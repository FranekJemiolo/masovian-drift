import * as THREE from 'three';

export type CameraViewMode = 'chase' | 'hood' | 'cinematic';

export class FollowCamera {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraViewMode = 'chase';

  private currentPosition = new THREE.Vector3();
  private currentLookTarget = new THREE.Vector3();
  private shakeOffset = new THREE.Vector3();
  private shakeIntensity = 0;

  constructor(fov: number = 62, aspect: number = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.2, 1200);
  }

  public setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public cycleMode(): CameraViewMode {
    if (this.mode === 'chase') this.mode = 'hood';
    else if (this.mode === 'hood') this.mode = 'cinematic';
    else this.mode = 'chase';
    return this.mode;
  }

  public snapToTarget(targetPos: THREE.Vector3, targetQuat: THREE.Quaternion): void {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(targetQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(targetQuat);
    this.currentPosition.copy(targetPos).addScaledVector(forward, -7.2).addScaledVector(up, 2.6);
    this.currentLookTarget.copy(targetPos).addScaledVector(forward, 9.0).addScaledVector(up, 1.2);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookTarget);
  }

  public addTrauma(amount: number): void {
    this.shakeIntensity = Math.min(1.0, this.shakeIntensity + amount);
  }

  /**
   * Smoothly updates camera position and orientation using Vector3.lerp and lookAt
   */
  public update(
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion,
    velocity: THREE.Vector3,
    speedKmh: number,
    delta: number
  ): void {
    // Dynamic FOV based on speed (gives high-speed thrill without nausea)
    const baseFov = 62;
    const targetFov = baseFov + Math.min(16, (speedKmh / 200) * 16);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, delta * 3.0);
    this.camera.updateProjectionMatrix();

    // Compute vehicle forward and up vectors
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(targetQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(targetQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(targetQuat);

    // Compute camera target position and look target based on mode
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();

    if (this.mode === 'chase') {
      // Offset behind and slightly above the vehicle
      const distBehind = 7.0 + (speedKmh / 160.0) * 1.5;
      const heightAbove = 2.8 + (speedKmh / 220.0) * 0.4;

      desiredPos.copy(targetPos)
        .addScaledVector(forward, -distBehind)
        .addScaledVector(up, heightAbove);

      // Look slightly ahead of the car, oriented with velocity direction
      const velDir = velocity.clone().normalize();
      const blendDir = velDir.lengthSq() > 0.1 ? velDir : forward;
      const lookLead = 8.0 + (speedKmh / 120.0) * 8.0;

      desiredLook.copy(targetPos)
        .addScaledVector(blendDir, lookLead)
        .addScaledVector(new THREE.Vector3(0, 1, 0), 1.2);

    } else if (this.mode === 'hood') {
      // Hood / Bumper camera
      desiredPos.copy(targetPos)
        .addScaledVector(forward, 1.2)
        .addScaledVector(up, 0.85);

      desiredLook.copy(targetPos)
        .addScaledVector(forward, 25.0)
        .addScaledVector(new THREE.Vector3(0, 1, 0), 0.7);

    } else {
      // Cinematic low side-rear angle
      desiredPos.copy(targetPos)
        .addScaledVector(forward, -6.0)
        .addScaledVector(right, 3.2)
        .addScaledVector(up, 1.6);

      desiredLook.copy(targetPos)
        .addScaledVector(forward, 6.0)
        .addScaledVector(new THREE.Vector3(0, 1, 0), 1.0);
    }

    // Initialize on first frame
    if (this.currentPosition.lengthSq() === 0) {
      this.currentPosition.copy(desiredPos);
      this.currentLookTarget.copy(desiredLook);
    }

    // Smooth position interpolation (Vector3.lerp)
    // Faster follow when moving quickly, softer damping when idling
    const posLerpRate = THREE.MathUtils.clamp(delta * (8.0 + (speedKmh / 100) * 4.0), 0.05, 0.45);
    this.currentPosition.lerp(desiredPos, posLerpRate);

    // Smooth look target interpolation to eliminate jitter
    const lookLerpRate = THREE.MathUtils.clamp(delta * 12.0, 0.1, 0.6);
    this.currentLookTarget.lerp(desiredLook, lookLerpRate);

    // Apply trauma camera shake
    if (this.shakeIntensity > 0.01) {
      const shakeMag = this.shakeIntensity * this.shakeIntensity * 0.35;
      this.shakeOffset.set(
        (Math.random() - 0.5) * shakeMag,
        (Math.random() - 0.5) * shakeMag,
        (Math.random() - 0.5) * shakeMag
      );
      this.shakeIntensity = Math.max(0, this.shakeIntensity - delta * 1.5);
    } else {
      this.shakeOffset.set(0, 0, 0);
      this.shakeIntensity = 0;
    }

    this.camera.position.copy(this.currentPosition).add(this.shakeOffset);
    this.camera.lookAt(this.currentLookTarget);
  }
}
