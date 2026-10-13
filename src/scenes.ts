import { ball, rackBalls, TABLE } from './physics';
import { freshRules } from './rules';
import type { Ball, RuleState } from './types';
export type SceneName = 'rack' | 'cut' | 'bank' | 'kick' | 'combo' | 'jump' | 'masse' | 'black';
export function scene(name: SceneName, mode: RuleState['mode']): { balls: Ball[]; rules: RuleState; target: number; pocket: number } {
  const rules = freshRules(mode);
  if (name === 'rack') return { balls: rackBalls(), rules, target: 1, pocket: 2 };
  rules.breakShot = false; rules.groups = ['solid', 'stripe']; rules.message = '练习局面已载入 · 选择目标球与洞口，或手动瞄准';
  const pool = rackBalls(); for (const b of pool) b.pocketed = true;
  const place = (id: number, x: number, y: number) => Object.assign(pool.find(b => b.id === id)!, ball(id, x, y));
  if (name === 'cut') {
    place(0, 0.55, 0.83); place(1, 1.22, 0.46); place(3, 1.92, 0.86); place(8, 2.08, 0.34); place(10, 1.65, 0.68); place(12, 0.78, 0.32);
    return { balls: pool, rules, target: 1, pocket: 1 };
  }
  if (name === 'bank') {
    place(0, 0.7, 0.9); place(2, 0.9, 0.45); place(3, 1.85, 0.88); place(8, 2.08, 0.34); place(10, 1.85, 0.27);
    return { balls: pool, rules, target: 2, pocket: 4 };
  }
  if (name === 'kick') {
    place(0, 0.5, 0.85); place(1, 1.2, 0.35); place(10, 0.85, 0.6); place(8, 2.05, 0.8);
    return { balls: pool, rules, target: 1, pocket: 1 };
  }
  if (name === 'combo') {
    place(0, 0.6, 0.85); place(1, 1.1, 0.6); place(3, 1.28, 0.39); place(8, 2.08, 0.34); place(10, 1.9, 0.86);
    return { balls: pool, rules, target: 3, pocket: 1 };
  }
  if (name === 'jump') {
    place(0, 0.65, 0.65); place(10, 0.94, 0.65); place(1, 1.55, 0.65); place(8, 2.1, 0.85);
    return { balls: pool, rules, target: 1, pocket: 2 };
  }
  if (name === 'masse') {
    place(0, 0.65, 0.75); place(10, 1.02, 0.67); place(1, 1.5, 0.43); place(8, 2.08, 0.88);
    return { balls: pool, rules, target: 1, pocket: 1 };
  }
  place(0, 0.62, 0.84); place(8, 1.26, 0.38); place(10, 1.75, 0.76);
  return { balls: pool, rules, target: 8, pocket: 1 };
}
