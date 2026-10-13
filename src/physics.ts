import type { Ball, PhysicsEvent, Simulation, Shot, TrailPoint } from './types';
import { integrateOrientation } from './rotation';

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
  const R = TABLE.r, speed = 0.2 + clamp(shot.power, 1, 100) / 100 * 6.2;
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
export class PhysicsWorld {
  balls: Ball[]; events: PhysicsEvent[] = []; time = 0; done = false; timedOut = false;
  trails: Record<number, TrailPoint[]> = {};
  private quiet = 0;
  private nextTrace = 0;
  private lastEvents = new Map<string, number>();
  constructor(input: Ball[], shot?: Shot, private recordTrails = true) {
    this.balls = copyState(input);
    if (shot) applyShot(this.balls, shot);
    if (recordTrails) this.trace();
  }
  private emit(event: Omit<PhysicsEvent, 'time'>, key: string) {
    const last = this.lastEvents.get(key);
    if (last !== undefined && this.time - last < 0.045) return;
    this.lastEvents.set(key, this.time);
    this.events.push({ ...event, time: this.time });
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
        b.vz -= 9.81 * dt; b.z += b.vz * dt;
        if (b.z <= R) { b.z = R; b.vz = Math.abs(b.vz) > 0.32 ? -b.vz * 0.2 : 0; b.vx *= 0.99; b.vy *= 0.99; }
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
      b.x += b.vx * dt; b.y += b.vy * dt;
      let captured = false;
      if (b.z < R + 0.012) {
        for (let p = 0; p < POCKETS.length; p++) if (Math.hypot(b.x - POCKETS[p].x, b.y - POCKETS[p].y) < TABLE.pocketR - 0.006) {
          const entry = { ...b }, speed = Math.hypot(b.vx, b.vy, b.vz);
          b.pocketed = true; b.vx = b.vy = b.vz = 0;
          this.emit({ type: 'pocket', ball: b.id, pocket: p, speed, entry }, `p${b.id}`); captured = true; break;
        }
      }
      if (captured) continue;
      if (b.z < R + 0.04) this.cushions(b);
      if (b.x < -0.13 || b.x > W + 0.13 || b.y < -0.13 || b.y > H + 0.13) {
        b.pocketed = true; b.vx = b.vy = b.vz = 0;
        this.emit({ type: 'off', ball: b.id }, `o${b.id}`);
      }
    }
    for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) {
      const a = this.balls[i], b = this.balls[j];
      if (a.pocketed || b.pocketed) continue;
      if (a.vx === 0 && a.vy === 0 && a.vz === 0 && b.vx === 0 && b.vy === 0 && b.vz === 0) continue;
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      if (Math.abs(dx) > 2 * R || Math.abs(dy) > 2 * R || Math.abs(dz) > 2 * R) continue;
      let distance = Math.hypot(dx, dy, dz);
      if (distance >= 2 * R || distance < 1e-9) continue;
      const oldRVX = b.vx - a.vx, oldRVY = b.vy - a.vy, oldRVZ = b.vz - a.vz;
      const speed2 = oldRVX * oldRVX + oldRVY * oldRVY + oldRVZ * oldRVZ;
      const dot = dx * oldRVX + dy * oldRVY + dz * oldRVZ;
      let rewind = 0;
      // Swept contact fixes the angle before balls penetrate at high speeds.
      if (speed2 > 1e-9 && dot < 0) {
        const root = (dot + Math.sqrt(Math.max(0, dot * dot - speed2 * (distance * distance - 4 * R * R)))) / speed2;
        if (root > 0 && root <= dt * 1.01) {
          rewind = root;
          a.x -= a.vx * rewind; a.y -= a.vy * rewind; a.z = Math.max(R, a.z - a.vz * rewind);
          b.x -= b.vx * rewind; b.y -= b.vy * rewind; b.z = Math.max(R, b.z - b.vz * rewind);
          dx = b.x - a.x; dy = b.y - a.y; dz = b.z - a.z; distance = Math.hypot(dx, dy, dz);
        }
      }
      const nx = dx / distance, ny = dy / distance, nz = dz / distance, overlap = Math.max(0, 2 * R - distance) + 1e-6;
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; a.z = Math.max(R, a.z - nz * overlap / 2);
      b.x += nx * overlap / 2; b.y += ny * overlap / 2; b.z = Math.max(R, b.z + nz * overlap / 2);
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rvz = b.vz - a.vz;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn >= 0) continue;
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
      if (rewind) {
        a.x += a.vx * rewind; a.y += a.vy * rewind; a.z = Math.max(R, a.z + a.vz * rewind);
        b.x += b.vx * rewind; b.y += b.vy * rewind; b.z = Math.max(R, b.z + b.vz * rewind);
      }
      this.emit({ type: 'contact', ball: a.id, other: b.id, speed: -vn }, `c${a.id}-${b.id}`);
    }
    for (const b of this.balls) {
      if (b.pocketed) continue;
      // Include spin from cloth, cushions and contacts before settling the ball.
      integrateOrientation(b, dt);
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
  private cushions(b: Ball) {
    const R = TABLE.r;
    if (b.x > R && b.x < W - R && b.y > R && b.y < H - R) return;
    for (const seg of CUSHIONS) {
      const sx = seg.bx - seg.ax, sy = seg.by - seg.ay;
      const t = clamp(((b.x - seg.ax) * sx + (b.y - seg.ay) * sy) / (sx * sx + sy * sy), 0, 1);
      const qx = seg.ax + t * sx, qy = seg.ay + t * sy;
      const dx = b.x - qx, dy = b.y - qy, distance = Math.hypot(dx, dy);
      if (distance >= R || distance < 1e-8) continue;
      const nx = dx / distance, ny = dy / distance;
      b.x += nx * (R - distance + 1e-6); b.y += ny * (R - distance + 1e-6);
      const vn = b.vx * nx + b.vy * ny; if (vn >= 0) continue;
      const normalImpulse = -(1 + 0.79) * vn;
      b.vx += normalImpulse * nx; b.vy += normalImpulse * ny;
      const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty - R * b.wz;
      const jt = clamp(-vt / 3.5, -normalImpulse * 0.16, normalImpulse * 0.16);
      b.vx += jt * tx; b.vy += jt * ty; b.wz -= 2.5 * jt / R;
      this.emit({ type: 'rail', ball: b.id, rail: seg.name, speed: -vn }, `r${b.id}-${seg.name}`);
    }
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
