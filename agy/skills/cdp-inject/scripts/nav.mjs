#!/usr/bin/env node
// 通过 CDP 导航当前（或匹配的）标签页：node nav.mjs <url> [targetUrlSubstring]
import { WebSocket } from "ws";
const [url, match] = process.argv.slice(2);
if (!url) { console.error("用法: nav.mjs <url> [目标标签页URL子串]"); process.exit(1); }
const port = process.env.CDP_PORT || 9222;
const tabs = (await (await fetch(`http://localhost:${port}/json`)).json()).filter(t => t.type === "page");
const tab = (match && tabs.find(t => t.url.includes(match))) || tabs[0];
if (!tab) { console.error("没有可用标签页"); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
ws.on("open", () => ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } })));
ws.on("message", d => { if (JSON.parse(d).id === 1) { console.log("navigated:", url); ws.close(); process.exit(0); } });
setTimeout(() => process.exit(2), 8000);
