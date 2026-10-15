import { clamp, PhysicsWorld, POCKETS, segmentClear, simulate, TABLE } from './physics';
import { adjudicate, describeEventChain, groupOf, legalFirstIds, remainingFor } from './rules';
import type { Ball, Plan, RuleState, SearchRequest, SearchUpdate, Shot, SortMode } from './types';
import { EXTENDED_POWER_START, shotPower } from './power';

export interface Route { angle: number; label: string; length: number; cut: number; contact: Point; kind: Shot['kind'] }
export interface SearchGrid { route: Route; shots: Shot[] }
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
type Rail = typeof rails[number];
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
function twoCushionBounces(from: Point, to: Point, route: [Rail, Rail]): [Point, Point] | null {
  const lengths = { x: TABLE.w - 2 * R, y: TABLE.h - 2 * R };
  const start = { x: from.x - R, y: from.y - R }, end = { x: to.x - R, y: to.y - R };
  const tiles = { x: 0, y: 0 }, directions: { x?: number; y?: number } = {};
  for (const rail of route) {
    const side = rail.value === R ? -1 : 1;
    const direction = directions[rail.axis] ?? side;
    if (directions[rail.axis] !== undefined) {
      const increasingPhysical = (tiles[rail.axis] & 1) === 0;
      const expectedSide = (direction > 0) === increasingPhysical ? 1 : -1;
      if (side !== expectedSide) return null;
    } else directions[rail.axis] = direction;
    tiles[rail.axis] += direction;
  }
  const image = {
    x: (tiles.x & 1) === 0 ? tiles.x * lengths.x + end.x : (tiles.x + 1) * lengths.x - end.x,
    y: (tiles.y & 1) === 0 ? tiles.y * lengths.y + end.y : (tiles.y + 1) * lengths.y - end.y,
  };
  const delta = { x: image.x - start.x, y: image.y - start.y };
  const currentTiles = { x: 0, y: 0 };
  let previousT = 0;
  const points: Point[] = [];
  for (const rail of route) {
    const direction = directions[rail.axis]!;
    const plane = direction > 0 ? (currentTiles[rail.axis] + 1) * lengths[rail.axis] : currentTiles[rail.axis] * lengths[rail.axis];
    const denominator = delta[rail.axis];
    if (Math.abs(denominator) < 1e-8) return null;
    const t = (plane - start[rail.axis]) / denominator;
    if (t <= previousT + 1e-6 || t >= 1) return null;
    const unfolded = { x: start.x + t * delta.x, y: start.y + t * delta.y };
    const folded = {
      x: (currentTiles.x & 1) === 0 ? unfolded.x - currentTiles.x * lengths.x : (currentTiles.x + 1) * lengths.x - unfolded.x,
      y: (currentTiles.y & 1) === 0 ? unfolded.y - currentTiles.y * lengths.y : (currentTiles.y + 1) * lengths.y - unfolded.y,
    };
    const point = { x: folded.x + R, y: folded.y + R };
    const onCushion = rail.axis === 'x'
      ? point.y >= 0.115 && point.y <= TABLE.h - 0.115
      : point.x >= 0.115 && point.x <= TABLE.w - 0.115 && Math.abs(point.x - TABLE.w / 2) >= 0.105;
    if (!onCushion) return null;
    points.push(point);
    currentTiles[rail.axis] += direction;
    previousT = t;
  }
  return [points[0], points[1]];
}
export function generateRoutes(req: SearchRequest): Route[] {
  const balls = req.balls, cue = balls.find(b => b.id === 0)!, target = balls.find(b => b.id === req.target)!;
  const pocket = POCKETS[req.pocket], legal = legalFirstIds(balls, req.rules), routes: Route[] = [];
  const add = (from: Point, contact: Point, label: string, length: number, cut: number, kind: Shot['kind'] = 'normal') => {
    if (cut > 0.12 || kind === 'masse') routes.push({ angle: Math.atan2(contact.y - from.y, contact.x - from.x), label, length, cut, contact, kind });
  };
  const directContact = ghost(target, pocket);
  const targetClear = segmentClear(balls, target.x, target.y, pocket.x, pocket.y, [0, target.id], 2 * R);
  if (legal.includes(target.id)) {
    if (targetClear && segmentClear(balls, cue.x, cue.y, directContact.x, directContact.y, [0, target.id]))
      add(cue, directContact, '直接进球', dist(cue, target) + dist(target, pocket), cutCos(cue, directContact, target, pocket));
    // A blocked planar cue path must still seed jump and curved shots. Actual
    // first contact, airborne clearance and pocketing are decided by physics.
    if (targetClear) for (const kind of ['jump', 'masse'] as const)
      add(cue, directContact, '直接进球', dist(cue, target) + dist(target, pocket), cutCos(cue, directContact, target, pocket), kind);
    for (const rail of rails) {
      const p = bounce(target, pocket, rail);
      if (p && segmentClear(balls, target.x, target.y, p.x, p.y, [0, target.id]) && segmentClear(balls, p.x, p.y, pocket.x, pocket.y, [0, target.id])) {
        const contact = ghost(target, p);
        if (segmentClear(balls, cue.x, cue.y, contact.x, contact.y, [0, target.id]))
          add(cue, contact, `单库翻袋 · ${rail.name}`, dist(cue, target) + dist(target, p) + dist(p, pocket), cutCos(cue, contact, target, p));
      }
      const kick = bounce(cue, directContact, rail);
      if (kick && targetClear && segmentClear(balls, cue.x, cue.y, kick.x, kick.y, [0, target.id]) && segmentClear(balls, kick.x, kick.y, directContact.x, directContact.y, [0, target.id]))
        add(cue, kick, `单库解球 · ${rail.name}`, dist(cue, kick) + dist(kick, target) + dist(target, pocket), cutCos(kick, directContact, target, pocket));
    }
    for (const firstRail of rails) for (const secondRail of rails) {
      if (firstRail === secondRail) continue;
      const routeRails: [Rail, Rail] = [firstRail, secondRail];
      const banks = twoCushionBounces(target, pocket, routeRails);
      if (!banks) continue;
      const [firstBank, secondBank] = banks, contact = ghost(target, firstBank);
      if (segmentClear(balls, target.x, target.y, firstBank.x, firstBank.y, [0, target.id])
        && segmentClear(balls, firstBank.x, firstBank.y, secondBank.x, secondBank.y, [0, target.id])
        && segmentClear(balls, secondBank.x, secondBank.y, pocket.x, pocket.y, [0, target.id])
        && segmentClear(balls, cue.x, cue.y, contact.x, contact.y, [0, target.id]))
        add(cue, contact, `双库翻袋 · ${firstRail.name} → ${secondRail.name}`,
          dist(cue, target) + dist(target, firstBank) + dist(firstBank, secondBank) + dist(secondBank, pocket),
          cutCos(cue, contact, target, firstBank));

      const cueBanks = twoCushionBounces(cue, directContact, routeRails);
      if (cueBanks) {
        const [firstBank, secondBank] = cueBanks;
        if (segmentClear(balls, cue.x, cue.y, firstBank.x, firstBank.y, [0, target.id])
          && segmentClear(balls, firstBank.x, firstBank.y, secondBank.x, secondBank.y, [0, target.id])
          && segmentClear(balls, secondBank.x, secondBank.y, directContact.x, directContact.y, [0, target.id]))
          add(cue, firstBank, `双库解球 · ${firstRail.name} → ${secondRail.name}`,
            dist(cue, firstBank) + dist(firstBank, secondBank) + dist(secondBank, directContact) + dist(target, pocket),
            cutCos(cue, firstBank, target, pocket));
      }
    }
  }
  // Legal first object strikes the selected target toward the called pocket.
  if (targetClear) for (const first of balls) {
    if (first.id === target.id || first.pocketed || !legal.includes(first.id)) continue;
    const contact = ghost(first, directContact), c1 = cutCos(cue, contact, first, directContact), c2 = cutCos(first, directContact, target, pocket);
    if (c2 > 0.2 && segmentClear(balls, cue.x, cue.y, contact.x, contact.y, [0, first.id])
      && segmentClear(balls, first.x, first.y, directContact.x, directContact.y, [0, first.id, target.id]))
      add(cue, contact, `组合球 · ${first.id} → ${target.id}`, dist(cue, first) + dist(first, target) + dist(target, pocket), c1 * c2);
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
export function planScore(plan: Pick<Plan, 'complexity' | 'position' | 'robustness'> & Partial<Pick<Plan, 'route' | 'shot' | 'outcome'>>, sort: SortMode): number {
  if (sort === 'fancy') {
    const events = plan.outcome?.events ?? [];
    const affected = new Set<number>();
    for (const event of events) {
      if (event.type === 'contact' || event.type === 'rail' || event.type === 'pocket' || event.type === 'off') {
        affected.add(event.ball);
        if (event.type === 'contact' && event.other !== undefined) affected.add(event.other);
      }
    }
    const contacts = events.filter(event => event.type === 'contact').length;
    const rails = events.filter(event => event.type === 'rail').length;
    const shot = plan.shot;
    const technique = shot ? (shot.kind === 'masse' ? 100 : shot.kind === 'jump' ? 78 : 0)
      + Math.min(30, shot.elevation * 0.35 + Math.hypot(shot.tipX, shot.tipY) * 24) : 0;
    const routeStyle = /组合球/.test(plan.route ?? '') ? 100 : /翻袋|解球/.test(plan.route ?? '') ? 72 : 0;
    const impact = Math.min(100, Math.max(0, affected.size - 2) * 20);
    const eventComplexity = Math.min(100, Math.max(0, contacts - 1) * 22 + rails * 12);
    return plan.complexity * 0.4 + impact * 0.28 + technique * 0.17
      + Math.max(routeStyle, eventComplexity) * 0.15;
  }
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
  return a.shot.kind !== b.shot.kind || Math.abs(a.shot.elevation - b.shot.elevation) > 12
    || a.route !== b.route || dist(cueA, cueB) > 0.17 || Math.abs(a.shot.tipY - b.shot.tipY) > 0.45 || Math.abs(a.shot.tipX - b.shot.tipX) > 0.45;
}
// Keep displayed parameters identical to the values the physics engine uses.
function normalizeShot(shot: Shot, unlimitedPower = false, maxPower = EXTENDED_POWER_START): Shot {
  const bounds = shot.kind === 'normal' ? [0, 34] : shot.kind === 'jump' ? [20, 78] : [36, 82];
  const len = Math.hypot(shot.tipX, shot.tipY), scale = len > 0.85 ? 0.85 / len : 1;
  return { ...shot, ...(unlimitedPower ? { unlimitedPower: true } : shot.unlimitedPower !== undefined ? { unlimitedPower: false } : {}), power: Math.min(shotPower({ power: shot.power, unlimitedPower }), unlimitedPower ? maxPower : 100), elevation: clamp(shot.elevation, bounds[0], bounds[1]),
    tipX: shot.tipX * scale, tipY: shot.tipY * scale };
}
export function shotKey(shot: Shot): string {
  return [shot.kind, shot.angle, shot.power, shot.tipX, shot.tipY, shot.elevation, !!shot.unlimitedPower].map(v => typeof v === 'number' ? v.toFixed(6) : v).join(':');
}
export function searchPowerLimit(req: Pick<SearchRequest, 'unlimitedPower' | 'searchPowerMax'>): number {
  return req.unlimitedPower ? Math.max(EXTENDED_POWER_START, Number.isFinite(req.searchPowerMax) ? req.searchPowerMax! : EXTENDED_POWER_START) : 100;
}
export function coarseShots(route: Route, options: Pick<SearchRequest, 'unlimitedPower' | 'searchPowerMax'> = {}): Shot[] {
  const shots: Shot[] = [];
  const maxPower = searchPowerLimit(options);
  const add = (offset: number, power: number, tipX: number, tipY: number, elevation: number) =>
    shots.push(normalizeShot({ angle: route.angle + offset, power, tipX, tipY, elevation, kind: route.kind }, !!options.unlimitedPower, maxPower));
  if (route.kind === 'normal') {
    const spins = [[0, 0], [0, -0.65], [0, 0.65], [-0.45, 0], [0.45, 0], [-0.4, -0.45], [0.4, -0.45], [-0.4, 0.45], [0.4, 0.45]];
    for (const offset of [0, -0.003, 0.003, -0.007, 0.007, -0.013, 0.013])
      for (const power of [12, 18, 24, 31, 40, 51, 64]) for (const [x, y] of spins) add(offset, power, x, y, 0);
    for (const e of [12, 24, 34]) for (const offset of [0, -0.007, 0.007])
      for (const power of [18, 31, 51]) for (const [x, y] of spins) add(offset, power, x, y, e);
  } else if (route.kind === 'jump') {
    for (const e of [28, 38, 48, 58, 68]) for (const power of [24, 32, 40, 48, 58, 70, 84, 100])
      for (const offset of [0, -0.004, 0.004, -0.012, 0.012]) for (const y of [0, -0.35, 0.35]) add(offset, power, 0, y, e);
  } else {
    // Sliding friction rotates an elevated, off-centre shot's planar velocity.
    // Seed both bending directions; simulations and refinement decide the aim.
    for (const e of [48, 60, 72, 82]) for (const x of [-0.7, -0.45, 0.45, 0.7]) for (const y of [-0.4, 0.2]) {
      const radians = e * Math.PI / 180;
      const bend = Math.atan2(x * (Math.sin(radians) - 0.022 * Math.cos(radians)), Math.cos(radians) * (1 + y));
      for (const factor of [0.35, 0.65, 1, 1.25]) for (const power of [18, 32, 48, 64, 82]) add(-bend * factor, power, x, y, e);
    }
  }
  if (options.unlimitedPower) {
    // Reuse each stroke's angle/spin/elevation families at additional energies.
    // Keep ordinary candidates intact; extended shots supplement them.
    const families = new Map<string, Shot>();
    for (const shot of shots) {
      if (route.kind === 'normal' && Math.abs(shot.angle - route.angle) > 0.0071) continue;
      families.set([shot.angle, shot.tipX, shot.tipY, shot.elevation].join(':'), shot);
    }
    const powers = new Set([82, 100, 125, 160, 220, 300, maxPower].filter(p => p <= maxPower));
    for (let power = 450; power < maxPower; power *= 1.5) powers.add(power);
    const existing = new Set(shots.map(shotKey));
    for (const power of powers) for (const family of families.values()) {
      const shot = { ...family, power };
      if (!existing.has(shotKey(shot))) { shots.push(shot); existing.add(shotKey(shot)); }
    }
  }
  return shots;
}
export function searchPlans(req: SearchRequest, onUpdate?: (u: SearchUpdate) => void, preparedGrids?: SearchGrid[]): Plan[] {
  const start = performance.now(); let checked = 0;
  const cue = req.balls.find(b => b.id === 0 && !b.pocketed), target = req.balls.find(b => b.id === req.target && !b.pocketed);
  if (!cue || !target || !POCKETS[req.pocket] || req.rules.breakShot) { onUpdate?.({ type: 'done', id: req.id, plans: [], checked, elapsed: 0 }); return []; }
  const candidates: Plan[] = [];
  const grids = preparedGrids ?? generateRoutes(req).map(route => ({ route, shots: coarseShots(route, req) }));
  const maxPower = searchPowerLimit(req);
  const total = grids.reduce((sum, grid) => sum + grid.shots.length, 0) + 1080 + 288;
  interface Seed { route: Route; shot: Shot; loss: number }
  const seeds: Record<Shot['kind'], Seed[]> = { normal: [], jump: [], masse: [] };
  const legal = legalFirstIds(req.balls, req.rules), seen = new Map<string, number>();
  const tryShot = (route: Route, input: Shot): Seed => {
    const shot = normalizeShot(input, !!req.unlimitedPower, maxPower);
    const key = `${shotKey(shot)}:${route.contact.x}:${route.contact.y}`;
    const cached = seen.get(key);
    if (cached !== undefined) return { route, shot, loss: cached };
    const world = new PhysicsWorld(req.balls, shot, false);
    const movingCue = world.balls.find(b => b.id === 0)!, movingTarget = world.balls.find(b => b.id === req.target)!;
    let nearContact = dist(cue, route.contact), nearPocket = dist(target, POCKETS[req.pocket]), eventCount = 0, invalid = false, firstChecked = false;
    while (!world.done) {
      world.step();
      nearContact = Math.min(nearContact, Math.hypot(movingCue.x - route.contact.x, movingCue.y - route.contact.y, movingCue.z - R));
      if (!movingTarget.pocketed) nearPocket = Math.min(nearPocket, dist(movingTarget, POCKETS[req.pocket]));
      for (; eventCount < world.events.length; eventCount++) {
        const e = world.events[eventCount];
        if (e.type === 'contact' && (e.ball === 0 || e.other === 0) && !firstChecked) {
          firstChecked = true;
          if (!legal.includes(e.ball === 0 ? e.other! : e.ball)) invalid = true;
        }
        if ((e.type === 'off' || e.type === 'pocket') && (e.ball === 0 || e.ball === req.target && (e.type === 'off' || e.pocket !== req.pocket))) invalid = true;
      }
      if (invalid) break;
      // If the cue has already settled before its first object-ball contact,
      // no later event can make this shot succeed. This is a common outcome
      // for coarse angle/power samples and avoids simulating the quiet tail.
      if (!firstChecked && movingCue.z <= R + 0.0002 && Math.abs(movingCue.vz) < 0.03
        && Math.hypot(movingCue.vx, movingCue.vy) < 0.012
        && Math.hypot(movingCue.wx, movingCue.wy, movingCue.wz) < 0.08) { world.done = true; break; }
    }
    const outcome = world.result(); checked++;
    if (checked % 30 === 0) onUpdate?.({ type: 'progress', id: req.id, checked, total, found: candidates.length });
    let loss = invalid || !outcome.settled ? 10 + nearContact : outcome.events.some(e => e.type === 'contact' && (e.ball === req.target || e.other === req.target))
      ? 0.1 + nearPocket : 2 + nearContact;
    if (!success(req, outcome)) { seen.set(key, loss); return { route, shot, loss }; }
    const contacts = outcome.events.filter(e => e.type === 'contact').length;
    const railsBeforePot = outcome.events.filter(e => e.type === 'rail' && e.time < outcome.events.find(e => e.type === 'pocket' && e.ball === req.target)!.time).length;
    const first = outcome.events.find(e => e.type === 'contact' && (e.ball === 0 || e.other === 0))!;
    const firstId = first.ball === 0 ? first.other! : first.ball;
    const targetPot = outcome.events.find(e => e.type === 'pocket' && e.ball === req.target)!;
    const targetRails = outcome.events.filter(e => e.type === 'rail' && e.ball === req.target && e.time < targetPot.time);
    const cueRails = outcome.events.filter(e => e.type === 'rail' && e.ball === 0 && e.time < first.time);
    const label = firstId !== req.target ? `组合球 · ${firstId} → ${req.target}` : cueRails.length ? `${cueRails.length}库解球 · ${cueRails[0].rail}${targetRails.length ? ' + 翻袋' : ''}` : targetRails.length ? `${targetRails.length}库翻袋 · ${targetRails[0].rail}` : '直接进球';
    const baseComplexity = firstId !== req.target ? 43 : targetRails.length ? 32 : cueRails.length ? 38 : 4;
    const complexity = clamp(baseComplexity + (shot.kind === 'jump' ? 24 : shot.kind === 'masse' ? 34 : 0) + shot.elevation * 0.18
      + Math.max(0, railsBeforePot - (targetRails.length || cueRails.length ? 1 : 0)) * 7
      + Math.max(0, contacts - (firstId !== req.target ? 2 : 1)) * 9 + Math.abs(shot.tipX) * 12 + Math.abs(shot.tipY) * 6 + Math.max(0, shot.power - 45) * 0.25, 0, 100);
    const ruling = adjudicate(req.balls, outcome.balls, outcome.events, { ...req.rules, calledPocket: req.pocket });
    const evaluatedRules: RuleState = { ...req.rules, groups: [...req.rules.groups] };
    if (ruling.assigned) evaluatedRules.groups[req.rules.player] = ruling.assigned;
    const position = ruling.winner === req.rules.player ? 100 : req.rules.mode === 'match' && !ruling.continuation
      ? 100 - positionScore(outcome.balls, { ...evaluatedRules, player: req.rules.player === 0 ? 1 : 0 }, req.target)
      : positionScore(outcome.balls, evaluatedRules, req.target);
    const plan: Plan = { id: `${req.id}-${checked}`, shot, route: (shot.kind === 'jump' ? '跳球 · ' : shot.kind === 'masse' ? '扎杆 · ' : '') + label, chain: describeEventChain(outcome.events), complexity, position, robustness: 0, score: 0, outcome };
    plan.score = planScore(plan, req.sort); candidates.push(plan);
    loss = -1 - plan.score / 100;
    seen.set(key, loss);
    return { route, shot, loss };
  };
  const distinctSeed = (a: Seed, b: Seed) => Math.abs(a.shot.angle - b.shot.angle) > 0.04 || Math.abs(a.shot.power - b.shot.power) > 12
    || Math.abs(a.shot.elevation - b.shot.elevation) > 9 || Math.hypot(a.shot.tipX - b.shot.tipX, a.shot.tipY - b.shot.tipY) > 0.3;
  for (const { route, shots } of grids) for (const shot of shots) {
    const seed = tryShot(route, shot), pool = seeds[shot.kind];
    pool.push(seed); pool.sort((a, b) => a.loss - b.loss);
    const kept: Seed[] = [];
    for (const s of pool) { if (kept.every(p => distinctSeed(s, p))) kept.push(s); if (kept.length === 6) break; }
    seeds[shot.kind] = kept;
  }
  // Refine unsuccessful near misses as well as legal shots. Elevation is a
  // search coordinate, never copied from the player's manual controls.
  for (const pool of Object.values(seeds)) for (let seed of pool) {
    for (let level = 0; level < 3; level++) for (let pass = 0; pass < 2; pass++) {
      const steps = { angle: (seed.shot.kind === 'normal' ? [0.012, 0.004, 0.0013] : [0.04, 0.012, 0.003])[level],
        power: [7, 3, 1][level] * Math.max(1, seed.shot.power / 100), tipX: [0.16, 0.07, 0.025][level], tipY: [0.16, 0.07, 0.025][level], elevation: [6, 2.5, 0.8][level] };
      const previous = seed;
      for (const parameter of Object.keys(steps) as (keyof typeof steps)[]) {
        const centre = seed;
        for (const direction of [-1, 1]) {
          const next = tryShot(seed.route, { ...centre.shot, [parameter]: centre.shot[parameter] + direction * steps[parameter] });
          if (next.loss < seed.loss) seed = next;
        }
      }
      if (seed === previous) break;
    }
  }
  // Keep distinct trajectories/leave positions before doing expensive perturbation validation.
  const finalists: Plan[] = [];
  // Preserve a representative of each successful stroke before filling the
  // remaining slots by score, so special strokes survive normal-shot crowds.
  for (const kind of ['normal', 'jump', 'masse'] as const) {
    const best = candidates.filter(p => p.shot.kind === kind).sort((a, b) => b.score - a.score)[0];
    if (best) finalists.push(best);
  }
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (finalists.every(p => diverse(p, candidate))) finalists.push(candidate);
    if (finalists.length >= 12) break;
  }
  for (const plan of finalists) {
    let hits = 0;
    const variations = [
      { angle: -0.0015 }, { angle: 0.0015 }, { angle: -0.003 }, { angle: 0.003 },
      { power: -1.5 }, { power: 1.5 }, { tipX: -0.035 }, { tipX: 0.035 }, { tipY: -0.035 }, { tipY: 0.035 },
      { elevation: -1.5 }, { elevation: 1.5 },
    ];
    const tested = new Set([shotKey(plan.shot)]);
    for (const v of variations) {
      const [parameter, delta] = Object.entries(v)[0] as ['angle' | 'power' | 'tipX' | 'tipY' | 'elevation', number];
      let perturbed = normalizeShot({ ...plan.shot, [parameter]: plan.shot[parameter] + delta }, !!req.unlimitedPower, maxPower);
      // At a parameter limit, use a distinct inward perturbation instead of
      // counting the unchanged successful shot as extra tolerance evidence.
      if (tested.has(shotKey(perturbed))) perturbed = normalizeShot({ ...plan.shot, [parameter]: plan.shot[parameter] - 2 * delta }, !!req.unlimitedPower, maxPower);
      tested.add(shotKey(perturbed));
      if (success(req, simulate(req.balls, perturbed))) hits++; checked++;
    }
    plan.robustness = hits / variations.length * 100;
    plan.score = planScore(plan, req.sort);
    plan.outcome = simulate(req.balls, plan.shot, true);
    onUpdate?.({ type: 'progress', id: req.id, checked, total, found: finalists.length });
  }
  const ranked = finalists.sort((a, b) => b.score - a.score);
  const representatives = (['normal', 'jump', 'masse'] as const).map(kind => ranked.find(p => p.shot.kind === kind)).filter((p): p is Plan => !!p);
  const plans = [...representatives, ...ranked.filter(p => !representatives.includes(p)).slice(0, 8 - representatives.length)].sort((a, b) => b.score - a.score);
  onUpdate?.({ type: 'done', id: req.id, plans, checked, elapsed: performance.now() - start });
  return plans;
}
