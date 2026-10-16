// The weather's own sounds: rain falling (bright, steady noise) and your tyres swishing
// through the water on the road (darker noise, louder and brighter with speed). Both follow
// the numbers from mix.ts.

export class RainVoice {
  private readonly rainGain: GainNode;
  private readonly swishGain: GainNode;
  private readonly swishFilter: BiquadFilterNode;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    noise: AudioBuffer,
  ) {
    const loop = (offset: number) => {
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.loop = true;
      n.start(0, offset);
      return n;
    };
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 2500;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    loop(0.7).connect(rainFilter).connect(this.rainGain).connect(out);

    this.swishFilter = ctx.createBiquadFilter();
    this.swishFilter.type = 'lowpass';
    this.swishGain = ctx.createGain();
    this.swishGain.gain.value = 0;
    loop(1.9).connect(this.swishFilter).connect(this.swishGain).connect(out);
  }

  update(rain: { gain: number }, swish: { gain: number; cutoff: number }): void {
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain.gain, t, 0.1);
    this.swishGain.gain.setTargetAtTime(swish.gain, t, 0.05);
    this.swishFilter.frequency.setTargetAtTime(swish.cutoff, t, 0.05);
  }
}
