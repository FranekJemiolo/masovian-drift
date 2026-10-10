import * as THREE from 'three';

export type CameraViewMode = 'chase' | 'hood' | 'cinematic';

export class FollowCamera {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraViewMode = 'chase';

  private currentPosition = new THREE.Vector3();
  private currentLookTarget = new THREE.Vector3();
  private shakeOffset = new THREE.Vector3();
  private shakeIntensity = 0;
  private currentRoll = 0;

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
    this.currentPosition.copy(targetPos).addScaledVector(forward, -6.0).addScaledVector(up, 2.2);
    this.currentLookTarget.copy(targetPos).addScaledVector(forward, 12.0).addScaledVector(up, 0.9);
    this.currentRoll = 0;
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
    const lateralVel = velocity.dot(right);

    if (this.mode === 'chase') {
      // Stable horizontal chase framing inspired by Need for Speed & classic racers
      const distBehind = 5.5 + (speedKmh / 160.0) * 1.2;
      const heightAbove = 2.15 + (speedKmh / 200.0) * 0.35;

      // Flatten forward vector horizontally to decouple camera height from suspension pitch/roll
      const forwardFlat = new THREE.Vector3(forward.x, 0, forward.z).normalize();
      if (forwardFlat.lengthSq() < 0.1) forwardFlat.copy(forward);

      desiredPos.copy(targetPos)
        .addScaledVector(forwardFlat, -distBehind)
        .add(new THREE.Vector3(0, heightAbove, 0));

      // Dynamic apex lookahead: lead camera gaze INTO corners towards the apex
      const steerLead = -THREE.MathUtils.clamp(lateralVel * 0.18, -3.2, 3.2);
      const lookLead = 14.0 + (speedKmh / 120.0) * 7.0;

      desiredLook.copy(targetPos)
        .addScaledVector(forwardFlat, lookLead)
        .addScaledVector(right, steerLead)
        .add(new THREE.Vector3(0, 1.1, 0));

    } else if (this.mode === 'hood') {
      // Hood / Bumper camera
      desiredPos.copy(targetPos)
        .addScaledVector(forward, 1.2)
        .add(new THREE.Vector3(0, 0.85, 0));

      desiredLook.copy(targetPos)
        .addScaledVector(forward, 25.0)
        .add(new THREE.Vector3(0, 0.75, 0));

    } else {
      // Cinematic low side-rear angle
      desiredPos.copy(targetPos)
        .addScaledVector(forward, -5.6)
        .addScaledVector(right, 3.0)
        .add(new THREE.Vector3(0, 1.6, 0));

      desiredLook.copy(targetPos)
        .addScaledVector(forward, 6.0)
        .add(new THREE.Vector3(0, 1.0, 0));
    }

    // Initialize on first frame
    if (this.currentPosition.lengthSq() === 0) {
      this.currentPosition.copy(desiredPos);
      this.currentLookTarget.copy(desiredLook);
    }

    // Smooth position interpolation (Vector3.lerp)
    const posLerpRate = THREE.MathUtils.clamp(delta * (10.0 + (speedKmh / 80.0) * 4.0), 0.08, 0.55);
    this.currentPosition.lerp(desiredPos, posLerpRate);

    // Smooth look target interpolation to eliminate jitter
    const lookLerpRate = THREE.MathUtils.clamp(delta * 14.0, 0.12, 0.7);
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

    // Dynamic Drift Dutch Roll (G9: Leans into slide angle for exhilarating sense of speed)
    if (this.mode === 'chase') {
      const targetRoll = -THREE.MathUtils.clamp(lateralVel * 0.007, -0.075, 0.075);
      this.currentRoll = THREE.MathUtils.lerp(this.currentRoll, targetRoll, delta * 7.0);
      this.camera.rotateZ(this.currentRoll);
    }
  }
}
