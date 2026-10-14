import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const url = process.env.CUE_LAB_TEST_URL || 'http://127.0.0.1:5173/';
let server;
try { if (!(await fetch(url)).ok) throw Error('unavailable'); }
catch {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
}
const browser = await chromium.launch({ channel: process.env.CUE_LAB_BROWSER || 'chrome', headless: true });
const page = await browser.newPage(), errors = [];
page.on('pageerror', e => errors.push(String(e)));
const idle = () => page.waitForFunction(() => !window.__cueLab.getState().searching, { timeout: 120000 });
try {
  await page.goto(url); await page.waitForFunction(() => window.__cueLab);
  assert.equal(await page.locator('#gpu-search').isChecked(), false);
  const adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter ? { ...adapter.info.toJSON?.(), vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null;
  });
  console.log('Adapter:', adapter);
  assert.ok(adapter, 'This test requires working WebGPU; CPU fallback is tested separately.');

  // An unaligned dispatch exercises the invocation guard. A physically valid
  // forward shot must outrank a shot aimed away from the object (not angle magnitude).
  const ranks = await page.evaluate(async () => {
    const { gpuScreen } = await import('/src/gpu-search.ts');
    const { ball } = await import('/src/physics.ts');
    const { freshRules } = await import('/src/rules.ts');
    const rules = freshRules('practice'); rules.breakShot = false;
    const request = { id: 1, balls: [ball(0, 1.27, 0.9), ball(1, 1.27, 0.4)], rules, target: 1, pocket: 1, sort: 'balanced' };
    const route = { angle: -Math.PI / 2, contact: { x: 1.27, y: 0.45715 }, length: 1, cut: 1, kind: 'normal', label: 'direct' };
    const shot = { angle: route.angle, power: 24, tipX: 0, tipY: 0, elevation: 0, kind: 'normal' };
    const shots = [{ ...shot, angle: 0 }, { ...shot, angle: Math.PI / 2 }, shot, { ...shot, power: 1 }, { ...shot, angle: Math.PI }];
    const result = await gpuScreen(request, [{ route, shots }]);
    return result.ok ? result.grids[0].shots : result;
  });
  assert.ok(Array.isArray(ranks), JSON.stringify(ranks));
  assert.ok(ranks.some(s => s.angle === -Math.PI / 2 && s.power === 24));
  assert.ok(!ranks.some(s => s.angle === Math.PI / 2));

  await page.check('#gpu-search');
  const timings = [];
  for (const name of ['cut', 'bank', 'kick', 'combo', 'black', 'jump', 'masse']) {
    await page.selectOption('#scene', name);
    await page.click('#search'); assert.equal(await page.locator('#gpu-search').isDisabled(), true);
    await idle();
    const state = await page.evaluate(() => window.__cueLab.getState());
    assert.ok(state.plans.length > 0, `${name}: no legal GPU-assisted plan`);
    if (name === 'jump' || name === 'masse') assert.ok(state.plans.some(p => p.shot.kind === name), `${name}: special stroke missing`);
    const validation = await page.evaluate(async () => {
      const { simulate } = await import('/src/physics.ts');
      const { adjudicate } = await import('/src/rules.ts');
      const state = window.__cueLab.getState();
      return state.plans.map(plan => ({ exact: JSON.stringify(simulate(state.balls, plan.shot, true)) === JSON.stringify(plan.outcome), foul: adjudicate(state.balls, plan.outcome.balls, plan.outcome.events, { ...state.rules, calledPocket: state.pocket }).foul, pot: plan.outcome.events.some(e => e.type === 'pocket' && e.ball === state.target && e.pocket === state.pocket) }));
    });
    assert.ok(validation.every(p => p.exact && !p.foul && p.pot), `${name}: exact physics/rules failed`);
    const status = await page.locator('#gpu-status').innerText();
    assert.match(status, /GPU 已试算/, `${name}: GPU path did not finish: ${status}`);
    timings.push({ name, plans: state.plans.length, status, time: await page.locator('#search-time').innerText() });
    console.log(timings.at(-1));
  }
  // Execute a GPU-selected special shot using the game's real frame loop.
  const state = await page.evaluate(() => window.__cueLab.getState());
  const index = state.plans.findIndex(p => p.shot.kind === 'masse');
  await page.locator('.plan-select').nth(index).click();
  await page.locator('.execute-plan').nth(index).click();
  await page.waitForFunction(() => !window.__cueLab.getState().moving, { timeout: 30000 });
  assert.deepEqual((await page.evaluate(() => window.__cueLab.getState())).balls, state.plans[index].outcome.balls);

  // GPU queue/readback cancellation must terminate the worker without late plans.
  await page.selectOption('#scene', 'cut'); await page.click('#search'); await page.click('#cancel-search');
  assert.equal((await page.evaluate(() => window.__cueLab.getState())).searching, false);
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.__cueLab.getState())).plans.length, 0);

  // Inject unavailable and failed adapters inside the actual search worker.
  for (const failure of ['unavailable', 'device-error', 'empty-shortlist']) {
    await page.route('**/src/search.worker.ts*', async route => {
      const response = await route.fetch();
      let body = await response.text();
      if (failure === 'empty-shortlist') body = body.replace('prepared = result.grids;', 'prepared = result.grids.map(g => ({...g, shots: []}));');
      else body = `Object.defineProperty(navigator, 'gpu', { value: ${failure === 'unavailable' ? 'undefined' : '{requestAdapter: async () => {throw new Error("injected device failure")}}'} });\n` + body;
      await route.fulfill({ response, body });
    });
    await page.click('#search'); await idle();
    const fallback = await page.evaluate(() => window.__cueLab.getState());
    assert.ok(fallback.plans.length > 0, `${failure}: fallback lost legal plans`);
    assert.match(await page.locator('#search-time').innerText(), /^CPU/);
    assert.match(await page.locator('#gpu-status').innerText(), failure === 'empty-shortlist' ? /完整 CPU 搜索补查/ : /已回退 CPU/);
    console.log('Fallback OK:', failure);
    await page.unroute('**/src/search.worker.ts*');
  }
  assert.deepEqual(errors, []);
  console.log('WebGPU trajectory screening, all seven scenes, exact execution, cancellation and fallback passed.');
} finally { await browser.close(); server?.kill(); }
