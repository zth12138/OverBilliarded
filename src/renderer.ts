import { CUSHIONS, POCKETS, PhysicsWorld, TABLE } from './physics';
import type { Ball, Plan, Shot, Simulation } from './types';
import { BallSurfaceRenderer } from './ball-surface';
import { pocketPose, type CuePose, type PocketFall } from './shot-feedback';

export { COLORS } from './ball-surface';
const CUE_LENGTH = 1.45;
export interface RenderState {
  balls: Ball[]; shot: Shot; target: number; pocket: number;
  aim: boolean; positionPreview: boolean; cueMarks: boolean; moving: boolean; edit: boolean; placeCue: boolean;
  preview: Simulation | null; selected: Plan | null;
  pointer: { x: number; y: number } | null;
  cuePose?: CuePose | null; pocketFalls?: PocketFall[];
}
export class TableRenderer {
  ctx: CanvasRenderingContext2D;
  width = 0; height = 0; scale = 1; ox = 0; oy = 0;
  private observer: ResizeObserver;
  private surfaces = new BallSurfaceRenderer();
  private previewKey = '';
  private previewResult: Simulation | null = null;
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas); this.resize();
  }
  resize() {
    const box = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = box.width; this.height = box.height;
    this.canvas.width = Math.round(box.width * dpr); this.canvas.height = Math.round(box.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.max(0.01, Math.min((this.width - 108) / TABLE.w, (this.height - 108) / TABLE.h));
    this.ox = (this.width - TABLE.w * this.scale) / 2; this.oy = (this.height - TABLE.h * this.scale) / 2;
  }
  point(clientX: number, clientY: number) {
    const box = this.canvas.getBoundingClientRect();
    return { x: (clientX - box.left - this.ox) / this.scale, y: (clientY - box.top - this.oy) / this.scale };
  }
  screen(x: number, y: number) { return { x: this.ox + x * this.scale, y: this.oy + y * this.scale }; }
  private rounded(x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
    const c = this.ctx; c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill();
  }
  draw(s: RenderState) {
    // ResizeObserver can briefly report a zero-size canvas during layout changes.
    if (this.width <= 108 || this.height <= 108) return;
    const c = this.ctx, scale = this.scale, W = TABLE.w * scale, H = TABLE.h * scale, x = this.ox, y = this.oy;
    c.clearRect(0, 0, this.width, this.height);
    c.save(); c.shadowColor = '#071510b8'; c.shadowBlur = 28; c.shadowOffsetY = 18;
    this.rounded(x - 40, y - 40, W + 80, H + 80, 28, '#302b25'); c.restore();
    const wood = c.createLinearGradient(0, y - 40, 0, y + H + 40); wood.addColorStop(0, '#8a6d55'); wood.addColorStop(0.16, '#5f4a3b'); wood.addColorStop(0.48, '#382f2a'); wood.addColorStop(0.83, '#6b5140'); wood.addColorStop(1, '#8a6d55');
    this.rounded(x - 39, y - 39, W + 78, H + 78, 27, wood);
    c.save(); c.beginPath(); c.roundRect(x - 39, y - 39, W + 78, H + 78, 27); c.clip();
    c.globalAlpha = 0.16; c.strokeStyle = '#d9b58a'; c.lineWidth = 1;
    for (let i = -2; i < 18; i++) { const gy = y - 35 + i * 24; c.beginPath(); c.moveTo(x - 48, gy); c.bezierCurveTo(x + W * 0.24, gy - 5, x + W * 0.62, gy + 5, x + W + 46, gy - 1); c.stroke(); }
    c.globalAlpha = 0.22; c.strokeStyle = '#211b18';
    c.beginPath(); c.moveTo(x - 28, y - 10); c.lineTo(x + W + 28, y - 10); c.stroke();
    c.beginPath(); c.moveTo(x - 28, y + H + 10); c.lineTo(x + W + 28, y + H + 10); c.stroke(); c.restore();
    c.beginPath(); c.roundRect(x - 39, y - 39, W + 78, H + 78, 27); c.strokeStyle = '#b28d6d88'; c.lineWidth = 1.5; c.stroke();
    this.rounded(x - 26, y - 26, W + 52, H + 52, 17, '#082c27');
    const cloth = c.createRadialGradient(x + W * 0.38, y + H * 0.34, 0, x + W * 0.5, y + H * 0.5, Math.max(W, H) * 0.72); cloth.addColorStop(0, '#2d8d74'); cloth.addColorStop(0.58, '#21715f'); cloth.addColorStop(1, '#124d43');
    this.rounded(x - 3, y - 3, W + 6, H + 6, 8, cloth);
    c.save(); c.beginPath(); c.rect(x, y, W, H); c.clip();
    c.globalAlpha = 0.045; c.fillStyle = '#d8f0dd';
    for (let iy = y; iy < y + H; iy += 4) for (let ix = x + (Math.round(iy) % 3); ix < x + W; ix += 5) c.fillRect(ix, iy, 1, 1);
    c.globalAlpha = 0.035; c.strokeStyle = '#bde6d044'; c.lineWidth = 1;
    for (let iy = y + 2; iy < y + H; iy += 7) { c.beginPath(); c.moveTo(x, iy); c.lineTo(x + W, iy + 3); c.stroke(); }
    c.restore();
    c.strokeStyle = '#c9e5cc22'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + W / 4, y); c.lineTo(x + W / 4, y + H); c.stroke();
    for (const px of [0.25, 0.5, 0.75]) { c.beginPath(); c.arc(x + W * px, y + H / 2, 2, 0, Math.PI * 2); c.fillStyle = '#c4d7be65'; c.fill(); }
    for (const seg of CUSHIONS.slice(0, 6)) {
      const a = this.screen(seg.ax, seg.ay), b = this.screen(seg.bx, seg.by);
      c.lineCap = 'round'; c.lineWidth = 22; c.strokeStyle = '#082f2a';
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.lineWidth = 16; c.strokeStyle = '#155745'; c.stroke();
      c.lineWidth = 2; c.strokeStyle = '#76ab8b55'; c.stroke();
      c.lineWidth = 1; c.strokeStyle = '#092d2855'; c.beginPath(); c.moveTo(a.x, a.y + 7); c.lineTo(b.x, b.y + 7); c.stroke();
    }
    for (let i = 0; i < POCKETS.length; i++) {
      const p = this.screen(POCKETS[i].x, POCKETS[i].y), selected = i === s.pocket;
      c.beginPath(); c.arc(p.x, p.y, 0.073 * scale, 0, Math.PI * 2); c.fillStyle = '#ad916b'; c.fill();
      c.beginPath(); c.arc(p.x, p.y, 0.067 * scale, 0, Math.PI * 2); c.fillStyle = '#30271e'; c.fill();
      const hole = c.createRadialGradient(p.x - 0.018 * scale, p.y - 0.02 * scale, 0, p.x, p.y, 0.061 * scale); hole.addColorStop(0, '#000000'); hole.addColorStop(0.72, '#061211'); hole.addColorStop(1, '#1b3b31');
      c.beginPath(); c.arc(p.x, p.y, 0.061 * scale, 0, Math.PI * 2); c.fillStyle = hole; c.fill();
      c.beginPath(); c.arc(p.x, p.y, 0.069 * scale, Math.PI * 1.06, Math.PI * 1.82); c.strokeStyle = '#dfc79599'; c.lineWidth = 1.5; c.stroke();
      if (selected) { c.strokeStyle = '#e9c277'; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.arc(p.x, p.y, 0.082 * scale, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
      const ly = POCKETS[i].y < TABLE.h / 2 ? p.y - 26 : p.y + 30;
      c.fillStyle = selected ? '#dfb875' : '#99978b'; c.font = '10px "Microsoft YaHei", sans-serif'; c.textAlign = 'center'; c.fillText(POCKETS[i].name, p.x, ly);
    }
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      for (const dy of [-31, H + 31]) { c.save(); c.translate(x + W * i / 8, y + dy); c.rotate(Math.PI / 4); c.fillStyle = '#c7b79a'; c.fillRect(-2.4, -2.4, 4.8, 4.8); c.restore(); }
    }
    if (s.preview && !s.moving) this.trails(s.preview, s.target);
    else if (s.positionPreview && !s.moving && !s.edit && !s.placeCue) this.trails(this.positionPreview(s.balls, s.shot), s.target);
    else if (s.aim && !s.moving && !s.edit && !s.placeCue) this.aim(s.balls, s.shot);
    const target = s.balls.find(b => b.id === s.target && !b.pocketed);
    if (target && !s.moving) {
      const p = this.screen(target.x, target.y); c.lineWidth = 1.4; c.strokeStyle = '#edcf8f'; c.setLineDash([3, 3]);
      c.beginPath(); c.arc(p.x, p.y, TABLE.r * scale + 6, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    for (const b of s.balls.filter(b => !b.pocketed).sort((a, b) => a.z - b.z)) this.drawBall(b, s.cueMarks);
    for (const fall of s.pocketFalls ?? []) this.drawPocketFall(fall, s.cueMarks);
    if (s.cuePose) this.drawCue(s.cuePose);
    else if (!s.moving && !s.edit && !s.placeCue) {
      const cue = s.balls.find(b => b.id === 0 && !b.pocketed);
      if (cue) this.drawCue({ ball: cue, shot: s.shot, offset: 0.065, opacity: 1 });
    }
    if (s.placeCue && s.pointer) { const p = this.screen(s.pointer.x, s.pointer.y); c.globalAlpha = 0.55; c.beginPath(); c.arc(p.x, p.y, TABLE.r * scale, 0, Math.PI * 2); c.fillStyle = '#f5f2e7'; c.fill(); c.globalAlpha = 1; }
    if (s.edit) {
      c.fillStyle = '#f3e7c0'; c.font = '11px "Microsoft YaHei", sans-serif'; c.textAlign = 'left'; c.fillText('摆球模式 · 拖动球改变位置', x + 13, y + H - 14);
    }
  }
  private drawBall(b: Ball, cueMarks: boolean) {
    const c = this.ctx, base = this.screen(b.x, b.y), lift = (b.z - TABLE.r) * this.scale * 0.6;
    const p = { x: base.x, y: base.y - lift }, r = TABLE.r * this.scale * (1 + Math.min(b.z - TABLE.r, 0.2) * 0.5);
    c.save(); c.beginPath(); c.ellipse(base.x + 2 + lift * 0.12, base.y + 3, r * (1 + lift / 60), r * 0.72, 0, 0, Math.PI * 2); c.fillStyle = `rgba(3,24,20,${Math.max(0.1, 0.4 - lift / 100)})`; c.fill();
    this.surfaces.draw(c, b, p.x, p.y, r, cueMarks);
    c.restore();
  }
  private aim(balls: Ball[], shot: Shot) {
    const cue = balls.find(b => b.id === 0 && !b.pocketed); if (!cue) return;
    const dx = Math.cos(shot.angle), dy = Math.sin(shot.angle); let distance = 4;
    let hit: Ball | null = null;
    for (const b of balls) {
      if (b.id === 0 || b.pocketed) continue;
      const px = b.x - cue.x, py = b.y - cue.y, along = px * dx + py * dy, perp2 = px * px + py * py - along * along;
      if (along > 0 && perp2 < (2 * TABLE.r) ** 2) {
        const t = along - Math.sqrt((2 * TABLE.r) ** 2 - perp2);
        if (t > 0 && t < distance) { distance = t; hit = b; }
      }
    }
    const boundary = [dx > 0 ? (TABLE.w - TABLE.r - cue.x) / dx : dx < 0 ? (TABLE.r - cue.x) / dx : 4,
      dy > 0 ? (TABLE.h - TABLE.r - cue.y) / dy : dy < 0 ? (TABLE.r - cue.y) / dy : 4].filter(t => t > 0);
    const rail = Math.min(...boundary); if (rail < distance) { distance = rail; hit = null; }
    const c = this.ctx, a = this.screen(cue.x, cue.y), end = this.screen(cue.x + dx * distance, cue.y + dy * distance);
    c.save(); c.strokeStyle = '#e8efdaae'; c.lineWidth = 1.3; c.setLineDash([6, 7]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(end.x, end.y); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.arc(end.x, end.y, TABLE.r * this.scale, 0, Math.PI * 2); c.strokeStyle = '#e8efda80'; c.stroke();
    if (hit) {
      const hx = hit.x - cue.x - dx * distance, hy = hit.y - cue.y - dy * distance, len = Math.hypot(hx, hy);
      const p = this.screen(hit.x, hit.y), q = this.screen(hit.x + hx / len * 0.32, hit.y + hy / len * 0.32);
      c.strokeStyle = '#eecb89'; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    }
    c.restore();
  }
  private drawPocketFall(fall: PocketFall, cueMarks: boolean) {
    const c = this.ctx, pose = pocketPose(fall), pocket = POCKETS[fall.pocket];
    const p = this.screen(pose.x, pose.y), hole = this.screen(pocket.x, pocket.y), r = pose.radius * this.scale;
    c.save();
    c.beginPath(); c.arc(hole.x, hole.y, 0.061 * this.scale, 0, Math.PI * 2); c.clip();
    c.globalAlpha = pose.opacity;
    this.surfaces.draw(c, fall.ball, p.x, p.y, r, cueMarks);
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fillStyle = `rgba(0,8,7,${pose.darkness})`; c.fill();
    c.restore();
  }
  private drawCue(pose: CuePose) {
    const c = this.ctx, shot = pose.shot, dx = Math.cos(shot.angle), dy = Math.sin(shot.angle);
    const cue = { x: pose.ball.x - dy * shot.tipX * TABLE.r, y: pose.ball.y + dx * shot.tipX * TABLE.r };
    const tipOffset = pose.offset, buttOffset = tipOffset + CUE_LENGTH;
    const start = this.screen(cue.x - dx * tipOffset, cue.y - dy * tipOffset), back = this.screen(cue.x - dx * buttOffset, cue.y - dy * buttOffset);
    c.save(); c.globalAlpha = pose.opacity;
    const cueGradient = c.createLinearGradient(start.x, start.y, back.x, back.y); cueGradient.addColorStop(0, '#f3e0b4'); cueGradient.addColorStop(0.08, '#f0d19a'); cueGradient.addColorStop(0.25, '#bd8b58'); cueGradient.addColorStop(0.62, '#8d603e'); cueGradient.addColorStop(1, '#4d3428');
    const cueLength = Math.hypot(back.x - start.x, back.y - start.y), nx = -(back.y - start.y) / cueLength, ny = (back.x - start.x) / cueLength;
    c.save(); c.globalAlpha *= 0.28; c.strokeStyle = '#050f0c'; c.lineWidth = 8; c.lineCap = 'round'; c.beginPath(); c.moveTo(start.x + 2, start.y + 3); c.lineTo(back.x + 2, back.y + 3); c.stroke(); c.restore();
    c.beginPath(); c.moveTo(start.x + nx * 1.7, start.y + ny * 1.7); c.lineTo(back.x + nx * 4.2, back.y + ny * 4.2); c.lineTo(back.x - nx * 4.2, back.y - ny * 4.2); c.lineTo(start.x - nx * 1.7, start.y - ny * 1.7); c.closePath(); c.fillStyle = cueGradient; c.fill();
    c.strokeStyle = '#f3d7a788'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(start.x + nx * 1.1, start.y + ny * 1.1); c.lineTo(back.x + nx * 3.1, back.y + ny * 3.1); c.stroke();
    const ferrule = this.screen(cue.x - dx * (tipOffset + 0.010), cue.y - dy * (tipOffset + 0.010)), tip = this.screen(cue.x - dx * (tipOffset + 0.017), cue.y - dy * (tipOffset + 0.017));
    c.lineWidth = 4.1; c.strokeStyle = '#efe7d0'; c.beginPath(); c.moveTo(ferrule.x, ferrule.y); c.lineTo(tip.x, tip.y); c.stroke();
    c.lineWidth = 2.1; c.strokeStyle = '#4a2f25'; c.beginPath(); c.moveTo(tip.x, tip.y); c.lineTo(start.x, start.y); c.stroke();
    c.lineWidth = 1.2; c.strokeStyle = '#fff2c866'; c.beginPath(); c.moveTo(start.x, start.y); c.lineTo(back.x, back.y); c.stroke(); c.restore();
  }
  private trails(sim: Simulation, target: number) {
    const c = this.ctx;
    for (const [id, points] of Object.entries(sim.trails)) {
      if (points.length < 2) continue;
      c.beginPath(); c.strokeStyle = Number(id) === 0 ? '#d8ecdcad' : Number(id) === target ? '#efc77ef0' : '#d7e8da48';
      c.lineWidth = Number(id) === target ? 2 : 1.4; c.setLineDash(Number(id) === 0 ? [4, 5] : []);
      points.forEach((p, i) => { const s = this.screen(p.x, p.y - (p.z - TABLE.r) * 0.6); if (!i) c.moveTo(s.x, s.y); else c.lineTo(s.x, s.y); }); c.stroke(); c.setLineDash([]);
    }
    const cue = sim.balls.find(b => b.id === 0 && !b.pocketed);
    if (cue) { const p = this.screen(cue.x, cue.y); c.strokeStyle = '#e6edcc'; c.lineWidth = 1; c.beginPath(); c.arc(p.x, p.y, TABLE.r * this.scale + 3, 0, Math.PI * 2); c.stroke(); c.font = '10px "Microsoft YaHei"'; c.fillStyle = '#e9edcf'; c.textAlign = 'center'; c.fillText('白球落点', p.x, p.y + 24); }
  }
  private positionPreview(balls: Ball[], shot: Shot): Simulation {
    const key = JSON.stringify([balls, shot]);
    if (key === this.previewKey && this.previewResult) return this.previewResult;
    const world = new PhysicsWorld(balls, shot, true);
    while (!world.done) world.step();
    this.previewKey = key; this.previewResult = world.result();
    return this.previewResult;
  }
}
