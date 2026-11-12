#!/usr/bin/env node
// 跨项目通用 PowerContext 记忆工具（供 AGY / Codex / 命令行统一调用）：
// 子命令：
//   ensure                          确保当前项目根目录绑定独立 Scope（与 Magpie sha256(path.resolve(root)) 完全一致）
//   recall --query "<关键词>"        确保独立 Scope 并一次性召回 Memory + Topic Memory + Experience
//   experience --situation ...      将已验证的踩坑经验幂等沉淀入 Experience（含防泄密拦截）
//   rule --kind constraint --text … 将明确的项目硬规则幂等沉淀入 Atomic Memory（含防泄密拦截）

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:17429';
const DEFAULT_TIMEOUT_MS = 10_000;
const GIT_ENV_STRIP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'];
const ALLOWED_RULE_KINDS = new Set(['constraint', 'decision', 'fact', 'preference']);

const SECRET_PATTERN =
  /(?:(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|authorization|(?:set-)?cookie|session[_-]?id|phpsessid|jsessionid|connect\.sid|[A-Za-z0-9]*(?:password|passwd|pwd)|secret|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+:[^\s/?#@]+@|\b(?:sk|rk)_live_[A-Za-z0-9]{8,}|\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [^-]*PRIVATE KEY-----)/iu;

export class ScopeConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeConflictError';
    this.exitCode = 2;
  }
}

export function containsSecret(value) {
  if (typeof value !== 'string' || !value) return false;
  return SECRET_PATTERN.test(value);
}

function normalizeWhitespace(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim();
}

function requireCleanField(name, value, maxLength = 8000) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error(`缺少必填字段 ${name}`);
  if (trimmed.length > maxLength) throw new Error(`字段 ${name} 超出最大长度 ${maxLength}`);
  if (containsSecret(trimmed)) throw new Error(`禁止写入疑似密钥或凭据内容（字段：${name}）`);
  return trimmed;
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
      isSameOrSubpath(candidate, path.join(homeDir, '.t3', 'userdata', 'attachments')) ||
      isSameOrSubpath(candidate, path.join(homeDir, '.t3', 'scratch')) ||
      (sysTmp && isSameOrSubpath(candidate, sysTmp))
    ) {
      throw new Error(`拒绝将临时或附件目录绑定为独立项目：${candidate}`);
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
    if (!rawTop) throw new Error(`git rev-parse --show-toplevel 返回空路径（${normalizedCwd}），拒绝继续`);
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
      throw new Error(`无法核实 git worktree 状态（${gitTop}），拒绝继续`);
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
  throw new Error(`Git 仓库边界检查异常（status=${topRes.status}，cwd=${normalizedCwd}）：${stderrText.trim() || '未知错误'}`);
}

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
    throw new Error(`PowerContext 服务不可达（${baseUrl}）：${detail}`);
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
      `PowerContext 绑定冲突或缺少归属证明：workspace (${root}) 当前绑定到 Scope (scope_id=${scopeObj.scope_id}, title=${JSON.stringify(scopeObj.title)}, summary=${JSON.stringify(summary)})，拒绝使用或覆盖`
    );
  }
}

async function withWorkspaceLock(workspaceKey, timeoutMs, fn) {
  const lockDir = path.join(os.tmpdir(), `powercontext-bind-${workspaceKey}.lock`);
  const deadline = Date.now() + Math.max(timeoutMs, 2_000);
  const staleMs = 30_000;
  while (true) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
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
        throw new Error(`等待本机并发绑定锁超时（${lockDir}）`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {}
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
    const exact = listRes.json.items.find(
      (item) => item?.title === expectedTitle && item?.summary === expectedSummary
    );
    if (exact?.scope_id) return exact;
    if (!conflictingTitleCandidate) {
      conflictingTitleCandidate = listRes.json.items.find((item) => item?.title === expectedTitle) ?? null;
    }
    cursor = listRes.json.next_cursor ?? null;
    if (!cursor) break;
  }
  if (cursor) throw new Error(`GET /v1/scopes 分页超过安全上限（${maxPages} 页）`);
  if (conflictingTitleCandidate) {
    throw new ScopeConflictError(
      `存在同名但非当前路径的 Scope（title=${JSON.stringify(expectedTitle)}, scope_id=${conflictingTitleCandidate.scope_id}），拒绝跨项目复用`
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

  const fastResolve = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
  if (fastResolve.status === 200) {
    assertNotConflictingScope(fastResolve.json, title, summary, root);
    return { scopeId: fastResolve.json.scope_id, root, workspaceKey, created: false };
  }
  if (fastResolve.status === 409) {
    throw new ScopeConflictError(`PowerContext 绑定冲突（HTTP 409）：${fastResolve.rawText}`);
  }
  if (fastResolve.status !== 404) {
    throw new Error(`POST /v1/scope-bindings/resolve 异常（HTTP ${fastResolve.status}）：${fastResolve.rawText}`);
  }

  return withWorkspaceLock(workspaceKey, timeoutMs, async () => {
    const initialResolve = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
    if (initialResolve.status === 200) {
      assertNotConflictingScope(initialResolve.json, title, summary, root);
      return { scopeId: initialResolve.json.scope_id, root, workspaceKey, created: false };
    }
    if (initialResolve.status === 409) {
      throw new ScopeConflictError(`PowerContext 绑定冲突（HTTP 409）：${initialResolve.rawText}`);
    }
    if (initialResolve.status !== 404) {
      throw new Error(`POST /v1/scope-bindings/resolve 异常（HTTP ${initialResolve.status}）：${initialResolve.rawText}`);
    }

    const createRes = await requestJson(
      serverUrl,
      'POST',
      '/v1/scopes',
      { title, summary, idempotency_key: `magpie-project:${workspaceKey}` },
      timeoutMs
    );
    let scopeId;
    if (createRes.status === 201 || createRes.status === 200) {
      scopeId = createRes.json?.scope_id;
      if (!scopeId) throw new Error(`POST /v1/scopes 未返回 scope_id：${createRes.rawText}`);
    } else if (createRes.status === 409) {
      const existing = await findScopeByTitle(serverUrl, title, summary, timeoutMs, maxPages);
      if (!existing?.scope_id) throw new Error(`POST /v1/scopes 409 但未找到当前路径 Scope`);
      scopeId = existing.scope_id;
    } else {
      throw new Error(`POST /v1/scopes 失败（HTTP ${createRes.status}）：${createRes.rawText}`);
    }

    const preBindCheck = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
    if (preBindCheck.status === 200) {
      assertNotConflictingScope(preBindCheck.json, title, summary, root);
      if (preBindCheck.json?.scope_id === scopeId) return { scopeId, root, workspaceKey, created: false };
      throw new ScopeConflictError(`workspace 已绑定到 ${preBindCheck.json?.scope_id}，拒绝覆盖`);
    }
    if (preBindCheck.status === 409) throw new ScopeConflictError(`绑定前复查 409 冲突：${preBindCheck.rawText}`);
    if (preBindCheck.status !== 404) throw new Error(`绑定前复查异常（HTTP ${preBindCheck.status}）`);

    const bindRes = await requestJson(
      serverUrl,
      'PUT',
      '/v1/scope-bindings',
      { key: { integration: 'magpie', kind: 'workspace', external_id: workspaceKey }, scope_id: scopeId },
      timeoutMs
    );
    if (bindRes.status !== 200 && bindRes.status !== 201) {
      throw new Error(`PUT /v1/scope-bindings 失败（HTTP ${bindRes.status}）：${bindRes.rawText}`);
    }

    const verifyRes = await resolveWorkspaceBinding(serverUrl, workspaceKey, timeoutMs);
    if (verifyRes.status !== 200 || verifyRes.json?.scope_id !== scopeId) {
      throw new ScopeConflictError(`绑定后校验不一致（HTTP ${verifyRes.status}）`);
    }
    assertNotConflictingScope(verifyRes.json, title, summary, root);
    return { scopeId, root, workspaceKey, created: true };
  });
}

export async function recallContext(options = {}) {
  const serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const query = typeof options.query === 'string' && options.query.trim()
    ? options.query.trim().slice(0, 2000)
    : '项目核心架构边界、硬约束规则、当前进展与踩坑经验';
  const { scopeId, root } = await ensureProjectScope({ ...options, serverUrl, timeoutMs });
  const prepRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/context/prepare',
    {
      scope_id: scopeId,
      query,
      max_bytes: 8000,
      assembly: {
        sections: [
          { family: 'memory', limit: 4 },
          { family: 'topic-memory', limit: 1 },
          { family: 'experience', limit: 2 },
          { family: 'profile', limit: 1 },
        ],
      },
    },
    timeoutMs
  );
  if (prepRes.status !== 200) {
    throw new Error(`POST /v1/context/prepare 失败（HTTP ${prepRes.status}）：${prepRes.rawText}`);
  }
  const contextText = prepRes.json?.content ?? prepRes.json?.context ?? prepRes.json?.rendered_context ?? '';
  return { scopeId, root, status: prepRes.json?.status ?? 'unknown', contextText };
}

export async function recordExperience(options = {}) {
  const serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = options.maxPages ?? 100;

  const baseSituation = requireCleanField('situation', options.situation, 7000);
  const action = requireCleanField('action', options.action, 8000);
  const baseOutcome = requireCleanField('outcome', options.outcome, 7000);
  const lesson = requireCleanField('lesson', options.lesson, 8000);

  let situation = baseSituation;
  let outcome = baseOutcome;
  const checkSubject = options.subject ? requireCleanField('subject', options.subject, 512) : baseSituation.slice(0, 200);
  const checkCondition = options.condition ? requireCleanField('condition', options.condition, 8000) : baseOutcome;

  if (options.cue) {
    const recallCue = requireCleanField('cue', options.cue, 512);
    const symptom = options.symptom ? requireCleanField('symptom', options.symptom, 2000) : '';
    const prefix = symptom ? `【触发线索：${recallCue}｜症状：${symptom}】` : `【触发线索：${recallCue}】`;
    situation = requireCleanField('situation', `${prefix}${baseSituation}`, 8000);
  }
  if (options.condition) {
    outcome = requireCleanField('outcome', `${baseOutcome}（验收核对：${checkCondition}）`, 8000);
  }

  const proposal = { situation, action, outcome, lesson };
  const reason = options.reason ? requireCleanField('reason', options.reason, 2000) : 'Verified project pitfall and lesson';
  const digest = crypto.createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
  const sourceId = `lesson:${digest}`;

  const { scopeId, root } = await ensureProjectScope({ ...options, serverUrl, timeoutMs });

  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const qs = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const res = await requestJson(serverUrl, 'GET', `/v1/scopes/${encodeURIComponent(scopeId)}/artifacts/experience${qs}`, undefined, timeoutMs);
    if (res.status !== 200 || !Array.isArray(res.json?.items)) {
      throw new Error(`查询已有 Experience 失败（HTTP ${res.status}）`);
    }
    const found = res.json.items.find((item) => Array.isArray(item?.sources) && item.sources.some((s) => s?.source_id === sourceId));
    if (found) return { scopeId, root, sourceId, artifactId: found.artifact_id, created: false };
    cursor = res.json.next_cursor ?? null;
    if (!cursor) break;
  }
  if (cursor) throw new Error(`查询已有 Experience 分页超过安全上限（${maxPages} 页）`);

  const outcomeRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/work/outcomes/record',
    {
      scope_id: scopeId,
      source_id: sourceId,
      outcome: {
        schema: 'powercontext.task-outcome.v1',
        trust: 'untrusted_observation',
        objective: situation,
        status: 'succeeded',
        summary: outcome,
        observations: [{ text: `${action} — 经验：${lesson}`, basis: 'declared', evidence: [] }],
        checks: [{ name: checkSubject, status: 'passed', details: checkCondition, basis: 'declared', evidence: [] }],
        produced_artifacts: [],
        remaining_work: [],
      },
    },
    timeoutMs
  );
  if (outcomeRes.status !== 202 && outcomeRes.status !== 200) {
    throw new Error(`记录 task-outcome 失败（HTTP ${outcomeRes.status}）：${outcomeRes.rawText}`);
  }

  const proposeRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/experience/propose',
    { scope_id: scopeId, proposal, source_refs: [{ name: 'content', source_id: sourceId }], artifact_refs: [], reason },
    timeoutMs
  );
  if (proposeRes.status !== 201 && proposeRes.status !== 200) {
    throw new Error(`提议 Experience 失败（HTTP ${proposeRes.status}）：${proposeRes.rawText}`);
  }
  const candidateId = proposeRes.json?.candidate_id;
  const version = proposeRes.json?.version ?? 1;
  const approveRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/candidates/approve',
    { scope_id: scopeId, candidate_id: candidateId, expected_version: version },
    timeoutMs
  );
  if (approveRes.status !== 200) {
    throw new Error(`批准 Experience 失败（HTTP ${approveRes.status}）：${approveRes.rawText}`);
  }
  return {
    scopeId,
    root,
    sourceId,
    artifactId: approveRes.json?.result_artifact?.artifact_id ?? '',
    created: true,
  };
}

export async function rememberRule(options = {}) {
  const serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = options.maxPages ?? 100;

  const kind = requireCleanField('kind', options.kind, 128);
  if (!ALLOWED_RULE_KINDS.has(kind)) {
    throw new Error(`kind 必须是 constraint | decision | fact | preference 之一`);
  }
  const text = requireCleanField('text', options.text, 8000);
  if (Buffer.byteLength(text, 'utf8') > 8192) throw new Error('text 超出 8192 UTF-8 字节上限');
  const description = options.description ? requireCleanField('description', options.description, 200) : undefined;
  const reason = options.reason ? requireCleanField('reason', options.reason, 512) : undefined;

  const { scopeId, root } = await ensureProjectScope({ ...options, serverUrl, timeoutMs });
  const targetNorm = normalizeWhitespace(text);

  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const listRes = await requestJson(
      serverUrl,
      'POST',
      '/v1/atomic-memory/list',
      { scope_id: scopeId, states: ['active'], limit: 100, ...(cursor ? { cursor } : {}) },
      timeoutMs
    );
    if (listRes.status !== 200 || !Array.isArray(listRes.json?.items)) {
      throw new Error(`查询已有 Atomic Memory 失败（HTTP ${listRes.status}）`);
    }
    const existing = listRes.json.items.find(
      (item) => item?.state === 'active' && normalizeWhitespace(item?.text) === targetNorm
    );
    if (existing) {
      return { scopeId, root, artifactId: existing.artifact?.artifact_id ?? '', created: false };
    }
    cursor = listRes.json.next_cursor ?? null;
    if (!cursor) break;
  }
  if (cursor) throw new Error(`查询已有 Atomic Memory 分页超过安全上限（${maxPages} 页）`);

  const remRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/memory/remember',
    { scope_id: scopeId, kind, text, ...(description ? { description } : {}), ...(reason ? { reason } : {}) },
    timeoutMs
  );
  if (remRes.status !== 200 && remRes.status !== 201) {
    throw new Error(`写入 Atomic Memory 失败（HTTP ${remRes.status}）：${remRes.rawText}`);
  }
  const artRef = remRes.json?.records?.[0]?.artifact ?? remRes.json?.artifact ?? remRes.json;
  return { scopeId, root, artifactId: artRef?.artifact_id ?? '', created: true };
}

function parseCliArgs(argv) {
  const [subcommand, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new Error(`未识别的参数：${token}`);
    const key = token.slice(2);
    const val = rest[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`参数 --${key} 缺少对应值`);
    flags[key] = val;
    i += 1;
  }
  return { subcommand, flags };
}

export async function main(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? ((s) => process.stdout.write(s));
  const stderr = options.stderr ?? ((s) => process.stderr.write(s));
  try {
    const { subcommand, flags } = parseCliArgs(argv);
    const common = { ...options, ...(flags.root ? { root: flags.root } : {}) };
    if (subcommand === 'ensure') {
      const res = await ensureProjectScope(common);
      stdout(`PowerContext scope_id=${res.scopeId} root=${res.root} created=${res.created}\n`);
      return 0;
    }
    if (subcommand === 'recall') {
      const res = await recallContext({ ...common, query: flags.query });
      stdout(`PowerContext scope_id=${res.scopeId} root=${res.root} status=${res.status}\n`);
      if (res.contextText) stdout(`${res.contextText.trim()}\n`);
      return 0;
    }
    if (subcommand === 'experience') {
      const res = await recordExperience({
        ...common,
        situation: flags.situation,
        action: flags.action,
        outcome: flags.outcome,
        lesson: flags.lesson,
        cue: flags.cue,
        symptom: flags.symptom,
        condition: flags.condition,
        subject: flags.subject,
        reason: flags.reason,
      });
      stdout(`PowerContext experience scope_id=${res.scopeId} artifact_id=${res.artifactId} created=${res.created}\n`);
      return 0;
    }
    if (subcommand === 'rule') {
      const res = await rememberRule({
        ...common,
        kind: flags.kind ?? 'constraint',
        text: flags.text,
        description: flags.description,
        reason: flags.reason,
      });
      stdout(`PowerContext rule scope_id=${res.scopeId} artifact_id=${res.artifactId} created=${res.created}\n`);
      return 0;
    }
    throw new Error('用法：node pc.mjs <ensure | recall --query "..." | experience ... | rule ...>');
  } catch (err) {
    const code = err instanceof ScopeConflictError ? 2 : 1;
    stderr(`${err?.message || String(err)}\n`);
    return code;
  }
}

const isDirect = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  }
})();

if (isDirect) {
  main().then((code) => process.exit(code));
}
