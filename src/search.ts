import { clamp, POCKETS, segmentClear, simulate, TABLE } from './physics';
import { adjudicate, describeEventChain, groupOf, legalFirstIds, remainingFor } from './rules';
import type { Ball, Plan, RuleState, SearchRequest, SearchUpdate, Shot, SortMode } from './types';

interface Route { angle: number; label: string; complexity: number; length: number; cut: number }
interface Point { x: number; y: number }
const R = TABLE.r;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const ghost = (target: Point, destination: Point): Point => {
  const d = dist(target, destination) || 1;
  return { x: target.x - (destination.x - target.x) / d * 2 * R, y: target.y - (destination.y - target.y) / d * 2 * R };
};
function cutCos(from: Point, contact: Point, object: Point, to: Point) {
  const ax = contact.x - from.x, ay = contact.y - from.y, bx = to.x - object.x, by = to.y - object.y;
  return (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
}
const rails = [
  { axis: 'x' as const, value: R, name: '左库' }, { axis: 'x' as const, value: TABLE.w - R, name: '右库' },
  { axis: 'y' as const, value: R, name: '上库' }, { axis: 'y' as const, value: TABLE.h - R, name: '下库' },
];
function reflected(p: Point, rail: typeof rails[number]): Point {
  return rail.axis === 'x' ? { x: rail.value - (p.x - rail.value) / 0.79, y: p.y } : { x: p.x, y: rail.value - (p.y - rail.value) / 0.79 };
}
function bounce(from: Point, to: Point, rail: typeof rails[number]): Point | null {
  const mirror = reflected(to, rail), denom = mirror[rail.axis] - from[rail.axis];
  if (Math.abs(denom) < 1e-8) return null;
  const t = (rail.value - from[rail.axis]) / denom;
  if (t <= 0 || t >= 1) return null;
  const p = { x: from.x + t * (mirror.x - from.x), y: from.y + t * (mirror.y - from.y) };
  if (rail.axis === 'x') { if (p.y < 0.115 || p.y > TABLE.h - 0.115) return null; }
  else if (p.x < 0.115 || p.x > TABLE.w - 0.115 || Math.abs(p.x - TABLE.w / 2) < 0.105) return null;
  return p;
}
export function generateRoutes(req: SearchRequest): Route[] {
  const balls = req.balls, cue = balls.find(b => b.id === 0)!, target = balls.find(b => b.id === req.target)!;
  const pocket = POCKETS[req.pocket], legal = legalFirstIds(balls, req.rules), routes: Route[] = [];
  const add = (from: Point, contact: Point, label: string, complexity: number, length: number, cut: number) => {
    if (cut > 0.12) routes.push({ angle: Math.atan2(contact.y - from.y, contact.x - from.x), label, complexity, length, cut });
  };
  const directContact = ghost(target, pocket);
  const targetClear = segmentClear(balls, target.x, target.y, pocket.x, pocket.y, [0, target.id], 2 * R);
  if (legal.includes(target.id)) {
    if (targetClear && segmentClear(balls, cue.x, cue.y, directContact.x, directContact.y, [0, target.id]))
      add(cue, directContact, '直接进球', 4, dist(cue, target) + dist(target, pocket), cutCos(cue, directContact, target, pocket));
    for (const rail of rails) {
      const p = bounce(target, pocket, rail);
      if (p && segmentClear(balls, target.x, target.y, p.x, p.y, [0, target.id]) && segmentClear(balls, p.x, p.y, pocket.x, pocket.y, [0, target.id])) {
        const contact = ghost(target, p);
        if (segmentClear(balls, cue.x, cue.y, contact.x, contact.y, [0, target.id]))
          add(cue, contact, `单库翻袋 · ${rail.name}`, 32, dist(cue, target) + dist(target, p) + dist(p, pocket), cutCos(cue, contact, target, p));
      }
      const kick = bounce(cue, directContact, rail);
      if (kick && targetClear && segmentClear(balls, cue.x, cue.y, kick.x, kick.y, [0, target.id]) && segmentClear(balls, kick.x, kick.y, directContact.x, directContact.y, [0, target.id]))
        add(cue, kick, `单库解球 · ${rail.name}`, 38, dist(cue, kick) + dist(kick, target) + dist(target, pocket), cutCos(kick, directContact, target, pocket));
    }
  }
  // Legal first object strikes the selected target toward the called pocket.
  if (targetClear) for (const first of balls) {
    if (first.id === target.id || first.pocketed || !legal.includes(first.id)) continue;
    const contact = ghost(first, directContact), c1 = cutCos(cue, contact, first, directContact), c2 = cutCos(first, directContact, target, pocket);
    if (c2 > 0.2 && segmentClear(balls, cue.x, cue.y, contact.x, contact.y, [0, first.id])
      && segmentClear(balls, first.x, first.y, directContact.x, directContact.y, [0, first.id, target.id]))
      add(cue, contact, `组合球 · ${first.id} → ${target.id}`, 43, dist(cue, first) + dist(first, target) + dist(target, pocket), c1 * c2);
  }
  return routes;
}
export function positionScore(balls: Ball[], rules: RuleState, target: number): number {
  const cue = balls.find(b => b.id === 0 && !b.pocketed); if (!cue) return 0;
  const group = rules.groups[rules.player] ?? groupOf(target);
  const nextBalls = balls.filter(b => !b.pocketed && b.id !== 0 && (group && remainingFor(group, balls) > 0 ? groupOf(b.id) === group : b.id === 8));
  if (!nextBalls.length) return 100;
  let best = 0, options = 0;
  for (const next of nextBalls) for (const pocket of POCKETS) {
    const contact = ghost(next, pocket), cut = cutCos(cue, contact, next, pocket);
    if (cut < 0.18 || !segmentClear(balls, cue.x, cue.y, contact.x, contact.y, [0, next.id]) || !segmentClear(balls, next.x, next.y, pocket.x, pocket.y, [0, next.id])) continue;
    options++;
    const totalDistance = dist(cue, next) + dist(next, pocket);
    const cueNearRail = Math.min(cue.x, TABLE.w - cue.x, cue.y, TABLE.h - cue.y) < R * 2.2;
    best = Math.max(best, 28 + cut * 48 + Math.max(0, 24 - totalDistance * 7) - (cueNearRail ? 12 : 0));
  }
  return clamp(best + Math.min(8, options * 1.5), 0, 100);
}
export function planScore(plan: Pick<Plan, 'complexity' | 'position' | 'robustness'>, sort: SortMode): number {
  const weights = sort === 'simple' ? [0.72, 0.13, 0.15] : sort === 'position' ? [0.14, 0.73, 0.13] : sort === 'robust' ? [0.13, 0.14, 0.73] : [0.36, 0.36, 0.28];
  return (100 - plan.complexity) * weights[0] + plan.position * weights[1] + plan.robustness * weights[2];
}
function success(req: SearchRequest, outcome: ReturnType<typeof simulate>): boolean {
  return outcome.settled && outcome.events.some(e => e.type === 'pocket' && e.ball === req.target && e.pocket === req.pocket)
    && !adjudicate(req.balls, outcome.balls, outcome.events, { ...req.rules, calledPocket: req.pocket }).foul
    && !outcome.events.some(e => e.ball === 8 && (e.type === 'pocket' || e.type === 'off') && req.target !== 8);
}
function diverse(a: Plan, b: Plan) {
  const cueA = a.outcome.balls.find(b => b.id === 0)!, cueB = b.outcome.balls.find(b => b.id === 0)!;
  return a.route !== b.route || dist(cueA, cueB) > 0.17 || Math.abs(a.shot.tipY - b.shot.tipY) > 0.45 || Math.abs(a.shot.tipX - b.shot.tipX) > 0.45;
}
export function searchPlans(req: SearchRequest, onUpdate?: (u: SearchUpdate) => void): Plan[] {
  const start = performance.now(); let checked = 0;
  const cue = req.balls.find(b => b.id === 0 && !b.pocketed), target = req.balls.find(b => b.id === req.target && !b.pocketed);
  if (!cue || !target || !POCKETS[req.pocket] || req.rules.breakShot) { onUpdate?.({ type: 'done', id: req.id, plans: [], checked, elapsed: 0 }); return []; }
  const routes = generateRoutes(req), candidates: Plan[] = [];
  const offsets = [0, -0.003, 0.003, -0.007, 0.007, -0.013, 0.013];
  const powers = [12, 18, 24, 31, 40, 51, 64];
  const spins: [number, number][] = [[0, 0], [0, -0.65], [0, 0.65], [-0.45, 0], [0.45, 0]];
  const total = routes.length * offsets.length * powers.length * spins.length + 240;
  const tryShot = (route: Route, shot: Shot) => {
    const outcome = simulate(req.balls, shot); checked++;
    if (checked % 30 === 0) onUpdate?.({ type: 'progress', id: req.id, checked, total, found: candidates.length });
    if (!success(req, outcome)) return;
    const contacts = outcome.events.filter(e => e.type === 'contact').length;
    const railsBeforePot = outcome.events.filter(e => e.type === 'rail' && e.time < outcome.events.find(e => e.type === 'pocket' && e.ball === req.target)!.time).length;
    const first = outcome.events.find(e => e.type === 'contact' && (e.ball === 0 || e.other === 0))!;
    const firstId = first.ball === 0 ? first.other! : first.ball;
    const targetPot = outcome.events.find(e => e.type === 'pocket' && e.ball === req.target)!;
    const targetRails = outcome.events.filter(e => e.type === 'rail' && e.ball === req.target && e.time < targetPot.time);
    const cueRails = outcome.events.filter(e => e.type === 'rail' && e.ball === 0 && e.time < first.time);
    const label = firstId !== req.target ? `组合球 · ${firstId} → ${req.target}` : cueRails.length ? `${cueRails.length}库解球 · ${cueRails[0].rail}${targetRails.length ? ' + 翻袋' : ''}` : targetRails.length ? `${targetRails.length}库翻袋 · ${targetRails[0].rail}` : '直接进球';
    const baseComplexity = firstId !== req.target ? 43 : targetRails.length ? 32 : cueRails.length ? 38 : 4;
    const complexity = clamp(baseComplexity + Math.max(0, railsBeforePot - (targetRails.length || cueRails.length ? 1 : 0)) * 7
      + Math.max(0, contacts - (firstId !== req.target ? 2 : 1)) * 9 + Math.abs(shot.tipX) * 12 + Math.abs(shot.tipY) * 6 + Math.max(0, shot.power - 45) * 0.25, 0, 100);
    const ruling = adjudicate(req.balls, outcome.balls, outcome.events, { ...req.rules, calledPocket: req.pocket });
    const evaluatedRules: RuleState = { ...req.rules, groups: [...req.rules.groups] };
    if (ruling.assigned) evaluatedRules.groups[req.rules.player] = ruling.assigned;
    const position = ruling.winner === req.rules.player ? 100 : req.rules.mode === 'match' && !ruling.continuation
      ? 100 - positionScore(outcome.balls, { ...evaluatedRules, player: req.rules.player === 0 ? 1 : 0 }, req.target)
      : positionScore(outcome.balls, evaluatedRules, req.target);
    const plan: Plan = { id: `${req.id}-${checked}`, shot, route: label, chain: describeEventChain(outcome.events), complexity, position, robustness: 0, score: 0, outcome };
    plan.score = planScore(plan, req.sort); candidates.push(plan);
  };
  for (const route of routes) for (const offset of offsets) for (const power of powers) for (const [tipX, tipY] of spins)
    tryShot(route, { angle: route.angle + offset, power, tipX, tipY, elevation: 0, kind: 'normal' });
  // Keep distinct trajectories/leave positions before doing expensive perturbation validation.
  const finalists: Plan[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (finalists.every(p => diverse(p, candidate))) finalists.push(candidate);
    if (finalists.length >= 24) break;
  }
  for (const plan of finalists) {
    let hits = 0;
    const variations = [
      { angle: -0.0015 }, { angle: 0.0015 }, { angle: -0.003 }, { angle: 0.003 },
      { power: -1.5 }, { power: 1.5 }, { tipX: -0.035 }, { tipX: 0.035 }, { tipY: -0.035 }, { tipY: 0.035 },
    ];
    for (const v of variations) {
      const perturbed = { ...plan.shot, angle: plan.shot.angle + (v.angle ?? 0), power: plan.shot.power + (v.power ?? 0), tipX: plan.shot.tipX + (v.tipX ?? 0), tipY: plan.shot.tipY + (v.tipY ?? 0) };
      if (success(req, simulate(req.balls, perturbed))) hits++; checked++;
    }
    plan.robustness = hits / variations.length * 100;
    plan.score = planScore(plan, req.sort);
    plan.outcome = simulate(req.balls, plan.shot, true);
    onUpdate?.({ type: 'progress', id: req.id, checked, total, found: finalists.length });
  }
  const plans = finalists.sort((a, b) => b.score - a.score).slice(0, 8);
  onUpdate?.({ type: 'done', id: req.id, plans, checked, elapsed: performance.now() - start });
  return plans;
}
