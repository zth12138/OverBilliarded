import type { Adjudication, Ball, Group, PhysicsEvent, RuleState } from './types';
import { ball, legalPlacement, TABLE } from './physics';

export const groupOf = (id: number): Group | null => id >= 1 && id <= 7 ? 'solid' : id >= 9 && id <= 15 ? 'stripe' : null;
export const groupName = (group: Group | null) => group === 'solid' ? '全色' : group === 'stripe' ? '花色' : '未分组';
export const pocketName = (id: number) => ['左上', '中上', '右上', '左下', '中下', '右下'][id] ?? '未知';
export function freshRules(mode: RuleState['mode'] = 'practice'): RuleState {
  return { mode, player: 0, groups: [null, null], breakShot: true, ballInHand: false, winner: null, calledPocket: null, shots: 0, message: '开球 · 开球进球不决定分组' };
}
export function remainingFor(group: Group, balls: Ball[]) { return balls.filter(b => !b.pocketed && groupOf(b.id) === group).length; }
export function legalFirstIds(balls: Ball[], state: RuleState): number[] {
  const group = state.groups[state.player];
  if (state.breakShot) return balls.filter(b => !b.pocketed && b.id !== 0).map(b => b.id);
  if (!group) return balls.filter(b => !b.pocketed && groupOf(b.id)).map(b => b.id);
  if (remainingFor(group, balls) === 0) return [8];
  return balls.filter(b => !b.pocketed && groupOf(b.id) === group).map(b => b.id);
}
export function adjudicate(before: Ball[], after: Ball[], events: PhysicsEvent[], state: RuleState): Adjudication {
  const reasons: string[] = [];
  const firstIndex = events.findIndex(e => e.type === 'contact' && (e.ball === 0 || e.other === 0));
  const firstEvent = events[firstIndex];
  // Equal timestamps can be genuine simultaneous impacts (e.g. a frozen ball).
  // Preserve their causal order instead of crediting a rail before first contact.
  const afterFirst = (e: PhysicsEvent, index: number) => !!firstEvent && (e.time > firstEvent.time || e.time === firstEvent.time && index > firstIndex);
  const first = firstEvent ? firstEvent.ball === 0 ? firstEvent.other : firstEvent.ball : null;
  if (first == null) reasons.push('空杆：白球未碰到目标球');
  else if (!legalFirstIds(before, state).includes(first)) reasons.push(first === 8 ? '尚不能首先击打黑八' : '首先碰到对方球');
  const pots = events.filter(e => e.type === 'pocket');
  if (pots.some(e => e.ball === 0)) reasons.push('白球落袋');
  if (events.some(e => e.type === 'off')) reasons.push('球跳出台面');
  if (firstEvent && !state.breakShot && !events.some((e, i) => (e.type === 'rail' || e.type === 'pocket') && afterFirst(e, i))) reasons.push('碰球后没有进球或碰库');
  if (state.breakShot) {
    const rails = new Set(events.filter((e, i) => e.type === 'rail' && e.ball !== 0 && afterFirst(e, i)).map(e => e.ball));
    if (!pots.some(e => e.ball !== 0) && rails.size < 4) reasons.push('开球不足：需进球或至少四颗目标球碰库');
  }
  const blackPot = pots.find(e => e.ball === 8); const blackOff = events.some(e => e.type === 'off' && e.ball === 8); const group = state.groups[state.player];
  let winner: 0 | 1 | null = null;
  if ((blackPot || blackOff) && !state.breakShot) {
    const eligible = !!group && remainingFor(group, before) === 0; const called = state.calledPocket !== null && blackPot?.pocket === state.calledPocket;
    winner = eligible && called && !reasons.length && !blackOff ? state.player : state.player === 0 ? 1 : 0;
    if (!eligible) reasons.push('提前打进或打飞黑八'); else if (!called) reasons.push('黑八未进入指定洞口');
  }
  let assigned: Group | null = null;
  if (!state.breakShot && !group && !reasons.length) {
    const groups = new Set(pots.map(e => groupOf(e.ball)).filter((g): g is Group => g !== null));
    if (groups.size === 1) assigned = [...groups][0];
  }
  const continuation = !reasons.length && pots.some(e => e.ball !== 0 && (state.breakShot || e.ball !== 8 && (!group || groupOf(e.ball) === group)));
  return { foul: reasons.length > 0, reasons, winner, continuation, assigned, respotEight: state.breakShot && (!!blackPot || blackOff) };
}
export function finishTurn(before: Ball[], after: Ball[], events: PhysicsEvent[], state: RuleState): RuleState {
  const ruling = adjudicate(before, after, events, state); const next: RuleState = { ...state, groups: [...state.groups], shots: state.shots + 1, breakShot: false, ballInHand: ruling.foul && ruling.winner === null, winner: ruling.winner, calledPocket: null };
  if (ruling.respotEight) respot(after, 8);
  if (ruling.assigned) { next.groups[state.player] = ruling.assigned; next.groups[state.player === 0 ? 1 : 0] = ruling.assigned === 'solid' ? 'stripe' : 'solid'; }
  const turnChanges = ruling.foul || !ruling.continuation;
  if (state.mode === 'match' && turnChanges && ruling.winner === null) next.player = state.player === 0 ? 1 : 0;
  if (ruling.foul && ruling.winner === null) next.message = `${ruling.reasons.join('；')} · ${state.mode === 'match' ? `玩家 ${next.player + 1}` : '你'}获得全台自由球`;
  else if (ruling.winner !== null) next.message = `玩家 ${ruling.winner + 1} 获胜 · ${ruling.reasons.join('；') || '黑八合法入袋'}`;
  else if (ruling.respotEight) next.message = '开球黑八入袋或离台，重置黑八' + (ruling.continuation ? ' · 继续击球' : ' · 换人击球');
  else if (ruling.assigned) next.message = `分组确定：${groupName(ruling.assigned)} · 继续击球`;
  else next.message = ruling.continuation ? '合法进球 · 继续击球' : state.mode === 'match' ? `换人 · 玩家 ${next.player + 1} 击球` : '本杆结束 · 可以继续练习';
  return next;
}
export function respot(balls: Ball[], id: number) {
  let existing = balls.find(b => b.id === id); if (!existing) { existing = ball(id, TABLE.w * 0.75, TABLE.h / 2); balls.push(existing); }
  for (let distance = 0; distance < TABLE.w; distance += TABLE.r * 2 + 0.002) for (const direction of [1, -1]) {
    const x = TABLE.w * 0.75 + direction * distance, y = TABLE.h / 2;
    if (legalPlacement(balls, id, x, y)) { Object.assign(existing, ball(id, x, y)); return; }
  }
  for (let y = 0.1; y < TABLE.h - 0.1; y += 0.065) for (let x = 0.1; x < TABLE.w - 0.1; x += 0.065) if (legalPlacement(balls, id, x, y)) { Object.assign(existing, ball(id, x, y)); return; }
}
export function describeEventChain(events: PhysicsEvent[]): string[] {
  const name = (id: number) => id === 0 ? '白球' : `${id}号球`;
  return ['白球出杆', ...events.map(e => e.type === 'contact' ? `${name(e.ball)}碰${name(e.other!)}` : e.type === 'rail' ? `${name(e.ball)}碰${e.rail}` : e.type === 'pocket' ? `${name(e.ball)}进${pocketName(e.pocket!)}袋` : `${name(e.ball)}离台`)];
}
