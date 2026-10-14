import type { Ball, PhysicsEvent, Simulation, Shot, TrailPoint } from './types';
import { integrateOrientation } from './rotation';
import { shotPower } from './power';

// SI units; play, previews, and search share this fixed-step engine.
export const TABLE = { w: 2.54, h: 1.27, r: 0.028575, pocketR: 0.056, dt: 1 / 240 };
export const POCKETS = [
  { x: 0, y: 0, name: '左上' }, { x: TABLE.w / 2, y: -0.012, name: '中上' }, { x: TABLE.w, y: 0, name: '右上' },
  { x: 0, y: TABLE.h, name: '左下' }, { x: TABLE.w / 2, y: TABLE.h + 0.012, name: '中下' }, { x: TABLE.w, y: TABLE.h, name: '右下' },
];
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const copyState = (balls: Ball[]) => balls.map(b => ({ ...b }));
export function ball(id: number, x: number, y: number): Ball {
  return { id, x, y, z: TABLE.r, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, qx: 0, qy: 0, qz: 0, qw: 1, pocketed: false };
}
export function rackBalls(): Ball[] {
  const out = [ball(0, 0.63, TABLE.h / 2)];
  const order = [1, 9, 2, 10, 8, 3, 4, 11, 5, 12, 6, 13, 7, 14, 15];
  const spacing = TABLE.r * 2 + 0.0005;
  let i = 0;
  for (let row = 0; row < 5; row++) for (let col = 0; col <= row; col++) {
    out.push(ball(order[i++], TABLE.w * 0.75 + row * spacing * Math.sqrt(3) / 2, TABLE.h / 2 + (col - row / 2) * spacing));
  }
  return out;
}
export interface Cushion { ax: number; ay: number; bx: number; by: number; name: string }
const W = TABLE.w, H = TABLE.h, corner = 0.078, side = 0.071;
export const CUSHIONS: Cushion[] = [
  { ax: corner, ay: 0, bx: W / 2 - side, by: 0, name: '上库' },
  { ax: W / 2 + side, ay: 0, bx: W - corner, by: 0, name: '上库' },
  { ax: corner, ay: H, bx: W / 2 - side, by: H, name: '下库' },
  { ax: W / 2 + side, ay: H, bx: W - corner, by: H, name: '下库' },
  { ax: 0, ay: corner, bx: 0, by: H - corner, name: '左库' },
  { ax: W, ay: corner, bx: W, by: H - corner, name: '右库' },
  { ax: corner, ay: 0, bx: 0.03, by: -0.032, name: '左上袋角' },
  { ax: 0, ay: corner, bx: -0.032, by: 0.03, name: '左上袋角' },
  { ax: W - corner, ay: 0, bx: W - 0.03, by: -0.032, name: '右上袋角' },
  { ax: W, ay: corner, bx: W + 0.032, by: 0.03, name: '右上袋角' },
  { ax: corner, ay: H, bx: 0.03, by: H + 0.032, name: '左下袋角' },
  { ax: 0, ay: H - corner, bx: -0.032, by: H - 0.03, name: '左下袋角' },
  { ax: W - corner, ay: H, bx: W - 0.03, by: H + 0.032, name: '右下袋角' },
  { ax: W, ay: H - corner, bx: W + 0.032, by: H - 0.03, name: '右下袋角' },
  { ax: W / 2 - side, ay: 0, bx: W / 2 - 0.047, by: -0.047, name: '中上袋角' },
  { ax: W / 2 + side, ay: 0, bx: W / 2 + 0.047, by: -0.047, name: '中上袋角' },
  { ax: W / 2 - side, ay: H, bx: W / 2 - 0.047, by: H + 0.047, name: '中下袋角' },
  { ax: W / 2 + side, ay: H, bx: W / 2 + 0.047, by: H + 0.047, name: '中下袋角' },
];
export function legalPlacement(balls: Ball[], id: number, x: number, y: number, behindLine = false): boolean {
  const R = TABLE.r;
  return x >= R && x <= W - R && y >= R && y <= H - R && (!behindLine || x <= W / 4)
    && !balls.some(b => !b.pocketed && b.id !== id && Math.hypot(b.x - x, b.y - y) < 2 * R + 0.001)
    && !POCKETS.some(p => Math.hypot(p.x - x, p.y - y) < TABLE.pocketR + R * 0.3);
}
export function applyShot(balls: Ball[], shot: Shot) {
  const cue = balls.find(b => b.id === 0);
  if (!cue || cue.pocketed) throw new Error('请先放置白球');
  const R = TABLE.r, speed = 0.2 + shotPower(shot) / 100 * 6.2;
  const a = shot.angle, dx = Math.cos(a), dy = Math.sin(a), sx = -dy, sy = dx;
  let tx = clamp(shot.tipX, -0.85, 0.85), ty = clamp(shot.tipY, -0.85, 0.85);
  const len = Math.hypot(tx, ty); if (len > 0.85) { tx *= 0.85 / len; ty *= 0.85 / len; }
  const elevation = clamp(shot.elevation, 0, 82) * Math.PI / 180;
  const planar = speed * Math.cos(elevation);
  cue.vx = planar * dx - planar * tx * 0.022 * sx;
  cue.vy = planar * dy - planar * tx * 0.022 * sy;
  const follow = speed * ty * 2.5 / R * Math.cos(elevation);
  const axial = -speed * tx * 2.5 / R * Math.sin(elevation);
  cue.wx = -dy * follow + dx * axial;
  cue.wy = dx * follow + dy * axial;
  cue.wz = -speed * tx * 2.5 / R * Math.cos(elevation);
  cue.vz = shot.kind === 'jump' ? speed * Math.sin(elevation) * 0.52 : 0;
  cue.z = R;
}
type Impact = { time: number; a: Ball } & (
  | { type: 'contact'; b: Ball }
  | { type: 'rail'; seg: Cushion; nx: number; ny: number }
  | { type: 'pocket'; pocket: number }
  | { type: 'ground' | 'off' }
);

// Entry time for a moving point into a sphere. The near root is stable even
// when starting almost in contact; separating motion never creates an impact.
function sphereTime(dx: number, dy: number, dz: number, vx: number, vy: number, vz: number, radius: number): number | null {
  const dot = dx * vx + dy * vy + dz * vz;
  if (dot >= -1e-10) return null;
  const c = dx * dx + dy * dy + dz * dz - radius * radius;
  if (c <= 1e-12) return 0;
  const speed2 = vx * vx + vy * vy + vz * vz, discriminant = dot * dot - speed2 * c;
  return discriminant < 0 ? null : c / (-dot + Math.sqrt(discriminant));
}

function cushionTime(b: Ball, seg: Cushion, duration: number): { time: number; nx: number; ny: number } | null {
  const R = TABLE.r, endX = b.x + b.vx * duration, endY = b.y + b.vy * duration;
  if (Math.min(b.x, endX) > Math.max(seg.ax, seg.bx) + R || Math.max(b.x, endX) < Math.min(seg.ax, seg.bx) - R
    || Math.min(b.y, endY) > Math.max(seg.ay, seg.by) + R || Math.max(b.y, endY) < Math.min(seg.ay, seg.by) - R) return null;
  const sx = seg.bx - seg.ax, sy = seg.by - seg.ay, length = Math.hypot(sx, sy), tx = sx / length, ty = sy / length;
  const dx = b.x - seg.ax, dy = b.y - seg.ay, along = dx * tx + dy * ty, normal = -dx * ty + dy * tx;
  let hit: { time: number; nx: number; ny: number } | null = null;
  for (const side of [1, -1]) {
    const nx = -ty * side, ny = tx * side, vn = b.vx * nx + b.vy * ny;
    if (vn >= -1e-10) continue;
    const distance = normal * side, time = distance >= 0 && distance < R ? 0 : (R - distance) / vn;
    const at = along + (b.vx * tx + b.vy * ty) * time;
    if (time >= 0 && time <= duration && at >= 0 && at <= length && (!hit || time < hit.time)) hit = { time, nx, ny };
  }
  for (const [x, y] of [[seg.ax, seg.ay], [seg.bx, seg.by]]) {
    const time = sphereTime(b.x - x, b.y - y, 0, b.vx, b.vy, 0, R);
    if (time === null || time > duration || hit && time >= hit.time) continue;
    const dx = b.x + b.vx * time - x, dy = b.y + b.vy * time - y, distance = Math.hypot(dx, dy);
    if (distance > 1e-9) hit = { time, nx: dx / distance, ny: dy / distance };
  }
  return hit;
}

export class PhysicsWorld {
  balls: Ball[]; events: PhysicsEvent[] = []; time = 0; done = false; timedOut = false;
  trails: Record<number, TrailPoint[]> = {};
  private quiet = 0;
  private nextTrace = 0;
  constructor(input: Ball[], shot?: Shot, private recordTrails = true) {
    this.balls = copyState(input);
    if (shot) applyShot(this.balls, shot);
    if (recordTrails) this.trace();
  }
  private emit(event: Omit<PhysicsEvent, 'time'>, time: number) {
    this.events.push({ ...event, time });
  }
  private trace() {
    for (const b of this.balls) {
      const list = this.trails[b.id] ??= [];
      if (b.pocketed) continue;
      const previous = list.at(-1);
      if (!previous || Math.hypot(b.x - previous.x, b.y - previous.y, b.z - previous.z) > 0.001 || this.done)
        list.push({ x: b.x, y: b.y, z: b.z, t: this.time });
    }
  }
  step() {
    if (this.done) return;
    const { r: R, dt } = TABLE;
    let moving = false;
    for (const b of this.balls) {
      if (b.pocketed) continue;
      if (b.vx === 0 && b.vy === 0 && b.vz === 0 && b.wx === 0 && b.wy === 0 && b.z <= R + 0.0001) { b.wz *= Math.exp(-1.05 * dt); continue; }
      if (b.z > R + 0.0001 || b.vz > 0.01) {
        b.vz -= 9.81 * dt;
      } else {
        b.z = R; b.vz = 0;
        const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;
        const slip = Math.hypot(ux, uy), slidingImpulse = 0.21 * 9.81 * dt;
        if (slip > slidingImpulse * 3.5) {
          const dvx = -slidingImpulse * ux / slip, dvy = -slidingImpulse * uy / slip;
          b.vx += dvx; b.vy += dvy;
          b.wx += 2.5 * dvy / R; b.wy -= 2.5 * dvx / R;
        } else {
          b.vx -= ux / 3.5; b.vy -= uy / 3.5;
          const v = Math.hypot(b.vx, b.vy), decel = 0.019 * 9.81 * dt;
          const scale = v > decel ? (v - decel) / v : 0;
          b.vx *= scale; b.vy *= scale;
          b.wx = -b.vy / R; b.wy = b.vx / R;
        }
        b.wz *= Math.exp(-1.05 * dt);
      }
    }
    this.advance(dt);
    for (const b of this.balls) {
      if (b.pocketed) continue;
      if (b.z <= R + 1e-5 && b.vz < 0) b.vz = 0;
      const slip = Math.hypot(b.vx - R * b.wy, b.vy + R * b.wx);
      if (Math.hypot(b.vx, b.vy) < 0.012 && slip < 0.025 && b.z <= R + 0.0002 && Math.abs(b.vz) < 0.03)
        b.vx = b.vy = b.vz = b.wx = b.wy = 0;
      else moving = true;
    }
    this.time += dt; this.quiet = moving ? 0 : this.quiet + 1;
    if (this.quiet >= 12 || this.time >= 28) {
      this.done = true; this.timedOut = this.time >= 28;
      for (const b of this.balls) b.vx = b.vy = b.vz = b.wx = b.wy = 0;
    }
    if (this.recordTrails && (this.time >= this.nextTrace || this.done)) { this.trace(); this.nextTrace = this.time + 1 / 30; }
  }
  // Find the next impact before moving: a graze can begin and end inside one
  // 240 Hz frame, and a frozen ball can hit the cushion immediately after contact.
  private advance(dt: number) {
    let remaining = dt, elapsed = 0;
    for (let impacts = 0; remaining > 1e-10 && impacts < 256; impacts++) {
      let hit: Impact | null = null;
      const consider = (candidate: Impact) => {
        if (candidate.time >= -1e-10 && candidate.time <= remaining && (!hit || candidate.time < hit.time)) hit = candidate;
      };
      for (let i = 0; i < this.balls.length; i++) {
        const a = this.balls[i]; if (a.pocketed) continue;
        for (let j = i + 1; j < this.balls.length; j++) {
          const b = this.balls[j]; if (b.pocketed) continue;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const vx = b.vx - a.vx, vy = b.vy - a.vy, vz = b.vz - a.vz;
          if (Math.abs(dx) > 2 * TABLE.r + Math.abs(vx) * remaining || Math.abs(dy) > 2 * TABLE.r + Math.abs(vy) * remaining || Math.abs(dz) > 2 * TABLE.r + Math.abs(vz) * remaining) continue;
          const time = sphereTime(dx, dy, dz, vx, vy, vz, 2 * TABLE.r);
          if (time !== null) consider({ type: 'contact', time, a, b });
        }
        for (let pocket = 0; pocket < POCKETS.length; pocket++) {
          const p = POCKETS[pocket], dx = a.x - p.x, dy = a.y - p.y, radius = TABLE.pocketR - 0.006;
          const time = dx * dx + dy * dy <= radius * radius ? 0 : sphereTime(dx, dy, 0, a.vx, a.vy, 0, radius);
          if (time !== null && a.z + a.vz * time < TABLE.r + 0.012) consider({ type: 'pocket', time, a, pocket });
        }
        for (const seg of CUSHIONS) {
          const cushion = cushionTime(a, seg, remaining);
          if (cushion && a.z + a.vz * cushion.time < TABLE.r + 0.04) consider({ type: 'rail', a, seg, ...cushion });
        }
        if (a.vz < -1e-10) consider({ type: 'ground', a, time: Math.max(0, (TABLE.r - a.z) / a.vz) });
        const exits = [
          a.x < -0.13 || a.x > W + 0.13 || a.y < -0.13 || a.y > H + 0.13 ? 0 : Infinity,
          a.vx < 0 ? (-0.13 - a.x) / a.vx : a.vx > 0 ? (W + 0.13 - a.x) / a.vx : Infinity,
          a.vy < 0 ? (-0.13 - a.y) / a.vy : a.vy > 0 ? (H + 0.13 - a.y) / a.vy : Infinity,
        ];
        consider({ type: 'off', a, time: Math.min(...exits) });
      }
      // The callback populates hit; use an explicit type for control-flow analysis.
      const impact = hit as Impact | null;
      const travel = impact ? Math.max(0, impact.time) : remaining;
      for (const b of this.balls) if (!b.pocketed) {
        b.x += b.vx * travel; b.y += b.vy * travel; b.z = Math.max(TABLE.r, b.z + b.vz * travel);
        integrateOrientation(b, travel);
      }
      elapsed += travel; remaining -= travel;
      if (!impact) return;
      const time = this.time + elapsed, a = impact.a;
      switch (impact.type) {
        case 'contact': this.contact(a, impact.b, time); break;
        case 'rail': {
          const { nx, ny } = impact, vn = a.vx * nx + a.vy * ny;
          const normalImpulse = -(1 + 0.79) * vn;
          a.x += nx * 1e-8; a.y += ny * 1e-8;
          a.vx += normalImpulse * nx; a.vy += normalImpulse * ny;
          const tx = -ny, ty = nx, vt = a.vx * tx + a.vy * ty - TABLE.r * a.wz;
          const jt = clamp(-vt / 3.5, -normalImpulse * 0.16, normalImpulse * 0.16);
          a.vx += jt * tx; a.vy += jt * ty; a.wz -= 2.5 * jt / TABLE.r;
          this.emit({ type: 'rail', ball: a.id, rail: impact.seg.name, speed: -vn }, time);
          break;
        }
        case 'pocket': {
          const entry = { ...a }, speed = Math.hypot(a.vx, a.vy, a.vz);
          a.pocketed = true; a.vx = a.vy = a.vz = 0;
          this.emit({ type: 'pocket', ball: a.id, pocket: impact.pocket, speed, entry }, time);
          break;
        }
        case 'off':
          a.pocketed = true; a.vx = a.vy = a.vz = 0;
          this.emit({ type: 'off', ball: a.id }, time);
          break;
        case 'ground':
          a.z = TABLE.r; a.vz = Math.abs(a.vz) > 0.32 ? -a.vz * 0.2 : 0;
          a.vx *= 0.99; a.vy *= 0.99;
          break;
      }
    }
    // In a dense simultaneous cluster, leave the unsolved fraction unmoved
    // rather than allowing balls to tunnel through each other or a cushion.
  }
  private contact(a: Ball, b: Ball, time: number) {
    const R = TABLE.r;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, distance = Math.hypot(dx, dy, dz);
    const nx = dx / distance, ny = dy / distance, nz = dz / distance;
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rvz = b.vz - a.vz;
    const vn = rvx * nx + rvy * ny + rvz * nz;
    if (vn >= 0) return;
    const separation = Math.max(0, 2 * R - distance) / 2 + 1e-8;
    a.x -= nx * separation; a.y -= ny * separation; a.z = Math.max(R, a.z - nz * separation);
    b.x += nx * separation; b.y += ny * separation; b.z = Math.max(R, b.z + nz * separation);
    const impulse = -(1 + 0.94) * vn / 2;
    a.vx -= impulse * nx; a.vy -= impulse * ny; a.vz -= impulse * nz;
    b.vx += impulse * nx; b.vy += impulse * ny; b.vz += impulse * nz;
    const sumX = a.wx + b.wx, sumY = a.wy + b.wy, sumZ = a.wz + b.wz;
    const cx = rvx - R * (sumY * nz - sumZ * ny), cy = rvy - R * (sumZ * nx - sumX * nz), cz = rvz - R * (sumX * ny - sumY * nx);
    const cvn = cx * nx + cy * ny + cz * nz;
    let jx = -(cx - cvn * nx) / 7, jy = -(cy - cvn * ny) / 7, jz = -(cz - cvn * nz) / 7;
    const jt = Math.hypot(jx, jy, jz), limit = 0.045 * impulse;
    if (jt > limit) { jx *= limit / jt; jy *= limit / jt; jz *= limit / jt; }
    a.vx -= jx; a.vy -= jy; a.vz -= jz; b.vx += jx; b.vy += jy; b.vz += jz;
    const ox = -2.5 / R * (ny * jz - nz * jy), oy = -2.5 / R * (nz * jx - nx * jz), oz = -2.5 / R * (nx * jy - ny * jx);
    a.wx += ox; b.wx += ox; a.wy += oy; b.wy += oy; a.wz += oz; b.wz += oz;
    this.emit({ type: 'contact', ball: a.id, other: b.id, speed: -vn }, time);
  }
  result(): Simulation { return { balls: copyState(this.balls), events: [...this.events], time: this.time, trails: this.trails, settled: !this.timedOut && this.done }; }
}
export function simulate(input: Ball[], shot: Shot, recordTrails = false): Simulation {
  const world = new PhysicsWorld(input, shot, recordTrails);
  while (!world.done) world.step();
  return world.result();
}
export function segmentClear(balls: Ball[], ax: number, ay: number, bx: number, by: number, ignore: number[], clearance = TABLE.r * 2): boolean {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  if (length < 1e-9) return true;
  return !balls.some(b => {
    if (b.pocketed || ignore.includes(b.id)) return false;
    const t = clamp(((b.x - ax) * dx + (b.y - ay) * dy) / length, 0, 1);
    return Math.hypot(b.x - ax - t * dx, b.y - ay - t * dy) < clearance;
  });
}
