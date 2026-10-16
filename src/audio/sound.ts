// The audio context and master volume, after five-a-side's `Sound`: every sound is synthesised
// with the Web Audio API (no sound files). Browsers only allow audio after a user gesture, so
// nothing plays until `unlock()` is called from one (the first key or click).

import { impact } from './mix';

export class Sound {
  ctx: AudioContext | null = null;
  /** Everything goes through here: volume and mute. */
  master: GainNode | null = null;
  /** A few seconds of white noise, shared by every noisy sound. */
  noise: AudioBuffer | null = null;
  private volume: number;
  private muted: boolean;

  constructor(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Create the context (call from a user gesture). Returns true the first time. */
  unlock(): boolean {
    if (this.ctx) {
      void this.ctx.resume();
      return false;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.level();
    this.master.connect(ctx.destination);
    this.noise = makeNoise(ctx, 3);
    return true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.apply();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.apply();
  }

  /** Silence everything for a moment (paused, a menu) without losing the settings. */
  suspend(quiet: boolean): void {
    if (!this.ctx) return;
    if (quiet) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** A knock: a dull thud and a scrape, loud for a big impulse; `gain` scales it (distance). */
  knock(impulse: number, gain = 1, against: 'barrier' | 'car' = 'barrier'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const level = impact(impulse) * gain;
    if (level < 0.02) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(against === 'car' ? 110 : 75, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
    // The scrape: band-passed noise, metallic off a barrier.
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = against === 'car' ? 900 : 2400;
    f.Q.value = 1.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(level * 0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t, Math.random() * 2);
    n.stop(t + 0.4);
  }

  /** A gearshift's pop: a short burst of low noise. */
  pop(gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || gain < 0.02) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 2);
    n.stop(t + 0.1);
  }

  private level(): number {
    return this.muted ? 0 : this.volume;
  }

  private apply(): void {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
