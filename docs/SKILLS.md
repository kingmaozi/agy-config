# 已安装 Skills 完整清单（共 42 个：19 个默认常驻 + 23 个按需开启，已全部随仓打包）

本仓库已把主力机全部 **42 个 Skills 的完整正文与脚本（总计仅 2.57 MB，零密钥、全可移植路径）** 收录进仓，并按主力机当前的精简防膨胀状态分为两档：

- **默认启用常驻核心（19 个，[`agy/skills/`](../agy/skills/)）**：运行 `bash scripts/install.sh` 默认装入 T3 AGY，保持系统提示词精简利落；其中 **6 个跨宿主核心技能**（`t3-subagent-routing`、`powercontext-memory`、`agent-reach`、`ponytail`、`ponytail-audit`、`ponytail-review`）同时同步到 `~/.agents/skills/` 供 Codex 共读。
- **可选扩展技能库（23 个，[`agy/optional-skills/`](../agy/optional-skills/)）**：随仓完整保留，平时不塞入提示词省 Token；需要全部启用时运行 `bash scripts/install.sh --all-skills`（或单独复制某一个目录进 `config/skills/`）即可秒开。

---

## 一、默认常驻核心 Skills（19 个 · `agy/skills/`）

| 分类 | Skill 名称 | 用途说明 | 跨宿主共享 (`~/.agents/skills`) |
| :--- | :--- | :--- | :---: |
| **编排与记忆** | **`t3-subagent-routing`** | T3 六大子智能体硬编码路由规则（`Explore`/`Lin`/`code-pro`/`Pixel`/`Rigel`/`code-review` + 防递归护栏） | ✅ |
| **编排与记忆** | **`powercontext-memory`** | 跨宿主项目独立记忆与踩坑经验沉淀（内置零依赖 `scripts/pc.mjs`：`recall`/`ensure`/`experience`/`rule`） | ✅ |
| **检索与自动化** | **`briking-agent-reach`** | 多源深度调研（微信、X/Twitter、B站、V2EX、YouTube 字幕、RSS，分 `fast/wide/deep` 三档） | — |
| **检索与自动化** | **`agent-reach`** | 只读跨平台内容读取 CLI（小红书、雪球、Boss直聘、Instagram 等补缺口） | ✅ |
| **检索与自动化** | **`cdp-inject`** | 通过 Chrome DevTools Protocol 复用登录态浏览器直接注入 JS 提取 JSON（不重启浏览器） | — |
| **检索与自动化** | **`lcu-computer-use`** | macOS 桌面级 Computer Use 自动化（配合 `lcu` MCP 操控原生 App） | — |
| **检索与自动化** | **`reverse-engineer-anything`** | 二进制 / Electron / 移动端 / Web 打包产物逆向分析指南（配合 `rea_anything` MCP） | — |
| **极简与审查** | **`ponytail`** | 资深懒人开发模式：最小改动完整解决问题，拒绝过度设计 | ✅ |
| **极简与审查** | **`ponytail-review`** | 改动质量审查：逻辑、安全、负载表现、慢路径与删减冗余 | ✅ |
| **极简与审查** | **`ponytail-audit`** | 整仓质量大体检：Bug、安全隐患、无测高危区、可删死代码排行 | ✅ |
| **工程红线** | **`systematic-debugging`** | 遇到任何报错或测试失败先做根因定位，严禁盲猜乱改 | — |
| **工程红线** | **`verification-before-completion`** | 汇报“已完成/已修好”前必须跑真实验证命令确认输出 | — |
| **前端构建** | **`frontend-app-builder`** | 从零构建高审美前端应用、看板、创意落地页与浏览器实测 | — |
| **前端构建** | **`image-to-code`** | 设计稿/截图高保真还原为响应式前端代码 | — |
| **前端构建** | **`react-best-practices`** | Vercel 出品的 React / Next.js 性能优化最佳实践 | — |
| **前端构建** | **`shadcn-best-practices`** | `shadcn/ui` 组件编排、主题预设与排障规范 | — |
| **办公文档** | **`documents`** | `.docx` / Word 文档生成、批注修订与 `render_docx.py` 视觉渲染核验 | — |
| **办公文档** | **`spreadsheets`** | `.xlsx` / `.csv` 表格公式、格式、图表生成与重算校验 | — |
| **办公文档** | **`pdf`** | PDF 解析、表单生成与 Poppler 页面渲染校验 | — |

---

## 二、可选扩展 Skills（23 个 · `agy/optional-skills/`，支持 `--all-skills` 开启）

| 分类 | 包含的 Skills | 说明 |
| :--- | :--- | :--- |
| **Superpowers 完整流程扩展（13 个）** | `using-superpowers`、`brainstorming`、`writing-plans`、`executing-plans`、`subagent-driven-development`、`dispatching-parallel-agents`、`test-driven-development`、`requesting-code-review`、`receiving-code-review`、`using-git-worktrees`、`finishing-a-development-branch`、`writing-skills`、`diagnosing-superpowers` | 重度多阶段规划/写新 Skill 时按需启用 |
| **GitHub PR 工作流（4 个）** | `github`、`yeet`、`gh-address-comments`、`gh-fix-ci` | GitHub PR 评论闭环、Actions 修挂与草稿 PR 发布 |
| **前端测试/克隆/视频（4 个）** | `frontend-testing-debugging`、`url-to-code`、`design-qa`、`remotion` | 网页克隆、设计稿像素对比 QA、React 代码做视频 |
| **演示与实时表格（2 个）** | `presentations`、`excel-live-control` | PPTX 母版演示文稿生成、实时操控打开的 Excel |

---

## 三、单项目内置 Skill 套件（`powercontext/project-kit`）

位于 [`powercontext/project-kit/skills/powercontext-project-scope/SKILL.md`](../powercontext/project-kit/skills/powercontext-project-scope/SKILL.md)，供需要放进具体业务仓库 `.agents/skills/` 内部时直接拷贝。
