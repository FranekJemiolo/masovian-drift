export class EngineSynth {
  private ctx: AudioContext;
  private isRunning = false;

  // Master engine gain
  private masterGain: GainNode;

  // Boxer 6-cylinder oscillators (A2)
  private oscSub: OscillatorNode | null = null;
  private oscSaw1: OscillatorNode | null = null;
  private oscSaw2: OscillatorNode | null = null;
  private oscSaw3: OscillatorNode | null = null;
  private oscSawGain: GainNode;
  private oscSubGain: GainNode;
  private oscHarmonicGain: GainNode;

  // Intake Roar
  private intakeNoiseNode: AudioBufferSourceNode | null = null;
  private intakeFilter: BiquadFilterNode;
  private intakeGain: GainNode;

  // Filters & Distortion
  private filter: BiquadFilterNode;
  private waveShaper: WaveShaperNode;

  // Transmission Dogbox Gear Whine
  private oscGearWhine: OscillatorNode | null = null;
  private gearWhineGain: GainNode;

  // Tire Squeal Generator (A5)
  private tireNoiseNode: AudioBufferSourceNode | null = null;
  private tireFilter: BiquadFilterNode;
  private tireGain: GainNode;

  // Wind Roar Generator (A5)
  private windNoiseNode: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode;
  private windGain: GainNode;

  // Curb Rumble Strip Synthesizer
  private oscCurb: OscillatorNode | null = null;
  private curbGain: GainNode;

  // Spatial Panner (A4)
  public isSpatial = false;
  private pannerNode: PannerNode | null = null;

  // Previous throttle for BOV detection
  private prevThrottle = 0;
  private lastBovTime = 0;

  private outputNode: AudioNode;

  // Static cached noise buffers (A3: Buffer reuse & pooling)
  private static cachedWhiteNoise: AudioBuffer | null = null;
  private static cachedPinkNoise: AudioBuffer | null = null;
  private static cachedBovNoise: AudioBuffer | null = null;
  private static cachedBackfireNoise: AudioBuffer | null = null;

  constructor(ctx: AudioContext, destination?: AudioNode, isSpatial = false) {
    this.ctx = ctx;
    this.isSpatial = isSpatial;
    EngineSynth.initNoiseBuffers(ctx);

    if (isSpatial) {
      this.pannerNode = ctx.createPanner();
      this.pannerNode.panningModel = 'HRTF';
      this.pannerNode.distanceModel = 'inverse';
      this.pannerNode.refDistance = 6.0;
      this.pannerNode.maxDistance = 140.0;
      this.pannerNode.rolloffFactor = 1.1;
      this.pannerNode.connect(destination ?? ctx.destination);
      this.outputNode = this.pannerNode;
    } else {
      this.outputNode = destination ?? ctx.destination;
    }

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

    this.oscHarmonicGain = ctx.createGain();
    this.oscHarmonicGain.gain.value = 0.18;

    // Intake roar chain
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 520;
    this.intakeFilter.Q.value = 2.5;

    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0.0;
    this.intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.masterGain);

    // Connect Engine Chain:
    this.oscSubGain.connect(this.waveShaper);
    this.oscSawGain.connect(this.waveShaper);
    this.oscHarmonicGain.connect(this.waveShaper);
    this.waveShaper.connect(this.filter);
    this.filter.connect(this.masterGain);
    this.masterGain.connect(this.outputNode);

    // Straight-Cut Transmission Gear Whine Bus
    this.gearWhineGain = ctx.createGain();
    this.gearWhineGain.gain.value = 0.0;
    this.gearWhineGain.connect(this.masterGain);

    // Curb Rumble Strip Bus
    this.curbGain = ctx.createGain();
    this.curbGain.gain.value = 0.0;
    this.curbGain.connect(this.masterGain);

    // Tire Squeal Procedural Chain (A5)
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1350;
    this.tireFilter.Q.value = 4.0;

    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0.0;
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.outputNode);

    // Wind Roar Procedural Chain (A5)
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 250;
    this.windFilter.Q.value = 1.0;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.outputNode);
  }

  /**
   * Pre-allocates noise buffers once to eliminate garbage-collection spikes during driving (A3)
   */
  private static initNoiseBuffers(ctx: AudioContext): void {
    if (EngineSynth.cachedWhiteNoise) return;

    // 1. White noise loop (2 seconds)
    const rate = ctx.sampleRate;
    const len = rate * 2;
    const wBuf = ctx.createBuffer(1, len, rate);
    const wData = wBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      wData[i] = Math.random() * 2 - 1;
    }
    EngineSynth.cachedWhiteNoise = wBuf;

    // 2. Pink noise loop (filtered noise for wind and deep tire chatter)
    const pBuf = ctx.createBuffer(1, len, rate);
    const pData = pBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      pData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    EngineSynth.cachedPinkNoise = pBuf;

    // 3. Pre-rendered Turbo BOV flutter (0.45s with 22Hz flutter modulation)
    const bovLen = Math.floor(rate * 0.45);
    const bovBuf = ctx.createBuffer(1, bovLen, rate);
    const bovData = bovBuf.getChannelData(0);
    for (let i = 0; i < bovLen; i++) {
      const flutter = Math.sin((i / rate) * Math.PI * 2 * 22) * 0.5 + 0.5;
      bovData[i] = (Math.random() * 2 - 1) * flutter;
    }
    EngineSynth.cachedBovNoise = bovBuf;

    // 4. Pre-rendered Backfire unburnt fuel pop buffer
    const popLen = Math.floor(rate * 0.12);
    const popBuf = ctx.createBuffer(1, popLen, rate);
    const popData = popBuf.getChannelData(0);
    for (let i = 0; i < popLen; i++) {
      popData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (popLen * 0.28));
    }
    EngineSynth.cachedBackfireNoise = popBuf;
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

  public setPosition(x: number, y: number, z: number): void {
    if (!this.pannerNode) return;
    const t = this.ctx.currentTime;
    if (this.pannerNode.positionX) {
      this.pannerNode.positionX.setTargetAtTime(x, t, 0.04);
      this.pannerNode.positionY.setTargetAtTime(y, t, 0.04);
      this.pannerNode.positionZ.setTargetAtTime(z, t, 0.04);
    } else if ((this.pannerNode as any).setPosition) {
      (this.pannerNode as any).setPosition(x, y, z);
    }
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

    // 2. Sawtooth 1 (primary bank cylinder pulses)
    this.oscSaw1 = this.ctx.createOscillator();
    this.oscSaw1.type = 'sawtooth';
    this.oscSaw1.frequency.setValueAtTime(45, t);
    this.oscSaw1.detune.setValueAtTime(-14, t);
    this.oscSaw1.connect(this.oscSawGain);
    this.oscSaw1.start(t);

    // 3. Sawtooth 2 (secondary bank cylinder pulses)
    this.oscSaw2 = this.ctx.createOscillator();
    this.oscSaw2.type = 'sawtooth';
    this.oscSaw2.frequency.setValueAtTime(68, t);
    this.oscSaw2.detune.setValueAtTime(14, t);
    this.oscSaw2.connect(this.oscSawGain);
    this.oscSaw2.start(t);

    // 4. Sawtooth 3 (triple firing-order harmonic 3.0x, A2)
    this.oscSaw3 = this.ctx.createOscillator();
    this.oscSaw3.type = 'sawtooth';
    this.oscSaw3.frequency.setValueAtTime(135, t);
    this.oscSaw3.detune.setValueAtTime(6, t);
    this.oscSaw3.connect(this.oscHarmonicGain);
    this.oscSaw3.start(t);

    // 5. Intake roar from pre-rendered pink noise buffer (A2, A3)
    if (EngineSynth.cachedPinkNoise) {
      this.intakeNoiseNode = this.ctx.createBufferSource();
      this.intakeNoiseNode.buffer = EngineSynth.cachedPinkNoise;
      this.intakeNoiseNode.loop = true;
      this.intakeNoiseNode.connect(this.intakeFilter);
      this.intakeNoiseNode.start(t);
    }

    // 6. Pre-rendered white noise for tire screech (A3)
    if (EngineSynth.cachedWhiteNoise) {
      this.tireNoiseNode = this.ctx.createBufferSource();
      this.tireNoiseNode.buffer = EngineSynth.cachedWhiteNoise;
      this.tireNoiseNode.loop = true;
      this.tireNoiseNode.connect(this.tireFilter);
      this.tireNoiseNode.start(t);
    }

    // 7. Wind roar buffer source (A5)
    if (EngineSynth.cachedPinkNoise) {
      this.windNoiseNode = this.ctx.createBufferSource();
      this.windNoiseNode.buffer = EngineSynth.cachedPinkNoise;
      this.windNoiseNode.loop = true;
      this.windNoiseNode.connect(this.windFilter);
      this.windNoiseNode.start(t);
    }

    // 8. Straight-cut transmission gear whine oscillator
    this.oscGearWhine = this.ctx.createOscillator();
    this.oscGearWhine.type = 'sine';
    this.oscGearWhine.frequency.setValueAtTime(320, t);
    this.oscGearWhine.connect(this.gearWhineGain);
    this.oscGearWhine.start(t);
  }

  /**
   * Dynamically maps Rapier3D vehicle RPM, throttle load, tire slip, and surface (A2, A5)
   */
  public update(
    rpm: number,
    throttle: number,
    slipAngle: number,
    speedKmh: number,
    surface: string = 'tarmac'
  ): void {
    if (!this.isRunning || !this.oscSub || !this.oscSaw1 || !this.oscSaw2) return;

    const t = this.ctx.currentTime;

    // 6-cylinder Boxer fundamental firing frequency:
    // f = (RPM / 60) * (6 cyl / 2 revs) = RPM / 20
    const fundamentalFreq = Math.max(28, rpm / 20.0);

    // Dynamically update oscillator frequencies and detune parameters (A2)
    this.oscSub.frequency.setTargetAtTime(fundamentalFreq * 0.5, t, 0.04);
    this.oscSaw1.frequency.setTargetAtTime(fundamentalFreq, t, 0.04);
    this.oscSaw2.frequency.setTargetAtTime(fundamentalFreq * 1.5, t, 0.04);
    if (this.oscSaw3) {
      this.oscSaw3.frequency.setTargetAtTime(fundamentalFreq * 3.0, t, 0.04);
    }

    // Detune spread expands under hard acceleration
    const dynamicDetune = 12 + throttle * 28;
    this.oscSaw1.detune.setTargetAtTime(-dynamicDetune, t, 0.05);
    this.oscSaw2.detune.setTargetAtTime(dynamicDetune, t, 0.05);

    // Rev-limiter ignition cut at 7,200 RPM (A2)
    let limiterCut = 1.0;
    if (rpm >= 7180) {
      // 26 Hz square-wave ignition cutout
      limiterCut = Math.sin(t * Math.PI * 2 * 26) > 0 ? 0.08 : 1.0;
    }

    // Filter opens up wide when throttle is applied
    const targetFilterFreq = (380 + (rpm / 7500) * 1600 + throttle * 1900) * limiterCut;
    this.filter.frequency.setTargetAtTime(targetFilterFreq, t, 0.04);

    // Oscillator mix balance: more sawtooth rasp at high throttle/RPM
    const sawGainVal = (0.22 + throttle * 0.28 + (rpm / 7500) * 0.2) * limiterCut;
    this.oscSawGain.gain.setTargetAtTime(sawGainVal, t, 0.04);

    // Intake air induction roar under high throttle load
    const intakeGainVal = Math.min(0.25, throttle * 0.22 * (rpm / 6500));
    this.intakeGain.gain.setTargetAtTime(intakeGainVal, t, 0.05);
    this.intakeFilter.frequency.setTargetAtTime(450 + (rpm / 7000) * 800, t, 0.05);

    // Transmission straight-cut gear whine
    if (this.oscGearWhine) {
      const gearFreq = 260 + speedKmh * 11.4;
      this.oscGearWhine.frequency.setTargetAtTime(gearFreq, t, 0.04);
      const whineVol = Math.min(0.12, (speedKmh / 160.0) * 0.08 * (0.35 + throttle * 0.65));
      this.gearWhineGain.gain.setTargetAtTime(whineVol, t, 0.05);
    }

    // Auto-detect sudden throttle lift-off at high RPM for Turbo BOV flutter!
    const now = performance.now();
    if (this.prevThrottle > 0.65 && throttle < 0.15 && rpm > 4200 && now - this.lastBovTime > 750) {
      this.lastBovTime = now;
      this.playTurboBov();
    }
    this.prevThrottle = throttle;

    // Tire Squeal Synthesis modulated by Surface acoustics (A5)
    const absSlip = Math.abs(slipAngle);
    if (absSlip > 0.18 && speedKmh > 18) {
      let screechGain = Math.min(0.35, (absSlip - 0.18) * 1.25);
      let screechPitch = 1200 + (speedKmh / 160) * 600;

      if (surface === 'gravel') {
        this.tireFilter.type = 'lowpass';
        screechPitch = 600 + (speedKmh / 160) * 350;
        screechGain *= 1.2;
      } else if (surface === 'sand') {
        this.tireFilter.type = 'bandpass';
        screechPitch = 900 + (speedKmh / 160) * 400;
        screechGain *= 0.85;
      } else {
        this.tireFilter.type = 'bandpass';
      }

      this.tireGain.gain.setTargetAtTime(screechGain, t, 0.03);
      this.tireFilter.frequency.setTargetAtTime(screechPitch, t, 0.03);
    } else {
      this.tireGain.gain.setTargetAtTime(0.0, t, 0.08);
    }

    // Procedural Wind Roar scaling with speed (A5)
    if (speedKmh > 50) {
      const windFactor = Math.min(1.0, (speedKmh - 50) / 160);
      const windVol = Math.min(0.16, windFactor * windFactor * 0.16);
      this.windGain.gain.setTargetAtTime(windVol, t, 0.08);
      this.windFilter.frequency.setTargetAtTime(220 + windFactor * 480, t, 0.08);
    } else {
      this.windGain.gain.setTargetAtTime(0.0, t, 0.08);
    }
  }

  /**
   * Procedural Turbo Blow-Off Valve using cached buffer (A3)
   */
  public playTurboBov(): void {
    if (!this.isRunning || !EngineSynth.cachedBovNoise) return;
    const t = this.ctx.currentTime;

    const bovSource = this.ctx.createBufferSource();
    bovSource.buffer = EngineSynth.cachedBovNoise;

    const bovFilter = this.ctx.createBiquadFilter();
    bovFilter.type = 'bandpass';
    bovFilter.frequency.setValueAtTime(3200, t);
    bovFilter.frequency.exponentialRampToValueAtTime(1400, t + 0.4);
    bovFilter.Q.value = 5.5;

    const bovGain = this.ctx.createGain();
    bovGain.gain.setValueAtTime(0.32, t);
    bovGain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

    bovSource.connect(bovFilter);
    bovFilter.connect(bovGain);
    bovGain.connect(this.masterGain);

    bovSource.start(t);
  }

  /**
   * Procedural exhaust backfire pop using cached buffer (A3)
   */
  public playBackfirePop(): void {
    if (!this.isRunning || !EngineSynth.cachedBackfireNoise) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.08);

    const noise = this.ctx.createBufferSource();
    noise.buffer = EngineSynth.cachedBackfireNoise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 600;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.42, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    noise.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * Procedural curb strike rumble (driving over 3D beveled kerbs)
   */
  public playCurbRumble(): void {
    if (!this.isRunning) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(55, t);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.13);
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
    gain.connect(this.outputNode);
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
      this.oscSub?.disconnect();
      this.oscSaw1?.stop();
      this.oscSaw1?.disconnect();
      this.oscSaw2?.stop();
      this.oscSaw2?.disconnect();
      this.oscSaw3?.stop();
      this.oscSaw3?.disconnect();
      this.oscGearWhine?.stop();
      this.oscGearWhine?.disconnect();
      this.tireNoiseNode?.stop();
      this.tireNoiseNode?.disconnect();
      this.intakeNoiseNode?.stop();
      this.intakeNoiseNode?.disconnect();
      this.windNoiseNode?.stop();
      this.windNoiseNode?.disconnect();
    } catch (_) {}
    this.oscSub = null;
    this.oscSaw1 = null;
    this.oscSaw2 = null;
    this.oscSaw3 = null;
    this.oscGearWhine = null;
    this.tireNoiseNode = null;
    this.intakeNoiseNode = null;
    this.windNoiseNode = null;
    this.isRunning = false;
  }
}
