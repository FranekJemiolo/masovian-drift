export class EngineSynth {
  private ctx: AudioContext;
  private isRunning = false;

  // Master engine gain
  private masterGain: GainNode;

  // Boxer 6-cylinder oscillators
  private oscSub: OscillatorNode | null = null;
  private oscSaw1: OscillatorNode | null = null;
  private oscSaw2: OscillatorNode | null = null;
  private oscSawGain: GainNode;
  private oscSubGain: GainNode;

  // Filters & Distortion
  private filter: BiquadFilterNode;
  private waveShaper: WaveShaperNode;

  // Tire Squeal Generator
  private tireNoiseNode: AudioBufferSourceNode | null = null;
  private tireFilter: BiquadFilterNode;
  private tireGain: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // Master Engine Bus
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.28;

    // Filter
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 3.5;

    // WaveShaper for authentic Boxer exhaust rasp
    this.waveShaper = ctx.createWaveShaper();
    this.waveShaper.curve = this.makeDistortionCurve(18) as any;
    this.waveShaper.oversample = '2x';

    // Gains for oscillator mixing
    this.oscSubGain = ctx.createGain();
    this.oscSubGain.gain.value = 0.45;

    this.oscSawGain = ctx.createGain();
    this.oscSawGain.gain.value = 0.35;

    // Connect Engine Chain:
    // Oscillators -> Gains -> WaveShaper -> Filter -> MasterGain -> Destination
    this.oscSubGain.connect(this.waveShaper);
    this.oscSawGain.connect(this.waveShaper);
    this.waveShaper.connect(this.filter);
    this.filter.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Tire Squeal Procedural Chain
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1350;
    this.tireFilter.Q.value = 4.0;

    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0.0;
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(ctx.destination);
  }

  private makeDistortionCurve(amount: number): Float32Array {
    const k = amount;
    const nSamples = 256;
    const curve = new Float32Array(nSamples);
    const deg = Math.PI / 180;
    for (let i = 0; i < nSamples; ++i) {
      const x = (i * 2) / nSamples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const t = this.ctx.currentTime;

    // 1. Sub fundamental triangle (deep engine displacement)
    this.oscSub = this.ctx.createOscillator();
    this.oscSub.type = 'triangle';
    this.oscSub.frequency.setValueAtTime(45, t);
    this.oscSub.connect(this.oscSubGain);
    this.oscSub.start(t);

    // 2. Sawtooth 1 (cylinder fire pulses)
    this.oscSaw1 = this.ctx.createOscillator();
    this.oscSaw1.type = 'sawtooth';
    this.oscSaw1.frequency.setValueAtTime(45, t);
    this.oscSaw1.detune.setValueAtTime(-14, t); // Detuned for Boxer rumble
    this.oscSaw1.connect(this.oscSawGain);
    this.oscSaw1.start(t);

    // 3. Sawtooth 2 (harmonic order)
    this.oscSaw2 = this.ctx.createOscillator();
    this.oscSaw2.type = 'sawtooth';
    this.oscSaw2.frequency.setValueAtTime(90, t);
    this.oscSaw2.detune.setValueAtTime(12, t);
    this.oscSaw2.connect(this.oscSawGain);
    this.oscSaw2.start(t);

    // 4. White noise buffer for procedural tire screech
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.tireNoiseNode = this.ctx.createBufferSource();
    this.tireNoiseNode.buffer = noiseBuffer;
    this.tireNoiseNode.loop = true;
    this.tireNoiseNode.connect(this.tireFilter);
    this.tireNoiseNode.start(t);
  }

  /**
   * Dynamically maps Rapier3D vehicle RPM, throttle load, and tire slip to oscillators
   */
  public update(rpm: number, throttle: number, slipAngle: number, speedKmh: number): void {
    if (!this.isRunning || !this.oscSub || !this.oscSaw1 || !this.oscSaw2) return;

    const t = this.ctx.currentTime;

    // 6-cylinder Boxer fundamental firing frequency:
    // f = (RPM / 60) * (6 cylinders / 2 revolutions) = RPM / 20
    const fundamentalFreq = Math.max(30, rpm / 20.0);

    // Dynamically update oscillator frequencies and detune parameters
    this.oscSub.frequency.setTargetAtTime(fundamentalFreq * 0.5, t, 0.04);
    this.oscSaw1.frequency.setTargetAtTime(fundamentalFreq, t, 0.04);
    this.oscSaw2.frequency.setTargetAtTime(fundamentalFreq * 2.0, t, 0.04);

    // Detune spread expands under hard acceleration
    const dynamicDetune = 12 + throttle * 28;
    this.oscSaw1.detune.setTargetAtTime(-dynamicDetune, t, 0.05);
    this.oscSaw2.detune.setTargetAtTime(dynamicDetune, t, 0.05);

    // Filter opens up wide when throttle is applied
    const targetFilterFreq = 380 + (rpm / 7500) * 1600 + throttle * 1900;
    this.filter.frequency.setTargetAtTime(targetFilterFreq, t, 0.05);

    // Oscillator mix balance: more sawtooth rasp at high throttle/RPM
    const sawGainVal = 0.22 + throttle * 0.28 + (rpm / 7500) * 0.2;
    this.oscSawGain.gain.setTargetAtTime(sawGainVal, t, 0.05);

    // Tire Squeal Synthesis (active during oversteer drifts or hard lockups)
    const absSlip = Math.abs(slipAngle);
    if (absSlip > 0.18 && speedKmh > 20) {
      const screechGain = Math.min(0.35, (absSlip - 0.18) * 1.2);
      this.tireGain.gain.setTargetAtTime(screechGain, t, 0.03);
      const screechPitch = 1200 + (speedKmh / 160) * 600;
      this.tireFilter.frequency.setTargetAtTime(screechPitch, t, 0.03);
    } else {
      this.tireGain.gain.setTargetAtTime(0.0, t, 0.08);
    }
  }

  public playCrashSound(intensity: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.35);

    gain.gain.setValueAtTime(Math.min(0.8, intensity * 0.4), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  public setVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  public stop(): void {
    if (!this.isRunning) return;
    try {
      this.oscSub?.stop();
      this.oscSaw1?.stop();
      this.oscSaw2?.stop();
      this.tireNoiseNode?.stop();
    } catch (_) {}
    this.isRunning = false;
  }
}
