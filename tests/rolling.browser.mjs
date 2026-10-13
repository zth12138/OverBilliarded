import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

// This visual fixture imports the actual Canvas painter through Vite.
const url = 'http://127.0.0.1:5173/';
let server;
try { if (!(await fetch(url)).ok) throw Error('unavailable'); }
catch {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const browser = await chromium.launch({ channel: process.env.CUE_LAB_BROWSER || 'chrome', headless: true });
try {
  await mkdir('test-results', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1320, height: 790 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url); await page.waitForFunction(() => window.__cueLab);
  const result = await page.evaluate(async () => {
    const { BallSurfaceRenderer } = await import('/src/ball-surface.ts');
    const { ball } = await import('/src/physics.ts');
    const { integrateOrientation } = await import('/src/rotation.ts');
    const painter = new BallSurfaceRenderer();
    const canvas = document.createElement('canvas'); canvas.width = 1312; canvas.height = 776;
    canvas.style.cssText = 'position:fixed;inset:0;z-index:100;background:#102a23'; document.body.append(canvas);
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#102a23'; c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#efe5cd'; c.font = '24px sans-serif'; c.fillText('球面滚动 · 同一颗球的连续朝向', 35, 40);
    c.fillStyle = '#adc4b5'; c.font = '14px sans-serif'; c.fillText('球号随球面移到边缘、背面；高光保持在固定光照方向。', 35, 68);
    const snapshots = [];
    for (let row = 0; row < 3; row++) {
      c.fillStyle = '#d7bd86'; c.font = '15px sans-serif';
      c.fillText(['实色球 · 向右滚动', '条纹球 · 斜向滚动', '白球 · 红点观察旋转'][row], 35, 104 + row * 224);
      for (let col = 0; col < 8; col++) {
        const b = ball([1, 10, 0][row], 0, 0), angle = col * Math.PI / 6;
        if (row === 0) b.wy = 1;
        else { b.wx = -Math.SQRT1_2; b.wy = Math.SQRT1_2; }
        integrateOrientation(b, angle);
        const x = 88 + col * 162, y = 183 + row * 224;
        painter.draw(c, b, x, y, 68, true);
        if (row === 0) {
          const pixels = c.getImageData(x - 68, y - 68, 136, 136).data;
          let count = 0, sumX = 0, center = 0;
          for (let py = 0; py < 136; py++) for (let px = 0; px < 136; px++) {
            const i = (py * 136 + px) * 4, rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
            if (Math.min(...rgb) > 130 && Math.max(...rgb) - Math.min(...rgb) < 35) {
              count++; sumX += px - 68;
              if (Math.abs(px - 68) < 14 && Math.abs(py - 68) < 14) center++;
            }
          }
          snapshots.push({ count, center, centroid: sumX / Math.max(1, count) });
        }
        c.fillStyle = '#a7bdae'; c.font = '13px monospace'; c.textAlign = 'center'; c.fillText(`${col * 30}°`, x, y + 88); c.textAlign = 'left';
      }
    }
    const probe = document.createElement('canvas'); probe.width = probe.height = 160;
    const p = probe.getContext('2d', { willReadFrequently: true });
    const white = ball(0, 0, 0); painter.draw(p, white, 80, 80, 70, false);
    const first = [...p.getImageData(0, 0, 160, 160).data];
    white.wx = -2; white.wy = 3; white.wz = 5; integrateOrientation(white, 0.4);
    p.clearRect(0, 0, 160, 160); painter.draw(p, white, 80, 80, 70, false);
    const turned = p.getImageData(0, 0, 160, 160).data;
    const fixedLighting = first.every((n, i) => n === turned[i]);
    p.clearRect(0, 0, 160, 160); painter.draw(p, white, 80, 80, 70, true);
    const marked = p.getImageData(0, 0, 160, 160).data;
    const marksVisible = first.some((n, i) => n !== marked[i]);
    const small = document.createElement('canvas'); small.width = small.height = 48;
    const sc = small.getContext('2d'), rolling = ball(10, 0, 0); rolling.wx = -1; rolling.wy = 1;
    const compact = [];
    for (let i = 0; i < 12; i++) {
      sc.clearRect(0, 0, 48, 48); painter.draw(sc, rolling, 24, 24, 12, true);
      compact.push(small.toDataURL()); integrateOrientation(rolling, 0.12);
    }
    // Exercise all sixteen sprites rather than benchmarking a single ball.
    const balls = Array.from({ length: 16 }, (_, id) => {
      const b = ball(id, 0, 0); b.wx = -15; b.wy = 21; b.wz = 12; return b;
    });
    const start = performance.now();
    for (let frame = 0; frame < 120; frame++) for (const b of balls) {
      integrateOrientation(b, 1 / 60); painter.draw(sc, b, 24, 24, 12, true);
    }
    const frameMs = (performance.now() - start) / 120;
    return { snapshots, fixedLighting, marksVisible, uniqueSmallFrames: new Set(compact).size, frameMs };
  });
  const [front, thirty, sixty, edge, backEdge, returning, otherBadge] = result.snapshots;
  assert.ok(thirty.centroid > front.centroid + 20, 'badge must roll across the sphere');
  assert.ok(sixty.count < front.count * 0.7, 'badge must foreshorten near the limb');
  assert.equal(edge.center, 0, 'the number must leave the face instead of spinning in place');
  assert.ok(backEdge.centroid < -20 && returning.centroid < -20, 'opposite badge must return from the other edge');
  assert.ok(otherBadge.center > 100, 'opposite badge should be visible after a half turn');
  assert.ok(result.fixedLighting, 'uniform ball lighting must be independent of orientation');
  assert.ok(result.marksVisible, 'cue ball marking option must draw rotating material');
  assert.equal(result.uniqueSmallFrames, 12, 'rolling must remain visible at game size');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/sphere-rolling.png' });
  console.log('Sphere projection passed: badge travel, foreshortening, occlusion, opposite-face return, fixed light, cue marks, game-size frames.');
  console.log(JSON.stringify(result));
} finally { await browser.close(); server?.kill(); }
