---
name: powercontext-memory
description: Use at the start of project coding, debugging, or architecture tasks in Antigravity (AGY) to ensure isolated per-project PowerContext Scope and recall project Memory, Topic Memory, and Experience; and after verifying non-obvious bug root causes, integration pitfalls, or durable project rules to record them idempotently without secrets or log bloat.
---

# PowerContext Project Memory (AGY & Cross-Agent)

## Overview

Native Antigravity (`antigravity-acp`) connects directly to Google/Anthropic endpoints rather than routing chat HTTP traffic through Magpie (`127.0.0.1:3425`). To ensure Antigravity shares the **exact same per-project isolated memory and troubleshooting Experience** as Magpie/Codex/Pi (`http://127.0.0.1:17429`), use the bundled zero-dependency CLI `scripts/pc.mjs` (or the `powercontext` MCP server after resolving `workspace_key`).

## 1. Start of Project Task: Ensure Scope & Recall Context

From the **project root directory** (never from a subdirectory, git linked worktree, `$HOME`, or `/tmp`), run:

```bash
node ~/.agents/skills/powercontext-memory/scripts/pc.mjs recall --query "本轮任务或排障关键词"
```

What this does automatically in one step (<100ms):
1. Computes `sha256(path.resolve(projectRoot))` — matching Magpie's `@magpie-community/gateway-powercontext` byte-for-byte.
2. Checks `POST /v1/scope-bindings/resolve` (`allow_default: false`); if unbound, atomically creates and binds the project's dedicated Scope (`Project memory for <root>`).
3. Calls `POST /v1/context/prepare` for `memory`, `topic-memory`, and `experience`, printing recalled rules, handoffs, and past pitfalls.

If you only need to bind/verify a new project folder without querying:

```bash
node ~/.agents/skills/powercontext-memory/scripts/pc.mjs ensure
```

## 2. After Verifying a Pitfall or Iron Rule: Record Idempotently

- **Never** dump routine transcripts or unverified guesses into PowerContext.
- **Never** pass API keys, tokens, cookies, passwords, or customer private messages (the CLI blocks secret patterns automatically).
- When a non-obvious bug root cause, tricky integration pitfall, or durable project constraint is **verified**, record it once from the project root:

```bash
# Record a verified troubleshooting pitfall into Experience (task-outcome -> propose -> approve)
node ~/.agents/skills/powercontext-memory/scripts/pc.mjs experience \
  --cue "报错关键词或触发特征" \
  --symptom "表面现象" \
  --situation "触发场景与上下文" \
  --action "已验证有效的排障与修复动作" \
  --outcome "修复后实际结果" \
  --condition "验收核对方式" \
  --lesson "可复用避坑结论"

# Record a durable project constraint / decision into Atomic Memory
node ~/.agents/skills/powercontext-memory/scripts/pc.mjs rule \
  --kind constraint \
  --text "明确的项目硬约束或铁律"
```

## 3. Using the `powercontext` MCP Server Directly

When calling `powercontext` MCP tools (`search_memory`, `search_topic_memory`, `get_recall_manifest`, `remember_memory`, etc.), **never** hardcode or guess `scope_id`, and **never** fall back to `Default` for a real project:
1. First resolve the exact project `scope_id` via `pc.mjs ensure` or `resolve_scope_binding` (`allow_default: false`, `binding_keys: [{ integration: "magpie", kind: "workspace", external_id: sha256(path.resolve(root)) }]`).
2. Pass that `scope_id` to subsequent `powercontext` MCP calls.
