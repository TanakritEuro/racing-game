// One car's continuous sound: its engine (three oscillators on the firing frequency through a
// soft clipper and a low-pass filter, stuttering at the limiter), tyre squeal, and for your
// own car kerb rumble and wind. Panned and faded with distance for the other cars.

import type { EngineVoice } from './mix';

/** How quickly a parameter follows its target (s): fast enough for gearshifts, smooth enough not to click. */
const SMOOTH = 0.025;

export class CarVoice {
  private readonly oscillators: OscillatorNode[];
  private readonly filter: BiquadFilterNode;
  private readonly engineGain: GainNode;
  private readonly stutterDepth: GainNode;
  private readonly squealFilter: BiquadFilterNode;
  private readonly squealGain: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly level: GainNode;
  private readonly rumbleOsc: OscillatorNode | null = null;
  private readonly rumbleGain: GainNode | null = null;
  private readonly windFilter: BiquadFilterNode | null = null;
  private readonly windGain: GainNode | null = null;
  private readonly sources: AudioScheduledSourceNode[] = [];

  /** `own`: your car (adds rumble and wind, unpanned). */
  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    noise: AudioBuffer,
    own: boolean,
  ) {
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.panner.connect(this.level).connect(out);

    // Engine: the firing frequency, its octave (slightly detuned) and a sub-octave square.
    const mix = ctx.createGain();
    const parts: [OscillatorType, number, number][] = [
      ['sawtooth', 1, 0.5],
      ['sawtooth', 2.006, 0.22],
      ['square', 0.5, 0.3],
    ];
    this.oscillators = parts.map(([type, , gain]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      return o;
    });
    const clip = ctx.createWaveShaper();
    clip.curve = softClip();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2;
    // The limiter's stutter: a square LFO pulling the level down and up.
    const stutter = ctx.createGain();
    stutter.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 22;
    this.stutterDepth = ctx.createGain();
    this.stutterDepth.gain.value = 0;
    lfo.connect(this.stutterDepth).connect(stutter.gain);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    mix.connect(clip).connect(this.filter).connect(stutter).connect(this.engineGain).connect(this.panner);

    // Squeal: noise through a narrow band-pass.
    const squealNoise = this.loop(noise);
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    squealNoise.connect(this.squealFilter).connect(this.squealGain).connect(this.panner);

    if (own) {
      this.rumbleOsc = ctx.createOscillator();
      this.rumbleOsc.type = 'square';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      this.rumbleGain = ctx.createGain();
      this.rumbleGain.gain.value = 0;
      this.rumbleOsc.connect(lp).connect(this.rumbleGain).connect(out);
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.loop(noise).connect(this.windFilter).connect(this.windGain).connect(out);
      this.sources.push(this.rumbleOsc);
    }
    for (const o of [...this.oscillators, lfo]) this.sources.push(o);
    for (const s of this.sources) s.start();
  }

  /** Follow the engine, squeal and (own car) rumble and wind; `gain` and `pan` place the car. */
  update(engine: EngineVoice, squeal: { gain: number; pitch: number }, gain: number, pan: number, rumble?: { gain: number; frequency: number }, wind?: { gain: number; cutoff: number }): void {
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, SMOOTH);
    set(this.oscillators[0].frequency, engine.fundamental);
    set(this.oscillators[1].frequency, engine.fundamental * 2.006);
    set(this.oscillators[2].frequency, engine.fundamental * 0.5);
    set(this.filter.frequency, Math.min(12000, engine.brightness));
    set(this.engineGain.gain, engine.gain);
    set(this.stutterDepth.gain, engine.limiter ? 0.45 : 0);
    set(this.squealFilter.frequency, squeal.pitch);
    set(this.squealGain.gain, squeal.gain);
    set(this.level.gain, gain);
    set(this.panner.pan, Math.max(-1, Math.min(1, pan)));
    if (rumble && this.rumbleOsc && this.rumbleGain) {
      set(this.rumbleOsc.frequency, Math.max(5, rumble.frequency));
      set(this.rumbleGain.gain, rumble.gain);
    }
    if (wind && this.windFilter && this.windGain) {
      set(this.windFilter.frequency, wind.cutoff);
      set(this.windGain.gain, wind.gain);
    }
  }

  /** Fade out (a voice not in use). */
  silence(): void {
    this.level.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    this.rumbleGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    this.windGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  private loop(noise: AudioBuffer): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    this.sources.push(n);
    return n;
  }
}

/** A gentle saturation curve: the engine's edge at full throttle. */
function softClip(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(1024 * 4));
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
  }
  return curve;
}

