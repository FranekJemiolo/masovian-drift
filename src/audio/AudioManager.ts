import { EngineSynth } from './EngineSynth';

export class AudioManager {
  private static instance: AudioManager | null = null;
  public ctx: AudioContext | null = null;
  public playerSynth: EngineSynth | null = null;
  public p2Synth: EngineSynth | null = null;
  public isUnlocked = false;
  public isMuted = false;

  private constructor() {
    this.setupIOSAutoplayUnlock();
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
      this.playerSynth = new EngineSynth(this.ctx);
      this.p2Synth = new EngineSynth(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public startEngines(): void {
    this.ensureContext();
    this.playerSynth?.start();
  }

  public startSplitScreenEngines(): void {
    this.ensureContext();
    this.playerSynth?.start();
    this.p2Synth?.start();
  }

  public updatePlayerEngine(rpm: number, throttle: number, slipAngle: number, speedKmh: number): void {
    if (this.isMuted) return;
    this.playerSynth?.update(rpm, throttle, slipAngle, speedKmh);
  }

  public updateP2Engine(rpm: number, throttle: number, slipAngle: number, speedKmh: number): void {
    if (this.isMuted) return;
    this.p2Synth?.update(rpm, throttle, slipAngle, speedKmh);
  }

  public playCrash(intensity: number): void {
    if (this.isMuted) return;
    this.playerSynth?.playCrashSound(intensity);
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.playerSynth) this.playerSynth.setVolume(this.isMuted ? 0 : 0.28);
    if (this.p2Synth) this.p2Synth.setVolume(this.isMuted ? 0 : 0.22);
    return this.isMuted;
  }
}
