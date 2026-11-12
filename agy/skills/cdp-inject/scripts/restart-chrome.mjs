#!/usr/bin/env node

/**
 * restart-chrome.mjs — 安全重启 Chrome 并开启远程调试端口 9222
 *
 * 安全规则（2026-06-23 修正）：
 *   ❌ 绝不主动杀正在运行的 Chrome（除非用户明确 --force）
 *   ✅ CDP 端口在线时直接退出，什么都不做
 *   ✅ 端口不在线时，check-port 先告诉你，你决定要不要重启
 *
 * 用法:
 *   node scripts/restart-chrome.mjs                # 检查+启动（安全模式）
 *   node scripts/restart-chrome.mjs --force        # 强制重启（杀当前 Chrome）
 *   node scripts/restart-chrome.mjs --keep-url     # 强制重启+恢复标签页
 *   node scripts/restart-chrome.mjs --fresh        # 清空 profile 全新启动
 *
 * 关键技术决策：
 *   Chrome 149+ 禁止 `--remote-debugging-port` 搭配系统默认 profile。
 *   本技能固定使用 ~/.chrome-cdp-profile 独立 profile。
 *   ➡ 首次用这个 profile 登录一次 + 装好插件，之后所有会话永久复用。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import http from 'node:http';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PROFILE = `${process.env.HOME}/.chrome-cdp-profile`;

const isForce = process.argv.includes('--force');
const keepUrl = process.argv.includes('--keep-url');
const fresh = process.argv.includes('--fresh');

// ── 工具函数 ────────────────────────────────────────────────

/** 检查 CDP 端口是否在线 */
async function isPortOnline() {
  try {
    const ok = await new Promise((resolve) => {
      const req = http.get('http://localhost:9222/json', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data.length > 0));
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
    return ok;
  } catch { return false; }
}

/** 轮询等待端口绑定 */
async function waitForPort(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOnline()) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** 获取页面列表 */
async function getPageList() {
  try {
    const data = await new Promise((resolve, reject) => {
      http.get('http://localhost:9222/json', (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
      }).on('error', reject);
    });
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function main() {
  if (!existsSync(CHROME_PATH)) {
    console.error(`❌ 未找到 Chrome: ${CHROME_PATH}`);
    process.exit(1);
  }

  // ── 第 1 步：检查 CDP 端口是否已在在线 ──────────────────
  const portOnline = await isPortOnline();

  if (portOnline) {
    const pages = await getPageList();
    const pageCount = pages.filter(t => t.type === 'page').length;
    console.log(`✅ CDP 端口 9222 已在在线，无需重启`);
    console.log(`   当前 ${pageCount} 个页面`);
    console.log(`   直接使用 extract-json.mjs 即可提取数据`);
    return;
  }

  // ── 第 2 步：端口不在线，检查 Chrome 是否在运行 ──────
  const { execSync } = await import('node:child_process');
  let chromeRunning = false;
  try {
    const result = execSync('ps aux | grep "/MacOS/Google Chrome$" | grep -v grep', { encoding: 'utf-8' });
    chromeRunning = result.trim().length > 0;
  } catch { /* not running */ }

  if (chromeRunning && !isForce) {
    console.log(`⚠️  Chrome 在运行，但 CDP 端口 9222 不可用`);
    console.log(`   原因：Chrome 启动时未加 --remote-debugging-port=9222 参数`);
    console.log();
    console.log(`   💡 解决方案（选一个）：`);
    console.log(`   A. 关掉当前的 Chrome，用 restart-chrome.mjs 重启（带上所有登录态）：`);
    console.log(`      node "$CDP_INJECT"/scripts/restart-chrome.mjs --force`);
    console.log(`      → 首次需要安装插件 + 登录目标网站，之后永久复用`);
    console.log();
    console.log(`   B. 手动在 Chrome 地址栏打开 chrome://inspect/#devices 并启用端口转发`);
    console.log();
    console.log(`   或你自己手动关闭当前 Chrome 后重新执行`);
    process.exit(1);
  }

  // ── 第 3 步：关闭 + 重启（仅 --force 或 Chrome 不在运行时进入） ──
  console.log('🔄 正在重启 Chrome（远程调试模式）...');

  // 杀进程
  try { execSync('killall "Google Chrome" 2>/dev/null', { stdio: 'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 2000));

  // 清理残留
  try { execSync('killall "Google Chrome Helper" 2>/dev/null', { stdio: 'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 1000));

  // 清理 lock 文件
  await rm(`${CDP_PROFILE}/SingletonLock`, { force: true }).catch(() => {});
  await rm(`${CDP_PROFILE}/SingletonSocket`, { force: true }).catch(() => {});

  // 可选：全新 profile
  if (fresh) {
    await rm(CDP_PROFILE, { recursive: true, force: true }).catch(() => {});
  }

  await mkdir(CDP_PROFILE, { recursive: true });

  // 启动
  // 2026-07-29 修复：从 ZCode 进程树 spawn 时 Chrome 沙箱初始化失败必崩（EXC_BREAKPOINT SIGTRAP），
  // 自动化专用 profile 加 --no-sandbox 绕过；--disable-gpu 防 GPU 进程连带崩溃。
  const args = [
    `--remote-debugging-port=9222`,
    `--user-data-dir=${CDP_PROFILE}`,
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (keepUrl) args.push('--restore-last-session');

  const chrome = spawn(CHROME_PATH, args, { detached: true, stdio: 'ignore' });
  chrome.unref();

  // 等待端口
  const ready = await waitForPort(15000);
  if (ready) {
    console.log(`✅ Chrome 远程调试端口 9222 已就绪（profile: ~/.chrome-cdp-profile）`);
    console.log(`   💡 首次使用需在 Chrome 中：`);
    console.log(`      1. 安装透视王等插件`);
    console.log(`      2. 登录目标网站（PDD / B站等）`);
    console.log(`      之后所有会话永久复用登录态，无需再次登录`);
  } else {
    console.log('⚠️  超时未检测到端口');
  }
}

main().catch((err) => {
  console.error(`❌ 失败: ${err.message}`);
  process.exit(1);
});