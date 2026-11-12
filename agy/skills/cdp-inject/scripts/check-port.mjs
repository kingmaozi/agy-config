#!/usr/bin/env node

/**
 * check-port.mjs — 检查 Chrome 远程调试端口状态
 *
 * 用法: node scripts/check-port.mjs
 *
 * ✅ CDP 端口 9222 在线 → 显示当前标签页列表
 * ❌ 不可用 → 给出详细排查指南
 *
 * 发现路径：HTTP /json 优先；Chrome 150+ HTTP 404 空响应时自动兜底
 * ws://localhost:9222/devtools/browser + Target.getTargets
 */

import { discoverTargets } from './cdp-targets.mjs';

async function check() {
  try {
    const { targets, via } = await discoverTargets();

    const pages = targets.filter(t => t.type === 'page');
    const extensions = targets.filter(t => t.type === 'background_page' || t.type === 'service_worker');

    console.log(`✅ CDP 端口 9222 在线（发现通道: ${via === 'ws' ? 'WS browser 兜底' : 'HTTP /json'}）`);
    console.log(`   总连接: ${targets.length}`);
    console.log(`   页面: ${pages.length}`);
    console.log(`   后台页/Worker: ${extensions.length}`);
    console.log();

    if (pages.length > 0) {
      console.log(`📄 当前打开的页面:`);
      pages.forEach((t, i) => {
        const title = (t.title || '(无标题)').substring(0, 60);
        const url = (t.url || '').substring(0, 90);
        console.log(`   ${i + 1}. ${title}`);
        console.log(`      ${url}`);
      });
    } else {
      console.log('(没有打开的页面)');
    }
  } catch (err) {
    console.log(`❌ CDP 端口 9222 不可用`);
    console.log(`   原因: ${err.message}`);
    console.log();

    // 排查建议
    console.log(`🔍 排查步骤:`);
    console.log(`   1. 检查 Chrome 是否运行: ps aux | grep -i chrome | grep -v grep`);
    console.log(`   2. 检查进程是否带 --remote-debugging-port 参数:`);
    console.log(`      ps aux | grep "remote-debugging" | grep -v grep`);
    console.log(`   3. 重启 Chrome（用 LaunchServices 逃逸沙箱，直接 spawn 会 SIGTRAP）:`);
    console.log(`      open -na "Google Chrome" --args --remote-debugging-port=9222 \\`);
    console.log(`        --user-data-dir=$HOME/.chrome-cdp-profile --no-first-run`);
  }
}

check();