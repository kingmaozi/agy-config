---
name: powercontext-project-scope
description: Use when starting work in a new or unbound project routed through local Magpie with PowerContext enabled, before the project's first Magpie model request, when POST /v1/scope-bindings/resolve (allow_default=false) returns HTTP 404 scope_not_found, or when onboarding a repository to isolated per-project PowerContext memory.
---

# PowerContext Project Scope Onboarding

## Overview

Magpie's `@magpie-community/gateway-powercontext` plugin automatically recalls and captures conversations against `http://127.0.0.1:17429`, **but never creates or binds project Scopes automatically**. Any unbound workspace silently falls back to the shared `Default` Scope on its first request.

**Core rule:** Run `node scripts/powercontext-ensure-scope.mjs` from the repository root **before** sending the project's first request through Magpie.

## When to Trigger

1. **Before the very first task in a new project** whose coding agents (Codex CLI, Claude Code, Pi, ZCode, T3 delegates) route requests through local Magpie (`http://127.0.0.1:3425`).
2. **Whenever `POST /v1/scope-bindings/resolve` (with `"allow_default": false`) returns HTTP `404`** (`scope_not_found`) for the current project root's `workspace_key`.

## Execution

From the **project root directory** (never from a subdirectory, linked git worktree, `$HOME`, or `/tmp`), run:

```bash
node scripts/powercontext-ensure-scope.mjs
```

Expected stdout (exit code `0`):

```text
PowerContext scope_id=scp_xxxxxxxxxxxxxxxxxxxxxxxxxx root=/absolute/path/to/project
```

If another repository does not yet have `scripts/powercontext-ensure-scope.mjs`, copy `scripts/powercontext-ensure-scope.mjs` from this repository (Node 18+ built-in modules only, zero npm dependencies) into the target project's `scripts/` directory and execute it before the first Magpie request.

## Critical Contract Rules

| Rule | Exact Requirement | Why Violation Breaks Isolation |
| :--- | :--- | :--- |
| **Workspace key hash** | `sha256(path.resolve(root))` (hex) | Must match Magpie hook (`sha256(resolve(ctx.cwd))`). Using `fs.realpathSync` or trailing `/` produces a different digest and misses the binding. |
| **Disable Default fallback on check** | Pass `"allow_default": false` in `POST /v1/scope-bindings/resolve` | PowerContext defaults `allow_default` to `true`, returning `200 Default` for unbound workspaces and masking missing bindings. |
| **Loopback no-auth** | Send **no** `Authorization` header to `http://127.0.0.1:17429` | Local service runs with `ACCESS_MODE=disabled`; never write or attach tokens. |
| **Conflict protection** | Exit code `2` without `PUT` if bound to another Scope | Never overwrite an existing workspace-to-Scope binding or reuse a `scope_id` across projects. |
| **Root-only boundary** | Reject empty path, `/`, `$HOME`, `/tmp`, `/private/tmp`, subdirs, and git worktrees | Subdirectories and linked worktrees have distinct `cwd` hashes and must never become standalone project Scopes. |
| **Fail closed on outage** | Exit non-zero if `http://127.0.0.1:17429` is unreachable | Never silently proceed and let conversations spill into `Default`. |

## Memory Hygiene & Recording Verified Pitfalls

- **Never manually save transcripts or routine logs:** Magpie's hook stages completed local conversations (`idleCaptureMs`, default 10 min) and PowerContext's background `group/262k` Worker filters them with `POWERCONTEXT_SERVER_RUNTIME_MEMORY_EXTRACTION_PROFILE=coding` (`atomic-memory.extract.coding.v4` + `reconcile.v3` + `artifact_dreaming`).
- **Record verified pitfalls & iron rules explicitly (`scripts/powercontext-record-lesson.mjs`):**
  - Magpie's automatic `conversation_completed` capture feeds `Memory` and `Topic Memory`, **never** `Experience` (which Magpie recalls via `sections: [{family: "experience", limit: 1}]`), and skips entire conversations whenever troubleshooting output matches Magpie's `secret` regex (`authorization:`, `token:`, `sk-...`, etc.).
  - When you verify a non-obvious bug root cause, tricky integration pitfall, or hard project rule, record a sanitized, secret-free entry once from the repo root (idempotent deduplication + secret-guard built in):
    ```bash
    # Record a verified troubleshooting lesson into Experience (propose + approve -> immediately recallable)
    node scripts/powercontext-record-lesson.mjs experience \
      --cue "报错关键词或触发特征" \
      --symptom "表面现象" \
      --situation "触发场景与上下文" \
      --action "已验证有效的排障与修复动作" \
      --outcome "修复后实际结果与验收方法" \
      --lesson "可复用避坑结论"

    # Record a durable project constraint / iron rule into Atomic Memory
    node scripts/powercontext-record-lesson.mjs rule \
      --kind constraint \
      --text "明确的项目硬约束或铁律"
    ```
  - **Never** pass raw API keys, tokens, cookies, or customer messages into `powercontext-record-lesson.mjs` (the CLI fails closed on secret patterns).
- **Do not modify global Magpie configuration** (`~/.config/magpie/plugins.json`) or manually mutate Scope bindings from project tasks.

## Verification Checklist

Run all four checks when onboarding or auditing a project:

1. **Idempotency (run twice):**
   ```bash
   node scripts/powercontext-ensure-scope.mjs
   node scripts/powercontext-ensure-scope.mjs
   ```
   Both runs exit `0` and output the **exact same** `scope_id` without creating duplicate Scopes.

2. **Direct `resolve` check (`allow_default: false`):**
   ```bash
   WK=$(node -e 'const p=require("path"),c=require("crypto");console.log(c.createHash("sha256").update(p.resolve(process.cwd())).digest("hex"))')
   curl -sS -i -X POST http://127.0.0.1:17429/v1/scope-bindings/resolve \
     -H 'Content-Type: application/json' \
     -d "{\"allow_default\":false,\"explicit_scope_id\":null,\"binding_keys\":[{\"integration\":\"magpie\",\"kind\":\"workspace\",\"external_id\":\"$WK\"}]}"
   ```
   Confirm `HTTP/1.1 200 OK` and the returned JSON `scope_id` matches step 1.

3. **Cross-project isolation:**
   Run the script in a different project root and confirm it returns a **different** `scope_id`.

4. **Scope listing visibility:**
   ```bash
   curl -sS http://127.0.0.1:17429/v1/scopes
   ```
   Confirm `items` contains an entry with `"title": "<project-folder-name>"` and the matching `"scope_id"`.

## Important Caveat

> **Next-request activation:** After binding completes, Magpie switches to the new project Scope on its **next** request. Any first-turn conversation that already ran *before* binding and landed in the shared `Default` Scope **will not migrate automatically**.
