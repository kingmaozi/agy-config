# 已安装插件与 MCP 服务完整清单

本套环境共包含 **三层插件体系**：
1. **T3 Code + Antigravity 挂载的 MCP 工具插件（6 个外部 + 1 个 T3 内置）**
2. **Antigravity 桌面端插件市场已装插件（8 个）**
3. **Magpie 本地模型网关已装插件（13 个）**

---

## 一、MCP 服务插件（`mcp_config.json`）

模板文件：
- T3 下的 AGY 配置：[`agy/mcp_config.t3.template.json`](../agy/mcp_config.t3.template.json)
- 独立桌面 AGY 配置：[`agy/mcp_config.desktop.template.json`](../agy/mcp_config.desktop.template.json)

| MCP 名称 | 用途说明 | 来源与新电脑还原方式 |
| :--- | :--- | :--- |
| **`t3-code`** *(T3 自动注入)* | T3 核心编排器：`delegate_task` 子代理派发、浏览器 `preview_*`、真机模拟器 `device_*`、图表渲染 `html_render`、PR 链接与盯守 | 安装并启动 **T3 Code** 后对内部会话自动注入，无需手动配 `mcp_config.json` |
| **`powercontext`** | 项目隔离记忆与踩坑经验 MCP（`http://127.0.0.1:17429/mcp/`） | 按 [`powercontext/README.md`](../powercontext/README.md) 启动本机 PowerContext 服务后即刻就绪 |
| **`context7`** | 实时查询第三方框架/SDK 最新官方文档（`https://mcp.context7.com/mcp`） | 远程免安装 HTTP MCP，`install.sh` 写入配置即用 |
| **`rea_anything`** | 逆向工程全能分析器（Mach-O / Android APK / Electron / Web Bundle / 原生 UI 追踪） | 已脱敏收录在本仓库 [`vendor/rea-anything/`](../vendor/rea-anything/)（去除了 `node_modules`），`install.sh` 自动复制到 `~/plugins/rea-anything` 并执行 `npm ci` |
| **`briking_agent_reach`** | 多源深度检索（微信文章、B站、V2EX、YouTube 字幕、RSS、GitHub、Tavily 等） | 来自私有仓库 `kingmaozi/briking-private`（`plugins/briking-agent-reach`）；`install.sh` 检测到 `gh` 已登录会自动浅克隆到 T3 AGY `vendor/briking-private` |
| **`codegraph`** | AST 级代码调用图谱检索（`codegraph_callers` / `callees` / `impact` / `trace`） | 启动脚本同样位于 `kingmaozi/briking-private`（`plugins/codegraph/launch.sh`），另需本机安装 `~/.local/bin/codegraph` 二进制 |
| **`lcu`** | macOS 桌面级 Computer Use 自动化（`js` / `js_reset` 驱动无障碍树、点击输入、截屏） | 需本机已装 LCU（`~/.local/share/lcu`）及 `/Applications/ChatGPT.app` 自带的 `cua_node`；AGY 专用代理桥接脚本已收录于 [`vendor/lcu-proxy/antigravity-cua.mjs`](../vendor/lcu-proxy/antigravity-cua.mjs)，`install.sh` 会自动在缺失时补齐 |

---

## 二、Antigravity 桌面端插件市场已装插件（8 个）

对应独立桌面版 Antigravity（`~/.gemini/antigravity/plugin_data/`），新电脑登录 Antigravity 后可在插件面板搜索同名安装：

| 插件 ID | 市场来源 | 版本 | 说明 |
| :--- | :--- | :--- | :--- |
| **`superpowers`** | `antigravity-plugins-partners` | `7.0.2` | TDD、系统性排障、头脑风暴、计划编写、代码审查等研发工程纪律套件（其全部 Skill 已直接打包在本仓库 `agy/skills/` 中） |
| **`chrome-devtools-plugin`** | `antigravity-plugins-partners` | 内置跟版 | Chrome DevTools 调试联动 |
| **`context7`** | `antigravity-plugins-partners` | 内置跟版 | 最新技术文档检索 |
| **`firebase`** | `antigravity-plugins-partners` | `1.0.0-agy` | Firebase 工具集成 |
| **`linear`** | `antigravity-plugins-partners` | `1.0.0-agy` | Linear 任务看板联动 |
| **`notion`** | `antigravity-plugins-partners` | `0.1.0-agy` | Notion 文档读写联动 |
| **`stripe`** | `antigravity-plugins-partners` | `0.0.2` | Stripe 支付接口集成 |
| **`swarm`** | 内置 Sidecar | `schema v1` | 多智能体看板 Sidecar |

---

## 三、Magpie 本地网关插件（`~/.config/magpie/plugins.json`）

完整配置模板见 [`powercontext/magpie-plugins.template.json`](../powercontext/magpie-plugins.template.json)：

1. **核心记忆挂钩插件（必装）**：
   - `@magpie-community/gateway-powercontext@latest`
     - `serverUrl`: `"http://127.0.0.1:17429"`
     - `capture`: `true`
     - **注意**：在 Magpie 图形界面里，「记忆空间 ID（Scope）」**必须保持 `由服务端解析`**，切勿填死某个 ID！
2. **上游模型通道认证插件（按你开通的账号启用）**：
   - `@magpie-community/opencode-antigravity-auth@latest`
   - `@magpie-community/opencode-zcode-auth@latest`
   - `@magpie-community/opencode-devin-auth@latest`
   - `@magpie-community/opencode-factory-auth@latest`
   - `@magpie-community/opencode-opendesign-auth@latest`
   - `@magpie-community/opencode-commandcode-auth@latest`
   - `@magpie-community/opencode-workbuddy-auth@latest`
   - `@magpie-community/opencode-minimax-auth@latest`
   - `@magpie-community/opencode-qoder-auth@latest`
   - `@magpie-community/opencode-trae-auth@latest`
   - `@magpie-community/opencode-kiro-auth@latest`
   - `@magpie-community/opencode-zen-free-auth@latest`
