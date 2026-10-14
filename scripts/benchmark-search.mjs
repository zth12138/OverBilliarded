import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Run against npm run dev. Measure end-to-end worker time including adapter,
// shader compilation, readback, CPU refinement and final physics verification.
const browser = await chromium.launch({ channel: process.env.CUE_LAB_BROWSER || 'chrome', headless: true });
const page = await browser.newPage(), samples = [];
try {
  await page.goto(process.env.CUE_LAB_TEST_URL || 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__cueLab);
  const hardware = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return { browser: navigator.userAgent, vendor: adapter?.info.vendor, architecture: adapter?.info.architecture };
  });
  for (let round = 0; round < 2; round++) for (const scene of ['cut', 'combo', 'masse']) {
    // Alternate order to reduce warmup/order bias. Each search uses a fresh worker.
    for (const gpu of round % 2 ? [true, false] : [false, true]) {
      await page.selectOption('#scene', scene);
      await page.locator('#gpu-search').setChecked(gpu);
      await page.click('#search');
      await page.waitForFunction(() => !window.__cueLab.getState().searching, { timeout: 120000 });
      const status = await page.locator('#gpu-status').innerText(), time = await page.locator('#search-time').innerText();
      if (gpu && !status.includes('GPU 已试算')) throw new Error(`GPU did not complete: ${status}`);
      const plans = await page.evaluate(() => window.__cueLab.getState().plans);
      samples.push({ round, scene, gpu, seconds: Number(time.match(/([\d.]+) 秒/)[1]), plans: plans.length, kinds: [...new Set(plans.map(p => p.shot.kind))], status });
      console.log(samples.at(-1));
    }
  }
  const results = ['cut', 'combo', 'masse'].map(scene => {
    const avg = gpu => { const values = samples.filter(s => s.scene === scene && s.gpu === gpu); return values.reduce((sum, s) => sum + s.seconds, 0) / values.length; };
    const cpu = avg(false), gpu = avg(true);
    return { scene, cpuSeconds: +cpu.toFixed(2), gpuSeconds: +gpu.toFixed(2), speedup: +(cpu / gpu).toFixed(2) };
  });
  console.table(results);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/search-benchmark.json', JSON.stringify({ hardware, rounds: 2, samples, results }, null, 2));
} finally { await browser.close(); }
