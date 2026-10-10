/**
 * Turbo Wastegate Blow-Off Flutter (*Tsu-tsu-tsu*) & Overrun Pop Synthesizer
 * Simulates compressor surge when the throttle lifts under high boost / RPM,
 * producing characteristic rapid 18Hz amplitude flutter and exhaust overrun crackles.
 */
export class TurboBlowOffSynth {
  private ctx: AudioContext | null = null;
  private outputNode: GainNode | null = null;
  private flutterGain: GainNode | null = null;
  private flutterLfo: OscillatorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private isFluttering = false;

  constructor(ctx: AudioContext | null, destination?: AudioNode) {
    if (!ctx) return;
    this.ctx = ctx;

    this.outputNode = ctx.createGain();
    this.outputNode.gain.value = 0;
    if (destination) {
      this.outputNode.connect(destination);
    } else {
      this.outputNode.connect(ctx.destination);
    }

    this.initNoiseBuffer();
  }

  private initNoiseBuffer(): void {
    if (!this.ctx) return;
    // 0.6 second pink/white noise buffer for whoosh and flutter
    const length = Math.floor(this.ctx.sampleRate * 0.6);
    this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Pink filter
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      data[i] = (b0 + b1 + b2 + white * 0.5362) * 0.35;
    }
  }

  /**
   * Triggers a turbo compressor surge blow-off flutter (*tsu-tsu-tsu*)
   */
  public triggerFlutter(intensity = 1.0): void {
    if (!this.ctx || !this.outputNode || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    // Resonant bandpass filter for sharp whoosh
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(800, now + 0.45);
    filter.Q.value = 3.5;

    // 18Hz amplitude tremolo for "tsu-tsu-tsu" flutter
    const tremolo = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.setValueAtTime(17.5, now);

    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.setValueAtTime(0.7, now);
    lfoDepth.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

    lfo.connect(lfoDepth);
    lfoDepth.connect(tremolo.gain);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.01, now);
    env.gain.linearRampToValueAtTime(0.85 * intensity, now + 0.04);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    source.connect(filter);
    filter.connect(tremolo);
    tremolo.connect(env);
    env.connect(this.outputNode);

    this.outputNode.gain.setValueAtTime(1.0, now);

    source.start(now);
    lfo.start(now);
    source.stop(now + 0.55);
    lfo.stop(now + 0.55);
  }

  /**
   * Triggers an exhaust overrun backfire pop/bang
   */
  public triggerPop(): void {
    if (!this.ctx || !this.outputNode) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.08);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1.0, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(env);
    env.connect(this.outputNode);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  public dispose(): void {
    if (this.outputNode) {
      this.outputNode.disconnect();
    }
    this.outputNode = null;
    this.noiseBuffer = null;
  }
}
