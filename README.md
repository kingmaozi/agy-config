# agy-config

我的 **T3 Code + Antigravity（AGY 主脑）+ Magpie + PowerContext（完整版项目记忆）** 全局配置包：
包含 **六大子智能体硬编码分配规则**、**已装插件与 MCP 配置**、**全部 42 个 Skills 完整实体文件**、**PowerContext 1.5.1 终极防坑配置与本地 Apple Silicon 免费向量服务**。

目标：换新电脑后 `gh repo clone` + 一条命令原地还原（与 [`kingmaozi/codex-config`](https://github.com/kingmaozi/codex-config) 配对使用，构成完整的双引擎工作台）。

> **安全声明（私有仓库）**：仓内不含任何 API Key、Token、Cookie、`auth.json`、邮箱或业务数据库。所有敏感字段均已替换为 `<REDACTED>`，路径均已模板化为 `__HOME__` / `__T3_AGY_DIR__`，由安装脚本自动按新电脑环境渲染。

---

## 目录结构

| 路径 | 内容说明 |
| :--- | :--- |
| [`agy/rules/AGENTS.md`](agy/rules/AGENTS.md) | 全局规则真源（T3 六大子代理路由 + 防递归护栏 + PowerContext 记忆规则）→ 同步至 T3 AGY 与 `~/.gemini/GEMINI.md` |
| [`agy/skills/`](agy/skills/) | **19 个默认常驻核心 Skills 完整源码**（含 `t3-subagent-routing`、`powercontext-memory/scripts/pc.mjs`、`cdp-inject`、`ponytail` 等，保持提示词精简） |
| [`agy/optional-skills/`](agy/optional-skills/) | **23 个按需开启的扩展 Skills 完整源码**（Superpowers 全流程、GitHub PR 套件、PPT/Remotion 等，`--all-skills` 一键全开） |
| [`agy/mcp_config.t3.template.json`](agy/mcp_config.t3.template.json) | T3 下 AGY 的 6 个 MCP 服务配置模板（`briking_agent_reach`、`codegraph`、`lcu`、`context7`、`rea_anything`、`powercontext`） |
| [`agy/mcp_config.desktop.template.json`](agy/mcp_config.desktop.template.json) | 独立桌面端 Antigravity 的 MCP 配置模板 |
| [`agy/t3-settings.reference.json`](agy/t3-settings.reference.json) | T3 Code 默认模型与多宿主（`antigravity` / `codex` / `pi`）参考配置 |
| [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md) | **六大子智能体分配详解**（路由表、标准 `delegate_task` JSON、防递归与复审闭环） |
| [`docs/PLUGINS.md`](docs/PLUGINS.md) | **已装插件全清单**（MCP 插件 + AGY 桌面市场插件 + Magpie 网关插件） |
| [`docs/SKILLS.md`](docs/SKILLS.md) | **42 个 Skills 分类说明与触发场景** |
| [`powercontext/`](powercontext/README.md) | **PowerContext 1.5.1 完整版方案**：调优 `.env` 模板（`180k` 长对话防卡死 + 具名 Key 防死循环）、本地 MLX `EmbeddingGemma-2-768` 服务源码、Magpie 模型组配置、单项目接入脚本套件 |
| [`vendor/`](vendor/) | 本机无公开远程源的轻量组件：`rea-anything`（已剥离 `node_modules`）与 `lcu` 桌面桥接脚本 |
| [`scripts/install.sh`](scripts/install.sh) | 一键备份并还原 AGY 全局规则、42 个 Skills、Vendor 插件与 MCP 配置 |
| [`scripts/setup-powercontext.sh`](scripts/setup-powercontext.sh) | 一键部署本地 Apple Silicon 向量服务 + 安装 PowerContext `1.5.1` |

---

## 新电脑快速还原（3 步到位）

```bash
# 1. 登录 GitHub 并克隆本仓库（建议同时克隆配对的 codex-config）
gh auth login
gh repo clone kingmaozi/agy-config
cd agy-config

# 2. 一键还原 AGY 规则、42 个完整 Skills、MCP 与本地插件（自动先备份旧文件）
bash scripts/install.sh

# 3. 一键部署本地 MLX 向量服务 + PowerContext 1.5.1 完整版环境
bash scripts/setup-powercontext.sh
```

> **提示**：如果新电脑刚装好 T3 Code 还没点开过 Antigravity，先打开一次 T3 Code 随便选一下 Antigravity 让它生成 `~/.t3/userdata/providers/antigravity/<hash>/` 目录，再跑一次 `bash scripts/install.sh`（幂等安全）即可把 42 个 Skills 全部灌入 T3。

---

## 一图看懂：子智能体怎么分配？

详细参数模板见 [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md)。当主会话在 T3 Code 中统筹开发时，通过 `delegate_task` 按任务性质硬编码分流：

| 角色 | 宿主 & 模型 | 思考档位 | 干什么 & 硬规矩 |
| :--- | :--- | :--- | :--- |
| **`Explore`**（侦察兵） | `codex` · `group/262k` | `reasoningEffort: max` | 只读查代码库、理调用链、定根因（严禁改文件） |
| **`Lin · code`**（后端主力） | `codex` · `group/code` | `reasoningEffort: max` | 常规功能、后端实现、修 Bug（强制先看失败红灯测试再转绿） |
| **`资深 · code-pro`**（攻坚） | `codex` · `gpt-6.1-terra` | `reasoningEffort: max` | 仅限 `Lin` 两次未过或跨 3+ 模块核心难题（开头必写为何 `Lin` 做不了） |
| **`Pixel · frontend`**（前端） | `antigravity` · `claude-opus-5-5` | `thinking_level: high` | 页面视觉、组件交互、样式改版（交付必附桌面 + 手机窄屏真机渲染图） |
| **`Rigel · qa-release`**（测试） | `codex` · `gpt-6.1-terra` | `reasoningEffort: max` | 边界/并发/回归难测用例与 `release-check`（严禁改业务源码） |
| **`code-review`**（独审） | `codex` · `group/code-reivew` | `reasoningEffort: high` | 每次改动必审；只读；只报 `confidence >= 80` 缺陷；返修后必须新开任务复审 |

- **豁免规则**：`image-generator`（生图）、`browser` 等宿主原生专用子代理不受限制，直接用 `invoke_subagent`；独立桌面端无 `delegate_task` 时全部内置子代理自动放行。
- **防套娃护栏**：被派出去的子代理严禁再调 `delegate_task` 递归派发研发子代理。

---

## 插件与 Skills 概览

- **已装插件**：6 个 MCP 插件（`powercontext`、`context7`、`rea_anything`、`briking_agent_reach`、`codegraph`、`lcu`）+ T3 内置 `t3-code` + 8 个桌面市场插件 + Magpie `gateway-powercontext` 插件 → 详见 [`docs/PLUGINS.md`](docs/PLUGINS.md)。
- **已装 Skills**：共 **42 个**，从 `t3-subagent-routing`、`powercontext-memory`、`cdp-inject`、`ponytail` 到 `superpowers` 全套、前端设计、Office/PDF 文档技能**已全部随仓打包** → 详见 [`docs/SKILLS.md`](docs/SKILLS.md)。

---

## PowerContext 完整版怎么弄？

完整架构、防死循环与防卡死调优参数详见 [`powercontext/README.md`](powercontext/README.md)，核心只需记住 4 条铁律：
1. **具名钥匙防自噬**：在 Magpie 建一把名叫 `powercontext-worker` 的网关钥匙填进 `~/powercontext/.env` 的 `OPENAI_API_KEY`，切断后台整理请求二次被抓进 `Default` 池的死循环。
2. **Magpie Scope 保持「由服务端解析」**：让 Magpie 自动按项目根目录 `sha256(path.resolve(cwd))` 路由，搭配关闭 Codex 自带的 `[memories]`，做到不同项目 100% 物理隔离不串味。
3. **调高长对话上限到 `180000` tokens**：直接用本仓库配好的 [`powercontext/.env.template`](powercontext/.env.template)，彻底告别开启“保存完整对话”后长代码对话 `context_overflow` 堵死队列。
4. **新项目先跑一行 `pc.mjs ensure`**：进新项目根目录跑 `node ~/.agents/skills/powercontext-memory/scripts/pc.mjs ensure`，让 AGY、Codex、Pi 全部对齐同一个专属记忆池，修完大坑用 `pc.mjs experience` 沉淀进经验库。
