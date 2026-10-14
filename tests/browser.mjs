import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const url = process.env.CUE_LAB_TEST_URL || 'http://127.0.0.1:5173/';
let server;
try { const response = await fetch(url); if (!response.ok) throw Error('unavailable'); }
catch {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
}
const browser = await chromium.launch({ channel: process.env.CUE_LAB_BROWSER || 'chrome', headless: true });
await mkdir('test-results', { recursive: true });
const errors = [], page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(String(error)));
const state = () => page.evaluate(() => window.__cueLab.getState());
const idle = () => page.waitForFunction(() => !window.__cueLab.getState().moving, { timeout: 30000 });
try {
  await page.goto(url); await page.waitForFunction(() => window.__cueLab);
  assert.equal((await state()).balls.length, 16);
  const tableBox = await page.locator('#table').boundingBox();
  const initialAngle = (await state()).shot.angle;
  await page.mouse.move(tableBox.x + tableBox.width * 0.35, tableBox.y + tableBox.height * 0.5);
  await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.move(tableBox.x + tableBox.width * 0.35, tableBox.y + tableBox.height * 0.25, { steps: 8 }); await page.waitForTimeout(40); await page.mouse.up();
  assert.notEqual((await state()).shot.angle, initialAngle);
  const spinBox = await page.locator('#spin-pad').boundingBox();
  assert.equal(await page.locator('.spin-control #cue-marks').count(), 1);
  await page.mouse.move(spinBox.x + spinBox.width / 2, spinBox.y + spinBox.height / 2); await page.mouse.down(); await page.mouse.move(spinBox.x + spinBox.width * 0.75, spinBox.y + spinBox.height * 0.25, { steps: 8 }); await page.mouse.up();
  const draggedSpin = await state(); assert.ok(Math.abs(draggedSpin.shot.tipX) > 0.2 && draggedSpin.shot.tipY > 0.2);
  await page.screenshot({ path: 'test-results/table.png', fullPage: true });

  await page.selectOption('#scene', 'cut'); await page.click('#search');
  await page.waitForFunction(() => !window.__cueLab.getState().searching, { timeout: 30000 });
  const searched = await state(); assert.ok(searched.plans.length > 1);
  assert.equal(await page.locator('.plan-card').count(), searched.plans.length);
  assert.match(await page.locator('.plan-card').first().innerText(), /击球链条/);
  await page.screenshot({ path: 'test-results/assisted-shot.png', fullPage: true });
  const beforeStrike = await state();
  const silentCounts = beforeStrike.audio.played;
  assert.deepEqual(silentCounts, { cue: 0, contact: 0, rail: 0, pocket: 0 });
  await page.locator('.execute-plan').first().click();
  const pulling = await state();
  assert.equal(pulling.moving, true); assert.equal(pulling.feedback.stroke.impacted, false);
  assert.deepEqual(pulling.balls, beforeStrike.balls);
  assert.equal(await page.locator('#strike').isDisabled(), true);
  assert.equal(await page.locator('#angle').isDisabled(), true);
  assert.equal(await page.locator('#undo').isDisabled(), true);
  // Held aiming/spin controls, scene changes and repeated strike must not alter the queued shot.
  await page.evaluate(() => {
    document.querySelector('#strike').click(); document.querySelector('[data-mode="match"]').click();
    document.querySelector('#spin-pad').dispatchEvent(new PointerEvent('pointerdown', { clientX: 20, clientY: 20 }));
  });
  assert.deepEqual((await state()).shot, pulling.shot);
  await page.waitForTimeout(200);
  assert.deepEqual((await state()).balls, beforeStrike.balls);
  await page.locator('#table').screenshot({ path: 'test-results/cue-backswing.png' });
  await page.waitForFunction(() => window.__cueLab.getState().feedback.falls.length > 0, { timeout: 15000 });
  const falling = await state(); assert.equal(falling.balls.find(b => b.id === 1).pocketed, true);
  await page.locator('#table').screenshot({ path: 'test-results/pocket-fall.png' });
  await idle();
  const executed = await state(); assert.equal(executed.rules.shots, 1);
  assert.equal(executed.audio.played.cue, 1); assert.ok(executed.audio.played.contact > 0);
  assert.ok(executed.audio.played.pocket > 0);
  assert.equal(executed.feedback.stroke, null); assert.equal(executed.feedback.falls.length, 0);
  for (const b of executed.balls) {
    const expected = searched.plans[0].outcome.balls.find(x => x.id === b.id);
    assert.ok(Math.hypot(b.x - expected.x, b.y - expected.y) < 1e-9); assert.equal(b.pocketed, expected.pocketed);
    for (const field of ['qx', 'qy', 'qz', 'qw']) assert.equal(b[field], expected[field]);
  }
  await page.click('#undo'); assert.equal((await state()).rules.shots, 0);
  assert.equal((await state()).balls.find(b => b.id === 1).pocketed, false);
  assert.deepEqual((await state()).balls, beforeStrike.balls);
  const soundedCounts = (await state()).audio.played;
  await page.uncheck('#sound');
  await page.locator('#power').fill('1'); await page.click('#strike'); await idle();
  assert.equal((await state()).rules.shots, 1);
  assert.deepEqual((await state()).audio.played, soundedCounts);
  await page.check('#sound');

  await page.selectOption('#scene', 'bank'); await page.click('#search');
  await page.waitForFunction(() => !window.__cueLab.getState().searching);
  assert.ok((await state()).plans.some(p => p.route.includes('翻袋')));

  for (const kind of ['jump', 'masse']) {
    await page.selectOption('#scene', kind); await page.click('#search');
    await page.waitForFunction(() => !window.__cueLab.getState().searching, { timeout: 30000 });
    const specialSearch = await state(), index = specialSearch.plans.findIndex(p => p.shot.kind === kind);
    assert.ok(index >= 0, `${kind} search should return a playable special stroke`);
    const plan = specialSearch.plans[index];
    await page.locator('.plan-select').nth(index).click();
    assert.deepEqual((await state()).shot, plan.shot);
    assert.equal(await page.locator('#kind').inputValue(), kind);
    assert.equal(Number(await page.locator('#elevation').inputValue()), Number(plan.shot.elevation.toFixed(1)));
    assert.match(await page.locator('.plan-card').nth(index).innerText(), /抬杆/);
    await page.locator('.execute-plan').nth(index).click(); await idle();
    assert.deepEqual((await state()).balls, plan.outcome.balls);
    assert.equal((await state()).balls.find(b => b.id === specialSearch.target).pocketed, true);
  }

  await page.selectOption('#scene', 'combo'); await page.click('#search');
  await page.click('#cancel-search'); assert.equal((await state()).searching, false);
  assert.equal(await page.locator('#strike').isEnabled(), true);
  await page.click('#edit'); const beforeEdit = await state();
  await page.selectOption('#edit-ball', '1'); await page.click('#remove-ball');
  assert.equal((await state()).balls.find(b => b.id === 1).pocketed, true);
  await page.click('#restore-ball'); assert.equal((await state()).balls.find(b => b.id === 1).pocketed, false);
  await page.click('#edit');

  await page.selectOption('#scene', 'cut'); await page.check('#auto'); await page.click('#search');
  await page.waitForFunction(() => window.__cueLab.getState().rules.shots === 1 && !window.__cueLab.getState().moving, { timeout: 30000 });
  assert.equal((await state()).balls.find(b => b.id === 1).pocketed, true); await page.uncheck('#auto');

  await page.selectOption('#scene', 'black'); await page.click('#search');
  await page.waitForFunction(() => !window.__cueLab.getState().searching); await page.locator('.execute-plan').first().click(); await idle();
  assert.equal((await state()).rules.winner, 0); assert.equal(await page.locator('#strike').isDisabled(), true);

  await page.click('[data-mode="match"]'); await page.fill('#angle', '180'); await page.click('#strike'); await idle();
  const foul = await state(); assert.equal(foul.rules.player, 1); assert.equal(foul.rules.ballInHand, true);
  const box = await page.locator('#table').boundingBox();
  const scale = Math.min((box.width - 108) / 2.54, (box.height - 108) / 1.27), ox = (box.width - 2.54 * scale) / 2, oy = (box.height - 1.27 * scale) / 2;
  // Invalid free-ball placement must preserve the foul state and keep strike locked.
  const object = foul.balls.find(b => b.id !== 0 && !b.pocketed);
  for (const [x, y] of [[object.x, object.y], [0.04, 0.04], [-0.02, 0.3]]) {
    await page.mouse.click(box.x + ox + x * scale, box.y + oy + y * scale);
    const rejected = await state();
    assert.equal(rejected.rules.ballInHand, true); assert.equal(rejected.rules.player, 1);
    assert.deepEqual(rejected.balls, foul.balls); assert.equal(await page.locator('#strike').isDisabled(), true);
  }
  await page.mouse.click(box.x + ox + 0.5 * scale, box.y + oy + 0.3 * scale);
  assert.equal((await state()).rules.ballInHand, false); assert.equal(await page.locator('#strike').isEnabled(), true);

  await page.click('#help'); assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), true);
  await page.click('.dialog-close');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.check('#cue-marks');
  await page.screenshot({ path: 'test-results/laptop.png', fullPage: true });
  await page.click('[data-mode="practice"]'); await page.selectOption('#scene', 'rack'); await page.fill('#angle', '0');
  await page.locator('#power').fill('75'); await page.click('#reset-spin'); await page.click('#strike');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/rolling-in-play.png', fullPage: true });
  await idle();
  const finished = await state();
  assert.ok(finished.balls.some(b => !b.pocketed && Math.abs(b.qw) < 0.98));
  await page.waitForTimeout(100);
  assert.deepEqual((await state()).balls, finished.balls);
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: play, exact preview execution, plans, bank, automatic jump/masse/elevation and execution, cancellation, editing, undo, automatic shot, black win, two-player foul/free ball, help, laptop layout.');
} finally { await browser.close(); server?.kill(); }
