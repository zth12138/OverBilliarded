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
page.on('pageerror', error => errors.push(String(error)));
const state = () => page.evaluate(() => window.__cueLab.getState());
try {
  await page.goto(url); await page.waitForFunction(() => window.__cueLab);
  assert.equal(await page.locator('#unlimited-power').isChecked(), false);
  assert.equal(await page.locator('#power').getAttribute('max'), '100');
  await page.selectOption('#scene', 'cut');
  await page.check('#unlimited-power');
  assert.equal(await page.locator('#power').getAttribute('max'), '300');
  await page.locator('#power').fill('220');
  assert.equal((await state()).shot.power, 220);
  assert.equal((await state()).shot.unlimitedPower, true);
  await page.click('#expand-power');
  assert.equal(await page.locator('#power').getAttribute('max'), '600');
  await page.locator('#power-number').fill('650'); await page.locator('#power-number').blur();
  assert.equal((await state()).shot.power, 650);
  assert.ok(Number(await page.locator('#power').getAttribute('max')) >= 650);
  await page.uncheck('#unlimited-power');
  assert.equal((await state()).shot.power, 100);
  assert.equal(await page.locator('#power').getAttribute('max'), '100');

  await page.check('#unlimited-power');
  await page.locator('#power').fill('220');
  const before = await state();
  const expected = await page.evaluate(async () => {
    const { simulate } = await import('/src/physics.ts');
    const state = window.__cueLab.getState(); return simulate(state.balls, state.shot, true);
  });
  await page.click('#preview'); await page.click('#strike');
  assert.equal(await page.locator('#unlimited-power').isDisabled(), true);
  await page.waitForFunction(() => !window.__cueLab.getState().moving, { timeout: 30000 });
  assert.deepEqual((await state()).balls, expected.balls);
  await page.click('#undo');
  assert.deepEqual((await state()).balls, before.balls);
  assert.deepEqual((await state()).shot, before.shot);
  assert.equal(await page.locator('#unlimited-power').isChecked(), true);

  // Verify the actual search worker and GPU both receive the selected range.
  // Restore the initial 300% range before full CPU/GPU search to keep this test bounded.
  await page.reload(); await page.waitForFunction(() => window.__cueLab);
  await page.selectOption('#scene', 'cut'); await page.check('#unlimited-power');
  const hasGpu = await page.evaluate(async () => !!await navigator.gpu?.requestAdapter());
  for (const gpu of hasGpu ? [false, true] : [false]) {
    await page.locator('#gpu-search').setChecked(gpu); await page.click('#search');
    assert.equal(await page.locator('#unlimited-power').isDisabled(), true);
    await page.waitForFunction(() => !window.__cueLab.getState().searching, { timeout: 120000 });
    const searched = await state();
    assert.ok(searched.plans.length > 0);
    assert.ok(searched.plans.every(p => p.shot.unlimitedPower && p.shot.power <= 300));
    const exact = await page.evaluate(async () => {
      const { simulate } = await import('/src/physics.ts');
      const s = window.__cueLab.getState();
      return s.plans.every(p => JSON.stringify(p.outcome) === JSON.stringify(simulate(s.balls, p.shot, true)));
    });
    assert.ok(exact);
    if (gpu) {
      const status = await page.locator('#gpu-status').innerText();
      assert.match(status, /GPU 已试算/);
      assert.ok(Number(status.match(/已试算 (\d+)/)[1]) > 3292, 'GPU must include the new extended-power samples');
    }
    console.log('Extended full search:', gpu ? 'GPU + CPU' : 'CPU', await page.locator('#search-time').innerText());
  }
  // Shader ranks genuinely high-power trajectories and guards unaligned dispatch.
  if (hasGpu) {
    const gpu = await page.evaluate(async () => {
      const { gpuScreen } = await import('/src/gpu-search.ts');
      const { ball } = await import('/src/physics.ts');
      const { freshRules } = await import('/src/rules.ts');
      const rules = freshRules('practice'); rules.breakShot = false;
      const request = { id: 1, balls: [ball(0, 1.27, 0.9), ball(1, 1.27, 0.4)], rules, target: 1, pocket: 1, sort: 'balanced', unlimitedPower: true };
      const route = { angle: -Math.PI / 2, contact: { x: 1.27, y: 0.45715 }, length: 1, cut: 1, kind: 'normal', label: 'direct' };
      const shots = [125, 160, 220].map(power => ({ angle: route.angle, power, tipX: 0, tipY: 0, elevation: 0, kind: 'normal', unlimitedPower: true }));
      const result = await gpuScreen(request, [{ route, shots }]);
      return result.ok ? { ok: true, powers: result.grids[0].shots.map(s => s.power), tested: result.tested } : result;
    });
    assert.equal(gpu.ok, true, JSON.stringify(gpu)); assert.equal(gpu.tested, 3);
    assert.ok(gpu.powers.every(power => power > 100));
  }
  await page.uncheck('#unlimited-power');
  assert.equal((await state()).plans.length, 0);
  assert.ok((await state()).shot.power <= 100);
  assert.deepEqual(errors, []);
  console.log('Unlimited power controls, preview/execution, undo, CPU/GPU searches and disabling passed.');
} finally { await browser.close(); server?.kill(); }
