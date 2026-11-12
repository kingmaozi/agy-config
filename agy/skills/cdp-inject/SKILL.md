---
name: cdp-inject
description: 复用当前浏览器页面，通过 Chrome DevTools Protocol 注入 JS 提取 JSON 数据。永不重启、永不杀进程、固定独立 profile 保留登录态。适用于精确读取页面结构化数据而非截图的场景。
---

# CDP Inject — 复用当前浏览器提取 JSON 数据

> ❗**最高行为规则（2026-06-23 修正）**：
> - **绝不允许杀正在运行的 Chrome 或重启浏览器** — 登录态会丢失
> - CDP 端口在线就**直接复用**，绝不多事
> - 固定使用 `~/.chrome-cdp-profile` 独立 profile，首次登录后永久复用
> - 你说「cdp skills」就立即执行提取，不啰嗦

> 路径变量：`export CDP_INJECT=__T3_AGY_SKILLS_DIR__/cdp-inject`（下文所有命令用它）。
> 已移植：原 `browser/nav.cjs` 依赖换成自带的 `scripts/nav.mjs <url> [标签页URL子串]`。

## 触发词

`cdp` `cdp技能` `cdp-inject` `复用当前浏览器` `获取页面json` `注入js` `提取页面数据` `读取页面信息 不要视觉`

## 核心原理

```
当前 Chrome（已有登录态+插件）
  → HTTP GET localhost:9222/json（获取标签页列表）
  → WebSocket 连接目标页面
  → Runtime.evaluate（注入 JS）
  → return 精确 JSON（非视觉、非截图）
```

## 使用步骤

### 第 0 步：检查 CDP 端口

```bash
node "$CDP_INJECT"/scripts/check-port.mjs
```

🟢 端口在线 → 直接跳第 2 步
🔴 端口不在线 → 用 `restart-chrome.mjs --force` 重启（**首次需登录**，之后永久复用）

### 第 1 步：导航到目标页面

```bash
# 通过 CDP 导航（推荐）
node "$CDP_INJECT/scripts/nav.mjs" https://mms.pinduoduo.com/home/

# 或通过 AppleScript
osascript -e 'tell application "Google Chrome" to set URL of active tab of front window to "https://目标网址"'
```

### 第 2 步：注入 JS 提取 JSON

```bash
node "$CDP_INJECT"/scripts/extract-json.mjs '
JSON.stringify({
  "📄 标题": document.title,
  "🔗 链接": window.location.href,
  "📊 数据": "你要提取的任何字段"
}, null, 2)
'
```

用 IIFE 写复杂逻辑：

```bash
node "$CDP_INJECT"/scripts/extract-json.mjs '
(() => {
  const items = Array.from(document.querySelectorAll(".item"))
    .slice(0, 10)
    .map((el, i) => ({排名: i+1, 标题: el.textContent.trim().substring(0, 30)}));
  return JSON.stringify({
    "📄 页面标题": document.title,
    "📊 总数": items.length,
    "🎯 数据": items
  }, null, 2);
})()
'
```

### 第 3 步：等用户扫码（如果需要登录）

提取结果重定向到登录页时，提示用户扫码，等待完成后重新提取。

---

## 脚本说明

| 脚本 | 用途 |
|------|------|
| `check-port.mjs` | 检查 CDP 端口状态 + 显示当前打开页面 |
| `restart-chrome.mjs` | 安全重启（端口在线就不动；需加 --force 才重启） |
| `extract-json.mjs` | 核心：注入 JS 提取 JSON 数据 |

## 关键技术决策

| 决策 | 原因 |
|------|------|
| **永不杀正在运行的 Chrome** | 杀进程 = 丢登录态 = 要重新扫码 = 浪费时间 |
| **固定 ~/.chrome-cdp-profile** | Chrome 149+ 禁止用默认 profile 开 CDP，必须独立目录 |
| **首次安装插件+登录一次** | 之后所有会话永久复用，绝不再杀 |
| **直接调二进制（不用 open -a）** | macOS `open -a` 会把参数只传给子进程，主进程收不到 |
| **启动必加 `--no-sandbox --disable-gpu`** | 从 ZCode 进程树 spawn 时 Chrome 沙箱初始化失败必崩（EXC_BREAKPOINT）；2026-07-29 实测 Chrome 150/macOS 26 |

## 踩过的坑（记忆已存储）

- `memory/mistakes.md`: Chrome 149 CDP 必须独立 profile + 不能杀进程
- `memory/decisions.md`: CDP-inject 标准化取数据取代视觉方案
- 向量库搜索: `npm run memory:search -- daima "cdp 端口绑定"`

## 依赖

```bash
npm install --prefix $CDP_INJECT ws
```