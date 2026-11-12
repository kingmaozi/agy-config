---
name: briking-agent-reach
description: >
  多源深度调研与特定平台检索工具（普通公开网页搜索请优先直接用宿主自带的 `search_web` / `read_url_content`，不要动用本 skill）。
  仅在以下场景使用：(1) 用户要求全网深度调研、跨源对比验证、带证据链的系统研究；
  (2) 需要检索 Google 抓不到或受限的渠道（微信公众号、X/Twitter、B站、V2EX、YouTube 字幕、RSS）；
  (3) 自带 `search_web` / `read_url_content` 搜不到或正文抓取受阻时兜底，或用户点名使用 Agent Reach。
  自动在三档中选择资源：fast / wide / deep，统一入口 `reach_run`，单渠道用对应 `reach_*` 工具。
  NOT for: 日常简单网页搜索、查官方文档（优先 `search_web` / `context7`）；写报告/数据分析/翻译；发帖/评论等写操作。
  边界：小红书 / Facebook / Instagram / 雪球改用 `agent-reach`（CLI 版），不要用 `reach_*` 硬凑。
metadata:
  openclaw:
    homepage: https://github.com/kingmaozi/briking-agent-reach-codex
---

# Agent Reach — 三档调研

## 核心原则

0. **普通搜索优先内置引擎**：日常查网页、查报错、找官网或公开资料，直接用 AGY 内置的 `search_web`（Google Grounding）与 `read_url_content`，秒回且不耗外部 API 额度；只有**跨渠道深度调研**、**搜微信/X/B站/V2EX/YouTube字幕**、或**内置搜索拿不到结果/正文**时，才启用本 skill。
1. **不要单磕一个渠道，也不要让用户自己选 API。** 确定需要启用本 skill 时，先判断用户要的是"快"、"全"还是"深"，再用 `reach_run` 启动对应档位。

```
reach_run(op="describe")                       # 可选：先看渠道与档位
reach_run(op="start", plan={query, tier, reason, costPolicy, includeSocial}, requestKey="...")
reach_run(op="get", runId="...")               # 读取进度与证据（分页，注意 nextCursor）
reach_run(op="advance", runId, revision, tasks, claims, requestKey)  # 读证据后补下一轮并提交结论
reach_run(op="finalize", runId, revision, claims)                    # 结束
```

`start` 返回的是"已完成第一轮、等待宿主处理"的快照；**必须先 `get` 读证据，再决定 `advance` 或 `finalize`**，不要在 `start` 之后直接说研究完成。深度档例外：`start` 会自动延伸跑完多轮（通常 2–3 轮、数十秒到几分钟），返回时已接近收敛；你只需 `get` 读证据、`finalize` 提交结论，`advance` 只用于收敛后追加新方向。

## 选档规则

| 用户意图 | 档位 | 典型问法 |
| --- | --- | --- |
| 查事实、链接、最新动态、快速了解 | `fast` | "快速看一下…""今天有什么…""帮我找到官网" |
| 比较、选型、优缺点、真实评价 | `wide` | "比较一下…""哪个更适合我""有什么坑" |
| 系统梳理、论文、机制、争议、研究报告 | `deep` | "做一份研究报告""近三年论文与主要争议" |

- 用户明确说了档位，照用户的选择。
- 判断不了时默认 `wide`，用一句话说明理由，不要问用户"选哪个 API"。
- 医学、金融等高影响结论要提高证据要求，但不承诺替代专业意见。

## 三档会用到的资源

- **fast**：Tavily、Exa、Jina、Parallel 四路网页并发 + 微信（搜狗微信，公开搜索）+ X（默认必查）。
- **deep**：在 wide 基础上**自动延伸**：首轮后从证据提取关键词、生成相关搜索词继续检索，并读取高价值正文；跑满轮次/预算/时效上限或无新增证据时收敛停止。每轮扩展词会写入 `warnings` 与 `expansions` 字段，交付时如实说明延伸了什么。

## 必须遵守

- **X 是必查渠道**（除非用户明确说不要社交）。X 失败要如实说明，不能用站外索引冒充 X 检索。
- **免费优先**：`costPolicy="save"` 时先 Parallel/TinyFish，再动用账号额度；默认 `parallel` 按四路并发。
  注意：四路并发会消耗 Tavily/Exa/Jina 额度，不能同时宣称"完全不消耗额度"。
- **时效**：问"今天/最新"时在计划里给出时间范围；正文用 `freshness="live"`。
- **不得伪造**：没有证据的结论写 `unverified`；`supported` 必须带真实证据 ID。
- **付费研究默认关闭**：TinyFish Research、Valyu DeepResearch 需要用户先在本机建立授权引用；模型自己说"批准"无效。
- **桌面豆包**需用户主动要求并授权，不自动运行，会自动加入的只有网页与 X。
- **私有内容不外发**：本地文件、凭据、内部信息不放进查询。

## 交付要求

1. `start` 后告诉用户这次用哪一档、为什么。
2. `get` 读取证据；证据分页，必要时按 `nextCursor` 取完。
3. 需要补查时 `advance`，把结论与证据 ID 一起提交（`claims`）。
4. 交付时说明：成功渠道、不可用渠道与原因、证据缺口、剩余预算；不要罗列工具日志。
5. 中断恢复用 `resume`，取消用 `cancel`（取消不代表退款，外部计费任务可能已产生费用）。

## 浏览器 AI 源（豆包/Gemini，仅用户明确要求时使用）

3.2.0 起**深度档不再自动派发豆包/Gemini**（也不再有自动产生的 `hostExecuted` 待执行任务）。
用户明确说"问一下豆包/Gemini"时才用，且必须由**宿主主会话的内置浏览器**执行——MCP 侧不会启动浏览器：

1. 按宿主的浏览器技能 bootstrap：ZCode 用 `browser-use:control-browser`；MiniMax Code 用 `browser-use:control-in-app-browser`
2. 从插件安装路径导入 `scripts/browser-ai.mjs`，调用 `queryAiSource(browser, "doubao"|"gemini", query)`
3. 用 `decodeDoubaoLink()` 还原豆包被 `link.wtturl.cn` 包装的真实链接
4. **用完关闭本次创建的标签**并核对无残留
5. 结果以 `excerptType: "generated"` 回传——这是模型生成内容，不能当作一手证据

详见 [references/browser-ai.md](references/browser-ai.md)。未登录时如实报告不可用，不要绕过。

## 单渠道精确查询

| 需求 | MCP 工具 |
|---|---|
| 中文网页搜索 | `reach_tavily` |
| 国内通用搜索 / 抖音生态 | `reach_doubao`（需用户主动要求） |
| 英文/技术/代码搜索 | `reach_search`（Exa，mode=code） |
| GitHub 仓库/代码/issue | `reach_github` |
| 读任意网页正文 | `reach_read`（Jina Reader，可匿名） |
| V2EX | `reach_v2ex` |
| B站 | `reach_bilibili`（勿用 yt-dlp，风控412） |
| YouTube/字幕 | `reach_youtube` |
| RSS | `reach_rss` |
| 免 key 基础检索 | `reach_parallel` |
| 指定渠道精确调用 | `reach_provider`（provider + operation + input） |
| 渠道健康 | `reach_status`（默认离线；probe=true 会消耗额度） |

## 体检

`reach_status` 中 `health=unknown` 表示尚未验证，不等于可用或不可用。不要因为一次失败就断定渠道长期不可用，也不要反复重试已明确失败的渠道。

Jina：Reader（`r.jina.ai`）可匿名使用；Search（`s.jina.ai`）需要 API key，没有 key 时会被拒绝而不是返回空结果。
