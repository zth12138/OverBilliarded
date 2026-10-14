import { CUSHIONS, POCKETS } from './physics';
import { legalFirstIds } from './rules';
import type { SearchGrid } from './search';
import type { SearchRequest } from './types';

// This is a coarse physical model, not the authoritative simulation. Independent
// invocations simulate complete tables; CPU CCD, rules and refinement verify the
// shortlist. Orientation/trails are reconstructed only by that CPU simulation.
export const trajectoryShader = /* wgsl */ `
struct Candidate { shot: vec4<f32>, extra: vec4<f32> }
@group(0) @binding(0) var<storage, read> scene: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> shots: array<Candidate>;
@group(0) @binding(2) var<storage, read_write> scores: array<f32>;
const R: f32 = 0.028575;
const DT: f32 = 0.0041666667;
@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&shots)) { return; }
  let n = u32(scene[0].x); let cue = u32(scene[0].y);
  let objectIndex = u32(scene[0].z); let called = u32(scene[0].w);
  var p: array<vec3<f32>, 16>; var v: array<vec3<f32>, 16>;
  var w: array<vec3<f32>, 16>; var live: array<bool, 16>;
  var legal: array<bool, 16>; var ids: array<u32, 16>;
  for (var i = 0u; i < n; i++) {
    let base = 25u + i * 3u;
    p[i] = scene[base].xyz; ids[i] = u32(scene[base].w);
    v[i] = scene[base + 1u].xyz; legal[i] = scene[base + 1u].w > 0.5;
    w[i] = scene[base + 2u].xyz; live[i] = scene[base + 2u].w > 0.5;
  }
  let s = shots[index]; let angle = s.shot.x; let speed = 0.2 + s.shot.y * 0.062;
  let tx = s.shot.z; let ty = s.shot.w;
  let elevation = s.extra.x * 0.01745329252;
  let d = vec2<f32>(cos(angle), sin(angle)); let side = vec2<f32>(-d.y, d.x);
  let planar = speed * cos(elevation);
  v[cue] = vec3<f32>(planar * d - planar * tx * 0.022 * side, 0.0);
  if (s.extra.y > 0.5 && s.extra.y < 1.5) { v[cue].z = speed * sin(elevation) * 0.52; }
  p[cue].z = R;
  let follow = speed * ty * 2.5 / R * cos(elevation);
  let axial = -speed * tx * 2.5 / R * sin(elevation);
  w[cue] = vec3<f32>(side * follow + d * axial, -speed * tx * 2.5 / R * cos(elevation));
  var nearContact = distance(p[cue], vec3<f32>(s.extra.zw, R));
  var nearPocket = distance(p[objectIndex].xy, scene[1u + called].xy);
  var first = false; var touched = false; var potted = false; var invalid = false;
  var quiet = 0u;
  // 12 second horizon. Fixed coarse steps differ from CPU's continuous impacts.
  for (var tick = 0u; tick < 2880u; tick++) {
    var moving = false;
    for (var i = 0u; i < n; i++) {
      if (!live[i]) { continue; }
      if (p[i].z > R + 0.0001 || v[i].z > 0.01) { v[i].z -= 9.81 * DT; }
      else {
        p[i].z = R; v[i].z = 0.0;
        let slip = v[i].xy + R * vec2<f32>(-w[i].y, w[i].x);
        let mag = length(slip); let impulse = 0.21 * 9.81 * DT;
        if (mag > impulse * 3.5) {
          let dv = -impulse * slip / mag;
          v[i] = vec3<f32>(v[i].xy + dv, v[i].z);
          w[i] = vec3<f32>(w[i].xy + 2.5 / R * vec2<f32>(dv.y, -dv.x), w[i].z);
        } else {
          var planarV = v[i].xy - slip / 3.5; let magV = length(planarV);
          planarV *= max(0.0, 1.0 - 0.019 * 9.81 * DT / max(magV, 0.000001));
          v[i] = vec3<f32>(planarV, 0.0);
          w[i] = vec3<f32>(-planarV.y / R, planarV.x / R, w[i].z);
        }
        w[i].z *= exp(-1.05 * DT);
      }
      p[i] += v[i] * DT;
      if (p[i].z < R) {
        p[i].z = R;
        v[i].z = select(0.0, -v[i].z * 0.2, abs(v[i].z) > 0.32);
        v[i] = vec3<f32>(v[i].xy * 0.99, v[i].z);
      }
      if (p[i].z < R + 0.012) {
        for (var pocket = 0u; pocket < 6u; pocket++) {
          if (distance(p[i].xy, scene[1u + pocket].xy) < 0.05) {
            live[i] = false; v[i] = vec3<f32>(0.0);
            if (i == cue || (ids[i] == 8u && ids[objectIndex] != 8u)) { invalid = true; }
            if (i == objectIndex) { potted = pocket == called; invalid = invalid || !potted; }
            break;
          }
        }
      }
      if (!live[i]) { continue; }
      if (p[i].x < -0.13 || p[i].x > 2.67 || p[i].y < -0.13 || p[i].y > 1.4) {
        live[i] = false;
        if (i == cue || i == objectIndex || ids[i] == 8u) { invalid = true; }
        continue;
      }
      if (p[i].z < R + 0.04) {
        for (var rail = 0u; rail < 18u; rail++) {
          let seg = scene[7u + rail]; let ab = seg.zw - seg.xy;
          let t = clamp(dot(p[i].xy - seg.xy, ab) / dot(ab, ab), 0.0, 1.0);
          let delta = p[i].xy - (seg.xy + t * ab); let distance = length(delta);
          if (distance < R && distance > 0.000001) {
            let normal = delta / distance; let vn = dot(v[i].xy, normal);
            p[i] = vec3<f32>(p[i].xy + normal * (R - distance + 0.000001), p[i].z);
            if (vn < 0.0) {
              let jn = -1.79 * vn; let tangent = vec2<f32>(-normal.y, normal.x);
              var velocity = v[i].xy + jn * normal;
              let jt = clamp(-(dot(velocity, tangent) - R * w[i].z) / 3.5, -jn * 0.16, jn * 0.16);
              v[i] = vec3<f32>(velocity + jt * tangent, v[i].z); w[i].z -= 2.5 * jt / R;
            }
          }
        }
      }
    }
    for (var i = 0u; i < n; i++) {
      if (!live[i]) { continue; }
      for (var j = i + 1u; j < n; j++) {
        if (!live[j]) { continue; }
        let delta = p[j] - p[i]; let distance = length(delta);
        if (distance > 2.0 * R || distance < 0.000001) { continue; }
        let normal = delta / distance; let relative = v[j] - v[i]; let vn = dot(relative, normal);
        let separation = normal * (0.5 * (2.0 * R - distance) + 0.000001);
        p[i] -= separation; p[j] += separation; p[i].z = max(R, p[i].z); p[j].z = max(R, p[j].z);
        if (vn >= 0.0) { continue; }
        if ((i == cue || j == cue) && !first) {
          first = true; invalid = invalid || !legal[select(i, j, i == cue)];
        }
        touched = touched || i == objectIndex || j == objectIndex;
        let impulse = -1.94 * vn * 0.5;
        v[i] -= impulse * normal; v[j] += impulse * normal;
        let relativeSurface = relative - R * cross(w[i] + w[j], normal);
        var friction = -(relativeSurface - dot(relativeSurface, normal) * normal) / 7.0;
        let frictionLength = length(friction); let limit = 0.045 * impulse;
        if (frictionLength > limit) { friction *= limit / frictionLength; }
        v[i] -= friction; v[j] += friction;
        let spin = -2.5 / R * cross(normal, friction); w[i] += spin; w[j] += spin;
      }
      moving = moving || length(v[i]) > 0.012 || length(w[i].xy) > 0.08;
    }
    nearContact = min(nearContact, distance(p[cue], vec3<f32>(s.extra.zw, R)));
    if (live[objectIndex]) { nearPocket = min(nearPocket, distance(p[objectIndex].xy, scene[1u + called].xy)); }
    if (invalid || (potted && first)) { break; }
    if (!moving) { quiet++; } else { quiet = 0u; }
    if (quiet >= 12u) { break; }
  }
  var loss = select(2.0 + nearContact, 0.1 + nearPocket, touched);
  if (potted && first) { loss = -1.0; }
  if (invalid) { loss = 10.0 + nearContact; }
  scores[index] = loss;
}`;

export type GpuScreenResult =
  | { ok: true; grids: SearchGrid[]; tested: number; retained: number; adapter: string }
  | { ok: false; reason: string };

// Reserve regularly spaced candidates in every route, in addition to the best
// physical scores. Special strokes have their own grids and cannot be crowded out.
export function shortlistIndices(scores: readonly number[]): number[] {
  const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => a.score - b.score || a.index - b.index);
  const keep = new Set(ranked.slice(0, Math.ceil(scores.length * 0.4)).map(s => s.index));
  for (let i = 0; i < scores.length; i += 12) keep.add(i);
  return [...keep].sort((a, b) => a - b);
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('GPU 响应超时')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function gpuScreen(req: SearchRequest, grids: SearchGrid[], onProgress?: (done: number, total: number) => void): Promise<GpuScreenResult> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return { ok: false, reason: '浏览器未提供 WebGPU' };
  const balls = req.balls.filter(b => !b.pocketed);
  const cue = balls.findIndex(b => b.id === 0), target = balls.findIndex(b => b.id === req.target);
  if (balls.length > 16 || cue < 0 || target < 0 || !POCKETS[req.pocket]) return { ok: false, reason: '当前球局不适合 GPU 试算' };
  let device: GPUDevice | undefined;
  const buffers: GPUBuffer[] = [];
  try {
    const adapter = await bounded(gpu.requestAdapter(), 5000);
    if (!adapter) return { ok: false, reason: '未找到可用 GPU' };
    device = await bounded(adapter.requestDevice(), 5000);
    const lost = device.lost.then(info => { throw new Error(`GPU 设备失联：${info.message}`); });
    // Always attach a rejection handler, including after successful completion.
    void lost.catch(() => {});
    const guard = <T>(promise: Promise<T>) => bounded(Promise.race([promise, lost]), 15000);
    device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
    const module = device.createShaderModule({ code: trajectoryShader });
    const compilation = await guard(module.getCompilationInfo());
    const errors = compilation.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(errors.map(m => `${m.lineNum}: ${m.message}`).join('; '));
    const pipeline = await guard(device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }));
    const legal = legalFirstIds(req.balls, req.rules), packed = new Float32Array((25 + balls.length * 3) * 4);
    packed.set([balls.length, cue, target, req.pocket]);
    POCKETS.forEach((p, i) => packed.set([p.x, p.y, 0, 0], (1 + i) * 4));
    CUSHIONS.forEach((s, i) => packed.set([s.ax, s.ay, s.bx, s.by], (7 + i) * 4));
    balls.forEach((b, i) => packed.set([b.x, b.y, b.z, b.id, b.vx, b.vy, b.vz, Number(legal.includes(b.id)), b.wx, b.wy, b.wz, 1], (25 + i * 3) * 4));
    const make = (size: number, usage: GPUBufferUsageFlags) => {
      const buffer = device!.createBuffer({ size, usage }); buffers.push(buffer); return buffer;
    };
    const scene = make(packed.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(scene, 0, packed);
    const tested = grids.reduce((sum, g) => sum + g.shots.length, 0);
    let done = 0;
    const selected: SearchGrid[] = [];
    for (const grid of grids) {
      const scores: number[] = [];
      for (let offset = 0; offset < grid.shots.length; offset += 256) {
        const batch = grid.shots.slice(offset, offset + 256), input = new Float32Array(batch.length * 8);
        batch.forEach((s, i) => input.set([s.angle, s.power, s.tipX, s.tipY, s.elevation, s.kind === 'normal' ? 0 : s.kind === 'jump' ? 1 : 2, grid.route.contact.x, grid.route.contact.y], i * 8));
        const shots = make(input.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        const output = make(batch.length * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const read = make(batch.length * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        device.queue.writeBuffer(shots, 0, input);
        const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: scene } }, { binding: 1, resource: { buffer: shots } }, { binding: 2, resource: { buffer: output } },
        ] });
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(batch.length / 32)); pass.end();
        encoder.copyBufferToBuffer(output, 0, read, 0, batch.length * 4); device.queue.submit([encoder.finish()]);
        await guard(read.mapAsync(GPUMapMode.READ));
        scores.push(...new Float32Array(read.getMappedRange())); read.unmap();
        for (const buffer of [shots, output, read]) { buffer.destroy(); buffers.splice(buffers.indexOf(buffer), 1); }
        done += batch.length; onProgress?.(done, tested);
      }
      if (scores.some(s => !Number.isFinite(s))) throw new Error('GPU 返回了无效轨迹评分');
      selected.push({ route: grid.route, shots: shortlistIndices(scores).map(i => grid.shots[i]) });
    }
    const memoryError = await guard(device.popErrorScope()), validationError = await guard(device.popErrorScope());
    if (memoryError || validationError) throw new Error((memoryError ?? validationError)!.message);
    return { ok: true, grids: selected, tested, retained: selected.reduce((sum, g) => sum + g.shots.length, 0), adapter: adapter.info.description || adapter.info.device || 'WebGPU' };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) }; }
  finally { buffers.forEach(b => b.destroy()); device?.destroy(); }
}
