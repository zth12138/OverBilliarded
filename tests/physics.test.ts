import assert from 'node:assert/strict';
import test from 'node:test';
import { ball, legalPlacement, PhysicsWorld, rackBalls, simulate, TABLE } from '../src/physics';
import type { Shot } from '../src/types';
const base: Shot = { angle: 0, power: 35, tipX: 0, tipY: 0, elevation: 0, kind: 'normal' };

test('rack has 16 separated balls with black centered and opposite rear corners', () => {
  const balls = rackBalls(); assert.equal(new Set(balls.map(b => b.id)).size, 16);
  assert.equal(balls.find(b => b.id === 8)!.y, TABLE.h / 2);
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) assert.ok(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y) >= TABLE.r * 2);
  assert.ok(balls.find(b => b.id === 6)!.y < balls.find(b => b.id === 15)!.y);
});
test('sliding decays to rolling and settles without NaN or modifying input', () => {
  const input = [ball(0, 0.4, 0.6)], copy = structuredClone(input), sim = simulate(input, base);
  assert.deepEqual(input, copy); assert.ok(sim.settled); assert.ok(sim.time < 28);
  for (const b of sim.balls) for (const n of [b.x, b.y, b.z, b.vx, b.vy]) assert.ok(Number.isFinite(n));
  assert.equal(sim.balls[0].vx, 0);
});
test('topspin follows and backspin draws after an object collision', () => {
  const setup = [ball(0, 0.6, 0.635), ball(1, 0.95, 0.635)];
  const draw = simulate(setup, { ...base, tipY: -0.7 });
  const neutral = simulate(setup, base); const follow = simulate(setup, { ...base, tipY: 0.7 });
  assert.ok(draw.balls[0].x < 0.6); assert.ok(follow.balls[0].x > neutral.balls[0].x + 0.4);
  for (const sim of [draw, neutral, follow]) assert.ok(sim.events.some(e => e.type === 'contact' && e.other === 1));
});
test('sidespin alters rebound off a cushion', () => {
  const setup = [ball(0, 0.5, 0.65)];
  const left = simulate(setup, { ...base, tipX: -0.65 }, true), right = simulate(setup, { ...base, tipX: 0.65 }, true);
  assert.ok(left.events.some(e => e.type === 'rail'));
  assert.ok(Math.abs(left.balls[0].y - right.balls[0].y) > 0.1);
});
test('jump clears the blocker and hits the farther ball', () => {
  const setup = [ball(0, 0.65, 0.65), ball(10, 0.94, 0.65), ball(1, 1.55, 0.65)];
  const sim = simulate(setup, { ...base, power: 48, kind: 'jump', elevation: 48 }, true);
  assert.ok(Math.max(...sim.trails[0].map(p => p.z)) > 3 * TABLE.r);
  assert.equal(sim.events.find(e => e.type === 'contact')?.other, 1);
  assert.ok(sim.settled);
});
test('elevated eccentric spin curves the path, rather than a rendered animation', () => {
  const setup = [ball(0, 0.65, 0.65)];
  const straight = simulate(setup, { ...base, elevation: 72, kind: 'masse' }, true);
  const curve = simulate(setup, { ...base, elevation: 72, kind: 'masse', tipX: 0.65, tipY: -0.3 }, true);
  // Compare the route before the cushion, which can bring the final point back.
  assert.ok(straight.trails[0].every(p => Math.abs(p.y - 0.65) < 1e-9));
  assert.ok(curve.trails[0].some(p => p.t < 0.7 && Math.abs(p.y - 0.65) > 0.25));
});
test('pocket mouths have physical openings and capture incoming balls', () => {
  const sim = simulate([ball(0, 1.27, 0.7)], { ...base, angle: -Math.PI / 2, power: 12 });
  assert.ok(sim.balls[0].pocketed); assert.ok(sim.events.some(e => e.type === 'pocket' && e.pocket === 1));
});
test('step-by-step gameplay and batch simulation finish in identical states', () => {
  const input = rackBalls(), shot = { ...base, power: 80 };
  const batch = simulate(input, shot, true), live = new PhysicsWorld(input, shot, true);
  while (!live.done) for (let i = 0; i < 17 && !live.done; i++) live.step();
  assert.deepEqual(live.result(), batch); assert.ok(batch.settled);
});
test('placement rejects overlapping balls, pockets, and positions outside the table', () => {
  const setup = [ball(0, 0.4, 0.6), ball(1, 1.0, 0.6)];
  assert.equal(legalPlacement(setup, 0, 1.0, 0.6), false);
  assert.equal(legalPlacement(setup, 0, -0.1, 0.6), false);
  assert.equal(legalPlacement(setup, 0, 0.04, 0.04), false);
  assert.equal(legalPlacement(setup, 0, 0.5, 0.5), true);
});
