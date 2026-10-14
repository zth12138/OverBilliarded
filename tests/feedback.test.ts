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

test('pocket animation keeps an independent entry pose and rolls behind the pocket lip', () => {
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
  assert.ok(nearEnd.x > pocket.x + 0.04, 'middle pocket travels sideways into the concealed chute');
  assert.ok(nearEnd.radius > start.radius * 0.8 && nearEnd.opacity < 1, 'occlusion replaces shrinking to a point');
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

test('all six pockets hide the ball through sideways travel while the surface rolls', () => {
  for (let pocket = 0; pocket < POCKETS.length; pocket++) {
    const p = POCKETS[pocket], feedback = new ShotFeedback();
    const entry = ball(1, p.x, p.y + (p.y < TABLE.h / 2 ? 0.035 : -0.035));
    const snapshot = structuredClone(entry);
    feedback.consume({ type: 'pocket', time: 0, ball: 1, pocket, entry });
    const fall = feedback.falls[0], initial = pocketPose(fall);
    assert.equal(initial.x, entry.x); assert.equal(initial.y, entry.y);
    feedback.advance(fall.duration * 0.75);
    const pose = pocketPose(fall);
    if (p.x === TABLE.w) {
      assert.equal(pose.x, p.x, 'right pockets roll vertically');
      const sign = p.y < TABLE.h / 2 ? 1 : -1;
      assert.ok((pose.y - p.y) * sign > TABLE.r, 'top right rolls down; bottom right rolls up');
    } else {
      assert.equal(pose.y, p.y, 'left and middle pockets roll horizontally');
      assert.ok(pose.x > p.x + TABLE.r, 'left and middle pockets roll right');
    }
    assert.ok(pose.radius > TABLE.r * 0.8, 'the ball stays recognizable until occluded');
    assert.notEqual(fall.ball.qw, 1, 'the surface rolls even with a non-spinning entry');
    assert.deepEqual(entry, snapshot);
    feedback.advance(fall.duration);
    assert.equal(feedback.falls.length, 0);
  }
});

test('pocket shrink settles early and does not continue over the roll', () => {
  const feedback = new ShotFeedback(), entry = ball(1, 1.27, 0.7);
  feedback.consume({ type: 'pocket', time: 0, ball: 1, pocket: 1, entry });
  const fall = feedback.falls[0];
  feedback.advance(fall.duration * 0.35); const settled = pocketPose(fall).radius;
  feedback.advance(fall.duration * 0.35); const rolling = pocketPose(fall).radius;
  assert.ok(settled < TABLE.r && settled > TABLE.r * 0.8, 'the initial dip only shrinks a little');
  assert.equal(rolling, settled, 'size stays fixed during the roll');
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
