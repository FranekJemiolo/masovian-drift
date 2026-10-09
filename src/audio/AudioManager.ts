import { EngineSynth } from './EngineSynth';

export class AudioManager {
  private static instance: AudioManager | null = null;
  public ctx: AudioContext | null = null;
  public playerSynth: EngineSynth | null = null;
  public p2Synth: EngineSynth | null = null;
  public isUnlocked = false;
  public isMuted = false;
  public masterVolume = 0.8;
  public isPaused = false;

  // Master bus & sub-buses
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  public engineBus: GainNode | null = null;
  public sfxBus: GainNode | null = null;
  public uiBus: GainNode | null = null;

  private constructor() {
    this.loadSettings();
    this.setupIOSAutoplayUnlock();
  }

  private loadSettings(): void {
    try {
      const savedVol = localStorage.getItem('masovian_master_volume');
      if (savedVol !== null) {
        this.masterVolume = Math.max(0, Math.min(1, parseFloat(savedVol)));
      }
      const savedMute = localStorage.getItem('masovian_is_muted');
      if (savedMute !== null) {
        this.isMuted = savedMute === 'true';
      }
    } catch (_) {}
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('masovian_master_volume', this.masterVolume.toString());
      localStorage.setItem('masovian_is_muted', this.isMuted.toString());
    } catch (_) {}
  }

  public static getInstance(): AudioManager {
    if (!this.instance) {
      this.instance = new AudioManager();
    }
    return this.instance;
  }

  /**
   * Bypasses iOS Safari strict autoplay restrictions by calling AudioContext.resume()
   * inside the synchronous body of the very first touchstart or click event listener.
   */
  private setupIOSAutoplayUnlock(): void {
    const unlockHandler = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.isUnlocked = true;
        });
      } else {
        this.isUnlocked = true;
      }

      window.removeEventListener('touchstart', unlockHandler, true);
      window.removeEventListener('touchend', unlockHandler, true);
      window.removeEventListener('click', unlockHandler, true);
      window.removeEventListener('keydown', unlockHandler, true);
    };

    window.addEventListener('touchstart', unlockHandler, { capture: true, passive: true });
    window.addEventListener('touchend', unlockHandler, { capture: true, passive: true });
    window.addEventListener('click', unlockHandler, { capture: true });
    window.addEventListener('keydown', unlockHandler, { capture: true });
  }

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtxClass();

      // Master Limiter / Compressor -> Destination
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.setValueAtTime(-1.5, this.ctx.currentTime);
      this.limiter.knee.setValueAtTime(12, this.ctx.currentTime);
      this.limiter.ratio.setValueAtTime(8, this.ctx.currentTime);
      this.limiter.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.limiter.release.setValueAtTime(0.15, this.ctx.currentTime);
      this.limiter.connect(this.ctx.destination);

      // Master Bus Gain -> Limiter
      this.masterGain = this.ctx.createGain();
      const effectiveGain = this.isMuted || this.isPaused ? 0 : this.masterVolume;
      this.masterGain.gain.setValueAtTime(effectiveGain, this.ctx.currentTime);
      this.masterGain.connect(this.limiter);

      // Sub-buses -> Master Bus
      this.engineBus = this.ctx.createGain();
      this.engineBus.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.engineBus.connect(this.masterGain);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.setValueAtTime(0.9, this.ctx.currentTime);
      this.sfxBus.connect(this.masterGain);

      this.uiBus = this.ctx.createGain();
      this.uiBus.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.uiBus.connect(this.masterGain);

      this.playerSynth = new EngineSynth(this.ctx, this.engineBus);
      this.p2Synth = new EngineSynth(this.ctx, this.engineBus);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public pause(): void {
    this.isPaused = true;
    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
      this.masterGain.gain.linearRampToValueAtTime(0, t + 0.05);
    }
  }

  public resume(): void {
    this.isPaused = false;
    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      const targetGain = this.isMuted ? 0 : this.masterVolume;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
      this.masterGain.gain.linearRampToValueAtTime(targetGain, t + 0.05);
    }
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    this.saveSettings();
    if (this.masterGain && this.ctx && !this.isPaused && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  public toggleMute(): boolean {
    return this.setMute(!this.isMuted);
  }

  public setMute(muted: boolean): boolean {
    this.isMuted = muted;
    this.saveSettings();
    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      const target = this.isMuted || this.isPaused ? 0 : this.masterVolume;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
      this.masterGain.gain.linearRampToValueAtTime(target, t + 0.03);
    }
    return this.isMuted;
  }

  public startEngines(): void {
    this.ensureContext();
    this.playerSynth?.start();
  }

  public stopEngines(): void {
    this.playerSynth?.stop();
    this.p2Synth?.stop();
  }

  public startSplitScreenEngines(): void {
    this.ensureContext();
    this.playerSynth?.start();
    this.p2Synth?.start();
  }

  public updatePlayerEngine(rpm: number, throttle: number, slipAngle: number, speedKmh: number): void {
    if (this.isMuted || this.isPaused) return;
    this.playerSynth?.update(rpm, throttle, slipAngle, speedKmh);
  }

  public updateP2Engine(rpm: number, throttle: number, slipAngle: number, speedKmh: number): void {
    if (this.isMuted || this.isPaused) return;
    this.p2Synth?.update(rpm, throttle, slipAngle, speedKmh);
  }

  public playCrash(intensity: number): void {
    if (this.isMuted || this.isPaused) return;
    this.playerSynth?.playCrashSound(intensity);
  }

  public playBackfire(): void {
    if (this.isMuted || this.isPaused) return;
    this.playerSynth?.playBackfirePop();
  }

  public playCurb(): void {
    if (this.isMuted || this.isPaused) return;
    this.playerSynth?.playCurbRumble();
  }

  public playCountdownBeep(isGo: boolean): void {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;

    if (isGo) {
      // 880Hz + 1320Hz crisp dual-tone green light chord
      [880, 1320].forEach((freq) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.24, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        osc.connect(gain);
        gain.connect(this.sfxBus!);
        osc.start(t);
        osc.stop(t + 0.4);
      });
    } else {
      // 440Hz single red light beep
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }

  public playUiClick(): void {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx || !this.uiBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(980, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.04);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(this.uiBus);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  public playUiHover(): void {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx || !this.uiBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, t);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    osc.connect(gain);
    gain.connect(this.uiBus);
    osc.start(t);
    osc.stop(t + 0.025);
  }
}
