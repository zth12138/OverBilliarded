import assert from 'node:assert/strict';
import test from 'node:test';
import { simulate, TABLE } from '../src/physics';
import { adjudicate } from '../src/rules';
import { scene } from '../src/scenes';
import { planScore, searchPlans } from '../src/search';

for (const name of ['cut', 'bank', 'kick', 'combo', 'black'] as const) test(`search finds legal ${name} plans for the exact called pocket`, () => {
  const state = scene(name, 'practice'), request = { id: 1, ...state, sort: 'balanced' as const };
  let lastChecked = 0, completed = false;
  const plans = searchPlans(request, update => {
    if (update.type === 'error') assert.fail(update.message);
    if (update.type === 'backend') return;
    assert.ok(update.checked >= lastChecked); lastChecked = update.checked;
    if (update.type === 'progress') assert.ok(update.checked <= update.total);
    if (update.type === 'done') completed = true;
  });
  assert.ok(completed); assert.ok(plans.length >= 1, `${name} returned no plans`);
  for (const plan of plans) {
    assert.ok(plan.outcome.settled);
    assert.ok(plan.outcome.events.some(e => e.type === 'pocket' && e.ball === state.target && e.pocket === state.pocket));
    assert.equal(adjudicate(state.balls, plan.outcome.balls, plan.outcome.events, { ...state.rules, calledPocket: state.pocket }).foul, false);
    assert.deepEqual(simulate(state.balls, plan.shot, true), plan.outcome);
    assert.ok(plan.robustness >= 0 && plan.robustness <= 100); assert.ok(plan.chain.some(s => s.includes('进')));
    assert.ok(plan.shot.power >= 1 && plan.shot.power <= 100);
    assert.ok(Math.hypot(plan.shot.tipX, plan.shot.tipY) <= 0.85 + 1e-12);
    assert.ok(plan.shot.elevation >= 0 && plan.shot.elevation <= 82);
  }
  assert.ok(plans.every((p, i) => !i || plans[i - 1].score >= p.score));
  if (name === 'bank') assert.ok(plans.some(p => p.route.includes('翻袋')));
  if (name === 'kick') assert.ok(plans.some(p => p.route.includes('解球')));
  if (name === 'combo') assert.ok(plans.some(p => p.route.includes('组合')));
  if (name === 'black') assert.ok(plans.every(p => adjudicate(state.balls, p.outcome.balls, p.outcome.events, { ...state.rules, calledPocket: state.pocket }).winner === 0));
  if (name === 'cut') {
    assert.ok(plans.some(p => p.shot.kind === 'normal' && Math.abs(p.shot.tipX) > 0.2 && Math.abs(p.shot.tipY) > 0.2), 'combined vertical and side spin');
    assert.ok(plans.some(p => [0, 0.65, -0.65, 0.45, -0.45, 0.35, -0.35, 0.2, -0.4].every(y => Math.abs(p.shot.tipY - y) > 0.01)), 'refined spin strength');
  }
});

for (const name of ['jump', 'masse'] as const) test(`search automatically chooses elevation for legal ${name} shots`, () => {
  const state = scene(name, 'practice');
  const plans = searchPlans({ id: 3, ...state, sort: 'balanced' });
  const special = plans.filter(p => p.shot.kind === name);
  assert.ok(special.length > 0, `no ${name} stroke found`);
  for (const plan of special) {
    assert.ok(plan.outcome.settled);
    assert.ok(plan.outcome.events.some(e => e.type === 'pocket' && e.ball === state.target && e.pocket === state.pocket));
    assert.equal(adjudicate(state.balls, plan.outcome.balls, plan.outcome.events, { ...state.rules, calledPocket: state.pocket }).foul, false);
    assert.deepEqual(simulate(state.balls, plan.shot, true), plan.outcome);
    assert.match(plan.route, name === 'jump' ? /跳球/ : /扎杆/);
  }
  if (name === 'jump') {
    assert.ok(new Set(special.map(p => p.shot.elevation)).size > 1, 'elevation must vary between searched solutions');
    assert.ok(special.some(p => ![28, 38, 48, 58, 68].includes(p.shot.elevation)), 'elevation is refined beyond the coarse grid');
    const blocker = state.balls.find(b => b.id === 10)!;
    assert.ok(special.some(p => p.outcome.trails[0].some(t => Math.abs(t.x - blocker.x) < TABLE.r && Math.abs(t.y - blocker.y) < TABLE.r * 2 && t.z > TABLE.r * 3)), 'cue clears the obstructing ball in the air');
  } else {
    const cue = state.balls.find(b => b.id === 0)!;
    assert.ok(special.some(p => {
      const first = p.outcome.events.find(e => e.type === 'contact' && (e.ball === 0 || e.other === 0))!;
      return p.shot.elevation >= 36 && Math.abs(p.shot.tipX) > 0.2
        && !p.outcome.events.some(e => e.type === 'rail' && e.ball === 0 && e.time < first.time)
        && p.outcome.trails[0].some(t => t.t < first.time
          && Math.abs((t.x - cue.x) * Math.sin(p.shot.angle) - (t.y - cue.y) * Math.cos(p.shot.angle)) > TABLE.r);
    }), 'elevated off-centre shot produces a curved approach before first contact');
  }
});
test('no solution returns an empty list and a completed search event', () => {
  const state = scene('cut', 'practice'); state.balls.find(b => b.id === 0)!.pocketed = true;
  let completed = false;
  assert.deepEqual(searchPlans({ id: 2, ...state, sort: 'balanced' }, update => { if (update.type === 'done') completed = true; }), []);
  assert.ok(completed);
});
test('ranking preferences change the recommended tradeoff', () => {
  const easy = { complexity: 5, position: 25, robustness: 30 }, position = { complexity: 65, position: 95, robustness: 35 }, robust = { complexity: 55, position: 35, robustness: 100 };
  assert.ok(planScore(easy, 'simple') > planScore(position, 'simple'));
  assert.ok(planScore(position, 'position') > planScore(easy, 'position'));
  assert.ok(planScore(robust, 'robust') > planScore(position, 'robust'));
});
