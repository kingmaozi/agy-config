#!/usr/bin/env node
// Antigravity / T3 Code MCP stdio relay for LCU (Local Computer Use).
// - Auto-accepts native app approvals listed in ComputerUseAppApprovals.json (`lcu apps allow`).
// - Immediately stops active ScreenCaptureKit app sharing (`controlStop`) + ends the CUA turn
//   (`turnEnded`) on `completion_summary`, after idle timeout, or on MCP shutdown so macOS
//   does not stay stuck in "Screen Sharing" mode after a task finishes.
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { persistAudioContent } from '../current/adapters/audio-files.mjs';
import {
  createCuaClient,
  MODEL_TOOLS,
  nativeAppApprovalOptions,
  nativeAppApprovalResponse,
} from '../current/adapters/client.mjs';

const HOME = process.env.HOME || homedir();
const LCU = process.env.LCU_BIN || `${HOME}/.local/share/lcu/current/bin/lcu`;
const APPROVAL_FILE = `${HOME}/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`;
const INSTRUCTIONS_HEADER = 'LCU: Computer Use instructions for this session:';
const IDLE_RELEASE_MS = Number(process.env.LCU_IDLE_RELEASE_MS ?? 45_000);
const SHUTDOWN_TIMEOUT_MS = 8_500;

let cache = { mtimeMs: -1, ids: new Set() };
function approvedIds() {
  try {
    const st = statSync(APPROVAL_FILE);
    if (st.mtimeMs !== cache.mtimeMs) {
      const parsed = JSON.parse(readFileSync(APPROVAL_FILE, 'utf8'));
      cache = { mtimeMs: st.mtimeMs, ids: new Set((parsed.approvedBundleIdentifiers ?? []).map(String)) };
    }
  } catch {}
  return cache.ids;
}

function shellWord(s) {
  return /^[A-Za-z0-9_./:-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function approvalHint(app) {
  const allowCmd = `${shellWord(LCU)} apps allow ${shellWord(app)}`;
  const revokeCmd = `${shellWord(LCU)} apps revoke ${shellWord(app)}`;
  return (
    `LCU: Computer Use needs user approval to control ${app}. ` +
    `Run \`${allowCmd}\` in a terminal (timeout >= 300s) so the user can approve via Touch ID / password, ` +
    `then retry this call. Afterwards, inform the user that ${app} stays allowed until revoked with \`${revokeCmd}\`.`
  );
}

const sessionId = `antigravity-${randomUUID()}`;
let turnId = randomUUID();
let turnDirty = false;
let inFlightCount = 0;
let instructionsDelivered = false;
let idleTimer = null;
let releasing = Promise.resolve();
const unapprovedInFlight = new Set();

const client = createCuaClient({
  command: [LCU],
  cwd: process.cwd(),
  env: process.env,
  adapter: 'client',
  allowedOrigins: process.env.LCU_APPROVED_ORIGINS ? JSON.parse(process.env.LCU_APPROVED_ORIGINS) : [],
  onElicitation: async (params) => {
    const approval = nativeAppApprovalOptions(params);
    if (approval) {
      if (approvedIds().has(approval.resource)) {
        const scope = approval.choices.some(c => c.value === 'always')
          ? 'always'
          : approval.choices.some(c => c.value === 'session')
            ? 'session'
            : 'once';
        return nativeAppApprovalResponse(params, scope);
      }
      for (const bucket of unapprovedInFlight) bucket.add(approval.resource);
    }
    return { action: 'cancel' };
  },
});

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleRelease() {
  clearIdleTimer();
  if (IDLE_RELEASE_MS > 0 && turnDirty && inFlightCount === 0) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (turnDirty && inFlightCount === 0) {
        void releaseActiveTurn('Stop');
      }
    }, IDLE_RELEASE_MS);
    idleTimer.unref?.();
  }
}

function releaseActiveTurn(event = 'Stop') {
  clearIdleTimer();
  if (!turnDirty) return releasing;
  const finishedTurnId = turnId;
  turnId = randomUUID();
  turnDirty = false;
  releasing = releasing.then(async () => {
    if (client.hasHostControl) {
      try {
        const status = await client.controlStatus({ sessionId, turnId: finishedTurnId });
        const activeApps = status?.computerUse?.activeApplications ?? [];
        for (const app of activeApps) {
          if (typeof app?.bundleIdentifier === 'string' && app.bundleIdentifier) {
            await client.controlStop({
              sessionId,
              turnId: finishedTurnId,
              app: app.bundleIdentifier,
            }).catch(() => {});
          }
        }
      } catch {}
    }
    try {
      await client.turnEnded({ sessionId, turnId: finishedTurnId, event });
    } catch {}
  });
  return releasing;
}

await client.connect();
const tools = client.publicTools();

const server = new Server(
  { name: 'lcu', version: '0.13.6' },
  { capabilities: { tools: {} }, instructions: client.instructions },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;
  if (!MODEL_TOOLS.has(name)) {
    return { isError: true, content: [{ type: 'text', text: `Unknown LCU tool: ${name}` }] };
  }
  clearIdleTimer();
  await releasing;

  const isCompletion = name === 'js' && typeof args?.completion_summary === 'string' && !('code' in args);
  if (name === 'js_reset') {
    await releaseActiveTurn('Interrupt');
  }

  const activeTurnId = turnId;
  if (name === 'js' && !isCompletion) {
    turnDirty = true;
  }

  const missingApps = new Set();
  unapprovedInFlight.add(missingApps);
  inFlightCount++;
  try {
    const result = await persistAudioContent(
      await client.call(name, args, {
        sessionId,
        turnId: activeTurnId,
        toolCallId: randomUUID(),
        signal: extra.signal,
      }),
    );

    if (isCompletion) {
      await releaseActiveTurn('Stop');
    }

    const leading = [];
    if (!instructionsDelivered && client.instructions) {
      instructionsDelivered = true;
      leading.push({ type: 'text', text: `${INSTRUCTIONS_HEADER}\n\n${client.instructions}` });
    }
    const trailing = [...missingApps].map(app => ({ type: 'text', text: approvalHint(app) }));
    if (!leading.length && !trailing.length) return result;
    return { ...result, content: [...leading, ...(result.content ?? []), ...trailing] };
  } finally {
    unapprovedInFlight.delete(missingApps);
    inFlightCount--;
    scheduleIdleRelease();
  }
});

let closing;
const shutdown = () => (closing ??= (async () => {
  clearIdleTimer();
  try {
    await Promise.race([
      releaseActiveTurn(inFlightCount > 0 ? 'Interrupt' : 'Stop'),
      new Promise(r => setTimeout(r, SHUTDOWN_TIMEOUT_MS)),
    ]);
  } catch {}
  await client.close().catch(() => {});
  await server.close().catch(() => {});
})());

server.onclose = () => { void shutdown(); };
process.stdin.once('end', () => { void shutdown(); });
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.once(sig, () => { shutdown().finally(() => process.exit(0)); });
}

await server.connect(new StdioServerTransport());
