# 子智能体（Subagents）完整分配与编排规则

这套编排体系用于 **T3 Code + Antigravity（主脑） + Codex / Magpie（执行编队）** 多引擎协作。
主会话默认使用 `antigravity / gemini-4-carbon` 统筹规划与决策，具体侦察、编码、前端、难测、独审通过 T3 的 `delegate_task` 按职责精准分流到最擅长的模型。

规则源文件位于：
- 全局系统规则：[`agy/rules/AGENTS.md`](../agy/rules/AGENTS.md)（自动软链到 `~/.gemini/GEMINI.md`）
- 全局编排技能：[`agy/skills/t3-subagent-routing/SKILL.md`](../agy/skills/t3-subagent-routing/SKILL.md)

---

## 一、六大研发子智能体硬编码路由总表

| # | 角色代号 | `role` | 宿主 (`providerInstanceId`) | 模型 (`model`) | 思考档位 (`options`) | 职责边界与硬门禁 |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **`Explore`**（只读侦察） | `research` | `codex` | `group/262k` | `reasoningEffort: "max"` | 代码库探索、跨模块定位、架构与调用链梳理（**严格只读，不改文件**） |
| 2 | **`Lin · code`**（后端主力） | `implementation` | `codex` | `group/code` | `reasoningEffort: "max"` | 常规功能开发、后端实现、Bug 修复、重构（**强制 TDD：先看见失败测试输出，再写实现转绿**） |
| 3 | **`资深 · code-pro`**（疑难攻关） | `implementation` | `codex` | `gpt-6.1-terra` | `reasoningEffort: "max"` | **仅限** `Lin` 两次未过 / 跨 3+ 模块不变量 / 核心契约未定；派单 `task` 开头**必写一行“为什么 Lin 做不了：…”** |
| 4 | **`Pixel · frontend`**（前端界面） | `design` | `antigravity` | `claude-opus-5-5` | `thinking_level: "high"` | 前端页面、组件设计、交互动效、样式改版（**交付必须附桌面端 + 窄屏移动端真实渲染截图**） |
| 5 | **`Rigel · qa-release`**（测试与发布） | `test` | `codex` | `gpt-6.1-terra` | `reasoningEffort: "max"` | 边界/并发/回归等难测用例编写与 `release-check` 发布核验（**严禁修改业务源码**） |
| 6 | **`code-review`**（独立只读审查） | `review` | `codex` | `group/code-reivew` | `reasoningEffort: "high"` | **每个实现改动必审**；严格只读；只报 `confidence >= 80` 的真实缺陷 |

> **注**：表中的 `group/262k`、`group/code`、`group/code-reivew` 是在本机 **Magpie（`127.0.0.1:3425`）** 中配置的模型组（定义见 [`powercontext/magpie-groups.reference.json`](../powercontext/magpie-groups.reference.json)）。注意 `group/code-reivew` 保留了原拼写以与现有网关组名完全匹配。

---

## 二、核心护栏与豁免规则（防止死循环与报错）

1. **宿主原生能力子代理完全放行（不受限）**：
   - `image-generator`（生图）、`browser` 等 Antigravity 原生专用能力子代理，`delegate_task` 无法替代，随时可通过原生 `invoke_subagent` 直接调用。
   - 若在**非 T3 环境**（如独立 Antigravity 桌面端、无 `delegate_task` 工具的会话）运行，本规则自动豁免，`self` / `research` 等内置子代理全部正常可用。
2. **防递归死循环（`<SUBAGENT-STOP>`）**：
   - 仅**顶层主会话（Orchestrator）**负责调用 `delegate_task` 派单。
   - 任何被 `delegate_task` 派发出来的子代理（提示词以 `Act as the ... sub-agent` 开头）必须亲自完成任务，**严禁再次调用 `delegate_task` 递归派发研发子代理**。
3. **首次派单前能力预检**：
   - 每个顶层线程第一次调用 `delegate_task` 前，先调用一次 `orchestrator_capabilities`（同一线程内无需重复调）。
4. **严格区分 Codex 与 Antigravity 的思考档位参数键名**：
   - 派给 `codex`：`target.options` 传 `{ "reasoningEffort": "max" }`（或 `"high"`）
   - 派给 `antigravity`：`target.options` 传 `{ "thinking_level": "high" }`
   - 传错键名会被对应宿主拒绝！
5. **并发注意事项**：
   - `codex` 子代理支持多路并发同时派发（并行写文件时需划分互不重叠的文件边界，或传 `isolation: "worktree"`）。
   - `antigravity` 子代理（如多个 `Pixel · frontend`）建议错开顺序派发，避免同一毫秒竞争初始化 ACP 会话。
6. **返修与复审闭环**：
   - 当 `code-review` 扫出缺陷时，**严禁对旧审查线程调用 `t3_thread_send` 追问**。
   - 正确闭环：**原实现者（`Lin` / `Pixel` / `code-pro`）修复 → 补新状态测试验证 → 发起一个全新的 `delegate_task` 独立复审**。

---

## 三、六个角色的标准 `delegate_task` 调用模板

### 1. `Explore`（只读侦察）
```json
{
  "title": "Explore · 只读侦察",
  "role": "research",
  "mode": "wait",
  "target": {
    "providerInstanceId": "codex",
    "model": "group/262k",
    "options": { "reasoningEffort": "max" }
  },
  "task": "只读排查：定位 xxx 模块调用链与根因，返回文件路径、行号与证据，不要修改任何文件。"
}
```

### 2. `Lin · code`（后端主力）
```json
{
  "title": "Lin · 后端实现",
  "role": "implementation",
  "mode": "wait",
  "target": {
    "providerInstanceId": "codex",
    "model": "group/code",
    "options": { "reasoningEffort": "max" }
  },
  "task": "实现 xxx：必须先编写/运行失败测试看到红灯输出，再实现最小代码使测试转绿，回报改动文件与测试结果。"
}
```

### 3. `资深 · code-pro`（难度编码）
```json
{
  "title": "资深 code-pro · 疑难攻关",
  "role": "implementation",
  "mode": "wait",
  "target": {
    "providerInstanceId": "codex",
    "model": "gpt-6.1-terra",
    "options": { "reasoningEffort": "max" }
  },
  "task": "为什么 Lin 做不了：跨 A/B/C 三个模块存在状态机并发不变量冲突。\n任务目标：..."
}
```

### 4. `Pixel · frontend`（前端界面）
```json
{
  "title": "Pixel · 前端界面",
  "role": "design",
  "mode": "wait",
  "target": {
    "providerInstanceId": "antigravity",
    "model": "claude-opus-5-5",
    "options": { "thinking_level": "high" }
  },
  "task": "完成 xxx 页面/组件开发，交付前必须完成桌面端与窄屏移动端真实渲染截图验证并附路径。"
}
```

### 5. `Rigel · qa-release`（测试与发布）
```json
{
  "title": "Rigel · 测试与发布核验",
  "role": "test",
  "mode": "wait",
  "target": {
    "providerInstanceId": "codex",
    "model": "gpt-6.1-terra",
    "options": { "reasoningEffort": "max" }
  },
  "task": "仅编写边界/并发/回归难测用例并执行 release-check，严禁修改业务源码。"
}
```

### 6. `code-review`（独立只读审查）
```json
{
  "title": "code-review · 独立只读审查",
  "role": "review",
  "mode": "wait",
  "target": {
    "providerInstanceId": "codex",
    "model": "group/code-reivew",
    "options": { "reasoningEffort": "high" }
  },
  "task": "独立只读审查本轮改动（附 diff 范围与需求目标）：严禁改代码，仅报告 confidence >= 80 的真实逻辑/安全/并发/边界缺陷。"
}
```
