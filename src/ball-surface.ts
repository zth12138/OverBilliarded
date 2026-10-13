import { worldToLocal } from './rotation';
import type { Ball } from './types';

export const COLORS = ['#f5f2e7', '#dfaf21', '#2863ab', '#ca4c38', '#7650a0', '#da7437', '#2c8765', '#a63d4c', '#202522', '#dfaf21', '#2863ab', '#ca4c38', '#7650a0', '#da7437', '#2c8765', '#a63d4c'];
const WHITE = [246, 242, 229], INK = [27, 38, 33], RED = [182, 48, 40];
const BADGE_RADIUS = 0.47, BADGE_EDGE = Math.sqrt(1 - BADGE_RADIUS ** 2), STRIPE_EDGE = 0.54;
const LABEL_SIZE = 128;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface SurfaceView {
  right: [number, number, number];
  up: [number, number, number];
  normal: [number, number, number];
  key: string;
}

const TABLE_VIEW: SurfaceView = { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1], key: 'table' };

/** View the cue ball from behind the cue tip, with the spin controls as screen axes. */
export function cueBallView(angle: number, elevation = 0): SurfaceView {
  const a = Math.max(0, Math.min(82, elevation)) * Math.PI / 180;
  const ca = Math.cos(angle), sa = Math.sin(angle), ce = Math.cos(a), se = Math.sin(a);
  const normal: [number, number, number] = [-ce * ca, -ce * sa, -se];
  const right: [number, number, number] = [sa, -ca, 0];
  // The canvas y-axis points down, so its basis is the downward direction
  // seen from behind the cue tip. Keep it perpendicular to the view normal.
  const up: [number, number, number] = [se * ca, se * sa, -ce];
  const key = `cue:${right.map(n => n.toFixed(5)).join(',')}:${up.map(n => n.toFixed(5)).join(',')}:${normal.map(n => n.toFixed(5)).join(',')}`;
  return { right, up, normal, key };
}

interface SphereGrid {
  // Pixel offset, view normal, diffuse light, fixed specular reflection, coverage.
  samples: Float32Array;
}
interface Sprite {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; pixels: ImageData;
  orientation: string; size: number;
}

/** Orthographic ray/sphere projection. Only the camera-facing hemisphere is sampled. */
export class BallSurfaceRenderer {
  private grids = new Map<number, SphereGrid>();
  private labels = new Map<number, Uint8ClampedArray>();
  private sprites = new Map<number, Sprite>();
  private colors = COLORS.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));

  draw(ctx: CanvasRenderingContext2D, b: Ball, x: number, y: number, radius: number, cueMarks: boolean, view: SurfaceView = TABLE_VIEW) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const size = Math.max(48, Math.min(192, Math.ceil(radius * 2 * dpr * 1.4 / 8) * 8));
    let sprite = this.sprites.get(b.id);
    if (!sprite || sprite.size !== size) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = canvas.getContext('2d')!;
      sprite = { canvas, ctx: context, pixels: context.createImageData(size, size), orientation: '', size };
      this.sprites.set(b.id, sprite);
    }
    const key = `${view.key}|${b.id === 0 && !cueMarks ? 'plain' : `${b.qx},${b.qy},${b.qz},${b.qw},${cueMarks}`}`;
    if (sprite.orientation !== key) {
      this.paint(sprite, b, cueMarks, view); sprite.orientation = key;
    }
    ctx.drawImage(sprite.canvas, x - radius, y - radius, radius * 2, radius * 2);
  }

  private grid(size: number): SphereGrid {
    let grid = this.grids.get(size); if (grid) return grid;
    const samples: number[] = [], radius = size / 2;
    for (let iy = 0; iy < size; iy++) for (let ix = 0; ix < size; ix++) {
      let x = (ix + 0.5 - radius) / radius, y = (iy + 0.5 - radius) / radius;
      const distance = Math.hypot(x, y), coverage = clamp01((1 - distance) * radius + 0.5);
      if (!coverage) continue;
      if (distance > 1) { x /= distance; y /= distance; }
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const diffuse = Math.max(0, -0.40 * x - 0.50 * y + 0.768 * z);
      // Light and reflections stay in view space while material coordinates rotate.
      const half = Math.max(0, -0.213 * x - 0.266 * y + 0.940 * z);
      const shine = 0.19 * half ** 48 + 0.38 * half ** 220;
      samples.push((iy * size + ix) * 4, x, y, z, 0.47 + 0.43 * diffuse + 0.10 * z, shine, coverage);
    }
    grid = { samples: new Float32Array(samples) }; this.grids.set(size, grid); return grid;
  }

  private label(id: number): Uint8ClampedArray {
    let alpha = this.labels.get(id); if (alpha) return alpha;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = LABEL_SIZE;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    c.fillStyle = '#000'; c.font = `bold ${id < 10 ? 99 : 82}px Georgia, serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(id), 64, 67);
    const pixels = c.getImageData(0, 0, LABEL_SIZE, LABEL_SIZE).data;
    alpha = new Uint8ClampedArray(LABEL_SIZE * LABEL_SIZE);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
    this.labels.set(id, alpha); return alpha;
  }

  private ink(alpha: Uint8ClampedArray, u: number, v: number): number {
    const px = (u / BADGE_RADIUS + 1) * (LABEL_SIZE - 1) / 2;
    const py = (v / BADGE_RADIUS + 1) * (LABEL_SIZE - 1) / 2;
    if (px < 0 || py < 0 || px >= LABEL_SIZE - 1 || py >= LABEL_SIZE - 1) return 0;
    const x = Math.floor(px), y = Math.floor(py), fx = px - x, fy = py - y, i = y * LABEL_SIZE + x;
    return ((alpha[i] * (1 - fx) + alpha[i + 1] * fx) * (1 - fy)
      + (alpha[i + LABEL_SIZE] * (1 - fx) + alpha[i + LABEL_SIZE + 1] * fx) * fy) / 255;
  }

  private paint(sprite: Sprite, b: Ball, cueMarks: boolean, view: SurfaceView) {
    const m = worldToLocal(b), data = sprite.pixels.data, samples = this.grid(sprite.size).samples;
    const color = this.colors[b.id], label = b.id ? this.label(b.id) : null;
    const edge = 0.8 / sprite.size;
    for (let i = 0; i < samples.length; i += 7) {
      const offset = samples[i], x = samples[i + 1], y = samples[i + 2], z = samples[i + 3];
      const wx = view.right[0] * x + view.up[0] * y + view.normal[0] * z;
      const wy = view.right[1] * x + view.up[1] * y + view.normal[1] * z;
      const wz = view.right[2] * x + view.up[2] * y + view.normal[2] * z;
      const lx = m[0] * wx + m[1] * wy + m[2] * wz;
      const ly = m[3] * wx + m[4] * wy + m[5] * wz;
      const lz = m[6] * wx + m[7] * wy + m[8] * wz;
      let white = b.id === 0 ? 1 : b.id >= 9 ? clamp01((Math.abs(ly) - STRIPE_EDGE) / edge + 0.5) : 0;
      let dark = 0, mark = 0;
      if (label && Math.abs(lz) > BADGE_EDGE - edge) {
        const badge = clamp01((Math.abs(lz) - BADGE_EDGE) / edge + 0.5);
        white = Math.max(white, badge);
        // Two antipodal number discs, with consistent tangent frames on each face.
        dark = badge * this.ink(label, lz >= 0 ? lx : -lx, ly);
      } else if (b.id === 0 && cueMarks) {
        mark = clamp01((Math.max(Math.abs(lx), Math.abs(ly), Math.abs(lz)) - 0.987) / edge + 0.5);
      }
      const shade = samples[i + 4], shine = samples[i + 5];
      for (let channel = 0; channel < 3; channel++) {
        let material = color[channel] * (1 - white) + WHITE[channel] * white;
        material = material * (1 - dark) + INK[channel] * dark;
        material = material * (1 - mark) + RED[channel] * mark;
        const lit = material * shade;
        data[offset + channel] = lit + (255 - lit) * shine;
      }
      data[offset + 3] = samples[i + 6] * 255;
    }
    sprite.ctx.putImageData(sprite.pixels, 0, 0);
  }
}
