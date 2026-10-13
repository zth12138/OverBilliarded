import { clamp, TABLE } from './physics';
import type { PhysicsEvent } from './types';

export type ImpactSound = 'cue' | 'contact' | 'rail' | 'pocket';
// Short material resonances plus a decaying transient, generated locally.
export function impactSamples(kind: ImpactSound, sampleRate: number): Float32Array {
  const presets = {
    cue: { duration: 0.11, frequency: 1150, decay: 70, noise: 0.32 },
    contact: { duration: 0.13, frequency: 2200, decay: 85, noise: 0.22 },
    rail: { duration: 0.16, frequency: 180, decay: 38, noise: 0.15 },
    pocket: { duration: 0.32, frequency: 125, decay: 18, noise: 0.25 },
  };
  const p = presets[kind], samples = new Float32Array(Math.ceil(sampleRate * p.duration));
  let seed = 12345, filtered = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0xffffffff * 2 - 1;
    filtered += (noise - filtered) * (kind === 'contact' || kind === 'cue' ? 0.7 : 0.12);
    const tone = Math.sin(2 * Math.PI * p.frequency * t) * 0.48
      + Math.sin(2 * Math.PI * p.frequency * 1.73 * t) * 0.18;
    const attack = Math.min(1, t / 0.0007);
    samples[i] = attack * (tone * Math.exp(-p.decay * t) + filtered * p.noise * Math.exp(-p.decay * 1.8 * t));
    if (kind === 'pocket' && t > 0.09) samples[i] += Math.sin(2 * Math.PI * 260 * (t - 0.09)) * 0.2 * Math.exp(-32 * (t - 0.09));
  }
  return samples;
}

export class TableAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<ImpactSound, AudioBuffer>();
  private voices = new Set<AudioBufferSourceNode>();
  private counts = { cue: 0, contact: 0, rail: 0, pocket: 0 };
  enabled = true;
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain(); this.master.gain.value = 0.55;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio availability must not prevent playing. */ }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.unlock();
    if (this.context && this.master) this.master.gain.setTargetAtTime(enabled ? 0.55 : 0, this.context.currentTime, 0.012);
    if (!enabled) this.stop();
  }
  play(kind: ImpactSound, speed: number, x: number) {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running' || !this.master || speed < 0.035 || this.voices.size >= 24) return;
    let buffer = this.buffers.get(kind);
    if (!buffer) {
      const samples = impactSamples(kind, ctx.sampleRate);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples); this.buffers.set(kind, buffer);
    }
    const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = 0.92 + clamp(speed / 7, 0, 1) * 0.16;
    gain.gain.value = (kind === 'pocket' ? 0.22 : 0.06) + Math.sqrt(clamp(speed / 6.4, 0, 1)) * (kind === 'contact' ? 0.72 : 0.5);
    pan.pan.value = clamp(x / TABLE.w * 2 - 1, -0.85, 0.85);
    source.connect(gain); gain.connect(pan); pan.connect(this.master);
    this.voices.add(source); this.counts[kind]++;
    source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start();
  }
  event(event: PhysicsEvent, x: number) {
    if (event.type === 'off') return;
    this.play(event.type, event.type === 'pocket' ? Math.max(0.2, event.speed ?? 0) : event.speed ?? 0, x);
  }
  stop() { for (const source of this.voices) source.stop(); this.voices.clear(); }
  getState() { return { enabled: this.enabled, state: this.context?.state ?? 'uninitialized', played: { ...this.counts } }; }
}
