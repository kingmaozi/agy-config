#!/usr/bin/env node
/**
 * load-extension.mjs — Chrome 150+ 通过 CDP browser 域加载未打包插件
 * 背景：Chrome 150 已移除 --load-extension，只能 Extensions.loadUnpacked。
 * 注意：不持久化，Chrome 每次重启都要重跑（memory/mistakes.md 2026-07-29）。
 */
import WebSocket from 'ws';
import http from 'node:http';

const EXT_PATH = process.argv[2];
if (!EXT_PATH) {
  console.error('用法: node load-extension.mjs <extension_dir>');
  process.exit(1);
}

function getBrowserWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/version', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).webSocketDebuggerUrl); }
        catch (e) { reject(new Error('解析 /json/version 失败: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

const wsUrl = await getBrowserWsUrl();
const ws = new WebSocket(wsUrl, { perMessageDeflate: false });

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP 响应超时')), 10000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: EXT_PATH } }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== 1) return;
    clearTimeout(timer);
    resolve(msg);
  });
  ws.on('error', reject);
});
ws.close();

if (result.error) {
  console.error('❌ 加载失败:', JSON.stringify(result.error));
  process.exit(1);
}
console.log('✅ 插件已加载:', JSON.stringify(result.result));
