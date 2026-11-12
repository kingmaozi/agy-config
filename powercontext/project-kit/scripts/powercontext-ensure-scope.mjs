#!/usr/bin/env node
// 确保当前项目根在机内 PowerContext 服务中拥有独立且唯一的 Magpie workspace Scope 绑定。
// Node 18+，仅使用内置模块；严禁附带 Authorization 或改动 Magpie 全局配置。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:17429';
const DEFAULT_TIMEOUT_MS = 5_000;
const GIT_ENV_STRIP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];

export class ScopeConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeConflictError';
    this.exitCode = 2;
  }
}

function defaultGitRunner(args, cwd) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const key of GIT_ENV_STRIP) delete env[key];
  const res = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 3_000 });
  return {
    status: res.status,
    signal: res.signal ?? null,
    error: res.error ?? null,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function isSameOrSubpath(target, base) {
  if (!base) return false;
  const resolvedBase = path.resolve(base);
  return target === resolvedBase || target.startsWith(`${resolvedBase}${path.sep}`);
}

export function resolveProjectRoot(options = {}) {
  const rawCwd = options.cwd !== undefined ? options.cwd : process.cwd();
  if (typeof rawCwd !== 'string' || rawCwd.trim() === '') {
    throw new Error('拒绝空路径：无法确定项目根目录');
  }

  const normalizedCwd = path.resolve(rawCwd);
  const homeDir = path.resolve(options.homeDir || process.env.HOME || os.homedir());
  const sysTmp = os.tmpdir() ? path.resolve(os.tmpdir()) : '';

  const checkForbidden = (candidate) => {
    if (!candidate || candidate === path.parse(candidate).root || candidate === '/') {
      throw new Error(`拒绝根目录路径：${candidate || '(empty)'}`);
    }
    if (candidate === homeDir) {
      throw new Error(`拒绝将 $HOME 绑定为项目：${candidate}`);
    }
    if (
      isSameOrSubpath(candidate, '/tmp') ||
      isSameOrSubpath(candidate, '/private/tmp') ||
      (sysTmp && isSameOrSubpath(candidate, sysTmp))
    ) {
      throw new Error(`拒绝将临时目录绑定为项目：${candidate}`);
    }
  };

  checkForbidden(normalizedCwd);

  const runGit = options.gitRunner ?? defaultGitRunner;
  const topRes = runGit(['rev-parse', '--show-toplevel'], normalizedCwd);
  if (topRes.error || topRes.signal) {
    const reason = topRes.error?.message || `signal ${topRes.signal}`;
    throw new Error(`Git 仓库边界检查失败（${normalizedCwd}）：${reason}；拒绝在未核实目录边界时绑定 Scope`);
  }

  if (topRes.status === 0) {
    const rawTop = (topRes.stdout ?? '').trim();
    if (!rawTop) {
      throw new Error(`git rev-parse --show-toplevel 返回空路径（${normalizedCwd}），拒绝继续`);
    }
    const gitTop = path.resolve(rawTop);
    checkForbidden(gitTop);

    if (normalizedCwd !== gitTop) {
      throw new Error(`拒绝把子目录绑定为项目（当前：${normalizedCwd}，仓库根：${gitTop}）；请切回项目根目录执行`);
    }

    const gitDirRes = runGit(['rev-parse', '--git-dir'], gitTop);
    const commonDirRes = runGit(['rev-parse', '--git-common-dir'], gitTop);
    if (
      gitDirRes.error ||
      gitDirRes.signal ||
      gitDirRes.status !== 0 ||
      !(gitDirRes.stdout ?? '').trim() ||
      commonDirRes.error ||
      commonDirRes.signal ||
      commonDirRes.status !== 0 ||
      !(commonDirRes.stdout ?? '').trim()
    ) {
      throw new Error(`无法核实 git worktree 状态（${gitTop}），拒绝在未确认主仓边界时绑定 Scope`);
    }

    const gitDir = path.resolve(gitTop, gitDirRes.stdout.trim());
    const commonDir = path.resolve(gitTop, commonDirRes.stdout.trim());
    if (gitDir !== commonDir) {
      throw new Error(`拒绝将 git worktree 绑定为独立项目：${gitTop}（主仓公共目录：${commonDir}）`);
    }

    return gitTop;
  }

  const stderrText = String(topRes.stderr ?? '');
  if (topRes.status === 128 && /not a git repository/iu.test(stderrText)) {
    return normalizedCwd;
  }

  throw new Error(
    `Git 仓库边界检查异常（status=${topRes.status}，cwd=${normalizedCwd}）：${stderrText.trim() || '未知错误'}；拒绝继续`
  );
}

// 与 @magpie-community/gateway-powercontext 完全一致：sha256(path.resolve(root))，不调 realpath、不加尾部斜杠。
export function computeWorkspaceKey(root) {
  return crypto.createHash('sha256').update(path.resolve(root)).digest('hex');
}

async function requestJson(baseUrl, method, route, body, timeoutMs) {
  const url = new URL(route, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch (err) {
    const detail = err?.cause?.message || err?.message || String(err);
    throw new Error(`PowerContext 服务不可达（${baseUrl}）：${detail}。拒绝静默回退到 Default Scope`);
  }

  const rawText = await res.text();
  let json = null;
  if (rawText) {
    try {
      json = JSON.parse(rawText);
    } catch {
      json = null;
    }
  }
  return { status: res.status, rawText, json };
}

function assertNotConflictingScope(scopeObj, expectedTitle, expectedSummary, root) {
  if (!scopeObj || typeof scopeObj.scope_id !== 'string' || !scopeObj.scope_id.trim()) {
    throw new Error(`PowerContext 返回了无效的 Scope 描述：${JSON.stringify(scopeObj)}`);
  }
  const summary = typeof scopeObj.summary === 'string' ? scopeObj.summary : '';
  if (scopeObj.title !== expectedTitle || summary !== expectedSummary) {
    throw new ScopeConflictError(
      `PowerContext 绑定冲突或缺少归属证明：workspace (${root}) 当前绑定到 Scope (scope_id=${scopeObj.scope_id}, title=${JSON.stringify(scopeObj.title)}, summary=${JSON.stringify(summary)})，与期望 (title=${JSON.stringify(expectedTitle)}, summary=${JSON.stringify(expectedSummary)}) 不一致，拒绝使用或覆盖`
    );
  }
}

async function withWorkspaceLock(workspaceKey, timeoutMs, fn) {
  const lockDir = path.join(os.tmpdir(), `powercontext-bind-${workspaceKey}.lock`);
  const pidFile = path.join(lockDir, 'owner.pid');
  const deadline = Date.now() + Math.max(timeoutMs, 2_000);
  const staleMs = 30_000;

  while (true) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      try {
        fs.writeFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
      } catch {
        // ignore metadata write failure once mkdir succeeded atomically
      }
      break;
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        throw new Error(`无法创建本机并发绑定锁（${lockDir}）：${err?.message || String(err)}`);
      }
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`等待本机并发绑定锁超时（${lockDir}），拒绝并发竞争写入 Scope 绑定`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // best-effort lock cleanup
    }
  }
}

async function resolveWorkspaceBinding(baseUrl, workspaceKey, timeoutMs) {
  return requestJson(
    baseUrl,
    'POST',
    '/v1/scope-bindings/resolve',
    {
      allow_default: false,
      explicit_scope_id: null,
      binding_keys: [{ integration: 'magpie', kind: 'workspace', external_id: workspaceKey }],
    },
    timeoutMs
  );
}

async function findScopeByTitle(baseUrl, expectedTitle, expectedSummary, timeoutMs, maxPages = 100) {
  let cursor = null;
  let conflictingTitleCandidate = null;
  for (let page = 0; page < maxPages; page += 1) {
    const qs = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const listRes = await requestJson(baseUrl, 'GET', `/v1/scopes${qs}`, undefined, timeoutMs);
    if (listRes.status !== 200 || !Array.isArray(listRes.json?.items)) {
      throw new Error(`GET /v1/scopes 失败（HTTP ${listRes.status}）：${listRes.rawText}`);
    }
    const exactSummaryMatch = listRes.json.items.find(
      (item) => item?.title === expectedTitle && item?.summary === expectedSummary
    );
    if (exactSummaryMatch?.scope_id) return exactSummaryMatch;

    if (!conflictingTitleCandidate) {
      conflictingTitleCandidate = listRes.json.items.find((item) => item?.title === expectedTitle) ?? null;
    }

    cursor = listRes.json.next_cursor ?? null;
    if (!cursor) break;
  }
  if (cursor) {
    throw new Error(`GET /v1/scopes 分页超过安全上限（${maxPages} 页），拒绝在不完整扫描下继续绑定 Scope`);
  }
  if (conflictingTitleCandidate) {
    throw new ScopeConflictError(
      `PowerContext 存在同名但无法证明归属当前路径的 Scope（title=${JSON.stringify(expectedTitle)}, scope_id=${conflictingTitleCandidate.scope_id}, summary=${JSON.stringify(conflictingTitleCandidate.summary)}），拒绝跨项目复用 scope_id`
    );
  }
  return null;
}

export async function ensureProjectScope(options = {}) {
  const serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = options.maxPages ?? 100;
  const root = options.root !== undefined
    ? resolveProjectRoot({ ...options, cwd: options.root })
    : resolveProjectRoot(options);
  const workspaceKey = computeWorkspaceKey(root);
  const title = path.basename(root);
  const summary = `Project memory for ${root}`;

  // 快速路径：已绑定且归属核验通过时无锁直接返回
  const fastResolve = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
  if (fastResolve.status === 200) {
    assertNotConflictingScope(fastResolve.json, title, summary, root);
    return { scopeId: fastResolve.json.scope_id, root, workspaceKey, created: false };
  }
  if (fastResolve.status === 409) {
    throw new ScopeConflictError(
      `PowerContext 绑定冲突（HTTP 409）：workspace 已存在指向缺失目标的持久化绑定，拒绝自动覆盖：${fastResolve.rawText}`
    );
  }
  if (fastResolve.status !== 404) {
    throw new Error(`POST /v1/scope-bindings/resolve 异常（HTTP ${fastResolve.status}）：${fastResolve.rawText}`);
  }

  // 慢路径：加本机原子目录锁串行化同 workspace 并发初始化，防止并发竞态覆盖
  return withWorkspaceLock(workspaceKey, timeoutMs, async () => {
    const initialResolve = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
    if (initialResolve.status === 200) {
      assertNotConflictingScope(initialResolve.json, title, summary, root);
      return { scopeId: initialResolve.json.scope_id, root, workspaceKey, created: false };
    }
    if (initialResolve.status === 409) {
      throw new ScopeConflictError(
        `PowerContext 绑定冲突（HTTP 409）：workspace 已存在指向缺失目标的持久化绑定，拒绝自动覆盖：${initialResolve.rawText}`
      );
    }
    if (initialResolve.status !== 404) {
      throw new Error(`POST /v1/scope-bindings/resolve 异常（HTTP ${initialResolve.status}）：${initialResolve.rawText}`);
    }

    // 步骤 4：创建独立项目 Scope
    const createRes = await requestJson(
      serverUrl,
      'POST',
      '/v1/scopes',
      {
        title,
        summary,
        idempotency_key: `magpie-project:${workspaceKey}`,
      },
      timeoutMs
    );

    let scopeId;
    if (createRes.status === 201 || createRes.status === 200) {
      scopeId = createRes.json?.scope_id;
      if (typeof scopeId !== 'string' || !scopeId.trim()) {
        throw new Error(`POST /v1/scopes 未返回有效 scope_id：${createRes.rawText}`);
      }
    } else if (createRes.status === 409) {
      const existing = await findScopeByTitle(serverUrl, title, summary, timeoutMs, maxPages);
      if (!existing?.scope_id) {
        throw new Error(`POST /v1/scopes 返回 409，但在 GET /v1/scopes 中未找到归属当前路径的 Scope（title=${JSON.stringify(title)}）`);
      }
      scopeId = existing.scope_id;
    } else {
      throw new Error(`POST /v1/scopes 失败（HTTP ${createRes.status}）：${createRes.rawText}`);
    }

    // 绑定前二次确认未被外部并发绑定到其他 Scope，且必须明确处于未绑定 404 状态才允许 PUT
    const preBindCheck = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
    if (preBindCheck.status === 200) {
      assertNotConflictingScope(preBindCheck.json, title, summary, root);
      if (preBindCheck.json?.scope_id === scopeId) {
        return { scopeId, root, workspaceKey, created: false };
      }
      throw new ScopeConflictError(
        `PowerContext 绑定冲突：workspace 已绑定到 ${preBindCheck.json?.scope_id}，拒绝覆盖为 ${scopeId}`
      );
    }
    if (preBindCheck.status === 409) {
      throw new ScopeConflictError(
        `PowerContext 绑定冲突（HTTP 409）：绑定前复查发现 workspace 已存在指向缺失目标的持久化绑定，拒绝自动覆盖：${preBindCheck.rawText}`
      );
    }
    if (preBindCheck.status !== 404) {
      throw new Error(`绑定前复查 resolve 异常（HTTP ${preBindCheck.status}）：${preBindCheck.rawText}`);
    }

    // 步骤 5：写入 workspace 绑定
    const bindRes = await requestJson(
      serverUrl,
      'PUT',
      '/v1/scope-bindings',
      {
        key: { integration: 'magpie', kind: 'workspace', external_id: workspaceKey },
        scope_id: scopeId,
      },
      timeoutMs
    );
    if (bindRes.status !== 200 && bindRes.status !== 201) {
      throw new Error(`PUT /v1/scope-bindings 失败（HTTP ${bindRes.status}）：${bindRes.rawText}`);
    }

    // 步骤 6：再次 resolve 校验幂等一致性与路径归属
    const verifyRes = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
    if (verifyRes.status !== 200) {
      throw new Error(`绑定后校验 resolve 失败（HTTP ${verifyRes.status}）：${verifyRes.rawText}`);
    }
    if (verifyRes.json?.scope_id !== scopeId) {
      throw new ScopeConflictError(
        `绑定后校验不一致：期望 scope_id=${scopeId}，实际返回 ${verifyRes.json?.scope_id}（拒绝继续）`
      );
    }
    assertNotConflictingScope(verifyRes.json, title, summary, root);

    return { scopeId, root, workspaceKey, created: true };
  });
}

export async function main(options = {}) {
  const stdout = options.stdout ?? ((s) => process.stdout.write(s));
  const stderr = options.stderr ?? ((s) => process.stderr.write(s));
  try {
    const { scopeId, root } = await ensureProjectScope(options);
    stdout(`PowerContext scope_id=${scopeId} root=${root}\n`);
    return 0;
  } catch (err) {
    const code = err instanceof ScopeConflictError ? 2 : 1;
    stderr(`${err?.message || String(err)}\n`);
    return code;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exitCode = await main();
}
