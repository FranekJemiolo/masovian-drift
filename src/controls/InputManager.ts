import { VehicleInputs } from '../physics/VehiclePhysics';

export class InputManager {
  private static instance: InputManager | null = null;

  // Active keyboard state
  private keys: Record<string, boolean> = {};

  // Mobile DeviceOrientation (Gyroscope)
  public gyroActive = false;
  public gyroSupported = false;
  private rawGamma = 0;
  private filteredGamma = 0;
  private readonly filterAlpha = 0.22; // Low-pass filter smoothing coefficient (1.0 = instant, 0.0 = no update)
  private readonly maxTiltAngle = 28;  // Degrees tilt for 100% steer

  // Mobile Touch zones
  public touchThrottle = 0;
  public touchBrake = 0;
  public touchHandbrake = false;
  public isMobileDevice = false;

  private constructor() {
    this.detectMobile();
    this.setupKeyboardListeners();
    this.setupGyroListeners();
  }

  public static getInstance(): InputManager {
    if (!this.instance) {
      this.instance = new InputManager();
    }
    return this.instance;
  }

  private detectMobile(): void {
    this.isMobileDevice =
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 1);
  }

  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  /**
   * Prompts for permission on iOS 13+ and registers DeviceOrientationEvent listener
   */
  public async requestGyroPermission(): Promise<boolean> {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as any).requestPermission === 'function'
    ) {
      try {
        const response = await (DeviceOrientationEvent as any).requestPermission();
        if (response === 'granted') {
          this.setupGyroListeners();
          this.gyroActive = true;
          return true;
        }
        return false;
      } catch (err) {
        console.warn('Gyroscope permission denied:', err);
        return false;
      }
    } else {
      // Non-iOS or older Android - permissions not required
      this.setupGyroListeners();
      this.gyroActive = true;
      return true;
    }
  }

  private setupGyroListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('deviceorientation', (event: DeviceOrientationEvent) => {
      if (event.gamma !== null) {
        this.gyroSupported = true;
        this.gyroActive = true;
        this.rawGamma = event.gamma;

        // Low-pass filter to smooth gyroscope hand jitter:
        // filtered = alpha * raw + (1 - alpha) * filtered_prev
        this.filteredGamma =
          this.filterAlpha * this.rawGamma +
          (1.0 - this.filterAlpha) * this.filteredGamma;
      }
    });
  }

  /**
   * Returns driving inputs for Single Player (or Player 1 in Split-Screen)
   */
  public getPlayerInputs(): VehicleInputs {
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let handbrake = false;

    // Keyboard inputs (WASD or Arrow keys)
    if (this.keys['KeyW'] || this.keys['ArrowUp']) throttle = 1.0;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) brake = 1.0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) steer -= 1.0;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) steer += 1.0;
    if (this.keys['Space']) handbrake = true;

    // Mobile Gyroscope tilt override
    if (this.gyroActive && Math.abs(this.filteredGamma) > 1.5) {
      // Normalize gamma (-maxTilt .. +maxTilt) to -1.0 .. +1.0
      const gyroSteer = this.filteredGamma / this.maxTiltAngle;
      steer = Math.max(-1.0, Math.min(1.0, gyroSteer));
    }

    // Touch screen button overlays
    if (this.touchThrottle > 0) throttle = Math.max(throttle, this.touchThrottle);
    if (this.touchBrake > 0) brake = Math.max(brake, this.touchBrake);
    if (this.touchHandbrake) handbrake = true;

    return {
      throttle: Math.min(1.0, Math.max(0, throttle)),
      brake: Math.min(1.0, Math.max(0, brake)),
      steer: Math.min(1.0, Math.max(-1.0, steer)),
      handbrake,
    };
  }

  /**
   * Returns driving inputs for Player 2 (Local Split-Screen Duel)
   */
  public getPlayer2Inputs(): VehicleInputs {
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let handbrake = false;

    // Player 2 uses Arrow Keys (or IJKL)
    if (this.keys['ArrowUp'] || this.keys['KeyI']) throttle = 1.0;
    if (this.keys['ArrowDown'] || this.keys['KeyK']) brake = 1.0;
    if (this.keys['ArrowLeft'] || this.keys['KeyJ']) steer -= 1.0;
    if (this.keys['ArrowRight'] || this.keys['KeyL']) steer += 1.0;
    if (this.keys['ShiftRight'] || this.keys['Numpad0'] || this.keys['KeyM']) handbrake = true;

    return {
      throttle: Math.min(1.0, Math.max(0, throttle)),
      brake: Math.min(1.0, Math.max(0, brake)),
      steer: Math.min(1.0, Math.max(-1.0, steer)),
      handbrake,
    };
  }

  public isKeyJustPressed(code: string): boolean {
    const isPressed = !!this.keys[code];
    return isPressed;
  }
}
