/**
 * cdp-targets.mjs — Chrome CDP target 发现（HTTP /json 优先，WS browser 端点兜底）
 *
 * 背景：Chrome 150 起 /json HTTP 端点对已知路径也返回 404 空响应，
 * 但 ws://localhost:9222/devtools/browser 的 Target 域完全可用。
 * 本模块统一两种路径，返回 HTTP 形状的 target 数组；
 * WS 兜底路径的 target 无 webSocketDebuggerUrl，标记 _viaBrowserWs=true，
 * 调用方需用 attachToTarget(flatten) + sessionId 发指令。
 */

import http from 'node:http';

const HTTP_URL = 'http://localhost:9222/json';
const BROWSER_WS = 'ws://localhost:9222/devtools/browser';
const TIMEOUT_MS = 5000;

async function loadWs() {
  const mod = await import('ws');
  return mod.default;
}

/** HTTP /json 发现（老 Chrome 快速路径） */
function getTargetsViaHttp() {
  return new Promise((resolve, reject) => {
    const req = http.get(HTTP_URL, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200 || !data.trim()) {
          reject(new Error(`HTTP ${res.statusCode} 空响应`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`响应不是有效 JSON: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('HTTP 连接超时')); });
  });
}

/** WS browser 端点发现（Chrome 150+ 兜底） */
async function getTargetsViaBrowserWs() {
  const WebSocket = await loadWs();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BROWSER_WS, { perMessageDeflate: false });
    const timer = setTimeout(() => { ws.close(); reject(new Error('WS browser 端点超时')); }, TIMEOUT_MS);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) { reject(new Error(`WS Target.getTargets: ${msg.error.message}`)); return; }
      const targets = (msg.result?.targetInfos || []).map((t) => ({
        id: t.targetId,
        targetId: t.targetId,
        type: t.type,
        title: t.title || '',
        url: t.url || '',
        attached: Boolean(t.attached),
        _viaBrowserWs: true,
      }));
      resolve(targets);
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** 统一发现：HTTP 优先，WS 兜底；返回 { targets, via } */
export async function discoverTargets() {
  try {
    const targets = await getTargetsViaHttp();
    return { targets, via: 'http' };
  } catch (httpErr) {
    try {
      const targets = await getTargetsViaBrowserWs();
      return { targets, via: 'ws', httpError: httpErr.message };
    } catch (wsErr) {
      const err = new Error(`HTTP /json 失败（${httpErr.message}）且 WS browser 兜底失败（${wsErr.message}）`);
      err.cause = { httpErr, wsErr };
      throw err;
    }
  }
}

/**
 * 在指定 target 上执行 JS（兼容两种发现路径）。
 * - HTTP 路径：直接连 page.webSocketDebuggerUrl 发 Runtime.evaluate
 * - WS 兜底：连 browser WS → Target.attachToTarget(flatten) → sessionId 内发 Runtime.evaluate
 */
export async function evaluateOnTarget(target, expression, timeoutMs = 15000) {
  const WebSocket = await loadWs();
  if (!target._viaBrowserWs && target.webSocketDebuggerUrl) {
    return evaluateViaPageWs(WebSocket, target.webSocketDebuggerUrl, expression, timeoutMs);
  }
  return evaluateViaBrowserWs(WebSocket, target.targetId || target.id, expression, timeoutMs);
}

function evaluateViaPageWs(WebSocket, wsUrl, expression, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); reject(new Error(`执行超时 (${timeoutMs}ms)`)); }
    }, timeoutMs);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.on('message', (data) => {
      if (settled) return;
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        settled = true;
        clearTimeout(timer);
        ws.close();
        unwrapEvaluateResult(msg, resolve, reject);
      }
    });
    ws.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
  });
}

function evaluateViaBrowserWs(WebSocket, targetId, expression, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BROWSER_WS, { perMessageDeflate: false });
    let settled = false;
    let sessionId = null;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); reject(new Error(`执行超时 (${timeoutMs}ms)`)); }
    }, timeoutMs);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Target.attachToTarget', params: { targetId, flatten: true } }));
    });
    ws.on('message', (data) => {
      if (settled) return;
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        if (msg.error) { settled = true; clearTimeout(timer); ws.close(); reject(new Error(`attach 失败: ${msg.error.message}`)); return; }
        sessionId = msg.result?.sessionId;
        ws.send(JSON.stringify({
          id: 2,
          sessionId,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }));
        return;
      }
      if (msg.id === 2) {
        settled = true;
        clearTimeout(timer);
        if (sessionId) {
          try { ws.send(JSON.stringify({ id: 3, method: 'Target.detachFromTarget', params: { sessionId } })); } catch {}
        }
        setTimeout(() => ws.close(), 50);
        unwrapEvaluateResult(msg, resolve, reject);
      }
    });
    ws.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
  });
}

function unwrapEvaluateResult(msg, resolve, reject) {
  if (msg.result?.exceptionDetails) {
    const exc = msg.result.exceptionDetails;
    reject(new Error(`JS 执行错误: ${exc.text || exc.exception?.description || JSON.stringify(exc)}`));
    return;
  }
  if (msg.result?.result && 'value' in msg.result.result) {
    resolve(msg.result.result.value);
    return;
  }
  if (msg.error) {
    reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    return;
  }
  resolve(undefined);
}
