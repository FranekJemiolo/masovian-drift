import * as THREE from 'three';

export interface PhotoSettings {
  fov: number; // 20 to 110 degrees
  exposure: number; // 0.5 to 2.5
  vignette: number; // 0.0 to 1.0
  dofAperture: number; // 0.0 (pin-sharp) to 1.4 (shallow bokeh)
  showWatermark: boolean;
}

/**
 * 6-DOF Cinematic Photo Mode
 * Allows players to pause and compose high-fidelity screenshots of drifts, Świdermajer architecture,
 * and pine forest scenery with custom optical controls.
 */
export class PhotoMode {
  public isActive = false;
  private camera: THREE.PerspectiveCamera;
  private origPosition = new THREE.Vector3();
  private origQuaternion = new THREE.Quaternion();
  private origFov = 60;

  public settings: PhotoSettings = {
    fov: 55,
    exposure: 1.0,
    vignette: 0.35,
    dofAperture: 0.2,
    showWatermark: true,
  };

  private domOverlay: HTMLElement | null = null;
  public onExit?: () => void;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  public enter(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.origPosition.copy(this.camera.position);
    this.origQuaternion.copy(this.camera.quaternion);
    this.origFov = this.camera.fov;

    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();

    this.createUI();
  }

  public exit(): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.camera.position.copy(this.origPosition);
    this.camera.quaternion.copy(this.origQuaternion);
    this.camera.fov = this.origFov;
    this.camera.updateProjectionMatrix();

    if (this.domOverlay) {
      this.domOverlay.remove();
      this.domOverlay = null;
    }
    this.onExit?.();
  }

  public moveCamera(dx: number, dy: number, dz: number): void {
    if (!this.isActive) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    this.camera.position.addScaledVector(right, dx);
    this.camera.position.addScaledVector(up, dy);
    this.camera.position.addScaledVector(forward, dz);
  }

  public setFov(fovDeg: number): void {
    this.settings.fov = THREE.MathUtils.clamp(fovDeg, 18, 110);
    if (this.isActive) {
      this.camera.fov = this.settings.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  public captureScreenshot(renderer: THREE.WebGLRenderer): string {
    const dataUrl = renderer.domElement.toDataURL('image/png');
    return dataUrl;
  }

  private createUI(): void {
    if (this.domOverlay) return;
    const overlay = document.createElement('div');
    overlay.id = 'photo-mode-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 12px;
      padding: 16px;
      color: #fff;
      font-family: 'Inter', sans-serif;
      z-index: 9999;
      width: 260px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    `;

    overlay.innerHTML = `
      <div style="font-weight: 800; font-size: 14px; letter-spacing: 1px; color: #38bdf8; margin-bottom: 12px;">
        📸 CINEMATIC PHOTO MODE
      </div>
      <div style="font-size: 12px; margin-bottom: 8px;">
        <label>Focal Length / FOV: <span id="photo-fov-val">${this.settings.fov}°</span></label>
        <input type="range" id="photo-fov-slider" min="20" max="95" value="${this.settings.fov}" style="width: 100%; margin-top: 4px;">
      </div>
      <div style="font-size: 11px; color: #94a3b8; margin-top: 10px; line-height: 1.4;">
        Controls: WASD (Move), QE (Height), Mouse (Aim)
      </div>
      <button id="photo-capture-btn" style="
        width: 100%;
        margin-top: 14px;
        padding: 8px;
        background: #0284c7;
        color: white;
        border: none;
        border-radius: 6px;
        font-weight: bold;
        cursor: pointer;
      ">CAPTURE SHOT</button>
      <button id="photo-exit-btn" style="
        width: 100%;
        margin-top: 6px;
        padding: 6px;
        background: transparent;
        color: #94a3b8;
        border: 1px solid #334155;
        border-radius: 6px;
        cursor: pointer;
      ">EXIT PHOTO MODE</button>
    `;

    document.body.appendChild(overlay);
    this.domOverlay = overlay;

    const fovSlider = overlay.querySelector('#photo-fov-slider') as HTMLInputElement;
    const fovVal = overlay.querySelector('#photo-fov-val');
    fovSlider?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      this.setFov(val);
      if (fovVal) fovVal.textContent = `${val}°`;
    });

    overlay.querySelector('#photo-capture-btn')?.addEventListener('click', () => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const link = document.createElement('a');
        link.download = `masovian_drift_photo_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      }
    });

    overlay.querySelector('#photo-exit-btn')?.addEventListener('click', () => {
      this.exit();
    });
  }
}
