import assert from 'node:assert/strict';
import test from 'node:test';
import { ball } from '../src/physics';
import { adjudicate, finishTurn, freshRules, legalFirstIds } from '../src/rules';
import type { PhysicsEvent } from '../src/types';
const contact = (id: number): PhysicsEvent => ({ type: 'contact', ball: 0, other: id, time: 0.1 });
const pot = (id: number, pocket = 1): PhysicsEvent => ({ type: 'pocket', ball: id, pocket, time: 0.5 });
const rail: PhysicsEvent = { type: 'rail', ball: 1, rail: '上库', time: 0.3 };
const setup = () => [ball(0, 0.5, 0.8), ball(1, 1, 0.4), ball(9, 1.8, 0.6), ball(8, 2, 0.4)];
const open = () => ({ ...freshRules('match'), breakShot: false });
const grouped = () => ({ ...open(), groups: ['solid', 'stripe'] as ['solid', 'stripe'] });

test('legal non-break single-group pocket assigns groups and retains turn', () => {
  const before = setup(), after = structuredClone(before); after.find(b => b.id === 1)!.pocketed = true;
  const next = finishTurn(before, after, [contact(1), pot(1)], open());
  assert.deepEqual(next.groups, ['solid', 'stripe']); assert.equal(next.player, 0); assert.equal(next.ballInHand, false);
});
test('open mixed-group pocket does not assign groups; black first is illegal', () => {
  const input = setup(); assert.equal(adjudicate(input, input, [contact(1), pot(1), pot(9)], open()).assigned, null);
  assert.ok(adjudicate(input, input, [contact(8), rail], open()).foul);
});
test('break pocket does not assign groups, and legally pocketed black is respotted', () => {
  const before = setup(), after = structuredClone(before); after.find(b => b.id === 8)!.pocketed = true;
  const next = finishTurn(before, after, [contact(1), pot(8)], freshRules('match'));
  assert.equal(next.winner, null); assert.deepEqual(next.groups, [null, null]); assert.equal(next.player, 0); assert.equal(after.find(b => b.id === 8)!.pocketed, false);
});
test('weak break, scratch, wrong first contact, and no rail each award free ball', () => {
  const input = setup();
  for (const [events, state] of [
    [[contact(1), rail], freshRules('match')], [[contact(1), pot(0)], grouped()], [[contact(9), rail], grouped()], [[contact(1)], grouped()], [[], grouped()],
  ] as const) {
    const next = finishTurn(input, structuredClone(input), [...events], state);
    assert.equal(next.ballInHand, true); assert.equal(next.player, 1);
  }
});
test('black requires prior clearance and the specified pocket', () => {
  const before = setup(), after = structuredClone(before);
  assert.equal(adjudicate(before, after, [contact(1), pot(1), pot(8)], { ...grouped(), calledPocket: 1 }).winner, 1);
  before.find(b => b.id === 1)!.pocketed = true;
  assert.deepEqual(legalFirstIds(before, grouped()), [8]);
  assert.equal(adjudicate(before, after, [contact(8), pot(8)], { ...grouped(), calledPocket: 1 }).winner, 0);
  assert.equal(adjudicate(before, after, [contact(8), pot(8, 2)], { ...grouped(), calledPocket: 1 }).winner, 1);
  assert.equal(adjudicate(before, after, [contact(8), pot(8), pot(0)], { ...grouped(), calledPocket: 1 }).winner, 1);
});
test('ordinary opponent pocket does not retain turn; practice keeps the player', () => {
  const input = setup(), events = [contact(1), pot(9)];
  assert.equal(finishTurn(input, structuredClone(input), events, grouped()).player, 1);
  assert.equal(finishTurn(input, structuredClone(input), events, { ...grouped(), mode: 'practice' }).player, 0);
});
test('jumping any ball off is a foul; jumping black off loses a non-break game', () => {
  const input = setup(); const off: PhysicsEvent = { type: 'off', ball: 9, time: 0.7 };
  assert.ok(adjudicate(input, input, [contact(1), rail, off], grouped()).foul);
  assert.equal(adjudicate(input, input, [contact(1), rail, { ...off, ball: 8 }], grouped()).winner, 1);
});
