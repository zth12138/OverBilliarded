import assert from 'node:assert/strict';
import test from 'node:test';
import { impactSamples } from '../src/audio';
import { ball, PhysicsWorld, POCKETS, simulate, TABLE } from '../src/physics';
import { pocketPose, ShotFeedback, STROKE_IMPACT_TIME } from '../src/shot-feedback';
import type { Shot } from '../src/types';

const shot: Shot = { angle: 0, power: 35, tipX: 0, tipY: 0, elevation: 0, kind: 'normal' };

test('cue pulls back before contact and triggers exactly one shot even across a long frame', () => {
  const cue = ball(0, 0.6, 0.6), feedback = new ShotFeedback();
  feedback.start(cue, shot);
  const restingOffset = feedback.cue!.offset;
  assert.equal(feedback.advance(0.3), false);
  assert.ok(feedback.cue!.offset > restingOffset);
  assert.equal(feedback.advance(STROKE_IMPACT_TIME - 0.3), true);
  assert.ok(Math.abs(feedback.cue!.offset - TABLE.r) < 1e-9);
  assert.equal(feedback.advance(0.1), false);
  assert.equal(feedback.advance(0.5), false);
  assert.equal(feedback.cue, null);
  assert.deepEqual(cue, ball(0, 0.6, 0.6));
  feedback.start(cue, shot);
  assert.equal(feedback.advance(1), true);
  assert.equal(feedback.advance(1), false);
});

test('pocket animation keeps an independent spinning entry pose and converges into the hole', () => {
  const input = [ball(0, 1.27, 0.7)];
  const sim = simulate(input, { ...shot, angle: -Math.PI / 2, power: 12 });
  const event = sim.events.find(e => e.type === 'pocket')!;
  assert.ok(event.speed! > 0);
  assert.equal(event.entry!.pocketed, false);
  assert.notEqual(event.entry!.vy, 0);
  const snapshot = structuredClone(event), feedback = new ShotFeedback();
  feedback.consume(event);
  const fall = feedback.falls[0], start = pocketPose(fall);
  assert.equal(start.radius, TABLE.r); assert.equal(start.opacity, 1);
  feedback.advance(fall.duration * 0.8);
  const nearEnd = pocketPose(fall), pocket = POCKETS[fall.pocket];
  assert.ok(Math.hypot(nearEnd.x - pocket.x, nearEnd.y - pocket.y) < 0.02);
  assert.ok(nearEnd.radius < start.radius && nearEnd.opacity < 1);
  assert.notEqual(fall.ball.qw, snapshot.entry!.qw);
  assert.deepEqual(event, snapshot);
  feedback.advance(1); assert.equal(feedback.falls.length, 0);
});

test('feedback does not change live physics compared with batch simulation', () => {
  const input = [ball(0, 1.27, 0.7)];
  const params = { ...shot, angle: -Math.PI / 2, power: 12 };
  const expected = simulate(input, params, true), live = new PhysicsWorld(input, params, true);
  const feedback = new ShotFeedback(); let cursor = 0;
  while (!live.done) {
    feedback.advance(TABLE.dt); live.step();
    while (cursor < live.events.length) feedback.consume(live.events[cursor++]);
  }
  assert.deepEqual(live.result(), expected);
});

test('impact metadata measures incoming speed and snapshots do not follow settled balls', () => {
  const input = [ball(0, 0.6, 0.635), ball(1, 0.8, 0.635)];
  const weak = simulate(input, { ...shot, power: 12 }), strong = simulate(input, { ...shot, power: 75 });
  const speed = (events: typeof weak.events) => events.find(e => e.type === 'contact')!.speed!;
  assert.ok(speed(strong.events) > speed(weak.events));
  for (const e of strong.events.filter(e => e.type === 'contact' || e.type === 'rail')) assert.ok(Number.isFinite(e.speed) && e.speed! > 0);
});

test('each material produces distinct, bounded audio with an immediate transient and decaying tail', () => {
  const rate = 48000;
  for (const kind of ['cue', 'contact', 'rail', 'pocket'] as const) {
    const samples = impactSamples(kind, rate);
    assert.ok(samples.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    assert.ok(rms(samples.subarray(0, rate * 0.015)) > rms(samples.subarray(-rate * 0.015)) * 3);
    assert.ok(samples.some(v => Math.abs(v) > 0.1));
  }
  assert.notDeepEqual(impactSamples('cue', rate), impactSamples('contact', rate));
});
