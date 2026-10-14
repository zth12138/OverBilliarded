import { clamp, POCKETS, TABLE } from './physics';
import { integrateOrientation } from './rotation';
import type { Ball, PhysicsEvent, Shot } from './types';

const smooth = (t: number) => t * t * (3 - 2 * t);
export const STROKE_IMPACT_TIME = 0.56;
export const STROKE_END_TIME = 0.88;
export interface CuePose { ball: Ball; shot: Shot; offset: number; opacity: number }
export interface PocketFall { ball: Ball; pocket: number; elapsed: number; duration: number }

export function strokePose(ball: Ball, shot: Shot, elapsed: number): CuePose {
  const rest = 0.065, pull = rest + 0.04 + clamp(shot.power, 1, 100) / 100 * 0.14;
  let offset: number, opacity = 1;
  if (elapsed < 0.36) offset = rest + (pull - rest) * smooth(clamp(elapsed / 0.36, 0, 1));
  else if (elapsed < 0.44) offset = pull;
  else if (elapsed < STROKE_IMPACT_TIME) {
    const t = clamp((elapsed - 0.44) / 0.12, 0, 1);
    offset = pull + (TABLE.r - pull) * t * t;
  } else if (elapsed < 0.63) offset = TABLE.r - 0.035 * smooth((elapsed - STROKE_IMPACT_TIME) / 0.07);
  else {
    const t = clamp((elapsed - 0.63) / 0.25, 0, 1);
    offset = TABLE.r - 0.035 + 0.16 * smooth(t);
    opacity = 1 - smooth(t);
  }
  return { ball, shot, offset, opacity };
}

export function pocketPose(fall: PocketFall) {
  const t = clamp(fall.elapsed / fall.duration, 0, 1), p = POCKETS[fall.pocket];
  // Once the ball reaches the mouth it follows the hidden track direction:
  // left and middle pockets feed right, while the two right pockets feed
  // vertically along the rail. The lip then occludes the rolling sphere.
  const rightSide = p.x === TABLE.w;
  const dirX = rightSide ? 0 : 1;
  const dirY = rightSide ? (p.y < TABLE.h / 2 ? 1 : -1) : 0;
  const dip = clamp(t / 0.28, 0, 1), entryWeight = (1 - dip) ** 2;
  const roll = smooth(clamp((t - 0.28) / 0.72, 0, 1));
  return {
    x: p.x + (fall.ball.x - p.x) * entryWeight + dirX * 0.085 * roll,
    y: p.y + (fall.ball.y - p.y) * entryWeight + dirY * 0.085 * roll,
    // It only dips slightly while crossing the lip; the remaining animation
    // is a constant-size roll, rather than a ball shrinking continuously.
    radius: TABLE.r * (1 - 0.14 * smooth(dip)),
    opacity: 1 - smooth(clamp((t - 0.7) / 0.3, 0, 1)),
    darkness: smooth(t) * 0.45,
  };
}

export class ShotFeedback {
  stroke: { ball: Ball; shot: Shot; elapsed: number; impacted: boolean } | null = null;
  falls: PocketFall[] = [];
  start(ball: Ball, shot: Shot) {
    this.stroke = { ball: { ...ball }, shot: { ...shot }, elapsed: 0, impacted: false };
    this.falls = [];
  }
  get cue(): CuePose | null {
    return this.stroke ? strokePose(this.stroke.ball, this.stroke.shot, this.stroke.elapsed) : null;
  }
  advance(seconds: number): boolean {
    let impact = false;
    if (this.stroke) {
      this.stroke.elapsed += seconds;
      if (!this.stroke.impacted && this.stroke.elapsed >= STROKE_IMPACT_TIME) {
        this.stroke.impacted = true; impact = true;
      }
      if (this.stroke.elapsed >= STROKE_END_TIME) this.stroke = null;
    }
    for (const fall of this.falls) {
      const before = pocketPose(fall), oldTime = fall.elapsed;
      fall.elapsed = Math.min(fall.duration, fall.elapsed + seconds);
      const after = pocketPose(fall), dt = fall.elapsed - oldTime;
      if (dt > 0) {
        // The surface rolls with the curved path, blending away entry spin.
        const incoming = Math.max(0, 1 - fall.elapsed / (fall.duration * 0.4));
        const { wx, wy, wz } = fall.ball;
        fall.ball.wx = -(after.y - before.y) / TABLE.r / dt + wx * incoming;
        fall.ball.wy = (after.x - before.x) / TABLE.r / dt + wy * incoming;
        fall.ball.wz = wz * incoming;
        integrateOrientation(fall.ball, dt);
        fall.ball.wx = wx; fall.ball.wy = wy; fall.ball.wz = wz;
      }
    }
    this.falls = this.falls.filter(f => f.elapsed < f.duration);
    return impact;
  }
  consume(event: PhysicsEvent) {
    if (event.type !== 'pocket' || event.pocket === undefined || !event.entry) return;
    this.falls.push({ ball: { ...event.entry }, pocket: event.pocket, elapsed: 0,
      duration: 0.62 - clamp(event.speed ?? 0, 0, 5) * 0.02 });
  }
  clear() { this.stroke = null; this.falls = []; }
}
