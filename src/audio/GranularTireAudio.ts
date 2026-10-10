/**
 * Physical Granular Tire Acoustic Synthesizer
 * Synthesizes dynamic tire tread scrubbing via overlapping audio grains (20-30ms)
 * modulated by micro-slip velocity, lateral load, and surface grit.
 */
export class GranularTireAudio {
  private ctx: AudioContext | null = null;
  private outputNode: GainNode | null = null;
  private grainBuffer: AudioBuffer | null = null;
  private isRunning = false;
  private nextGrainTime = 0;

  public volume = 0.85;

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

    this.initGrainBuffer();
  }

  private initGrainBuffer(): void {
    if (!this.ctx) return;
    // Pre-render a 40ms texture grain of rubber tire tread friction
    const length = Math.floor(this.ctx.sampleRate * 0.04);
    this.grainBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.grainBuffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Hann window envelope to prevent clicking
      const env = 0.5 * (1 - Math.cos(2 * Math.PI * t));
      // Textured noise with low-frequency grit
      const noise = (Math.random() * 2 - 1) * 0.7 + Math.sin(i * 0.12) * 0.3;
      data[i] = noise * env;
    }
  }

  /**
   * Updates grain emission rate and playback pitch based on physical telemetry
   */
  public update(slipSpeedMs: number, normalForceRatio: number, surface: string): void {
    if (!this.ctx || !this.outputNode || !this.grainBuffer) return;

    if (slipSpeedMs < 1.2 || normalForceRatio < 0.05) {
      this.outputNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
      this.isRunning = false;
      return;
    }

    this.isRunning = true;
    const now = this.ctx.currentTime;

    // Gain scales with normal force and slip speed
    const targetGain = Math.min(1.0, (slipSpeedMs / 12.0) * normalForceRatio * this.volume);
    this.outputNode.gain.setTargetAtTime(targetGain, now, 0.03);

    // Schedule grains if due
    if (now >= this.nextGrainTime) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.grainBuffer;

      // Pitch shifts with slip velocity and surface grit
      let baseRate = 0.85 + Math.min(2.5, slipSpeedMs * 0.15);
      if (surface === 'gravel' || surface === 'sand') {
        baseRate *= 0.65; // Lower frequency crunch
      } else if (surface === 'kerb') {
        baseRate *= 1.4;  // Higher frequency rumble
      }
      source.playbackRate.value = baseRate + (Math.random() - 0.5) * 0.1;

      source.connect(this.outputNode);
      source.start(now);

      // Grain spacing (density scales with slip speed)
      const grainInterval = Math.max(0.015, 0.045 - (slipSpeedMs / 20.0) * 0.025);
      this.nextGrainTime = now + grainInterval;
    }
  }

  public dispose(): void {
    if (this.outputNode) {
      this.outputNode.disconnect();
    }
    this.outputNode = null;
    this.grainBuffer = null;
  }
}
