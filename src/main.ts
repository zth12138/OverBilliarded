import './style.css';
import { ball, copyState, legalPlacement, PhysicsWorld, POCKETS, simulate, TABLE } from './physics';
import { describeEventChain, finishTurn, groupName, groupOf, legalFirstIds, pocketName, remainingFor } from './rules';
import { COLORS, TableRenderer } from './renderer';
import { BallSurfaceRenderer, cueBallView } from './ball-surface';
import { scene, type SceneName } from './scenes';
import { ShotFeedback } from './shot-feedback';
import { EXTENDED_POWER_START, shotPower } from './power';
import { TableAudio } from './audio';
import type { Ball, Plan, RuleState, SearchUpdate, Shot, Simulation, SortMode } from './types';

const icon = (name: string) => ({ aim: '◎', undo: '↶', reset: '↻', arrow: '↗', play: '▶', settings: '⌘', spark: '✧' })[name] ?? name;
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="app-header">
    <a class="brand" href="/" aria-label="台球实验室首页"><span class="brand-ball">8</span><span>CUE<span class="brand-light">LAB</span><small>台球实验室</small></span></a>
    <nav class="mode-tabs" aria-label="游戏模式"><button class="active" data-mode="practice">自由练习</button><button data-mode="match">双人对战</button></nav>
    <div class="header-actions"><span class="local-status"><i></i>本地运行</span><button class="icon-button" id="help" title="操作与规则">?</button></div>
  </header>
  <main class="workspace">
    <section class="play-area">
      <div class="table-heading"><div><div class="eyebrow">CHINESE EIGHT-BALL <span>/</span> TABLE 01</div><h1>中式八球<span class="version">第一版</span></h1></div><div class="table-actions"><button class="text-button" id="undo">${icon('undo')} 撤销</button><button class="text-button" id="new-game">${icon('reset')} 重新开局</button></div></div>
      <div class="scoreboard"><div class="player active" id="player0"><span class="player-index">01</span><div><strong>玩家一 <span class="turn-dot">●</span></strong><small id="group0">未分组</small></div><div class="score-balls" id="balls0"></div></div><div class="score-divider">VS</div><div class="player" id="player1"><div class="score-balls" id="balls1"></div><div><strong>玩家二 <span class="turn-dot">●</span></strong><small id="group1">未分组</small></div><span class="player-index">02</span></div></div>
      <div class="table-stage"><div class="stage-top"><span id="stage-mode">练习球桌</span><span class="stage-toggles"><label class="check-label"><input id="sound" type="checkbox" checked> 音效</label><label class="check-label"><input id="aim" type="checkbox" checked> 瞄准线</label><label class="check-label"><input id="position-preview" type="checkbox"> 白球走位</label></span></div><canvas id="table" aria-label="台球桌，点击空白处瞄准，点击目标球或洞口选择" tabindex="0"></canvas><div class="stage-bottom"><span id="table-hint">点击球桌瞄准 · 空格出杆 · ← → 微调角度</span><span id="shot-number">第 01 杆</span></div></div>
      <div class="status-bar" role="status" aria-live="polite"><span class="status-mark"></span><span id="status">准备就绪</span><button id="place-cue" class="inline-button">放置白球</button></div>
      <section class="shot-console" aria-label="击球控制">
        <div class="power-control"><div class="control-heading"><label for="power">击球力度</label><output id="power-value">45<span>%</span></output></div><input id="power" type="range" min="1" max="100" value="45"><div class="range-labels"><span>轻推</span><span id="power-range-label">100% 强击</span></div><label class="check-label power-unlimited"><input id="unlimited-power" type="checkbox"> 力度无限制</label><div id="extended-power-controls" class="extended-power-controls" hidden><label for="power-number">力度 %</label><input id="power-number" type="number" min="1" step="1" value="45"><button id="expand-power" class="inline-button" type="button">扩大滑杆范围</button></div><div class="angle-row"><label for="angle">方向</label><input id="angle" type="number" step="0.1" value="0"><span>°</span><button id="preview" class="inline-button">预览本杆</button></div></div>
        <div class="spin-control"><div class="control-heading"><span>杆头击点</span><span class="spin-heading-actions"><label class="cue-mark-toggle" title="显示随白球滚动的六个红点，观察高低杆与侧旋"><input id="cue-marks" type="checkbox" checked> 红点</label><button class="inline-button" id="reset-spin">回中</button></span></div><div class="spin-pad-row"><div class="spin-label">左塞</div><div class="spin-pad" id="spin-pad" tabindex="0" role="slider" aria-label="杆头击点，方向键调整，高杆向上低杆向下" aria-valuemin="-85" aria-valuemax="85" aria-valuenow="0"><canvas id="spin-ball" width="94" height="94" aria-hidden="true"></canvas><span class="spin-line horizontal"></span><span class="spin-line vertical"></span><span class="spin-marker" id="spin-marker"></span><span class="spin-top">高杆</span><span class="spin-bottom">低杆</span></div><div class="spin-label">右塞</div><span id="spin-description">中杆<br><small>不加塞</small></span></div></div>
        <div class="elevation-control"><div class="control-heading"><label for="kind">杆法</label><select id="kind"><option value="normal">平杆</option><option value="jump">跳球</option><option value="masse">扎杆</option></select></div><div class="elevation-heading"><label for="elevation">抬杆角度</label><output id="elevation-value">0°</output></div><input id="elevation" type="range" min="0" max="82" step="0.1" value="0"><small id="elevation-note">平杆 · 调整击点控制跟进与回拉</small></div>
        <button class="strike-button" id="strike"><span>出杆 ${icon('arrow')}</span><small>SPACE / 空格</small></button>
      </section>
      <section class="practice-toolbar" id="practice-toolbar"><div><span class="eyebrow">PRACTICE</span><select id="scene" aria-label="练习局面"><option value="rack">标准开球</option><option value="cut">直球与走位</option><option value="bank">翻袋练习</option><option value="kick">单库解球</option><option value="combo">组合球练习</option><option value="jump">跳球练习</option><option value="masse">扎杆练习</option><option value="black">黑八收尾</option></select></div><button id="edit" class="text-button">${icon('settings')} 自由摆球</button><div class="edit-tools" id="edit-tools" hidden><select id="edit-ball" aria-label="选择摆放的球"></select><button id="restore-ball" class="inline-button">放回球桌</button><button id="remove-ball" class="inline-button">移出球桌</button></div></section>
      <details class="shot-log"><summary>上一杆击球链条 <span id="last-shot-summary">尚未出杆</span></summary><div id="last-chain">实际发生的碰撞、碰库和进球将在这里显示。</div></details>
    </section>
    <aside class="assistant-panel">
      <div class="assistant-heading"><div class="assistant-icon">${icon('spark')}</div><div><div class="eyebrow">SHOT EXPLORER</div><h2>智能辅助</h2></div><span class="assistant-badge">试验版</span></div>
      <p class="assistant-intro">选一颗球，一个洞口。<br>探索这一杆的更多可能。</p>
      <div class="assist-field"><label for="target"><span class="step-number">01</span>目标球</label><select id="target"></select></div>
      <div class="assist-field"><label><span class="step-number">02</span>目标洞口 <span id="pocket-name">右上袋</span></label><div class="pocket-map" aria-label="选择目标洞口">${POCKETS.map((p, i) => `<button class="pocket-choice pocket-${i}" data-pocket="${i}" aria-label="${p.name}袋" title="${p.name}袋"></button>`).join('')}<span class="map-cross">＋</span><span class="map-caption">点击洞口选择</span></div></div>
      <div class="assist-field"><label for="sort"><span class="step-number">03</span>方案偏好</label><select id="sort"><option value="balanced">综合推荐</option><option value="simple">复杂度最低</option><option value="position">下一杆优势优先</option><option value="robust">容错程度优先</option><option value="fancy">最花哨</option></select></div>
      <label class="auto-control"><div><strong>全自动执行</strong><small>搜索完成后执行首选方案</small></div><input id="auto" type="checkbox" role="switch"><span class="switch-track"></span></label>
      <label class="auto-control gpu-control"><div><strong>GPU 加速（可选）</strong><small id="gpu-status" aria-live="polite">默认 CPU 搜索；GPU 批量试算后仍精确验证</small></div><input id="gpu-search" type="checkbox" role="switch"><span class="switch-track"></span></label>
      <button class="search-button" id="search">${icon('spark')} 搜索击球方案 <span>↗</span></button>
      <div class="search-progress" id="search-progress" hidden><div><span id="progress-text">搜索中…</span><button id="cancel-search" class="inline-button">取消</button></div><progress id="progress" max="100" value="0"></progress></div>
      <div class="results-heading"><h3>候选方案 <span id="plan-count">00</span></h3><span id="search-time">等待搜索</span></div>
      <div id="plans"><div class="empty-state"><div class="empty-orbit"><span>↗</span></div><strong>下一杆，由你定义</strong><p>选择目标球与洞口后开始搜索。<br>试试「直球与走位」练习局面。</p></div></div>
      <div class="assistant-footnote"><i></i><span>仅推荐通过本地规则检查的方案。<br>容错分数来自参数扰动试算。</span></div>
    </aside>
  </main>
  <footer class="app-footer"><span>CUE LAB <span>·</span> 每一杆，探索更多可能。</span><span>中式八球 · 本地双人 / 自由练习</span></footer>
  <dialog id="help-dialog"><button class="dialog-close icon-button" aria-label="关闭帮助">×</button><div class="eyebrow">QUICK GUIDE</div><h2>上手这一杆</h2><p>点击球桌空白处瞄准，点击彩球选择目标；点击洞口指定入袋位置。调整力度、击点和抬杆角度后，按空格或「出杆」。← → 微调方向，按住 Shift 可更精细地调整。</p><p>「预览本杆」显示当前参数的模拟路线。「搜索击球方案」搜索直球、单库翻袋、单库解球、简单组合球，以及跳球和扎杆。击点、力度、方向与抬杆角度均由程序自动搜索。选择方案可查看击球链条和白球落点；打开全自动后，搜索完成会执行首选方案。</p><h3>本版规则约定</h3><p>开球需进球或至少四颗目标球碰库；开球不分组，黑八入袋重置。开放球局不得先碰黑八；非开球时合法打进单一组别后分组，两组同进则仍开放。分组后须先碰己方球，碰球后须进球或碰库。犯规给对方全台自由球；打飞的普通目标球不重置。</p><p>打黑八前必须已清空己方球，并指定洞口。提前进黑八、黑八入错袋、打飞黑八或进黑八同时犯规均判负。本版采用以上固定的休闲规则约定，不含裁判认定的推杆、连击和故意犯规。</p><h3>练习与杆法</h3><p>练习模式保留规则提示，由同一人连续操作。自由摆球可拖动球，或从球号菜单放回、移出球。高低杆和左右塞由击点控制；跳球选择跳球杆法并抬杆，扎杆选择扎杆后抬杆并加偏心击点。旋转与离台采用近似物理模型。智能辅助会比较不同杆法，并细化抬杆角度与组合击点；有限搜索仍可能遗漏复杂解法。</p><h3>快捷键</h3><p>空格：出杆 · ← →：微调方向 · Ctrl+Z：撤销 · Esc：取消搜索或退出摆球。输入框内不触发出杆快捷键。</p></dialog>
  <div class="toast" id="toast" role="status"></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
let loaded = scene('rack', 'practice'), balls = loaded.balls, rules = loaded.rules, target = loaded.target, pocket = loaded.pocket;
let shot: Shot = { angle: 0, power: 45, tipX: 0, tipY: 0, elevation: 0, kind: 'normal' };
let world: PhysicsWorld | null = null, preview: Simulation | null = null, plans: Plan[] = [], selected: Plan | null = null;
let edit = false, placeCue = false, pointer: { x: number; y: number } | null = null, dragBall: number | null = null;
let aiming = false;
let worker: Worker | null = null, requestId = 0, searching = false, lastChain: string[] = [];
let toastTimer: ReturnType<typeof setTimeout>, clock = performance.now(), accumulator = 0;
const history: { balls: Ball[]; rules: RuleState; shot: Shot; chain: string[] }[] = [];
let preShot: Ball[] = [];
const feedback = new ShotFeedback(), audio = new TableAudio();
let eventCursor = 0;
const busy = () => !!world || !!feedback.stroke;
const renderer = new TableRenderer($<HTMLCanvasElement>('table'));
const spinCanvas = $<HTMLCanvasElement>('spin-ball');
const spinContext = spinCanvas.getContext('2d')!;
const spinSurface = new BallSurfaceRenderer();
function drawSpinBall() {
  spinContext.clearRect(0, 0, spinCanvas.width, spinCanvas.height);
  const cue = balls.find(b => b.id === 0);
  if (cue) spinSurface.draw(spinContext, cue, spinCanvas.width / 2, spinCanvas.height / 2, spinCanvas.width * 0.45, $<HTMLInputElement>('cue-marks').checked, cueBallView(shot.angle, shot.elevation));
}
const saveHistory = () => { history.push({ balls: copyState(balls), rules: structuredClone(rules), shot: { ...shot }, chain: [...lastChain] }); if (history.length > 40) history.shift(); };
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3300); }
function invalidate() { if (searching) cancelSearch(); plans = []; selected = null; preview = null; $('search-time').textContent = '等待搜索'; renderPlans(); }
function changeShot() { preview = null; selected = null; updateShotUI(); if (plans.length) renderPlans(); }
let powerRangeMax = EXTENDED_POWER_START;
function updateShotUI() {
  const unlimited = !!shot.unlimitedPower;
  $<HTMLInputElement>('unlimited-power').checked = unlimited;
  if (unlimited) powerRangeMax = Math.max(powerRangeMax, Math.ceil(shot.power / 100) * 100);
  $<HTMLInputElement>('power').max = String(unlimited ? powerRangeMax : 100);
  $('extended-power-controls').hidden = !unlimited;
  $<HTMLInputElement>('power-number').value = String(Number(shot.power.toFixed(2)));
  $('power-range-label').textContent = `${unlimited ? powerRangeMax : 100}% 强击`;
  $<HTMLInputElement>('power').value = String(shot.power); $('power-value').innerHTML = `${Math.round(shot.power)}<span>%</span>`;
  $<HTMLInputElement>('angle').value = String(Math.round(((shot.angle * 180 / Math.PI + 360) % 360) * 100) / 100);
  $<HTMLSelectElement>('kind').value = shot.kind; $<HTMLInputElement>('elevation').value = String(shot.elevation); $('elevation-value').textContent = `${Number(shot.elevation.toFixed(1))}°`;
  $('spin-marker').style.left = `${50 + shot.tipX * 46}%`; $('spin-marker').style.top = `${50 - shot.tipY * 46}%`;
  $('spin-pad').setAttribute('aria-valuenow', String(Math.round(shot.tipY * 100)));
  $('spin-pad').setAttribute('aria-valuetext', `左右 ${shot.tipX.toFixed(2)}，高低 ${shot.tipY.toFixed(2)}`);
  const vertical = shot.tipY > 0.12 ? '高杆' : shot.tipY < -0.12 ? '低杆' : '中杆', horizontal = shot.tipX > 0.12 ? '右塞' : shot.tipX < -0.12 ? '左塞' : '不加塞';
  $('spin-description').innerHTML = `${vertical}<br><small>${horizontal}</small>`;
  $('elevation-note').textContent = shot.kind === 'jump' ? '离台高度取决于力度与抬杆角度' : shot.kind === 'masse' ? '抬杆并加偏心击点，让摩擦产生弧线' : '平杆 · 调整击点控制跟进与回拉';
}
function updateUI() {
  for (const i of [0, 1] as const) {
    $(`player${i}`).classList.toggle('active', rules.player === i); $(`group${i}`).textContent = `${groupName(rules.groups[i])}${rules.groups[i] ? ` · 剩余 ${remainingFor(rules.groups[i]!, balls)}` : ''}`;
    const ids = rules.groups[i] === 'stripe' ? [9, 10, 11, 12, 13, 14, 15] : [1, 2, 3, 4, 5, 6, 7];
    $(`balls${i}`).innerHTML = ids.map(id => `<span class="score-ball ${rules.groups[i] === 'stripe' ? 'striped' : ''} ${balls.find(b => b.id === id)?.pocketed ? 'potted' : ''}" style="--ball-color:${COLORS[id]}">${id}</span>`).join('');
  }
  $('status').textContent = rules.message; $('shot-number').textContent = `第 ${String(rules.shots + 1).padStart(2, '0')} 杆`;
  $('stage-mode').textContent = feedback.stroke && !feedback.stroke.impacted ? '准备出杆' : busy() ? '击球中' : edit ? '自由摆球' : rules.winner !== null ? '本局结束' : rules.mode === 'practice' ? '练习球桌' : `玩家 ${rules.player + 1} 击球`;
  const activeBalls = balls.filter(b => !b.pocketed && b.id !== 0).sort((a, b) => a.id - b.id);
  if (!activeBalls.some(b => b.id === target)) target = activeBalls[0]?.id ?? 8;
  const legal = legalFirstIds(balls, rules);
  $<HTMLSelectElement>('target').innerHTML = activeBalls.map(b => `<option value="${b.id}">${b.id} 号球 · ${b.id === 8 ? '黑八' : groupName(groupOf(b.id))}${legal.includes(b.id) ? '' : ' / 需合法组合'}</option>`).join('');
  $<HTMLSelectElement>('target').value = String(target);
  $('pocket-name').textContent = `${pocketName(pocket)}袋`; document.querySelectorAll<HTMLButtonElement>('[data-pocket]').forEach(b => { b.classList.toggle('selected', Number(b.dataset.pocket) === pocket); b.setAttribute('aria-pressed', String(Number(b.dataset.pocket) === pocket)); });
  const unavailable = busy() || searching || edit || placeCue || rules.ballInHand || rules.winner !== null || !!balls.find(b => b.id === 0)?.pocketed;
  for (const id of ['power', 'angle', 'kind', 'elevation', 'reset-spin', 'target', 'sort', 'gpu-search', 'unlimited-power', 'power-number', 'expand-power']) $<HTMLInputElement>(id).disabled = busy() || searching;
  $('spin-pad').setAttribute('aria-disabled', String(busy() || searching));
  $<HTMLButtonElement>('strike').disabled = unavailable; $<HTMLButtonElement>('preview').disabled = unavailable;
  $<HTMLButtonElement>('search').disabled = unavailable; $<HTMLButtonElement>('undo').disabled = !history.length || busy();
  $<HTMLButtonElement>('new-game').disabled = busy(); $<HTMLButtonElement>('edit').disabled = busy() || searching;
  $<HTMLButtonElement>('place-cue').hidden = rules.mode !== 'practice' && !rules.ballInHand;
  $('place-cue').textContent = placeCue ? '取消放置' : rules.ballInHand ? '放置自由球' : '放置白球';
  $('practice-toolbar').hidden = rules.mode !== 'practice'; $('edit-tools').hidden = !edit; $('edit').classList.toggle('active', edit);
  $<HTMLSelectElement>('scene').disabled = busy() || searching;
  $('table-hint').textContent = placeCue || rules.ballInHand ? '点击球桌合法位置放置白球' : edit ? '拖动球摆放 · 从菜单恢复或移出球' : '点击空白处瞄准 · 空格出杆 · ← → 微调';
  $('last-chain').textContent = lastChain.length ? lastChain.join(' → ') : '实际发生的碰撞、碰库和进球将在这里显示。';
  $('last-shot-summary').textContent = lastChain.length ? `${lastChain.length - 1} 次事件` : '尚未出杆';
}
function setPocket(id: number) { if (busy() || searching) return; if (pocket !== id) { pocket = id; invalidate(); } rules.calledPocket = pocket; updateUI(); }
function setTarget(id: number) { if (busy() || searching) return; if (target !== id) { target = id; invalidate(); } updateUI(); }
function loadScene(name: SceneName, mode = rules.mode) {
  if (busy()) return; cancelSearch(); loaded = scene(name, mode); balls = loaded.balls; rules = loaded.rules; target = loaded.target; pocket = loaded.pocket;
  shot = { angle: 0, power: name === 'rack' ? 80 : 35, tipX: 0, tipY: 0, elevation: 0, kind: 'normal', ...($<HTMLInputElement>('unlimited-power').checked ? { unlimitedPower: true } : {}) };
  if (name === 'jump') { shot.kind = 'jump'; shot.elevation = 48; shot.power = 48; }
  if (name === 'masse') { shot.kind = 'masse'; shot.elevation = 68; shot.tipX = 0.6; shot.tipY = -0.25; shot.power = 48; }
  const cue = balls.find(b => b.id === 0)!, t = balls.find(b => b.id === target)!; shot.angle = Math.atan2(t.y - cue.y, t.x - cue.x);
  feedback.clear(); audio.stop(); eventCursor = 0;
  history.length = 0; lastChain = []; edit = placeCue = false; invalidate(); updateShotUI(); updateUI();
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $<HTMLSelectElement>('scene').value = name;
}
function strike(params = shot) {
  if (busy() || searching || edit || rules.winner !== null || placeCue || rules.ballInHand) return;
  const cue = balls.find(b => b.id === 0); if (!cue || cue.pocketed) { toast('请先放置白球'); return; }
  saveHistory(); preShot = copyState(balls); shot = { ...params }; rules.calledPocket = pocket;
  aiming = spinning = false; table.classList.remove('aiming');
  audio.unlock(); feedback.start(cue, shot); eventCursor = 0;
  accumulator = 0; clock = performance.now(); invalidate(); updateShotUI(); updateUI();
}
function undo() {
  if (busy()) return; const saved = history.pop(); if (!saved) return;
  feedback.clear(); audio.stop(); eventCursor = 0;
  cancelSearch(); balls = saved.balls; rules = saved.rules; shot = saved.shot; lastChain = saved.chain; placeCue = false; invalidate(); updateShotUI(); updateUI();
}
function cancelSearch() {
  worker?.terminate(); worker = null; searching = false; requestId++; $('search-progress').hidden = true; updateUI();
}
function startSearch() {
  if (busy() || searching || rules.winner !== null || rules.ballInHand) return;
  if (rules.breakShot) { toast('先完成开球，或载入练习局面再搜索指定进球'); return; }
  if (target === 8 && !legalFirstIds(balls, rules).includes(8)) { toast('自己的球尚未清空，不能以黑八进球为目标'); return; }
  plans = []; selected = null; preview = null; searching = true; const id = ++requestId;
  $('search-progress').hidden = false; $<HTMLProgressElement>('progress').value = 0; $('progress-text').textContent = '生成候选路线…'; $('search-time').textContent = '搜索中'; renderPlans(); updateUI();
  worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
  let backend = 'CPU';
  worker.onmessage = (event: MessageEvent<SearchUpdate>) => {
    const data = event.data; if (data.id !== requestId) return;
    if (data.type === 'backend') { backend = data.backend === 'gpu' ? 'GPU + CPU' : 'CPU'; $('gpu-status').textContent = data.message; $('progress-text').textContent = data.message; }
    else if (data.type === 'progress') { $<HTMLProgressElement>('progress').value = data.checked / data.total * 100; $('progress-text').textContent = `${backend} · 已精确试算 ${data.checked} 组 · 找到 ${data.found} 个候选`; }
    else if (data.type === 'done') {
      worker?.terminate(); worker = null; searching = false; $('search-progress').hidden = true; plans = data.plans; $('search-time').textContent = `${backend} · ${(data.elapsed / 1000).toFixed(1)} 秒 · ${data.checked} 次`;
      if (plans.length) choosePlan(plans[0].id); else renderPlans(); updateUI();
      if (plans.length && $<HTMLInputElement>('auto').checked) { toast('已找到首选方案，自动执行'); strike(plans[0].shot); }
    } else { cancelSearch(); toast(`搜索失败：${data.message}`); }
  };
  worker.onerror = () => { cancelSearch(); toast('搜索未能运行，请刷新页面后重试'); };
  worker.postMessage({ id, balls: copyState(balls), rules: { ...rules, calledPocket: pocket }, target, pocket, sort: $<HTMLSelectElement>('sort').value as SortMode,
    useGpu: $<HTMLInputElement>('gpu-search').checked, unlimitedPower: !!shot.unlimitedPower, searchPowerMax: Math.max(EXTENDED_POWER_START, powerRangeMax, shot.power) });
}
function choosePlan(id: string) {
  const plan = plans.find(p => p.id === id); if (!plan || busy() || searching) return;
  selected = plan; shot = { ...plan.shot }; preview = plan.outcome; updateShotUI(); renderPlans();
}
function renderPlans() {
  $('plan-count').textContent = String(plans.length).padStart(2, '0');
  if (!plans.length) {
    $('plans').innerHTML = `<div class="empty-state"><div class="empty-orbit"><span>${searching ? '⌕' : '↗'}</span></div><strong>${searching ? '正在探索击球路线' : $('search-time').textContent?.includes('次') ? '本次搜索未找到可行方案' : '下一杆，由你定义'}</strong><p>${searching ? '后台试算中，球桌保持响应。' : $('search-time').textContent?.includes('次') ? '可尝试其他洞口或调整球位。<br>当前搜索范围未覆盖所有可能打法。' : '选择目标球与洞口后开始搜索。<br>试试「直球与走位」练习局面。'}</p></div>`; return;
  }
  $('plans').innerHTML = plans.map((p, index) => `<article class="plan-card ${selected?.id === p.id ? 'selected' : ''}" data-plan="${p.id}"><button class="plan-select" data-select-plan="${p.id}"><span class="plan-rank">${String(index + 1).padStart(2, '0')}</span><span><strong>${p.route}</strong><small>${Math.round(p.shot.power)}% 力度 · 抬杆 ${Number(p.shot.elevation.toFixed(1))}° · ${p.shot.tipY > 0.1 ? '高杆' : p.shot.tipY < -0.1 ? '低杆' : '中杆'}${Math.abs(p.shot.tipX) > 0.1 ? p.shot.tipX > 0 ? '右塞' : '左塞' : ''}</small></span><span class="legal-badge">合法</span></button><div class="plan-metrics"><span>复杂度 <b>${Math.round(p.complexity)}</b></span><span>走位 <b>${Math.round(p.position)}</b></span><span>容错 <b>${Math.round(p.robustness)}</b></span></div><details ${selected?.id === p.id ? 'open' : ''}><summary>击球链条与参数</summary><p class="chain">${p.chain.join(' → ')}</p><p class="plan-params">角度 ${((p.shot.angle * 180 / Math.PI + 360) % 360).toFixed(2)}° · 力度 ${p.shot.power.toFixed(1)}%<br>击点 (${p.shot.tipX.toFixed(2)}, ${p.shot.tipY.toFixed(2)}) · ${p.shot.kind === 'jump' ? '跳球' : p.shot.kind === 'masse' ? '扎杆' : '平杆'} · 抬杆 ${Number(p.shot.elevation.toFixed(1))}°</p><button class="execute-plan" data-execute-plan="${p.id}">执行此方案 ↗</button></details></article>`).join('');
}

$<HTMLInputElement>('power').oninput = e => { shot.power = Number((e.target as HTMLInputElement).value); changeShot(); };
$<HTMLInputElement>('unlimited-power').onchange = e => {
  if (busy() || searching) return;
  if ((e.target as HTMLInputElement).checked) shot.unlimitedPower = true;
  else { delete shot.unlimitedPower; shot.power = Math.min(100, shot.power); }
  invalidate(); updateShotUI(); updateUI();
};
$<HTMLInputElement>('power-number').onchange = e => {
  if (busy() || searching || !shot.unlimitedPower) return;
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value >= 1) shot.power = value;
  changeShot();
};
$('expand-power').onclick = () => {
  if (busy() || searching || !shot.unlimitedPower) return;
  powerRangeMax *= 2; invalidate(); updateShotUI(); updateUI();
};
$<HTMLInputElement>('angle').oninput = e => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n)) { shot.angle = n * Math.PI / 180; preview = null; selected = null; } };
$<HTMLInputElement>('elevation').oninput = e => { shot.elevation = Number((e.target as HTMLInputElement).value); if (shot.elevation > 35 && shot.kind === 'normal') shot.kind = 'masse'; changeShot(); };
$<HTMLSelectElement>('kind').onchange = e => { shot.kind = (e.target as HTMLSelectElement).value as Shot['kind']; shot.elevation = shot.kind === 'jump' ? 48 : shot.kind === 'masse' ? 68 : 0; if (shot.kind === 'masse' && Math.abs(shot.tipX) < 0.2) shot.tipX = 0.55; changeShot(); };
const setSpin = (x: number, y: number) => { const len = Math.hypot(x, y), factor = len > 0.85 ? 0.85 / len : 1; shot.tipX = x * factor; shot.tipY = y * factor; changeShot(); };
let spinning = false;
const spinEvent = (e: PointerEvent) => { const r = $('spin-pad').getBoundingClientRect(); setSpin((e.clientX - r.left - r.width / 2) / (r.width * 0.46), -(e.clientY - r.top - r.height / 2) / (r.height * 0.46)); };
$('spin-pad').onpointerdown = e => { if (busy() || searching) return; spinning = true; $('spin-pad').setPointerCapture(e.pointerId); spinEvent(e); };
$('spin-pad').onpointermove = e => { if (spinning && !busy() && !searching) spinEvent(e); }; $('spin-pad').onpointerup = () => { spinning = false; };
$('spin-pad').onkeydown = e => { if (busy() || searching) return; const step = 0.05; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setSpin(shot.tipX + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), shot.tipY + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0)); } };
$('reset-spin').onclick = () => setSpin(0, 0);
document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
document.addEventListener('keydown', () => audio.unlock(), { capture: true });
$<HTMLInputElement>('sound').onchange = e => audio.setEnabled((e.target as HTMLInputElement).checked);
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.stop(); });
$('strike').onclick = () => strike(); $('undo').onclick = undo; $('new-game').onclick = () => loadScene('rack');
$('preview').onclick = () => { if (busy() || searching) return; preview = simulate(balls, shot, true); selected = null; toast('白色虚线：白球 · 金色实线：目标球 · 圆圈：白球落点'); };
$('search').onclick = startSearch; $('cancel-search').onclick = () => { cancelSearch(); $('search-time').textContent = '已取消'; renderPlans(); };
$<HTMLSelectElement>('target').onchange = e => setTarget(Number((e.target as HTMLSelectElement).value));
document.querySelectorAll<HTMLButtonElement>('[data-pocket]').forEach(b => b.onclick = () => setPocket(Number(b.dataset.pocket)));
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => { if (!busy() && b.dataset.mode !== rules.mode) loadScene('rack', b.dataset.mode as RuleState['mode']); });
$<HTMLSelectElement>('scene').onchange = e => loadScene((e.target as HTMLSelectElement).value as SceneName);
$('sort').onchange = () => { if (plans.length) { invalidate(); $('search-time').textContent = '偏好已更改，请重新搜索'; } };
$('plans').onclick = e => {
  if (busy() || searching) return;
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
  if (button.dataset.selectPlan) choosePlan(button.dataset.selectPlan);
  if (button.dataset.executePlan) { const plan = plans.find(p => p.id === button.dataset.executePlan); if (plan) { shot = { ...plan.shot }; strike(shot); } }
};
$('edit').onclick = () => { if (busy() || searching) return; edit = !edit; placeCue = false; invalidate(); updateUI(); };
$('place-cue').onclick = () => { if (busy() || searching || rules.winner !== null) return; placeCue = !placeCue; edit = false; invalidate(); updateUI(); };
$<HTMLSelectElement>('edit-ball').innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i === 0 ? '白球' : `${i}号球`}</option>`).join('');
$('restore-ball').onclick = () => {
  if (busy() || searching || !edit) return;
  const id = Number($<HTMLSelectElement>('edit-ball').value); const existing = balls.find(b => b.id === id)!;
  for (let y = 0.18; y < TABLE.h - 0.1; y += 0.09) for (let x = 0.18; x < TABLE.w - 0.1; x += 0.09) if (legalPlacement(balls, id, x, y)) { saveHistory(); Object.assign(existing, ball(id, x, y)); invalidate(); updateUI(); return; }
};
$('remove-ball').onclick = () => { if (busy() || searching || !edit) return; const id = Number($<HTMLSelectElement>('edit-ball').value); saveHistory(); balls.find(b => b.id === id)!.pocketed = true; invalidate(); updateUI(); };
$('help').onclick = () => $<HTMLDialogElement>('help-dialog').showModal(); document.querySelector<HTMLButtonElement>('.dialog-close')!.onclick = () => $<HTMLDialogElement>('help-dialog').close();
$('help-dialog').onclick = e => { if (e.target === $('help-dialog')) { const r = $('help-dialog').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $<HTMLDialogElement>('help-dialog').close(); } };

const table = $<HTMLCanvasElement>('table');
table.onpointerdown = e => {
  if (busy() || searching || rules.winner !== null) return;
  const p = renderer.point(e.clientX, e.clientY); pointer = p;
  const hit = balls.find(b => !b.pocketed && Math.hypot(b.x - p.x, b.y - p.y) < TABLE.r * 1.5);
  if (edit && hit) { saveHistory(); dragBall = hit.id; $<HTMLSelectElement>('edit-ball').value = String(hit.id); table.setPointerCapture(e.pointerId); return; }
  if (placeCue || rules.ballInHand) {
    if (legalPlacement(balls, 0, p.x, p.y)) { saveHistory(); Object.assign(balls.find(b => b.id === 0)!, ball(0, p.x, p.y)); rules.ballInHand = false; placeCue = false; rules.message = '白球已放置 · 可以击球'; invalidate(); updateUI(); }
    else toast('此位置不能放球：避开其他球、洞口与库边'); return;
  }
  const nearPocket = POCKETS.findIndex(pocket => Math.hypot(pocket.x - p.x, pocket.y - p.y) < 0.1);
  if (nearPocket >= 0) { setPocket(nearPocket); return; }
  if (hit && hit.id !== 0) { setTarget(hit.id); return; }
  if (p.x < 0 || p.x > TABLE.w || p.y < 0 || p.y > TABLE.h || edit) return;
  const cue = balls.find(b => b.id === 0)!;
  // Capture the pointer so a long press can keep aiming even when the cursor
  // leaves the canvas. A click still works because it is just one update.
  aiming = true; table.setPointerCapture(e.pointerId); table.classList.add('aiming');
  shot.angle = Math.atan2(p.y - cue.y, p.x - cue.x); changeShot();
};
table.onpointermove = e => {
  pointer = renderer.point(e.clientX, e.clientY);
  if (aiming && !busy() && !searching && !edit && !placeCue && !rules.ballInHand) {
    const cue = balls.find(b => b.id === 0 && !b.pocketed);
    if (cue) { shot.angle = Math.atan2(pointer.y - cue.y, pointer.x - cue.x); changeShot(); }
  }
  if (!busy() && dragBall !== null && edit && legalPlacement(balls, dragBall, pointer.x, pointer.y)) { const b = balls.find(b => b.id === dragBall)!; b.x = pointer.x; b.y = pointer.y; preview = null; }
};
table.onpointerup = e => {
  aiming = false; table.classList.remove('aiming');
  if (table.hasPointerCapture(e.pointerId)) table.releasePointerCapture(e.pointerId);
  if (dragBall !== null) { dragBall = null; rules.breakShot = false; rules.winner = null; rules.message = '球位已更新 · 自由练习'; invalidate(); updateUI(); }
};
table.onpointercancel = e => { aiming = false; table.classList.remove('aiming'); if (table.hasPointerCapture(e.pointerId)) table.releasePointerCapture(e.pointerId); dragBall = null; };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (searching) cancelSearch(); edit = placeCue = false; updateUI(); return; }
  const focused = (e.target as HTMLElement).tagName;
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(focused) || $<HTMLDialogElement>('help-dialog').open) return;
  if (e.code === 'Space') { e.preventDefault(); strike(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if (!busy() && !searching && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); shot.angle += (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.005 : 0.02) * Math.PI / 180; changeShot(); }
});
function frame(now: number) {
  const elapsed = Math.min((now - clock) / 1000, 0.05); clock = now;
  if (feedback.advance(elapsed)) {
    world = new PhysicsWorld(balls, shot, true); accumulator = 0;
    const cue = preShot.find(b => b.id === 0)!;
    audio.play('cue', 0.2 + shotPower(shot) / 100 * 6.2, cue.x); updateUI();
  }
  if (world) {
    accumulator += elapsed * 1.5;
    while (accumulator >= TABLE.dt && !world.done) {
      world.step(); accumulator -= TABLE.dt;
      while (eventCursor < world.events.length) {
        const event = world.events[eventCursor++];
        feedback.consume(event);
        audio.event(event, event.entry?.x ?? world.balls.find(b => b.id === event.ball)!.x);
      }
    }
    balls = world.balls;
    if (world.done && !feedback.stroke && !feedback.falls.length) { const result = world.result(); balls = result.balls; lastChain = describeEventChain(result.events); rules = finishTurn(preShot, balls, result.events, rules); world = null; accumulator = 0; preview = null; updateUI(); }
  }
  drawSpinBall();
  renderer.draw({ balls, shot, target, pocket, aim: $<HTMLInputElement>('aim').checked, positionPreview: $<HTMLInputElement>('position-preview').checked, cueMarks: $<HTMLInputElement>('cue-marks').checked, moving: busy(), edit, placeCue: placeCue || rules.ballInHand, preview, selected, pointer, cuePose: feedback.cue, pocketFalls: feedback.falls });
  requestAnimationFrame(frame);
}
loadScene('rack'); requestAnimationFrame(frame);

// Read-only diagnostics for deterministic browser verification.
Object.defineProperty(window, '__cueLab', { value: { getState: () => structuredClone({ balls, rules, shot, target, pocket, searching, plans, moving: busy(), edit,
  feedback: { cue: feedback.cue, stroke: feedback.stroke, falls: feedback.falls }, audio: audio.getState() }) }, writable: false });
