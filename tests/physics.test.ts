import assert from 'node:assert/strict';
import test from 'node:test';
import { ball, CUSHIONS, legalPlacement, PhysicsWorld, POCKETS, rackBalls, simulate, TABLE } from '../src/physics';
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

test('unlimited power increases actual impulse and preserves continuous collisions above 100%', () => {
  const input = [ball(0, 1.27, 0.9), ball(1, 1.27, 0.4)];
  const normal = new PhysicsWorld(input, { ...base, angle: -Math.PI / 2, power: 100 });
  const limited = new PhysicsWorld(input, { ...base, angle: -Math.PI / 2, power: 220 });
  const unlimitedShot = { ...base, angle: -Math.PI / 2, power: 220, unlimitedPower: true };
  const unlimited = new PhysicsWorld(input, unlimitedShot, true);
  assert.deepEqual(limited.balls, normal.balls);
  assert.ok(Math.abs(unlimited.balls[0].vy) > Math.abs(normal.balls[0].vy) * 2);
  while (!unlimited.done) unlimited.step();
  const result = unlimited.result();
  assert.ok(result.settled);
  assert.equal(result.events.find(e => e.type === 'contact')?.other, 1);
  assert.ok(result.events.some(e => e.type === 'pocket' && e.ball === 1 && e.pocket === 1));
  assert.deepEqual(result, simulate(input, unlimitedShot, true));
  for (const power of [300, 600]) {
    const simulation = simulate(input, { ...unlimitedShot, power }, true);
    assert.ok(simulation.settled);
    assert.equal(simulation.events.find(e => e.type === 'contact')?.other, 1);
    for (const ball of simulation.balls) for (const value of Object.values(ball))
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
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

test('a high-speed thin graze between samples still transfers momentum', () => {
  const cue = ball(0, 1 - 0.013, 0.65 - (2 * TABLE.r - 0.0003)), target = ball(1, 1, 0.65);
  cue.vx = 6.4; cue.wy = cue.vx / TABLE.r;
  const world = new PhysicsWorld([cue, target]); world.step();
  assert.ok(world.events.some(e => e.type === 'contact' && e.other === 1));
  assert.ok(Math.hypot(world.balls[1].vx, world.balls[1].vy) > 0.01);
  assert.ok(Math.hypot(world.balls[0].x - world.balls[1].x, world.balls[0].y - world.balls[1].y) >= 2 * TABLE.r - 1e-6);
});

test('opposing fast balls collide before crossing centres', () => {
  const a = ball(0, 0.98, 0.65), b = ball(1, 1.04, 0.65);
  a.vx = 8; b.vx = -8; a.wy = a.vx / TABLE.r; b.wy = b.vx / TABLE.r;
  const world = new PhysicsWorld([a, b]); world.step();
  assert.ok(world.events.some(e => e.type === 'contact'));
  assert.ok(world.balls[0].vx < 0 && world.balls[1].vx > 0);
  assert.ok(world.balls[1].x - world.balls[0].x >= 2 * TABLE.r - 1e-6);
});

test('frozen object balls cannot be driven through any straight cushion', () => {
  const R = TABLE.r;
  for (const [x, y, angle] of [[0.8, R, -Math.PI / 2], [0.8, TABLE.h - R, Math.PI / 2], [R, 0.6, Math.PI], [TABLE.w - R, 0.6, 0]]) {
    for (const power of [1, 35, 100]) {
      const setup = [ball(0, x - Math.cos(angle) * (2 * R + 0.0002), y - Math.sin(angle) * (2 * R + 0.0002)), ball(1, x, y)];
      const world = new PhysicsWorld(setup, { ...base, angle, power }, false);
      while (!world.done) {
        world.step();
        for (const b of world.balls) if (!b.pocketed) {
          assert.ok(b.x >= R - 1e-6 && b.x <= TABLE.w - R + 1e-6 && b.y >= R - 1e-6 && b.y <= TABLE.h - R + 1e-6, `frozen ball crossed cushion (${angle}, ${power})`);
        }
        assert.ok(Math.hypot(world.balls[0].x - world.balls[1].x, world.balls[0].y - world.balls[1].y, world.balls[0].z - world.balls[1].z) >= 2 * R - 1e-6);
      }
      assert.ok(world.result().settled);
      assert.ok(world.events.some(e => e.type === 'contact'));
      assert.ok(world.events.some(e => e.type === 'rail' && e.ball === 1));
      assert.ok(!world.events.some(e => e.type === 'off'));
    }
  }
});

test('all six pocket openings capture centred ground-level shots at low and high speed', () => {
  for (const [pocket, p] of POCKETS.entries()) for (const power of [12, 100]) {
    const dx = TABLE.w / 2 - p.x, dy = TABLE.h / 2 - p.y, length = Math.hypot(dx, dy);
    const cue = ball(0, p.x + dx / length * 0.3, p.y + dy / length * 0.3);
    const sim = simulate([cue], { ...base, angle: Math.atan2(-dy, -dx), power });
    assert.ok(sim.settled);
    assert.ok(sim.events.some(e => e.type === 'pocket' && e.pocket === pocket), `pocket ${pocket}, power ${power}`);
    assert.ok(!sim.events.some(e => e.type === 'off'));
  }
});

test('a shot wide of a side pocket rebounds instead of being captured or leaving the table', () => {
  const sim = simulate([ball(0, TABLE.w / 2 - 0.105, 0.3)], { ...base, angle: -Math.PI / 2, power: 40 });
  assert.ok(sim.events.some(e => e.type === 'rail' && e.rail === '上库'));
  assert.ok(!sim.events.some(e => e.type === 'pocket' || e.type === 'off'));
  assert.ok(sim.settled);
});

test('pocket mouths flare wider at the rail and join the cushion jaws continuously', () => {
  const middleLeft = CUSHIONS[14], middleRight = CUSHIONS[15];
  assert.equal(CUSHIONS[0].bx, middleLeft.ax);
  assert.equal(CUSHIONS[1].ax, middleRight.ax);
  assert.ok(middleRight.ax - middleLeft.ax > middleRight.bx - middleLeft.bx);
  assert.ok(Math.hypot(middleLeft.bx - POCKETS[1].x, middleLeft.by - POCKETS[1].y) > TABLE.pocketR);
  assert.equal(CUSHIONS[0].ax, CUSHIONS[6].ax);
  assert.equal(CUSHIONS[4].ay, CUSHIONS[7].ay);
  assert.ok(Math.hypot(CUSHIONS[6].bx, CUSHIONS[6].by) > TABLE.pocketR);
});

test('a side pocket jaw deflects a glancing shot before it enters the pocket', () => {
  const sim = simulate([ball(0, 1.12, 0.12)], { ...base, angle: -0.45, power: 40 });
  const jaw = sim.events.find(e => e.type === 'rail' && e.rail === '中上袋角');
  const pocket = sim.events.find(e => e.type === 'pocket' && e.pocket === 1);
  assert.ok(jaw && pocket && jaw.time < pocket.time);
  assert.ok(!sim.events.some(e => e.type === 'off')); assert.ok(sim.settled);
});

test('two impacts on the same rail around first contact remain in chronological order', () => {
  const cue = ball(0, 0.8, TABLE.r + 0.012), target = ball(1, 0.8, TABLE.r + 0.09);
  cue.vy = -2; target.vy = -4; cue.wx = -cue.vy / TABLE.r; target.wx = -target.vy / TABLE.r;
  const world = new PhysicsWorld([cue, target], undefined, false);
  while (world.time < 0.02) world.step();
  const first = world.events.findIndex(e => e.type === 'contact');
  const rails = world.events.filter(e => e.type === 'rail' && e.ball === 0);
  assert.equal(rails.length, 2);
  assert.ok(rails[0].time < world.events[first].time && rails[1].time > world.events[first].time);
  assert.ok(rails[1].time - rails[0].time < 0.045);
  for (let i = 1; i < world.events.length; i++) assert.ok(world.events[i].time >= world.events[i - 1].time);
});

test('an airborne ball clears cushions and pocket openings before being ruled off the table', () => {
  const cue = ball(0, TABLE.w / 2, 0.15); cue.z = TABLE.r + 0.15; cue.vy = -4;
  const world = new PhysicsWorld([cue], undefined, false);
  while (!world.done) world.step();
  assert.ok(world.events.some(e => e.type === 'off'));
  assert.ok(!world.events.some(e => e.type === 'rail' || e.type === 'pocket'));
});

test('dense break shots stay finite, separated and settle for different powers and spin', () => {
  for (const shot of [{ ...base, power: 35 }, { ...base, power: 100 }, { ...base, power: 100, tipX: 0.6, tipY: -0.4 }]) {
    const world = new PhysicsWorld(rackBalls(), shot, false);
    while (!world.done) {
      world.step();
      const active = world.balls.filter(b => !b.pocketed);
      for (const b of active) for (const value of [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.qx, b.qy, b.qz, b.qw]) assert.ok(Number.isFinite(value));
      for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= 2 * TABLE.r - 1e-6, `break overlap: ${a.id}, ${b.id}`);
      }
    }
    assert.ok(world.result().settled);
    for (let i = 1; i < world.events.length; i++) assert.ok(world.events[i].time >= world.events[i - 1].time);
  }
});
