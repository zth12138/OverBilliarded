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
  const travel = 1 - (1 - t) ** 3;
  return {
    x: fall.ball.x + (p.x - fall.ball.x) * travel,
    y: fall.ball.y + (p.y - fall.ball.y) * travel + TABLE.r * 0.4 * t * t,
    radius: TABLE.r * (1 - 0.92 * t * t),
    opacity: 1 - smooth(clamp((t - 0.6) / 0.4, 0, 1)),
    darkness: t * 0.8,
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
      fall.elapsed += seconds;
      integrateOrientation(fall.ball, seconds);
    }
    this.falls = this.falls.filter(f => f.elapsed < f.duration);
    return impact;
  }
  consume(event: PhysicsEvent) {
    if (event.type !== 'pocket' || event.pocket === undefined || !event.entry) return;
    this.falls.push({ ball: { ...event.entry }, pocket: event.pocket, elapsed: 0,
      duration: 0.48 - clamp(event.speed ?? 0, 0, 5) * 0.02 });
  }
  clear() { this.stroke = null; this.falls = []; }
}
