import assert from 'node:assert/strict';
import test from 'node:test';
import { ball, copyState, PhysicsWorld, TABLE } from '../src/physics';
import { integrateOrientation, worldToLocal } from '../src/rotation';
import type { Ball } from '../src/types';

const orientation = (b: Ball) => [b.qx, b.qy, b.qz, b.qw];
const topBadge = (b: Ball) => {
  const m = worldToLocal(b);
  // Transpose of the inverse matrix, applied to the material's top badge.
  return [m[6], m[7], m[8]];
};

test('rolling right moves the top badge to the edge, behind, and back around', () => {
  const b = ball(1, 0.6, 0.6); b.wy = 1;
  integrateOrientation(b, Math.PI / 2);
  const edge = topBadge(b); assert.ok(edge[0] > 0.999); assert.ok(Math.abs(edge[2]) < 1e-12);
  integrateOrientation(b, Math.PI / 2); assert.ok(topBadge(b)[2] < -0.999);
  integrateOrientation(b, Math.PI); assert.ok(topBadge(b)[2] > 0.999);
});

test('rolling down and backspin turn the surface in opposite directions', () => {
  const down = ball(1, 0.6, 0.6), draw = ball(1, 0.6, 0.6);
  down.wx = -1; draw.wx = 1;
  integrateOrientation(down, Math.PI / 2); integrateOrientation(draw, Math.PI / 2);
  assert.ok(topBadge(down)[1] > 0.999); assert.ok(topBadge(draw)[1] < -0.999);
});

test('arbitrary combined spin remains normalized and does not depend on render frames', () => {
  const smallSteps = ball(10, 0.6, 0.6), bigStep = ball(10, 0.6, 0.6);
  for (const b of [smallSteps, bigStep]) { b.wx = 21; b.wy = -37; b.wz = 59; }
  for (let i = 0; i < 2400; i++) integrateOrientation(smallSteps, TABLE.dt);
  integrateOrientation(bigStep, TABLE.dt * 2400);
  assert.ok(Math.abs(Math.hypot(...orientation(smallSteps)) - 1) < 1e-12);
  const dot = orientation(smallSteps).reduce((sum, n, i) => sum + n * orientation(bigStep)[i], 0);
  assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-11);
});

test('a rolling ball rotates by the distance travelled divided by its radius', () => {
  const input = ball(1, 0.6, 0.6); input.vx = 0.35; input.wy = input.vx / TABLE.r;
  const world = new PhysicsWorld([input]);
  for (let i = 0; i < 120; i++) world.step();
  const b = world.balls[0], angle = (b.x - input.x) / TABLE.r;
  assert.ok(Math.abs(b.qy - Math.sin(angle / 2)) < 1e-11);
  assert.ok(Math.abs(b.qw - Math.cos(angle / 2)) < 1e-11);
  assert.deepEqual(orientation(input), [0, 0, 0, 1]);
});

test('contact-transferred sidespin changes the object ball orientation', () => {
  const setup = [ball(0, 0.6, 0.6), ball(10, 0.6 + 2 * TABLE.r + 0.003, 0.6)];
  const world = new PhysicsWorld(setup, { angle: 0, power: 20, tipX: 0.7, tipY: 0, elevation: 0, kind: 'normal' });
  for (let i = 0; i < 10 && !world.events.some(e => e.type === 'contact'); i++) world.step();
  assert.ok(world.events.some(e => e.type === 'contact'));
  const object = world.balls[1]; assert.ok(Math.abs(object.wz) > 0.1);
  assert.ok(Math.abs(object.qz) > 1e-5);
  assert.deepEqual(orientation(setup[1]), [0, 0, 0, 1]);
});

test('settling preserves orientation and copied history stays independent', () => {
  const input = ball(1, 0.6, 0.6); input.vx = 0.12; input.wy = input.vx / TABLE.r;
  const world = new PhysicsWorld([input]);
  while (!world.done) world.step();
  const stopped = orientation(world.balls[0]); assert.notDeepEqual(stopped, [0, 0, 0, 1]);
  const saved = copyState(world.balls);
  for (let i = 0; i < 30; i++) world.step();
  assert.deepEqual(orientation(world.balls[0]), stopped);
  const next = new PhysicsWorld(world.balls);
  assert.deepEqual(orientation(next.balls[0]), stopped);
  next.balls[0].wz = 3; next.step();
  assert.deepEqual(orientation(saved[0]), stopped);
  assert.notDeepEqual(orientation(next.balls[0]), stopped);
});
