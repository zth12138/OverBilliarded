import type { Shot } from './types';

export const NORMAL_POWER_MAX = 100;
export const EXTENDED_POWER_START = 300;

// The option travels with the shot so previews, undo and execution agree.
export function shotPower(shot: Pick<Shot, 'power' | 'unlimitedPower'>): number {
  const power = Number.isFinite(shot.power) ? Math.max(1, shot.power) : 1;
  return shot.unlimitedPower ? power : Math.min(NORMAL_POWER_MAX, power);
}
