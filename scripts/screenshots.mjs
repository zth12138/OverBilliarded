import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const url = process.env.CUE_LAB_TEST_URL || 'http://127.0.0.1:5173/';
let server, browser;
try {
  let available = false;
  try { available = (await fetch(url)).ok; } catch {}
  if (!available) {
    if (process.env.CUE_LAB_TEST_URL) throw Error(`无法访问指定地址：${url}`);
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      stdio: 'ignore', windowsHide: true,
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(url)).ok) { available = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!available) throw Error('本地开发服务未能启动。');
  }
  browser = await chromium.launch({ channel: process.env.CUE_LAB_BROWSER || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await mkdir('docs/screenshots', { recursive: true });
  await page.goto(url);
  await page.waitForFunction(() => window.__cueLab);
  await page.uncheck('#sound');
  await page.evaluate(() => document.fonts.ready);
  const capture = async name => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `docs/screenshots/${name}.png` });
  };
  await capture('overview');

  const searchScene = async name => {
    await page.selectOption('#scene', name);
    await page.check('#cue-marks');
    await page.click('#search');
    await page.waitForFunction(() => !window.__cueLab.getState().searching, { timeout: 60000 });
    const state = await page.evaluate(() => window.__cueLab.getState());
    assert.ok(state.plans.length > 1, `${name} 应展示多个真实搜索方案`);
    return state;
  };
  await searchScene('cut');
  await capture('assisted-shot');
  const bank = await searchScene('bank');
  const index = bank.plans.findIndex(plan => plan.route.includes('翻袋'));
  assert.ok(index >= 0, '应找到真实翻袋方案');
  await page.locator('.plan-select').nth(index).click();
  await capture('bank-shot');
  assert.deepEqual(errors, []);
  console.log('已生成 3 张实际程序截图：docs/screenshots/{overview,assisted-shot,bank-shot}.png');
} finally {
  await browser?.close(); server?.kill();
}
