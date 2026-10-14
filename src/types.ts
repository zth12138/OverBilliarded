export type Group = 'solid' | 'stripe';
export type ShotKind = 'normal' | 'jump' | 'masse';
export interface Ball {
  id: number; x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number;
  // Accumulated local-to-world orientation, independent of angular velocity.
  qx: number; qy: number; qz: number; qw: number;
  pocketed: boolean;
}
export interface Shot {
  angle: number; power: number; tipX: number; tipY: number;
  elevation: number; kind: ShotKind;
}
export interface PhysicsEvent {
  type: 'contact' | 'rail' | 'pocket' | 'off'; time: number;
  ball: number; other?: number; pocket?: number; rail?: string;
  // Impact speed and entry pose are presentation data, never simulation inputs.
  speed?: number; entry?: Ball;
}
export interface TrailPoint { x: number; y: number; z: number; t: number }
export interface Simulation {
  balls: Ball[]; events: PhysicsEvent[]; time: number;
  trails: Record<number, TrailPoint[]>; settled: boolean;
}
export interface RuleState {
  mode: 'practice' | 'match'; player: 0 | 1;
  groups: [Group | null, Group | null]; breakShot: boolean;
  ballInHand: boolean; winner: 0 | 1 | null; calledPocket: number | null;
  shots: number; message: string;
}
export interface Adjudication {
  foul: boolean; reasons: string[]; winner: 0 | 1 | null;
  continuation: boolean; assigned: Group | null; respotEight: boolean;
}
export type SortMode = 'balanced' | 'simple' | 'position' | 'robust';
export interface Plan {
  id: string; shot: Shot; route: string; chain: string[];
  complexity: number; position: number; robustness: number; score: number;
  outcome: Simulation;
}
export interface SearchRequest {
  id: number; balls: Ball[]; rules: RuleState;
  target: number; pocket: number; sort: SortMode;
  // Optional WebGPU coarse-screening. The CPU search remains the fallback.
  useGpu?: boolean;
}
export type SearchUpdate =
  | { type: 'backend'; id: number; backend: 'cpu' | 'gpu'; message: string }
  | { type: 'progress'; id: number; checked: number; total: number; found: number }
  | { type: 'done'; id: number; plans: Plan[]; checked: number; elapsed: number }
  | { type: 'error'; id: number; message: string };
