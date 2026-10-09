/**
 * 100% Procedural Web Audio Synthwave Music & Countryside Ambience Synthesizer
 * Zero recorded audio files; all drums, basslines, and synth pads are synthesized via Web Audio nodes.
 */
export class MusicSynth {
  private ctx: AudioContext;
  private outputBus: GainNode;

  // Master music gain & ambience gain
  private musicGain: GainNode;
  private ambienceGain: GainNode;

  // Music state
  private isPlaying = false;
  private tempo = 128; // BPM
  private currentStep = 0;
  private nextNoteTime = 0;
  private timerId: number | null = null;

  // Dynamic filter modulated by drift and speed (A7)
  private bassFilter: BiquadFilterNode;
  private targetCutoff = 600;

  // Bassline notes (F minor / Mazovian night drive synthwave: F1, Ab1, Bb1, C2)
  private bassFreqs = [
    43.65, 43.65, 43.65, 43.65, // F1
    51.91, 51.91, 51.91, 51.91, // Ab1
    58.27, 58.27, 58.27, 58.27, // Bb1
    65.41, 65.41, 58.27, 51.91, // C2 -> Bb1 -> Ab1
  ];

  // Lead arpeggio notes (pentatonic synth: F3, Ab3, Bb3, C4, Eb4, F4)
  private arpFreqs = [174.61, 207.65, 233.08, 261.63, 311.13, 349.23];

  // Ambience nodes (A6: pine forest wind)
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  constructor(ctx: AudioContext, destination: GainNode) {
    this.ctx = ctx;
    this.outputBus = destination;

    // Music sub-bus
    this.musicGain = ctx.createGain();
    this.musicGain.gain.setValueAtTime(0.35, ctx.currentTime);
    this.musicGain.connect(this.outputBus);

    // Bassline filter (dynamically opened by speed & drift)
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.frequency.setValueAtTime(600, ctx.currentTime);
    this.bassFilter.Q.setValueAtTime(4.0, ctx.currentTime);
    this.bassFilter.connect(this.musicGain);

    // Ambience sub-bus (Mazovian pine breeze)
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.setValueAtTime(0.2, ctx.currentTime);
    this.ambienceGain.connect(this.outputBus);
    this.setupAmbience();
  }

  private setupAmbience(): void {
    try {
      // Procedural wind noise generator
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        data[i] = (b0 + b1 + b2) * 0.18;
      }

      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.setValueAtTime(320, this.ctx.currentTime);
      this.windFilter.Q.setValueAtTime(2.2, this.ctx.currentTime);

      this.windGain = this.ctx.createGain();
      this.windGain.gain.setValueAtTime(0.14, this.ctx.currentTime);

      noiseSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.ambienceGain);
      noiseSource.start();
    } catch (_) {}
  }

  public start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.currentStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.scheduler();
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  public setMusicVolume(val: number): void {
    const v = Math.max(0, Math.min(1, val));
    this.musicGain.gain.setValueAtTime(v * 0.35, this.ctx.currentTime);
  }

  public updateAdaptiveIntensity(speedKmh: number, isDrifting: boolean, driftCombo: number): void {
    if (!this.ctx) return;
    // Speed opens up the bass filter from 500Hz to 2800Hz
    const speedNorm = Math.min(1, Math.max(0, speedKmh / 160));
    const driftBoost = isDrifting ? 1200 + Math.min(1000, driftCombo * 50) : 0;
    this.targetCutoff = 500 + speedNorm * 1800 + driftBoost;

    const t = this.ctx.currentTime;
    this.bassFilter.frequency.setTargetAtTime(this.targetCutoff, t, 0.08);

    // Pine wind modulation
    if (this.windFilter) {
      const windFreq = 260 + speedNorm * 380;
      this.windFilter.frequency.setTargetAtTime(windFreq, t, 0.2);
    }
  }

  private scheduler = (): void => {
    if (!this.isPlaying) return;
    const lookaheadSec = 0.1;
    const scheduleAheadTime = 0.2;

    while (this.nextNoteTime < this.ctx.currentTime + scheduleAheadTime) {
      this.playStep(this.currentStep, this.nextNoteTime);
      const secondsPerBeat = 60.0 / this.tempo;
      const secondsPer16th = secondsPerBeat / 4;
      this.nextNoteTime += secondsPer16th;
      this.currentStep = (this.currentStep + 1) % 64;
    }

    this.timerId = window.setTimeout(this.scheduler, lookaheadSec * 1000);
  };

  private playStep(step: number, time: number): void {
    const sixteenth = step % 16;
    const beat = Math.floor(sixteenth / 4);
    const isQuarter = sixteenth % 4 === 0;

    // 1. Kick Drum (Beats 1, 2, 3, 4)
    if (isQuarter) {
      this.playKick(time);
    }

    // 2. Snare / Clap (Beats 2 and 4)
    if (beat === 1 && sixteenth % 4 === 0 || beat === 3 && sixteenth % 4 === 0) {
      this.playSnare(time);
    }

    // 3. Hi-hat on 16th notes
    if (sixteenth % 2 === 0 || this.targetCutoff > 1200) {
      this.playHiHat(time, isQuarter ? 0.08 : 0.04);
    }

    // 4. Rolling 16th Synthwave Bassline
    const noteIdx = Math.floor(step / 4) % this.bassFreqs.length;
    const freq = this.bassFreqs[noteIdx];
    this.playBassNote(freq, time);

    // 5. Arpeggiator Lead (Pops when racing fast or drifting)
    if (this.targetCutoff > 1100 && step % 2 === 0) {
      const arpNote = this.arpFreqs[step % this.arpFreqs.length];
      this.playArpNote(arpNote, time);
    }
  }

  private playKick(time: number): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.08);
    gain.gain.setValueAtTime(0.55, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  private playSnare(time: number): void {
    // Noise snap
    const noise = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1200, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    noise.start(time);
    noise.stop(time + 0.12);
  }

  private playHiHat(time: number, vol: number): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(8000, time);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.035);
  }

  private playBassNote(freq: number, time: number): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);

    osc.connect(gain);
    gain.connect(this.bassFilter);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  private playArpNote(freq: number, time: number): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);

    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.15);
  }
}
