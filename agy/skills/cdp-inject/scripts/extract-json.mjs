#!/usr/bin/env node

/**
 * extract-json.mjs — 复用当前 Chrome 浏览器，注入 JS 提取 JSON 数据
 *
 * 用法:
 *   node scripts/extract-json.mjs '<JavaScript 表达式>'
 *
 * 示例:
 *   node scripts/extract-json.mjs 'JSON.stringify({title:document.title,url:location.href},null,2)'
 *   node scripts/extract-json.mjs "(() => { return JSON.stringify({links:Array.from(document.querySelectorAll('a')).map(a=>a.href).slice(0,10)},null,2); })()"
 *
 * 原理:
 *   1. 发现活跃标签页：HTTP GET http://localhost:9222/json 优先；
 *      Chrome 150+ HTTP /json 404 空响应时自动兜底 ws://localhost:9222/devtools/browser + Target.getTargets
 *   2. Runtime.evaluate 注入 JS 到页面上下文
 *      （HTTP 路径直连 page WS；WS 兜底路径 attachToTarget(flatten) + sessionId）
 *   3. 返回结构化 JSON（和你自己打开 DevTools Console 执行一样精准）
 */

import { discoverTargets, evaluateOnTarget } from './cdp-targets.mjs';

const CMD = process.argv[2] || 'JSON.stringify({title:document.title},null,2)';
const TIMEOUT_MS = 15000;

if (CMD === '--help' || CMD === '-h') {
  console.error(`用法: node extract-json.mjs '<JavaScript 表达式>'
示例:
  node extract-json.mjs 'JSON.stringify({title:document.title,url:location.href},null,2)'
  node extract-json.mjs "(() => { return JSON.stringify({链接数:document.links.length},null,2); })()"`);
  process.exit(1);
}

async function main() {
  try {
    // 1. 获取活跃页面（HTTP 优先，Chrome 150+ 自动走 WS browser 兜底）
    const { targets } = await discoverTargets();
    const page = targets.find(t => t.type === 'page' && t.url !== 'about:blank') || targets[0];

    if (!page) {
      throw new Error('未找到活跃页面，请先打开一个页面');
    }

    // 2. 注入 JS 并输出结果
    const result = await evaluateOnTarget(page, CMD, TIMEOUT_MS);

    // 尝试解析为 JSON 并漂亮输出
    try {
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      if (parsed !== undefined && parsed !== null) {
        console.log(JSON.stringify(parsed, null, 2));
      } else {
        console.log(String(result));
      }
    } catch {
      console.log(String(result));
    }

  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  }
}

main();