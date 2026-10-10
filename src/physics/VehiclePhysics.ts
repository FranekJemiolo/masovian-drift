import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { VehicleDamage, VehicleSpecs, VehicleState, WeightTransferState } from '../game/Types';
import { CarVisualElements } from '../graphics/VoxelCarBuilder';
import { Waypoint } from './TrackWaypoints';
import { PRNG } from '../utils/PRNG';

export interface VehicleInputs {
  throttle: number; // 0.0 to 1.0
  brake: number;    // 0.0 to 1.0
  steer: number;    // -1.0 to 1.0
  handbrake: boolean;
}

export class VehiclePhysics {
  public id: string;
  public name: string;
  public isPlayer: boolean;
  public isAI: boolean;

  public rigidBody!: RAPIER.RigidBody;
  public collider!: RAPIER.Collider;
  public visual: CarVisualElements;
  public specs: VehicleSpecs;
  public damage: VehicleDamage;
  public justCrashed = 0;

  // Kinematic state
  public position = new THREE.Vector3();
  public quaternion = new THREE.Quaternion();
  public velocity = new THREE.Vector3();
  public angularVelocity = new THREE.Vector3();
  public speedKmh = 0;

  // Powertrain & Dynamics
  public rpm = 900;
  public currentGear = 1; // -1 = Rev, 0 = Neutral, 1..5
  public steerAngle = 0;
  public targetSteerAngle = 0;
  public slipAngle = 0;
  public isDrifting = false;
  public driftScore = 0;
  private driftDuration = 0;

  // Dynamic weight transfer state
  public weightTransfer: WeightTransferState = {
    frontLeftLoad: 0.20,
    frontRightLoad: 0.20,
    rearLeftLoad: 0.30,
    rearRightLoad: 0.30,
    frontBias: 0.40,
    rearBias: 0.60,
    rollAngle: 0,
    pitchAngle: 0,
  };

  // Raycast Vehicle Suspension parameters (Hooke's Law: F = -kx - cv)
  private physicsWorld!: RAPIER.World;
  private readonly wheelbase = 2.4; // meters
  private readonly trackWidth = 1.55; // meters
  private readonly cogHeight = 0.42; // Center of gravity height
  private readonly suspensionRestLen = 0.48;
  private readonly suspensionMaxLen = 0.76;
  private readonly springStiffnessFront = 28000;
  private readonly springStiffnessRear = 38000;
  private readonly damperCoeffFront = 2200;
  private readonly damperCoeffRear = 2600;

  private readonly wheelOffsets = [
    new THREE.Vector3(-0.76, 0.32, 1.05),  // FL
    new THREE.Vector3(0.76, 0.32, 1.05),   // FR
    new THREE.Vector3(-0.80, 0.32, -1.05), // RL
    new THREE.Vector3(0.80, 0.32, -1.05),  // RR
  ];
  public wheelCompressions = [0, 0, 0, 0];
  public wheelGroundedCount = 4;

  // Race progression tracking
  private brakeRotorHeat = 0;
  public currentLap = 1;
  public currentCheckpointIndex = 0;
  public currentLapTime = 0;
  public bestLapTime = Infinity;
  public raceFinished = false;
  public raceRank = 1;

  // Surface & Kerb geometry tracking (M1)
  public currentSurface: 'asphalt' | 'gravel' | 'sand' | 'kerb' | 'grass' = 'asphalt';
  public isOnKerb = false;
  public isOffTrack = false;
  public isWrongWay = false;
  private lastClosestWpIdx = 0;

  // Recovery timers (M7)
  public flipTimer = 0;
  public offTrackTimer = 0;

  public get upVector(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
  }

  // Scratch objects for zero-allocation per-frame physics (P1)
  private static readonly _vForward = new THREE.Vector3();
  private static readonly _vRight = new THREE.Vector3();
  private static readonly _vUp = new THREE.Vector3();
  private static readonly _vAccel = new THREE.Vector3();
  private static readonly _vForceWorld = new THREE.Vector3();
  private static readonly _vToCar = new THREE.Vector3();

  // Collision damage accumulator
  private lastVelocity = new THREE.Vector3();
  public spawnGraceTimer = 1.0;

  constructor(
    id: string,
    name: string,
    specs: VehicleSpecs,
    visual: CarVisualElements,
    world: RAPIER.World,
    spawnPos: THREE.Vector3,
    spawnQuat: THREE.Quaternion,
    isPlayer: boolean = false,
    isAI: boolean = false,
    damage?: VehicleDamage
  ) {
    this.id = id;
    this.name = name;
    this.specs = specs;
    this.visual = visual;
    this.isPlayer = isPlayer;
    this.isAI = isAI;

    this.damage = damage ?? {
      bodyDamage: 0.0,
      aerodynamicDragPenalty: 1.0,
      steeringAlignmentOffset: 0.0,
      engineWear: 0.0,
    };

    this.initRigidBody(world, spawnPos, spawnQuat);
  }

  private initRigidBody(
    world: RAPIER.World,
    spawnPos: THREE.Vector3,
    spawnQuat: THREE.Quaternion
  ): void {
    this.physicsWorld = world;
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPos.x, spawnPos.y + 0.45, spawnPos.z)
      .setRotation(new RAPIER.Quaternion(spawnQuat.x, spawnQuat.y, spawnQuat.z, spawnQuat.w))
      .setLinearDamping(0.04)
      .setAngularDamping(0.4)
      .setCanSleep(false);

    this.rigidBody = world.createRigidBody(rbDesc);

    // Chassis collision box (raised with y-offset so bottom sits at y = -0.06, well above ground contact patch!)
    const colDesc = RAPIER.ColliderDesc.cuboid(0.82, 0.28, 1.90)
      .setTranslation(0, 0.22, 0)
      .setMass(this.specs.mass)
      .setFriction(0.0)
      .setRestitution(0.05);

    this.position.copy(spawnPos);
    this.quaternion.copy(spawnQuat);
    this.visual.root.position.copy(spawnPos);
    this.visual.root.quaternion.copy(spawnQuat);
    this.collider = world.createCollider(colDesc, this.rigidBody);
  }

  /**
   * Evaluates the Pacejka '94 Magic Formula for lateral tire force (Section 7.2):
   * Fy = D * sin(C * arctan(B * alpha - E * (B * alpha - arctan(B * alpha))))
   * where:
   *   alpha: tire slip angle (radians)
   *   normalLoadN: vertical load Fz on the tire (Newtons)
   *   surfaceGrip: friction coefficient (asphalt, gravel, sand)
   *   mu: peak friction coefficient
   */
  public static pacejka94LateralForce(
    alpha: number,
    normalLoadN: number,
    surfaceGrip: number = 1.0,
    mu: number = 1.15
  ): number {
    const B = 10.0; // Stiffness factor
    const C = 1.65; // Shape factor
    const D = mu * surfaceGrip * Math.max(100.0, normalLoadN); // Peak friction force
    const E = -0.85; // Curvature factor

    const B_alpha = B * alpha;
    const inside = B_alpha - E * (B_alpha - Math.atan(B_alpha));
    // Opposes slip angle direction
    return -D * Math.sin(C * Math.atan(inside));
  }

  /**
   * Fixed physics step update (60 Hz)
   */
  public updatePhysics(inputs: VehicleInputs, dt: number, waypoints?: Waypoint[]): void {
    if (!this.rigidBody) return;

    // 1. Fetch current Rapier state
    const t = this.rigidBody.translation();
    const r = this.rigidBody.rotation();
    const lv = this.rigidBody.linvel();
    const av = this.rigidBody.angvel();

    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    this.velocity.set(lv.x, lv.y, lv.z);
    this.angularVelocity.set(av.x, av.y, av.z);

    // Compute vehicle coordinate frame using static scratch vectors (P1)
    const forward = VehiclePhysics._vForward.set(0, 0, 1).applyQuaternion(this.quaternion);
    const right = VehiclePhysics._vRight.set(1, 0, 0).applyQuaternion(this.quaternion);
    const up = VehiclePhysics._vUp.set(0, 1, 0).applyQuaternion(this.quaternion);

    const forwardSpeed = this.velocity.dot(forward);
    const lateralSpeed = this.velocity.dot(right);
    this.speedKmh = Math.abs(forwardSpeed) * 3.6;

    // Detect impact shock & accumulate damage (horizontal only, with spawn grace period)
    if (this.spawnGraceTimer > 0) {
      this.spawnGraceTimer -= dt;
    }
    const accelVector = VehiclePhysics._vAccel.copy(this.velocity).sub(this.lastVelocity).divideScalar(dt);
    const horizAccel = Math.hypot(accelVector.x, accelVector.z);
    const impactG = horizAccel / 9.81;
    if (this.spawnGraceTimer <= 0 && impactG > 14.0) {
      const damageAmount = Math.min(0.25, (impactG - 14.0) * 0.015);
      this.damage.bodyDamage = Math.min(1.0, this.damage.bodyDamage + damageAmount);
      // Aerodynamic penalty increases with body crumpling
      this.damage.aerodynamicDragPenalty = 1.0 + this.damage.bodyDamage * 1.1; // up to 2.1x drag!
      // Tie-rod alignment bends slightly with crashes (deterministic PRNG, M4)
      this.damage.steeringAlignmentOffset += PRNG.global.range(-0.5, 0.5) * 0.015 * damageAmount;
      this.damage.steeringAlignmentOffset = THREE.MathUtils.clamp(
        this.damage.steeringAlignmentOffset,
        -0.045,
        0.045
      );
      this.justCrashed = Math.min(1.0, (impactG - 14.0) / 18.0);
    } else {
      this.justCrashed = 0;
    }
    this.lastVelocity.copy(this.velocity);

    // 1b. FOUR-POINT RAYCAST VEHICLE SUSPENSION (Hovercraft Physics: F = -kx - cv)
    this.wheelGroundedCount = 0;
    const chassisVel = this.velocity;
    const chassisAngVel = this.angularVelocity;

    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const offset = this.wheelOffsets[i];
      const wheelWorld = offset.clone().applyQuaternion(this.quaternion).add(this.position);

      const ray = new RAPIER.Ray(
        new RAPIER.Vector3(wheelWorld.x, wheelWorld.y, wheelWorld.z),
        new RAPIER.Vector3(-up.x, -up.y, -up.z)
      );

      const hit = this.physicsWorld.castRayAndGetNormal(
        ray,
        this.suspensionMaxLen,
        false,
        undefined,
        undefined,
        undefined,
        this.rigidBody
      );

      if (hit && hit.timeOfImpact < this.suspensionMaxLen) {
        this.wheelGroundedCount++;
        const currentLen = hit.timeOfImpact;
        const compression = Math.max(0, this.suspensionRestLen - currentLen);
        this.wheelCompressions[i] = compression;

        // Compression velocity: v_point = v + omega x r
        const rArm = wheelWorld.clone().sub(this.position);
        const pointVel = chassisVel.clone().add(chassisAngVel.clone().cross(rArm));
        const suspVel = -pointVel.dot(up);

        const k = isFront ? this.springStiffnessFront : this.springStiffnessRear;
        const c = isFront ? this.damperCoeffFront : this.damperCoeffRear;
        const suspForceN = Math.max(0, k * compression - c * suspVel);

        const impulse = up.clone().multiplyScalar(suspForceN * dt);
        this.rigidBody.applyImpulseAtPoint(
          new RAPIER.Vector3(impulse.x, impulse.y, impulse.z),
          new RAPIER.Vector3(wheelWorld.x, wheelWorld.y, wheelWorld.z),
          true
        );
      } else {
        this.wheelCompressions[i] = 0;
      }
    }

    // 1c. AIRBORNE STABILIZATION (Angular Stability auto-alignment)
    const isAirborne = this.wheelGroundedCount <= 1;
    if (isAirborne) {
      let targetNormal = new THREE.Vector3(0, 1, 0);
      const centerDownRay = new RAPIER.Ray(
        new RAPIER.Vector3(this.position.x, this.position.y, this.position.z),
        new RAPIER.Vector3(0, -1, 0)
      );
      const groundHit = this.physicsWorld.castRayAndGetNormal(
        centerDownRay,
        15.0,
        false,
        undefined,
        undefined,
        undefined,
        this.rigidBody
      );
      if (groundHit && groundHit.normal) {
        targetNormal.set(groundHit.normal.x, groundHit.normal.y, groundHit.normal.z).normalize();
      }

      const rollTilt = right.dot(targetNormal);
      const pitchTilt = forward.dot(targetNormal);

      const mass = this.specs.mass;
      const rollCorrection = -rollTilt * (mass * 24.0) - this.angularVelocity.z * (mass * 3.5);
      const pitchCorrection = -pitchTilt * (mass * 20.0) - this.angularVelocity.x * (mass * 3.5);

      const airTorque = forward.clone().multiplyScalar(rollCorrection)
        .add(right.clone().multiplyScalar(pitchCorrection));

      this.rigidBody.applyTorqueImpulse(
        new RAPIER.Vector3(airTorque.x * dt, airTorque.y * dt, airTorque.z * dt),
        true
      );
    }

    // M1: Real Geometric Kerb & Track Surface Detection
    let surfaceGrip = 1.0;
    if (waypoints && waypoints.length > 0) {
      const n = waypoints.length;
      let closestIdx = this.lastClosestWpIdx;
      let minDistSq = this.position.distanceToSquared(waypoints[closestIdx].point);

      for (let offset = -6; offset <= 12; offset++) {
        const idx = (this.lastClosestWpIdx + offset + n) % n;
        const dSq = this.position.distanceToSquared(waypoints[idx].point);
        if (dSq < minDistSq) {
          minDistSq = dSq;
          closestIdx = idx;
        }
      }
      this.lastClosestWpIdx = closestIdx;
      const wp = waypoints[closestIdx];

      const toCar = VehiclePhysics._vToCar.copy(this.position).sub(wp.point);
      const normal = wp.normal ?? right;
      const lateralDist = toCar.dot(normal);
      const absOffset = Math.abs(lateralDist);
      const halfWidth = wp.width * 0.5;
      const curbWidth = 1.45;

      if (absOffset <= halfWidth) {
        this.isOnKerb = false;
        this.isOffTrack = false;
        this.currentSurface = wp.surface;
        if (wp.surface === 'asphalt') surfaceGrip = 1.0;
        else if (wp.surface === 'gravel') surfaceGrip = 0.74;
        else if (wp.surface === 'sand') surfaceGrip = 0.44;
      } else if (absOffset <= halfWidth + curbWidth) {
        this.isOnKerb = true;
        this.isOffTrack = false;
        this.currentSurface = 'kerb';
        surfaceGrip = 0.88;
      } else {
        this.isOnKerb = false;
        this.isOffTrack = true;
        this.currentSurface = 'grass';
        surfaceGrip = 0.52;
      }

      // Wrong-way orientation check (U10)
      if (wp.tangent) {
        const forwardDot = forward.dot(wp.tangent);
        this.isWrongWay = forwardDot < -0.35 && this.speedKmh > 12;
      }
    }

    // 2. DYNAMIC WEIGHT TRANSFER CALCULATIONS (Porsche Unleashed Inspiration)
    // Longitudinal acceleration
    const longAccel = accelVector.dot(forward);
    // Lateral acceleration
    const latAccel = accelVector.dot(right);

    // Static distribution: 40% Front, 60% Rear
    const staticFront = 0.40;
    const staticRear = 0.60;

    // Longitudinal weight transfer: dFz = (m * a_x * h_cog) / wheelbase
    // Acceleration (longAccel > 0) transfers mass from front to rear!
    // Braking (longAccel < 0) violently shifts weight to the front!
    const weightShiftLong = (longAccel * this.cogHeight) / (this.wheelbase * 9.81);
    const dynamicFrontBias = THREE.MathUtils.clamp(staticFront - weightShiftLong, 0.15, 0.85);
    const dynamicRearBias = 1.0 - dynamicFrontBias;

    // Lateral weight transfer: dFz_lat = (m * a_y * h_cog) / trackWidth
    const weightShiftLat = (latAccel * this.cogHeight) / (this.trackWidth * 9.81);

    // Calculate individual wheel loads (relative to total mass)
    // Lateral weight shift transfers load to OUTSIDE tires during cornering:
    this.weightTransfer.frontLeftLoad = Math.max(0.02, (dynamicFrontBias * 0.5) + weightShiftLat * 0.5);
    this.weightTransfer.frontRightLoad = Math.max(0.02, (dynamicFrontBias * 0.5) - weightShiftLat * 0.5);
    this.weightTransfer.rearLeftLoad = Math.max(0.02, (dynamicRearBias * 0.5) + weightShiftLat * 0.5);
    this.weightTransfer.rearRightLoad = Math.max(0.02, (dynamicRearBias * 0.5) - weightShiftLat * 0.5);

    this.weightTransfer.frontBias = dynamicFrontBias;
    this.weightTransfer.rearBias = dynamicRearBias;
    this.weightTransfer.pitchAngle = weightShiftLong * 0.15;
    this.weightTransfer.rollAngle = weightShiftLat * 0.12;

    // 3. STEERING & ALIGNMENT
    // Speed-sensitive steering ratio
    const speedRatio = Math.min(1.0, this.speedKmh / 160.0);
    const maxSteer = THREE.MathUtils.lerp(0.58, 0.22, speedRatio); // Radian max steer
    // Add persistent damage steering alignment pull
    const damagedSteerInput = inputs.steer + this.damage.steeringAlignmentOffset;
    this.targetSteerAngle = THREE.MathUtils.clamp(damagedSteerInput, -1.0, 1.0) * maxSteer;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, this.targetSteerAngle, dt * 14.0);

    // 4. GEARBOX & ENGINE RPM (Flywheel Inertia Dynamics)
    this.updatePowertrain(inputs, forwardSpeed, dt);

    // 5. TIRE FORCES & OVERSTEER DYNAMICS
    const totalWeightN = this.specs.mass * 9.81;
    const frontNormalN = totalWeightN * dynamicFrontBias;
    const rearNormalN = totalWeightN * dynamicRearBias;

    // Tire grip limits (governed by normal force * surface friction)
    const frontMaxGrip = frontNormalN * surfaceGrip * 1.35;
    let rearMaxGrip = rearNormalN * surfaceGrip * 1.45;

    // Handbrake breaks rear traction immediately
    if (inputs.handbrake) {
      rearMaxGrip *= 0.20;
    }

    // Rear slip angle (rad)
    this.slipAngle = Math.atan2(lateralSpeed, Math.max(1.5, Math.abs(forwardSpeed)));

    // Trail-Braking Oversteer:
    // If braking into a turn, rearNormalN drops drastically (unloaded rear axle).
    // The unloaded rear tires lose lateral capacity, causing the classic Boxer oversteer pendulum!
    const isTrailBraking = inputs.brake > 0.2 && Math.abs(this.steerAngle) > 0.08;
    if (isTrailBraking) {
      rearMaxGrip *= 0.65; // Massive lift-off / trail-braking oversteer!
    }

    // Drive Force (RWD rear wheels only, authentic Boxer torque curve - M9)
    let driveForceN = 0;
    if (inputs.throttle > 0) {
      const gearRatio = this.specs.gearRatios[Math.max(1, this.currentGear)];

      // Realistic Flat-6 Boxer Torque Curve (M9)
      const peakTorqueNm = (this.specs.enginePowerKw * 1000 * 9.5488) / 5200;
      let torqueCurveFactor = 0.7;
      if (this.rpm < 2200) {
        torqueCurveFactor = 0.65 + (this.rpm / 2200) * 0.20;
      } else if (this.rpm < 3800) {
        torqueCurveFactor = 0.85 + ((this.rpm - 2200) / 1600) * 0.15;
      } else if (this.rpm <= 5800) {
        torqueCurveFactor = 1.0; // Sweet-spot torque plateau
      } else if (this.rpm <= 6800) {
        torqueCurveFactor = 1.0 - ((this.rpm - 5800) / 1000) * 0.12;
      } else {
        torqueCurveFactor = Math.max(0.15, 0.88 - ((this.rpm - 6800) / 400) * 0.7);
      }

      // Rev-limiter ignition cut (M9)
      if (this.rpm >= 7180) {
        torqueCurveFactor *= 0.1;
      }

      // Engine power output degradation tied to body/mechanical damage (M10)
      const engineHealthFactor = Math.max(0.68, 1.0 - this.damage.bodyDamage * 0.32);
      const engineTorque = peakTorqueNm * torqueCurveFactor * engineHealthFactor;
      const wheelTorque = engineTorque * gearRatio * this.specs.finalDrive * inputs.throttle;
      const tireRadius = 0.32;
      driveForceN = (wheelTorque / tireRadius);

      // Tire traction limit (rear axle)
      if (driveForceN > rearMaxGrip * 1.6) {
        driveForceN = rearMaxGrip * 1.6; // Wheelspin!
      }
    }

    // Braking Force (60% front, 40% rear bias)
    let brakeForceN = 0;
    if (inputs.brake > 0) {
      brakeForceN = inputs.brake * 16000.0;
      if (forwardSpeed < 1.0 && inputs.brake > 0.4) {
        // Reverse gear
        driveForceN = -inputs.brake * 5500.0;
        brakeForceN = 0;
      }
    }

    // Lateral Tire Grip:
    // Cancels lateral sliding cleanly when not drifting
    const latCancelForce = -lateralSpeed * (this.specs.mass * 9.5);
    const maxCombinedGrip = (frontMaxGrip + rearMaxGrip);
    const clampedLatForce = THREE.MathUtils.clamp(latCancelForce, -maxCombinedGrip, maxCombinedGrip);

    // Front lateral cornering force via Pacejka '94 Magic Formula (Section 7.2)
    const frontSlipAngle = this.slipAngle - this.steerAngle;
    const frontPacejka = VehiclePhysics.pacejka94LateralForce(
      frontSlipAngle,
      frontNormalN,
      surfaceGrip,
      this.isDrifting ? 0.88 : 1.18
    );
    const frontLateralForce = THREE.MathUtils.clamp(frontPacejka, -frontMaxGrip, frontMaxGrip);

    // Rear lateral cornering force via Pacejka '94 Magic Formula (Section 7.2)
    const rearPacejka = VehiclePhysics.pacejka94LateralForce(
      this.slipAngle,
      rearNormalN,
      surfaceGrip,
      this.isDrifting ? 0.75 : 1.25
    );
    const rearLateralForce = THREE.MathUtils.clamp(rearPacejka, -rearMaxGrip, rearMaxGrip);

    // Detect Drift state
    const driftThreshold = 0.15; // ~8.5 degrees
    if (Math.abs(this.slipAngle) > driftThreshold && this.speedKmh > 22.0) {
      this.isDrifting = true;
      this.driftDuration += dt;
      const scoreGain = Math.floor(Math.abs(this.slipAngle) * (this.speedKmh / 20) * dt * 250);
      this.driftScore += scoreGain;
    } else {
      this.isDrifting = false;
      this.driftDuration = Math.max(0, this.driftDuration - dt * 2.0);
    }

    // Aerodynamic Drag & Downforce (degraded by damage)
    const effectiveCd = this.specs.dragCoefficient * this.damage.aerodynamicDragPenalty;
    const airDensity = 1.225;
    const frontalArea = 1.95;
    const aeroDragForce = 0.5 * airDensity * effectiveCd * frontalArea * (forwardSpeed * forwardSpeed);
    const aeroDownforce = 0.5 * airDensity * 0.45 * (forwardSpeed * forwardSpeed);

    // Apply forces and torques to Rapier RigidBody
    // 1. Forward Net Force
    let netLongForce = (driveForceN - Math.sign(forwardSpeed) * (brakeForceN + aeroDragForce));

    // Vector Redirection (Technique #2): Redirect lateral sliding force into forward speed during drifts
    if (this.isDrifting) {
      const redirectedForwardN = Math.abs(clampedLatForce) * 0.38;
      netLongForce += redirectedForwardN;
    }
    const forceWorld = VehiclePhysics._vForceWorld.copy(forward).multiplyScalar(netLongForce);

    // 2. Lateral Force (lateral tire adhesion holding car to corner line)
    const driftGripScale = this.isDrifting ? 0.65 : 1.0;
    const netLatForce = clampedLatForce * driftGripScale;
    forceWorld.addScaledVector(right, netLatForce);

    // Front steered lateral traction force (pulls vehicle front in steer direction)
    const frontSteerLateralForce = (this.steerAngle * Math.sign(forwardSpeed || 1)) * Math.min(1.0, this.speedKmh / 14.0) * (frontNormalN * 0.85);
    forceWorld.addScaledVector(right, frontSteerLateralForce);

    // 3. Downforce
    forceWorld.y -= aeroDownforce;

    // Apply linear impulse
    this.rigidBody.applyImpulse(
      new RAPIER.Vector3(forceWorld.x * dt, forceWorld.y * dt, forceWorld.z * dt),
      true
    );

    // 4. RESPONSIVE YAW & STEERING INTEGRATION (Kinematic + Dynamic)
    // Low speeds (< 24 km/h): Kinematic Ackermann steering ensures immediate, agile vehicle rotation
    const lowSpeedBlend = THREE.MathUtils.clamp(1.0 - (this.speedKmh / 24.0), 0.0, 1.0);
    const targetAckermannYawRate = (forwardSpeed / this.wheelbase) * Math.tan(this.steerAngle) * 1.25;

    // High speeds: Dynamic yaw torque from tire slip difference + direct steering moment
    const dynamicYawTorque = (frontLateralForce * (this.wheelbase * 0.58)) - (rearLateralForce * (this.wheelbase * 0.42));
    const directSteerTorque = this.steerAngle * Math.sign(forwardSpeed || 1) * Math.min(1.0, this.speedKmh / 15.0) * (this.specs.mass * 9.5);
    const highSpeedYawTorque = dynamicYawTorque + directSteerTorque;

    // Compute yaw impulse and apply along local vehicle UP axis
    const currentYawRate = this.angularVelocity.y;
    const kinematicYawImpulse = (targetAckermannYawRate - currentYawRate) * (this.specs.mass * 1.6) * lowSpeedBlend;
    const dynamicYawImpulse = (highSpeedYawTorque - currentYawRate * 1800.0) * (1.0 - lowSpeedBlend) * dt;

    const totalYawImpulse = THREE.MathUtils.clamp(
      kinematicYawImpulse + dynamicYawImpulse,
      -this.specs.mass * 3.5,
      this.specs.mass * 3.5
    );
    const yawImpulseWorld = up.clone().multiplyScalar(totalYawImpulse);
    this.rigidBody.applyTorqueImpulse(
      new RAPIER.Vector3(yawImpulseWorld.x, yawImpulseWorld.y, yawImpulseWorld.z),
      true
    );

    // Anti-roll & stabilization upright torque
    const tiltDot = up.dot(new THREE.Vector3(0, 1, 0));
    if (tiltDot < 0.98) {
      const uprightCorrection = new THREE.Vector3(0, 1, 0).cross(up).multiplyScalar(-9500.0 * dt);
      this.rigidBody.applyTorqueImpulse(
        new RAPIER.Vector3(uprightCorrection.x, uprightCorrection.y, uprightCorrection.z),
        true
      );
    }

    // 6. UPDATE 3D VISUALS (Chassis and Wheels)
    this.updateVisuals(inputs, dt);
  }

  /**
   * Powertrain RPM calculation with flywheel inertia and automatic gear selection
   */
  private updatePowertrain(inputs: VehicleInputs, forwardSpeed: number, dt: number): void {
    const wheelRadius = 0.32;
    const wheelRps = Math.abs(forwardSpeed) / (2 * Math.PI * wheelRadius);
    const finalDrive = this.specs.finalDrive;

    // Automatic gear shifting based on true drivetrain wheel load
    if (forwardSpeed < -1.0) {
      this.currentGear = -1; // Reverse
    } else {
      if (this.currentGear <= 0) this.currentGear = 1;

      const currentGearRatio = this.specs.gearRatios[this.currentGear];
      const wheelLinkedRpm = wheelRps * currentGearRatio * finalDrive * 60;

      // Upshift at redline plateau (6500 RPM wheel-linked)
      if (wheelLinkedRpm > 6500 && this.currentGear < 5) {
        this.currentGear++;
      }
      // Downshift when dropping below 2600 RPM
      else if (wheelLinkedRpm < 2600 && this.currentGear > 1) {
        this.currentGear--;
      }
    }

    const currentGearRatio = this.specs.gearRatios[Math.max(1, this.currentGear)];
    const wheelLinkedRpm = wheelRps * currentGearRatio * finalDrive * 60;

    // Flywheel inertia model:
    // dRPM / dt = (Torque - Load) / I_flywheel
    // Lighter flywheel = faster rev response!
    const flywheelInertia = this.specs.flywheelInertia;

    // Clutch slip model: allows high launch revs off the line, locks up smoothly above 18 km/h
    const clutchSlip = Math.max(0, 1.0 - this.speedKmh / 18.0);
    let targetRpm = Math.max(this.specs.idleRpm, wheelLinkedRpm);

    if (inputs.throttle > 0) {
      targetRpm += inputs.throttle * 2400.0 * clutchSlip;
    }

    targetRpm = Math.min(this.specs.maxRpm, targetRpm);
    const revRate = (34.0 / flywheelInertia) * dt;
    this.rpm = THREE.MathUtils.lerp(this.rpm, targetRpm, THREE.MathUtils.clamp(revRate, 0.05, 0.45));
  }

  /**
   * Syncs 3D mesh transforms, chassis pitch/roll tilt, wheel rotation and steering
   */
  private updateVisuals(inputs: VehicleInputs, dt: number): void {
    // Synchronize root transform to Rapier rigid body
    this.visual.root.position.copy(this.position);
    this.visual.root.quaternion.copy(this.quaternion);

    // Apply visual chassis pitch (squat / dive) and roll (outward centrifugal lean)
    this.visual.bodyMesh.rotation.x = -this.weightTransfer.pitchAngle * 0.6;
    this.visual.bodyMesh.rotation.z = -this.weightTransfer.rollAngle * 0.7;

    // Visual damage model (M10): body deformation and asymmetrical crumple tilt
    if (this.damage.bodyDamage > 0.05) {
      const crumpleTilt = Math.min(0.045, this.damage.bodyDamage * 0.045);
      const crumpleYaw = Math.min(0.02, this.damage.bodyDamage * 0.02);
      this.visual.bodyMesh.rotation.z += (this.damage.steeringAlignmentOffset >= 0 ? 1 : -1) * crumpleTilt;
      this.visual.bodyMesh.rotation.y = (this.damage.steeringAlignmentOffset >= 0 ? -1 : 1) * crumpleYaw;
      this.visual.bodyMesh.position.y = -Math.min(0.03, this.damage.bodyDamage * 0.025);
    } else {
      this.visual.bodyMesh.rotation.y = 0;
      this.visual.bodyMesh.position.y = 0;
    }

    // Steer front wheels cleanly around vertical Y axis (isolated steering knuckle)
    this.visual.wheelFL.rotation.y = this.steerAngle;
    this.visual.wheelFR.rotation.y = this.steerAngle;

    // Visual suspension travel on 4 wheels
    const flTravel = Math.max(-0.10, Math.min(0.10, this.wheelCompressions[0] - 0.05));
    const frTravel = Math.max(-0.10, Math.min(0.10, this.wheelCompressions[1] - 0.05));
    const rlTravel = Math.max(-0.10, Math.min(0.10, this.wheelCompressions[2] - 0.05));
    const rrTravel = Math.max(-0.10, Math.min(0.10, this.wheelCompressions[3] - 0.05));

    this.visual.wheelFL.position.y = 0.32 + flTravel;
    this.visual.wheelFR.position.y = 0.32 + frTravel;
    this.visual.wheelRL.position.y = 0.32 + rlTravel;
    this.visual.wheelRR.position.y = 0.32 + rrTravel;

    // Spin wheels along forward axle X axis via dedicated spin sub-groups (no gimbal wobble!)
    const forward = VehiclePhysics._vForward.set(0, 0, 1).applyQuaternion(this.quaternion);
    const forwardSpeed = this.velocity.dot(forward);
    const wheelSpinDelta = (forwardSpeed / 0.32) * dt;

    if (this.visual.wheelSpins && this.visual.wheelSpins.length === 4) {
      this.visual.wheelSpins[0].rotation.x += wheelSpinDelta;
      this.visual.wheelSpins[1].rotation.x += wheelSpinDelta;
      this.visual.wheelSpins[2].rotation.x += wheelSpinDelta;
      this.visual.wheelSpins[3].rotation.x += wheelSpinDelta;
    }

    // Brake light glowing emissive response
    if (inputs.brake > 0.05) {
      this.visual.brakeLightMaterial.emissive.setHex(0xdc2626);
      this.visual.brakeLightMaterial.emissiveIntensity = 2.4;
    } else {
      this.visual.brakeLightMaterial.emissive.setHex(0x450a0a);
      this.visual.brakeLightMaterial.emissiveIntensity = 0.2;
    }

    // Ventilated steel brake rotor thermal glow effect
    if (inputs.brake > 0.08 && this.speedKmh > 18) {
      this.brakeRotorHeat = Math.min(1.0, this.brakeRotorHeat + inputs.brake * (this.speedKmh / 140.0) * dt * 2.2);
    } else {
      this.brakeRotorHeat = Math.max(0.0, this.brakeRotorHeat - dt * 0.7);
    }

    if (this.visual.brakeRotorMaterials && this.visual.brakeRotorMaterials.length > 0) {
      const heat = this.brakeRotorHeat;
      for (const mat of this.visual.brakeRotorMaterials) {
        if (heat > 0.05) {
          mat.emissive.setHex(heat > 0.6 ? 0xffaa00 : 0xff3d00); // Incandescent red-orange shifting to bright orange
          mat.emissiveIntensity = heat * 4.8;
        } else {
          mat.emissiveIntensity = 0.0;
        }
      }
    }

    // Voxel Driver Helmet turns head towards corner apex
    if (this.visual.driverHead) {
      const targetHeadYaw = this.steerAngle * 0.65;
      this.visual.driverHead.rotation.y = THREE.MathUtils.lerp(
        this.visual.driverHead.rotation.y,
        targetHeadYaw,
        dt * 10.0
      );
    }
  }

  public resetPosition(spawnPos: THREE.Vector3, spawnQuat: THREE.Quaternion): void {
    this.rigidBody.setTranslation(
      new RAPIER.Vector3(spawnPos.x, spawnPos.y + 0.5, spawnPos.z),
      true
    );
    this.rigidBody.setRotation(
      new RAPIER.Quaternion(spawnQuat.x, spawnQuat.y, spawnQuat.z, spawnQuat.w),
      true
    );
    this.rigidBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
    this.rigidBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
    this.speedKmh = 0;
    this.rpm = this.specs.idleRpm;
    this.currentGear = 1;
    this.isDrifting = false;
  }

  /**
   * M3: Comprehensive race restart - eliminates leftover heat, drift, or yaw state
   */
  public reset(spawnPos: THREE.Vector3, spawnQuat: THREE.Quaternion): void {
    this.resetPosition(spawnPos, spawnQuat);
    this.steerAngle = 0;
    this.targetSteerAngle = 0;
    this.slipAngle = 0;
    this.isDrifting = false;
    this.driftScore = 0;
    this.driftDuration = 0;
    this.brakeRotorHeat = 0;
    this.currentLap = 1;
    this.currentCheckpointIndex = 0;
    this.currentLapTime = 0;
    this.raceFinished = false;
    this.isOnKerb = false;
    this.isOffTrack = false;
    this.currentSurface = 'asphalt';
    this.lastVelocity.set(0, 0, 0);

    // Reset weight transfer
    this.weightTransfer.frontLeftLoad = 0.20;
    this.weightTransfer.frontRightLoad = 0.20;
    this.weightTransfer.rearLeftLoad = 0.30;
    this.weightTransfer.rearRightLoad = 0.30;
    this.weightTransfer.frontBias = 0.40;
    this.weightTransfer.rearBias = 0.60;
    this.weightTransfer.rollAngle = 0;
    this.weightTransfer.pitchAngle = 0;

    // Reset damage and spawn grace timer
    this.damage.bodyDamage = 0.0;
    this.damage.aerodynamicDragPenalty = 1.0;
    this.damage.steeringAlignmentOffset = 0.0;
    this.spawnGraceTimer = 1.0;

    // Reset visual rotations and emissives
    this.visual.bodyMesh.rotation.set(0, 0, 0);
    this.visual.wheelFL.rotation.set(0, 0, 0);
    this.visual.wheelFR.rotation.set(0, 0, 0);
    if (this.visual.driverHead) this.visual.driverHead.rotation.set(0, 0, 0);
    this.visual.brakeLightMaterial.emissive.setHex(0x450a0a);
    this.visual.brakeLightMaterial.emissiveIntensity = 0.2;
    if (this.visual.brakeRotorMaterials) {
      for (const mat of this.visual.brakeRotorMaterials) {
        mat.emissiveIntensity = 0.0;
      }
    }
  }

  public getVehicleState(): VehicleState {
    return {
      id: this.id,
      name: this.name,
      isPlayer: this.isPlayer,
      isAI: this.isAI,
      position: this.position.clone(),
      quaternion: this.quaternion.clone(),
      velocity: this.velocity.clone(),
      angularVelocity: this.angularVelocity.clone(),
      speedKmh: this.speedKmh,
      rpm: this.rpm,
      gear: this.currentGear,
      throttle: 0,
      brake: 0,
      steer: this.steerAngle,
      handbrake: false,
      slipAngle: this.slipAngle,
      isDrifting: this.isDrifting,
      driftScore: this.driftScore,
      isWrongWay: this.isWrongWay,
      deltaBestLap: Number.isFinite(this.bestLapTime) ? this.currentLapTime - this.bestLapTime : undefined,
      damage: { ...this.damage },
      weightTransfer: { ...this.weightTransfer },
      lap: this.currentLap,
      checkpointIndex: this.currentCheckpointIndex,
      lapTime: this.currentLapTime,
      bestLapTime: this.bestLapTime,
      raceFinished: this.raceFinished,
      raceRank: this.raceRank,
    };
  }

  public destroy(world: RAPIER.World): void {
    if (this.collider) {
      world.removeCollider(this.collider, false);
    }
    if (this.rigidBody) {
      world.removeRigidBody(this.rigidBody);
    }
  }
}
