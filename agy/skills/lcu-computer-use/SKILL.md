---
name: lcu-computer-use
description: macOS Desktop Computer Use via LCU (amontlabs/lcu) to inspect apps, read accessibility state, capture screenshots, click, type, and automate desktop UI.
---

# LCU Desktop Computer Use

Use LCU (`amontlabs/lcu`) whenever the user asks to inspect or control macOS native desktop apps (outside T3's built-in `preview_*` web browser).

## 1. Preferred: MCP `lcu` Server (`js` / `js_reset`)
If `lcu` appears in `<mcp_servers>`, call its `js` tool directly (via `mcp_lcu_js` or `call_mcp_tool` on `ServerName: "lcu", ToolName: "js"`). The first call returns the full `cua` API reference automatically.

## 2. Immediate CLI Fallback (when `lcu` MCP has not loaded in the current session yet)
Write a small `.mjs`/`.js` script with `cua` calls and run it with ChatGPT's bundled Node:
```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node ~/.local/share/lcu/proxy/run.mjs /tmp/cua_task.js
```
Any returned screenshots are saved to `/tmp/cua-shot-*.png` and can be viewed with `view_file` or copied as needed.

## 3. App Approvals on macOS
- Check approved apps: `~/.local/share/lcu/current/bin/lcu apps`
- Grant Touch ID approval for a new app: `~/.local/share/lcu/current/bin/lcu apps allow "<App Name or Bundle ID>"` (use command timeout >= 300s so the user can approve Touch ID).
- Revoke approval when requested: `~/.local/share/lcu/current/bin/lcu apps revoke "<App Name or Bundle ID>"`
