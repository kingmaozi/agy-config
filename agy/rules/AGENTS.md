# 全局子代理编排规则（T3 Code · Antigravity）

1. **宿主内置子代理不禁止、不受约束**：
   - **内置专用功能子代理完全放行**：Antigravity 自带的专用能力型子代理（如 `image-generator` 生图、`browser` 等）随时可直接通过 `invoke_subagent` 正常调用，不受本规则任何限制。
   - **非 T3 环境自动放行**：当当前会话中不存在 `delegate_task` 工具时（如在 Antigravity 桌面端直接使用），本编排规则不生效，所有宿主内置子代理（含 `image-generator`、`self`、`research` 等）均可自由调用。
   - **T3 通用研发派单走 `delegate_task`**：仅当会话中存在 `delegate_task` 工具，且需要派发下方六类通用研发/审查角色时，统一调用 T3 的 `delegate_task`（不用通用 `self` / `research` 替代这六类角色）。
2. **防递归护栏（子代理自检）**：本派单规则仅对**顶层主会话（Orchestrator）**生效。若当前会话自身是被 `delegate_task` 派发的子代理（child / subagent），必须亲自执行交办任务，**不要再递归调用 `delegate_task` 派发通用研发子代理**（除非任务指令明确要求；调用 `image-generator` 等宿主内置能力子代理不受限）。
3. **能力预检与参数键名区分**：每个顶层线程首次派单前先调一次 `orchestrator_capabilities`。注意不同宿主的思考档位字段名不同：
   - `providerInstanceId: "codex"` 使用 `options: { "reasoningEffort": "..." }`
   - `providerInstanceId: "antigravity"` 使用 `options: { "thinking_level": "..." }`
4. **按任务类型硬传子代理配置**：
   - **只读侦察 (`Explore`)** → `role: "research"`, `target: { providerInstanceId: "codex", model: "group/262k", options: { reasoningEffort: "max" } }`
   - **后端主力 (`Lin · code`)** → `role: "implementation"`, `target: { providerInstanceId: "codex", model: "group/code", options: { reasoningEffort: "max" } }`（强制先失败后通过测试输出）
   - **难度编码 (`资深 · code-pro`)** → `role: "implementation"`, `target: { providerInstanceId: "codex", model: "gpt-6.1-terra", options: { reasoningEffort: "max" } }`（仅限 Lin 两次未过 / 跨 3+ 模块不变量 / 契约未定，派单必写一行“为什么 Lin 做不了”）
   - **前端界面 (`Pixel · frontend`)** → `role: "design"`, `target: { providerInstanceId: "antigravity", model: "claude-opus-5-5", options: { thinking_level: "high" } }`（交付附桌面+窄屏真实截图）
   - **测试与发布 (`Rigel · qa-release`)** → `role: "test"`, `target: { providerInstanceId: "codex", model: "gpt-6.1-terra", options: { reasoningEffort: "max" } }`（只写难测用例与 `release-check`，不改业务源码；若在 Magpie 建了 `group/qa` 可随时改成 `group/qa`）
   - **独立只读审查 (`code-review`)** → `role: "review"`, `target: { providerInstanceId: "codex", model: "group/code-reivew", options: { reasoningEffort: "high" } }`（每个实现改动必审，只读，只报 `confidence >= 80` 缺陷，返修走“原实现者 → 新状态测试 → 全新 `delegate_task` 复审”）

## PowerContext 项目专属记忆规则（AGY 直连与跨项目通用）

1. **开工确保独立 Scope 并召回历史记忆**：在具体项目根目录开展研发、排障或架构任务时（排除子目录、git worktree、临时/附件目录），先运行 `node ~/.agents/skills/powercontext-memory/scripts/pc.mjs recall --query "<本轮任务或问题关键词>"`（或通过 `powercontext` MCP 先 `resolve_scope_binding(allow_default=false)` 解析当前目录 `sha256(path.resolve(root))` 对应的专属 `scope_id`），与 Magpie 共享同一项目独立记忆池，绝不串台。
2. **踩坑经验与硬规则幂等沉淀（防膨胀、零泄密）**：日常闲聊与普通流水账禁止手动刷入记忆库；每当核实了**隐蔽 Bug 根因、真实踩坑经验或项目硬红线**，验收后在项目根目录运行 `node ~/.agents/skills/powercontext-memory/scripts/pc.mjs experience ...`（或 `rule ...`）幂等记录一次。严禁写入任何密码、Token、Cookie、API Key 或真实客户正文。
