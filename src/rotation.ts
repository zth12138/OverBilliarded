import type { Ball } from './types';

/** Integrate world-space angular velocity without deriving roll from travel. */
export function integrateOrientation(b: Ball, dt: number) {
  if (b.wx === 0 && b.wy === 0 && b.wz === 0) return;
  const speed = Math.hypot(b.wx, b.wy, b.wz);
  const halfAngle = speed * dt / 2, s = Math.sin(halfAngle) / speed;
  const x = b.wx * s, y = b.wy * s, z = b.wz * s, w = Math.cos(halfAngle);
  // Left multiplication: the spin axes belong to the table, not the texture.
  const qx = w * b.qx + x * b.qw + y * b.qz - z * b.qy;
  const qy = w * b.qy - x * b.qz + y * b.qw + z * b.qx;
  const qz = w * b.qz + x * b.qy - y * b.qx + z * b.qw;
  const qw = w * b.qw - x * b.qx - y * b.qy - z * b.qz;
  const inverseLength = 1 / Math.hypot(qx, qy, qz, qw);
  b.qx = qx * inverseLength; b.qy = qy * inverseLength;
  b.qz = qz * inverseLength; b.qw = qw * inverseLength;
}

/** Row-major inverse rotation: visible surface normals to material coordinates. */
export function worldToLocal(b: Ball): number[] {
  const { qx: x, qy: y, qz: z, qw: w } = b;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
}
