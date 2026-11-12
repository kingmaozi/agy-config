---
name: t3-subagent-routing
description: "【全局子代理编排规则 · T3 Code】仅在存在 delegate_task 工具的 T3 Code 环境中，派发六类通用研发子代理（Explore侦察 / 后端编码 / 资深攻关 / 前端界面 / 测试发布 / 代码审查）时走 T3 的 delegate_task（首次派单前先调一次 orchestrator_capabilities）。宿主内置功能型子代理（如 image-generator 生图、browser 等）以及无 delegate_task 的独立桌面/CLI 环境完全放行、不受限制。固定路由：Explore -> codex group/262k (reasoningEffort:max)；Lin后端 -> codex group/code (reasoningEffort:max)；资深code-pro -> codex gpt-6.1-terra (reasoningEffort:max)；Pixel前端 -> antigravity claude-opus-5-5 (thinking_level:high)；Rigel测试 -> codex gpt-6.1-terra (reasoningEffort:max)；code-review审查 -> codex group/code-reivew (reasoningEffort:high)。"
---

# 全局子代理编排规则（T3 Code）

<SUBAGENT-STOP>
如果你当前是被 `delegate_task` 派发的子代理（child / subagent，例如提示词以 `Act as the ... sub-agent for this task` 开头），必须亲自执行交办的研发任务，**不要再通过 `delegate_task` 递归派发通用研发子代理**（除非任务指令明确要求）；但调用宿主内置功能型子代理（如 `image-generator` 生图等）不受限制。
</SUBAGENT-STOP>

## 1. 适用范围与豁免规则

1. **宿主内置子代理不禁止、不受约束**：
   - **内置专用能力子代理完全放行**：如 `image-generator`（图片生成）、`browser` 等宿主自带的专用能力子代理（`delegate_task` 无法替代的宿主原生能力），随时可直接通过原生工具（如 `invoke_subagent` / `Agent`）自由调用，不受本规则任何限制。
   - **非 T3 环境完全放行**：若当前会话没有挂载 `t3-code` 的 `delegate_task` 工具（例如在 Antigravity 桌面端、独立 Claude Code 或 Codex CLI 中运行），本规则自动不生效，所有宿主内置子代理（含 `image-generator`、`self`、`research` 等）均可正常调用。
2. **T3 Code 通用研发角色走 `delegate_task`**：当且仅当当前会话存在 `delegate_task` 工具，且顶层主会话需要派发下方六类通用研发/审查任务时，统一调用 `t3-code` MCP 的 `delegate_task`（不要用通用 `self` / `research` 替代这六类派单）。
3. **首次派单前能力预检**：每个顶层线程首次调用 `delegate_task` 前，必须先调用一次 `orchestrator_capabilities`（同一线程内无需重复调用，除非报错或用户要求切换提供商）。
4. **严格区分不同目标宿主的思考档位字段名**：
   - 目标为 `providerInstanceId: "codex"` 时：`target.options` 传 `{ "reasoningEffort": "..." }`
   - 目标为 `providerInstanceId: "antigravity"` 时：`target.options` 传 `{ "thinking_level": "..." }`
   - `delegate_task` 常用顶层字段：`title`（简短标题）、`role`、`mode`（`"wait"` 或 `"async"`）、`isolation`（需要独立工作树时传 `"worktree"`）、`target`、`task`。
   - **并发注意**：`codex` 子代理支持多路同时并发；若需同时派发多个 `antigravity` 子代理（如多个 `Pixel · frontend`），请错开顺序派发，避免同一毫秒竞争打开 Antigravity ACP 会话。

## 2. 六大角色硬编码路由表

### ① 只读侦察（`Explore`）
- **适用场景**：代码库探索、跨模块定位、架构与调用链梳理（只读，不改文件）
- **`delegate_task` 参数**：
  ```json
  {
    "title": "Explore · 只读侦察",
    "role": "research",
    "mode": "wait",
    "target": {
      "providerInstanceId": "codex",
      "model": "group/262k",
      "options": { "reasoningEffort": "max" }
    }
  }
  ```

### ② 后端主力（`Lin · code`）
- **适用场景**：常规功能开发、后端实现、Bug 修复、重构
- **强约束**：强制先看见失败测试输出，再实现转绿通过
- **`delegate_task` 参数**：
  ```json
  {
    "title": "Lin · 后端实现",
    "role": "implementation",
    "mode": "wait",
    "target": {
      "providerInstanceId": "codex",
      "model": "group/code",
      "options": { "reasoningEffort": "max" }
    }
  }
  ```

### ③ 难度编码（`资深 · code-pro`）
- **适用场景**：**仅限** `Lin · code` 两次未过 / 跨 3+ 模块不变量 / 核心契约未定
- **强约束**：派单 `task` 开头**必写一行“为什么 Lin 做不了：...”**
- **`delegate_task` 参数**（走 Codex · GPT-6.1 Terra Max）：
  ```json
  {
    "title": "资深 code-pro · 疑难攻关",
    "role": "implementation",
    "mode": "wait",
    "target": {
      "providerInstanceId": "codex",
      "model": "gpt-6.1-terra",
      "options": { "reasoningEffort": "max" }
    }
  }
  ```

### ④ 前端界面（`Pixel · frontend`）
- **适用场景**：前端页面、组件设计、交互动效、样式改版与视觉还原
- **强约束**：交付必须附**桌面端 + 窄屏（移动端）真实渲染截图**验证
- **`delegate_task` 参数**（走 Antigravity · Claude Opus 5.5 High）：
  ```json
  {
    "title": "Pixel · 前端界面",
    "role": "design",
    "mode": "wait",
    "target": {
      "providerInstanceId": "antigravity",
      "model": "claude-opus-5-5",
      "options": { "thinking_level": "high" }
    }
  }
  ```

### ⑤ 测试与发布（`Rigel · qa-release`）
- **适用场景**：边界/并发/回归等难测用例编写、`release-check` 发布前核验
- **强约束**：**只写难测用例与执行 `release-check`，严禁修改业务源码**（注：若后续在 Magpie 新建了 `group/qa`，可将 `model` 改为 `"group/qa"`）
- **`delegate_task` 参数**：
  ```json
  {
    "title": "Rigel · 测试与发布核验",
    "role": "test",
    "mode": "wait",
    "target": {
      "providerInstanceId": "codex",
      "model": "gpt-6.1-terra",
      "options": { "reasoningEffort": "max" }
    }
  }
  ```

### ⑥ 独立只读审查（`code-review`）
- **适用场景**：**每个实现改动必审**
- **强约束**：
  - 严格只读，不改代码；只报 `confidence >= 80` 的真实缺陷。
  - 若发现问题需要返修，严格走闭环：**原实现者修复 → 补新状态测试 → 发起全新 `delegate_task` 复审**（严禁对旧审查线程 `t3_thread_send` 追问）。
- **`delegate_task` 参数**：
  ```json
  {
    "title": "code-review · 独立只读审查",
    "role": "review",
    "mode": "wait",
    "target": {
      "providerInstanceId": "codex",
      "model": "group/code-reivew",
      "options": { "reasoningEffort": "high" }
    }
  }
  ```
