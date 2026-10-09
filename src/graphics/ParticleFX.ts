import * as THREE from 'three';
import { VehiclePhysics } from '../physics/VehiclePhysics';

interface SmokeParticle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  maxScale: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

interface SkidSegment {
  active: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  opacity: number;
}

export class ParticleFX {
  private scene: THREE.Scene;

  // 1. Tire Smoke & Dust (Instanced Mesh)
  private maxSmoke = 160;
  private smokeParticles: SmokeParticle[] = [];
  private smokeMesh: THREE.InstancedMesh;
  private smokeDummy = new THREE.Object3D();
  private smokeMat: THREE.MeshStandardMaterial;

  // 2. Exhaust Backfire Flames & Sparks
  private flameGroup = new THREE.Group();
  private flameMeshL: THREE.Mesh;
  private flameMeshR: THREE.Mesh;
  private flameLight: THREE.PointLight;
  private flameTimer = 0;

  // 3. Dynamic Skid Mark Decals (Instanced Ribbons)
  private maxSkids = 240;
  private skidSegments: SkidSegment[] = [];
  private skidMesh: THREE.InstancedMesh;
  private skidDummy = new THREE.Object3D();
  private nextSkidIdx = 0;

  // Static scratch vectors for tire positions (P1)
  private static readonly _scratchTireL = new THREE.Vector3();
  private static readonly _scratchTireR = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // --- Smoke / Dust Particles ---
    const smokeGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this.smokeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.9,
      transparent: true,
      opacity: 0.75,
      flatShading: true,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, this.smokeMat, this.maxSmoke);
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.smokeMesh);

    for (let i = 0; i < this.maxSmoke; i++) {
      this.smokeParticles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        scale: 0.2,
        maxScale: 1.4,
        life: 0,
        maxLife: 1.0,
        color: new THREE.Color(0xf1f5f9),
      });
      this.smokeDummy.position.set(0, -999, 0);
      this.smokeDummy.scale.set(0, 0, 0);
      this.smokeDummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.smokeDummy.matrix);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;

    // --- Exhaust Flames & Light ---
    const flameGeo = new THREE.ConeGeometry(0.14, 0.5, 6);
    flameGeo.rotateX(-Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8, // Turbo blue core with orange rim
      transparent: true,
      opacity: 0.9,
    });
    this.flameMeshL = new THREE.Mesh(flameGeo, flameMat);
    this.flameMeshR = new THREE.Mesh(flameGeo, flameMat);
    this.flameMeshL.visible = false;
    this.flameMeshR.visible = false;

    this.flameLight = new THREE.PointLight(0xf97316, 0, 8);
    this.flameGroup.add(this.flameMeshL);
    this.flameGroup.add(this.flameMeshR);
    this.flameGroup.add(this.flameLight);
    scene.add(this.flameGroup);

    // --- Skid Mark Ribbons ---
    const skidGeo = new THREE.PlaneGeometry(0.32, 1.4);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x18181b,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, this.maxSkids);
    this.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.skidMesh);

    for (let i = 0; i < this.maxSkids; i++) {
      this.skidSegments.push({
        active: false,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
        opacity: 0,
      });
      this.skidDummy.position.set(0, -999, 0);
      this.skidDummy.updateMatrix();
      this.skidMesh.setMatrixAt(i, this.skidDummy.matrix);
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Spawns tire smoke puff when drifting or spinning wheels
   */
  public emitTireSmoke(pos: THREE.Vector3, vel: THREE.Vector3, isSand: boolean = false): void {
    // Find inactive particle
    let p = this.smokeParticles.find((part) => !part.active);
    if (!p) {
      p = this.smokeParticles[Math.floor(Math.random() * this.smokeParticles.length)];
    }

    p.active = true;
    p.position.copy(pos).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      0.15,
      (Math.random() - 0.5) * 0.3
    ));
    // Drift puff rises and floats with momentum
    p.velocity.copy(vel).multiplyScalar(0.2).add(new THREE.Vector3(
      (Math.random() - 0.5) * 1.4,
      1.2 + Math.random() * 1.8,
      (Math.random() - 0.5) * 1.4
    ));
    p.scale = 0.25;
    p.maxScale = isSand ? 1.6 : 1.3 + Math.random() * 0.8;
    p.life = 0;
    p.maxLife = 0.65 + Math.random() * 0.45;
    p.color.setHex(isSand ? 0xd4a373 : 0xf1f5f9);
  }

  /**
   * Spawns exhaust backfire flame pop
   */
  public triggerBackfire(pipes: THREE.Vector3[], carRoot: THREE.Group): void {
    if (pipes.length < 2) return;
    this.flameTimer = 0.12;

    const pL = pipes[0].clone().applyMatrix4(carRoot.matrixWorld);
    const pR = pipes[1].clone().applyMatrix4(carRoot.matrixWorld);

    this.flameMeshL.position.copy(pL);
    this.flameMeshL.quaternion.copy(carRoot.quaternion);
    this.flameMeshL.visible = true;

    this.flameMeshR.position.copy(pR);
    this.flameMeshR.quaternion.copy(carRoot.quaternion);
    this.flameMeshR.visible = true;

    this.flameLight.position.copy(pL).lerp(pR, 0.5);
    this.flameLight.intensity = 4.5;
  }

  /**
   * Leaves rubber skidmarks on asphalt
   */
  public addSkidMark(pos: THREE.Vector3, quat: THREE.Quaternion, roadY: number = 0.405): void {
    const s = this.skidSegments[this.nextSkidIdx];
    s.active = true;
    s.position.set(pos.x, roadY, pos.z);
    s.quaternion.copy(quat);
    s.opacity = 0.55;

    this.skidDummy.position.copy(s.position);
    this.skidDummy.quaternion.copy(s.quaternion);
    this.skidDummy.scale.set(1, 1, 1);
    this.skidDummy.updateMatrix();
    this.skidMesh.setMatrixAt(this.nextSkidIdx, this.skidDummy.matrix);
    this.skidMesh.instanceMatrix.needsUpdate = true;

    this.nextSkidIdx = (this.nextSkidIdx + 1) % this.maxSkids;
  }

  /**
   * Update particle positions and animation each frame
   */
  public update(delta: number, vehicles: VehiclePhysics[]): void {
    // 1. Process vehicle smoke / skid emissions
    for (const v of vehicles) {
      const isDrifting = v.isDrifting || Math.abs(v.slipAngle) > 0.16;
      const isSlipping = v.speedKmh > 18 && (isDrifting || v.weightTransfer.rearLeftLoad < 0.1);

      if (isSlipping) {
        // Rear tire positions in world space using static scratch vectors (P1)
        const leftRear = ParticleFX._scratchTireL.set(-0.8, 0.15, -1.05).applyQuaternion(v.quaternion).add(v.position);
        const rightRear = ParticleFX._scratchTireR.set(0.8, 0.15, -1.05).applyQuaternion(v.quaternion).add(v.position);

        if (Math.random() < 0.65) {
          this.emitTireSmoke(leftRear, v.velocity);
          this.emitTireSmoke(rightRear, v.velocity);
        }

        if (isDrifting && v.speedKmh > 24) {
          this.addSkidMark(leftRear, v.quaternion, v.position.y - 0.28);
          this.addSkidMark(rightRear, v.quaternion, v.position.y - 0.28);
        }
      }
    }

    // 2. Animate smoke particles
    for (let i = 0; i < this.maxSmoke; i++) {
      const p = this.smokeParticles[i];
      if (!p.active) continue;

      p.life += delta;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.smokeDummy.position.set(0, -999, 0);
        this.smokeDummy.scale.set(0, 0, 0);
        this.smokeDummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, this.smokeDummy.matrix);
        continue;
      }

      // Physics integration
      p.position.addScaledVector(p.velocity, delta);
      p.velocity.multiplyScalar(0.96); // Air drag

      // Scale expansion: grows from small puff to billowing cloud
      const progress = p.life / p.maxLife;
      const currentScale = THREE.MathUtils.lerp(p.scale, p.maxScale, Math.sqrt(progress));

      this.smokeDummy.position.copy(p.position);
      this.smokeDummy.scale.set(currentScale, currentScale, currentScale);
      this.smokeDummy.rotation.set(progress * 1.5, progress * 2.0, progress * 0.8);
      this.smokeDummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.smokeDummy.matrix);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;

    // 3. Animate exhaust backfire
    if (this.flameTimer > 0) {
      this.flameTimer -= delta;
      const flicker = 0.8 + Math.random() * 0.5;
      this.flameMeshL.scale.set(flicker, flicker, flicker * 1.4);
      this.flameMeshR.scale.set(flicker, flicker, flicker * 1.4);
      this.flameLight.intensity = this.flameTimer > 0 ? 5.0 * flicker : 0;
    } else {
      this.flameMeshL.visible = false;
      this.flameMeshR.visible = false;
      this.flameLight.intensity = 0;
    }
  }

  /**
   * M3: Comprehensive FX restart - removes leftover skidmarks, smoke, and flames
   */
  public reset(): void {
    // Clear smoke
    for (let i = 0; i < this.maxSmoke; i++) {
      this.smokeParticles[i].active = false;
      this.smokeDummy.position.set(0, -999, 0);
      this.smokeDummy.scale.set(0, 0, 0);
      this.smokeDummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.smokeDummy.matrix);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;

    // Clear skidmarks
    for (let i = 0; i < this.maxSkids; i++) {
      this.skidSegments[i].active = false;
      this.skidDummy.position.set(0, -999, 0);
      this.skidDummy.scale.set(0, 0, 0);
      this.skidDummy.updateMatrix();
      this.skidMesh.setMatrixAt(i, this.skidDummy.matrix);
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
    this.nextSkidIdx = 0;

    // Clear flames
    this.flameTimer = 0;
    this.flameMeshL.visible = false;
    this.flameMeshR.visible = false;
    this.flameLight.intensity = 0;
  }
}
