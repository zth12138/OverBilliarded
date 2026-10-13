import assert from 'node:assert/strict';
import test from 'node:test';
import { simulate } from '../src/physics';
import { adjudicate } from '../src/rules';
import { scene } from '../src/scenes';
import { planScore, searchPlans } from '../src/search';

for (const name of ['cut', 'bank', 'kick', 'combo', 'black'] as const) test(`search finds legal ${name} plans for the exact called pocket`, () => {
  const state = scene(name, 'practice'), request = { id: 1, ...state, sort: 'balanced' as const };
  const plans = searchPlans(request); assert.ok(plans.length >= 1, `${name} returned no plans`);
  for (const plan of plans) {
    assert.ok(plan.outcome.settled);
    assert.ok(plan.outcome.events.some(e => e.type === 'pocket' && e.ball === state.target && e.pocket === state.pocket));
    assert.equal(adjudicate(state.balls, plan.outcome.balls, plan.outcome.events, { ...state.rules, calledPocket: state.pocket }).foul, false);
    assert.deepEqual(simulate(state.balls, plan.shot, true), plan.outcome);
    assert.ok(plan.robustness >= 0 && plan.robustness <= 100); assert.ok(plan.chain.some(s => s.includes('进')));
  }
  assert.ok(plans.every((p, i) => !i || plans[i - 1].score >= p.score));
  if (name === 'bank') assert.ok(plans.some(p => p.route.includes('翻袋')));
  if (name === 'kick') assert.ok(plans.some(p => p.route.includes('解球')));
  if (name === 'combo') assert.ok(plans.some(p => p.route.includes('组合')));
  if (name === 'black') assert.ok(plans.every(p => adjudicate(state.balls, p.outcome.balls, p.outcome.events, { ...state.rules, calledPocket: state.pocket }).winner === 0));
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
