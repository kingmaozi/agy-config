#!/usr/bin/env node
// 将经过验证的踩坑经验（Experience）或关键硬约束（Atomic Memory）幂等沉淀到当前项目的独立 PowerContext Scope。
// Node 18+，仅使用内置模块；严禁附带 Authorization、写入任何密钥或刷入日常流水账。

import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SERVER_URL,
  ScopeConflictError,
  ensureProjectScope,
} from './powercontext-ensure-scope.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_RULE_KINDS = new Set(['constraint', 'decision', 'fact', 'preference']);

// 与 Magpie gateway-powercontext 保持同级敏感信息拦截，并补充 Cookie / 会话凭据拦截，防止把密钥/Token/Cookie 写入记忆服务。
const SECRET_PATTERN =
  /(?:(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|authorization|(?:set-)?cookie|session[_-]?id|phpsessid|jsessionid|connect\.sid|[A-Za-z0-9]*(?:password|passwd|pwd)|secret|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+:[^\s/?#@]+@|\b(?:sk|rk)_live_[A-Za-z0-9]{8,}|\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [^-]*PRIVATE KEY-----)/iu;

export function containsSecret(value) {
  if (typeof value !== 'string' || !value) return false;
  return SECRET_PATTERN.test(value);
}

function normalizeWhitespace(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim();
}

function requireCleanField(name, value, maxLength = 8000) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`缺少必填字段 ${name}`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`字段 ${name} 超出最大长度 ${maxLength}`);
  }
  if (containsSecret(trimmed)) {
    throw new Error(`禁止写入疑似密钥或凭据内容（字段：${name}）`);
  }
  return trimmed;
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

async function findExistingExperienceBySource(baseUrl, scopeId, sourceId, timeoutMs, maxPages = 100) {
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const qs = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const res = await requestJson(
      baseUrl,
      'GET',
      `/v1/scopes/${encodeURIComponent(scopeId)}/artifacts/experience${qs}`,
      undefined,
      timeoutMs
    );
    if (res.status !== 200 || !Array.isArray(res.json?.items)) {
      throw new Error(`查询已有 Experience 失败（HTTP ${res.status}）：${res.rawText}`);
    }
    const found = res.json.items.find((item) =>
      Array.isArray(item?.sources) && item.sources.some((s) => s?.source_id === sourceId)
    );
    if (found) return found;
    cursor = res.json.next_cursor ?? null;
    if (!cursor) break;
  }
  if (cursor) {
    throw new Error(`查询已有 Experience 分页超过安全上限（${maxPages} 页），拒绝在不完整去重下继续写入`);
  }
  return null;
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
  let checkSubject = options.subject
    ? requireCleanField('subject', options.subject, 512)
    : baseSituation.slice(0, 200);
  let checkCondition = options.condition
    ? requireCleanField('condition', options.condition, 8000)
    : baseOutcome;

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

  const existing = await findExistingExperienceBySource(serverUrl, scopeId, sourceId, timeoutMs, maxPages);
  if (existing) {
    return {
      scopeId,
      root,
      sourceId,
      artifactId: existing.artifact_id,
      revision: existing.revision,
      created: false,
    };
  }

  const outcomePayload = {
    scope_id: scopeId,
    source_id: sourceId,
    outcome: {
      schema: 'powercontext.task-outcome.v1',
      trust: 'untrusted_observation',
      objective: situation,
      status: 'succeeded',
      summary: outcome,
      observations: [
        {
          text: `${action} — 经验：${lesson}`,
          basis: 'declared',
          evidence: [],
        },
      ],
      checks: [
        {
          name: checkSubject,
          status: 'passed',
          details: checkCondition,
          basis: 'declared',
          evidence: [],
        },
      ],
      produced_artifacts: [],
      remaining_work: [],
    },
  };

  const outcomeRes = await requestJson(serverUrl, 'POST', '/v1/work/outcomes/record', outcomePayload, timeoutMs);
  if (outcomeRes.status !== 202 && outcomeRes.status !== 200) {
    throw new Error(`记录 task-outcome 失败（HTTP ${outcomeRes.status}）：${outcomeRes.rawText}`);
  }

  const proposeRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/experience/propose',
    {
      scope_id: scopeId,
      proposal,
      source_refs: [{ name: 'content', source_id: sourceId }],
      artifact_refs: [],
      reason,
    },
    timeoutMs
  );
  if (proposeRes.status !== 201 && proposeRes.status !== 200) {
    throw new Error(`提议 Experience 失败（HTTP ${proposeRes.status}）：${proposeRes.rawText}`);
  }

  const candidateId = proposeRes.json?.candidate_id;
  const version = proposeRes.json?.version ?? 1;
  if (!candidateId) {
    throw new Error(`POST /v1/experience/propose 未返回 candidate_id：${proposeRes.rawText}`);
  }

  const approveRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/candidates/approve',
    {
      scope_id: scopeId,
      candidate_id: candidateId,
      expected_version: version,
    },
    timeoutMs
  );
  if (approveRes.status !== 200) {
    throw new Error(`批准 Experience 候选失败（HTTP ${approveRes.status}）：${approveRes.rawText}`);
  }

  const artRef = approveRes.json?.result_artifact;
  return {
    scopeId,
    root,
    sourceId,
    candidateId,
    artifactId: artRef?.artifact_id ?? '',
    revision: artRef?.revision ?? 1,
    created: true,
  };
}

export async function rememberRule(options = {}) {
  const serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = options.maxPages ?? 100;

  const kind = requireCleanField('kind', options.kind, 128);
  if (!ALLOWED_RULE_KINDS.has(kind)) {
    throw new Error(`kind 必须是 constraint | decision | fact | preference 之一（当前：${kind}）`);
  }
  const text = requireCleanField('text', options.text, 8000);
  if (Buffer.byteLength(text, 'utf8') > 8192) {
    throw new Error('text 超出 8192 UTF-8 字节上限');
  }
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
      {
        scope_id: scopeId,
        states: ['active'],
        limit: 100,
        ...(cursor ? { cursor } : {}),
      },
      timeoutMs
    );
    if (listRes.status !== 200 || !Array.isArray(listRes.json?.items)) {
      throw new Error(`查询已有 Atomic Memory 失败（HTTP ${listRes.status}）：${listRes.rawText}`);
    }
    const existing = listRes.json.items.find(
      (item) => item?.state === 'active' && normalizeWhitespace(item?.text) === targetNorm
    );
    if (existing) {
      return {
        scopeId,
        root,
        artifactId: existing.artifact?.artifact_id ?? '',
        revision: existing.artifact?.revision ?? 1,
        created: false,
      };
    }
    cursor = listRes.json.next_cursor ?? null;
    if (!cursor) break;
  }
  if (cursor) {
    throw new Error(`查询已有 Atomic Memory 分页超过安全上限（${maxPages} 页），拒绝在不完整去重下继续写入`);
  }

  const remRes = await requestJson(
    serverUrl,
    'POST',
    '/v1/memory/remember',
    {
      scope_id: scopeId,
      kind,
      text,
      ...(description ? { description } : {}),
      ...(reason ? { reason } : {}),
    },
    timeoutMs
  );
  if (remRes.status !== 200 && remRes.status !== 201) {
    throw new Error(`写入 Atomic Memory 失败（HTTP ${remRes.status}）：${remRes.rawText}`);
  }

  const artRef = remRes.json?.records?.[0]?.artifact ?? remRes.json?.artifact ?? remRes.json;
  return {
    scopeId,
    root,
    artifactId: artRef?.artifact_id ?? '',
    revision: artRef?.revision ?? 1,
    created: true,
  };
}

function parseCliArgs(argv) {
  const [subcommand, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      throw new Error(`未识别的参数：${token}`);
    }
    const key = token.slice(2);
    const val = rest[i + 1];
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`参数 --${key} 缺少对应值`);
    }
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
    if (subcommand === 'experience') {
      const res = await recordExperience({
        ...options,
        situation: flags.situation,
        action: flags.action,
        outcome: flags.outcome,
        lesson: flags.lesson,
        cue: flags.cue,
        symptom: flags.symptom,
        condition: flags.condition,
        subject: flags.subject,
        repairSurface: flags['repair-surface'],
        reason: flags.reason,
      });
      stdout(
        `PowerContext experience scope_id=${res.scopeId} artifact_id=${res.artifactId} created=${res.created}\n`
      );
      return 0;
    }
    if (subcommand === 'rule') {
      const res = await rememberRule({
        ...options,
        kind: flags.kind,
        text: flags.text,
        description: flags.description,
        reason: flags.reason,
      });
      stdout(
        `PowerContext rule scope_id=${res.scopeId} artifact_id=${res.artifactId} created=${res.created}\n`
      );
      return 0;
    }
    throw new Error('用法：powercontext-record-lesson.mjs <experience|rule> [--字段 值 ...]');
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
