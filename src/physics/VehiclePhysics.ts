import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { VehicleDamage, VehicleSpecs, VehicleState, WeightTransferState } from '../game/Types';
import { CarVisualElements } from '../graphics/VoxelCarBuilder';
import { Waypoint } from './TrackWaypoints';

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

  // Suspension parameters
  private readonly wheelbase = 2.4; // meters
  private readonly trackWidth = 1.55; // meters
  private readonly cogHeight = 0.42; // Center of gravity height

  // Race progression tracking
  public currentLap = 1;
  public currentCheckpointIndex = 0;
  public currentLapTime = 0;
  public bestLapTime = Infinity;
  public raceFinished = false;
  public raceRank = 1;

  // Collision damage accumulator
  private lastVelocity = new THREE.Vector3();

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
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPos.x, spawnPos.y + 0.5, spawnPos.z)
      .setRotation(new RAPIER.Quaternion(spawnQuat.x, spawnQuat.y, spawnQuat.z, spawnQuat.w))
      .setLinearDamping(0.15)
      .setAngularDamping(2.8)
      .setCanSleep(false);

    this.rigidBody = world.createRigidBody(rbDesc);

    // Chassis collision box (centered with 60% rear weight bias)
    const colDesc = RAPIER.ColliderDesc.cuboid(0.85, 0.35, 1.95)
      .setMass(this.specs.mass)
      .setFriction(0.3)
      .setRestitution(0.12);

    this.position.copy(spawnPos);
    this.quaternion.copy(spawnQuat);
    this.visual.root.position.copy(spawnPos);
    this.visual.root.quaternion.copy(spawnQuat);
    this.collider = world.createCollider(colDesc, this.rigidBody);
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

    // Compute vehicle coordinate frame
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);

    const forwardSpeed = this.velocity.dot(forward);
    const lateralSpeed = this.velocity.dot(right);
    this.speedKmh = Math.abs(forwardSpeed) * 3.6;

    // Detect impact shock & accumulate damage
    const accelVector = this.velocity.clone().sub(this.lastVelocity).divideScalar(dt);
    const impactG = accelVector.length() / 9.81;
    if (impactG > 12.0) {
      const damageAmount = Math.min(0.25, (impactG - 12.0) * 0.015);
      this.damage.bodyDamage = Math.min(1.0, this.damage.bodyDamage + damageAmount);
      // Aerodynamic penalty increases with body crumpling
      this.damage.aerodynamicDragPenalty = 1.0 + this.damage.bodyDamage * 1.1; // up to 2.1x drag!
      // Tie-rod alignment bends slightly with crashes
      this.damage.steeringAlignmentOffset += (Math.random() - 0.5) * 0.015 * damageAmount;
      this.damage.steeringAlignmentOffset = THREE.MathUtils.clamp(
        this.damage.steeringAlignmentOffset,
        -0.045,
        0.045
      );
    }
    this.lastVelocity.copy(this.velocity);

    // Determine current surface grip (Tarmac = 1.0, Gravel = 0.75, Sand = 0.45)
    let surfaceGrip = 0.95;
    if (waypoints && waypoints.length > 0) {
      let minDist = Infinity;
      let closestSurface: 'asphalt' | 'gravel' | 'sand' = 'asphalt';
      for (let i = 0; i < waypoints.length; i += 3) {
        const d = this.position.distanceTo(waypoints[i].point);
        if (d < minDist) {
          minDist = d;
          closestSurface = waypoints[i].surface;
        }
      }
      if (closestSurface === 'gravel') surfaceGrip = 0.72;
      else if (closestSurface === 'sand') surfaceGrip = 0.42; // Mazovian river sand
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
    this.weightTransfer.frontLeftLoad = Math.max(0.02, (dynamicFrontBias * 0.5) - weightShiftLat * 0.5);
    this.weightTransfer.frontRightLoad = Math.max(0.02, (dynamicFrontBias * 0.5) + weightShiftLat * 0.5);
    this.weightTransfer.rearLeftLoad = Math.max(0.02, (dynamicRearBias * 0.5) - weightShiftLat * 0.5);
    this.weightTransfer.rearRightLoad = Math.max(0.02, (dynamicRearBias * 0.5) + weightShiftLat * 0.5);

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
    // Normal force per axle (Newtons)
    const totalWeightN = this.specs.mass * 9.81;
    const frontNormalN = totalWeightN * dynamicFrontBias;
    const rearNormalN = totalWeightN * dynamicRearBias;

    // Tire grip limits (governed by normal force * surface friction)
    const frontMaxGrip = frontNormalN * surfaceGrip * 1.15;
    let rearMaxGrip = rearNormalN * surfaceGrip * 1.25;

    // Handbrake breaks rear traction immediately
    if (inputs.handbrake) {
      rearMaxGrip *= 0.22;
    }

    // Rear slip angle (rad)
    this.slipAngle = Math.atan2(lateralSpeed, Math.max(2.0, Math.abs(forwardSpeed)));

    // Trail-Braking Oversteer:
    // If braking into a turn, rearNormalN drops drastically (unloaded rear axle).
    // The unloaded rear tires lose lateral capacity, causing the classic Boxer oversteer pendulum!
    const isTrailBraking = inputs.brake > 0.2 && Math.abs(this.steerAngle) > 0.08;
    if (isTrailBraking) {
      rearMaxGrip *= 0.65; // Massive lift-off / trail-braking oversteer!
    }

    // Drive Force (RWD rear wheels only!)
    let driveForceN = 0;
    if (inputs.throttle > 0) {
      const gearRatio = this.specs.gearRatios[Math.max(1, this.currentGear)];
      const engineTorque = (this.specs.enginePowerKw * 1000 * 9.5488) / Math.max(1200, this.rpm);
      const wheelTorque = engineTorque * gearRatio * this.specs.finalDrive * inputs.throttle;
      const tireRadius = 0.32;
      driveForceN = (wheelTorque / tireRadius);

      // Tire traction limit (rear axle)
      if (driveForceN > rearMaxGrip) {
        driveForceN = rearMaxGrip; // Wheelspin!
      }
    }

    // Braking Force (60% front, 40% rear bias)
    let brakeForceN = 0;
    if (inputs.brake > 0) {
      brakeForceN = inputs.brake * 14000.0;
      if (forwardSpeed < 1.0 && inputs.brake > 0.5) {
        // Reverse gear
        driveForceN = -inputs.brake * 3800.0;
        brakeForceN = 0;
      }
    }

    // Lateral Cornering Forces
    // Front lateral force (steers car)
    const frontSlipAngle = this.slipAngle - this.steerAngle;
    const frontCorneringStiffness = 38000.0;
    const frontLateralForce = -THREE.MathUtils.clamp(
      frontSlipAngle * frontCorneringStiffness,
      -frontMaxGrip,
      frontMaxGrip
    );

    // Rear lateral force
    const rearCorneringStiffness = 44000.0;
    const rearLateralForce = -THREE.MathUtils.clamp(
      this.slipAngle * rearCorneringStiffness,
      -rearMaxGrip,
      rearMaxGrip
    );

    // Detect Drift state
    const driftThreshold = 0.16; // ~9.2 degrees
    if (Math.abs(this.slipAngle) > driftThreshold && this.speedKmh > 28.0) {
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
    const netLongForce = (driveForceN - Math.sign(forwardSpeed) * (brakeForceN + aeroDragForce));
    const forceWorld = forward.clone().multiplyScalar(netLongForce);

    // 2. Lateral Force (Sum of front and rear grip)
    const netLatForce = frontLateralForce + rearLateralForce;
    forceWorld.addScaledVector(right, netLatForce);

    // 3. Downforce
    forceWorld.addScaledVector(new THREE.Vector3(0, -1, 0), aeroDownforce);

    // Apply central force
    this.rigidBody.applyImpulse(
      new RAPIER.Vector3(forceWorld.x * dt, forceWorld.y * dt, forceWorld.z * dt),
      true
    );

    // 4. Yaw Torque (Yaw moment around center of gravity)
    // Distance to front axle = wheelbase * 0.60; Distance to rear axle = wheelbase * 0.40
    const yawTorque = (frontLateralForce * (this.wheelbase * 0.60)) - (rearLateralForce * (this.wheelbase * 0.40));
    // Damping yaw rate
    const yawDamping = -this.angularVelocity.y * 3200.0;
    const netYawMoment = yawTorque + yawDamping;
    this.rigidBody.applyTorqueImpulse(
      new RAPIER.Vector3(0, netYawMoment * dt, 0),
      true
    );

    // Anti-roll & stabilization upright torque
    const tiltDot = up.dot(new THREE.Vector3(0, 1, 0));
    if (tiltDot < 0.98) {
      const uprightCorrection = new THREE.Vector3(0, 1, 0).cross(up).multiplyScalar(-8000.0 * dt);
      this.rigidBody.applyTorqueImpulse(
        new RAPIER.Vector3(uprightCorrection.x, uprightCorrection.y, uprightCorrection.z),
        true
      );
    }

    // Keep car grounded on slopes
    if (this.position.y > 0.8 && this.position.y < 3.0) {
      this.rigidBody.applyImpulse(new RAPIER.Vector3(0, -9.81 * this.specs.mass * dt * 0.8, 0), true);
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

    // Automatic gear shifting
    if (forwardSpeed < -1.0) {
      this.currentGear = -1; // Reverse
    } else {
      if (this.currentGear <= 0) this.currentGear = 1;

      const currentGearRatio = this.specs.gearRatios[this.currentGear];
      const targetRpm = wheelRps * currentGearRatio * finalDrive * 60;

      // Upshift at 6800 RPM
      if (this.rpm > 6800 && this.currentGear < 5) {
        this.currentGear++;
      }
      // Downshift when dropping below 2600 RPM
      else if (this.rpm < 2600 && this.currentGear > 1) {
        this.currentGear--;
      }
    }

    const currentGearRatio = this.specs.gearRatios[Math.max(1, this.currentGear)];
    const wheelLinkedRpm = wheelRps * currentGearRatio * finalDrive * 60;

    // Flywheel inertia model:
    // dRPM / dt = (Torque - Load) / I_flywheel
    // Lighter flywheel = faster rev response!
    const flywheelInertia = this.specs.flywheelInertia;
    let targetRpm = Math.max(this.specs.idleRpm, wheelLinkedRpm);

    if (inputs.throttle > 0) {
      targetRpm += inputs.throttle * 2400.0;
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

    // Apply visual chassis pitch (weight transfer squat / dive) and roll (cornering lean)
    this.visual.bodyMesh.rotation.x = -this.weightTransfer.pitchAngle * 0.6;
    this.visual.bodyMesh.rotation.z = this.weightTransfer.rollAngle * 0.7;

    // Steer front wheels
    this.visual.wheelFL.rotation.y = this.steerAngle;
    this.visual.wheelFR.rotation.y = this.steerAngle;

    // Spin wheels according to vehicle speed
    const wheelSpinDelta = (this.velocity.length() / 0.32) * dt;
    this.visual.wheelFL.rotation.x += wheelSpinDelta;
    this.visual.wheelFR.rotation.x += wheelSpinDelta;
    this.visual.wheelRL.rotation.x += wheelSpinDelta;
    this.visual.wheelRR.rotation.x += wheelSpinDelta;

    // Brake light glowing emissive response
    if (inputs.brake > 0.05) {
      this.visual.brakeLightMaterial.emissive.setHex(0xdc2626);
      this.visual.brakeLightMaterial.emissiveIntensity = 2.4;
    } else {
      this.visual.brakeLightMaterial.emissive.setHex(0x450a0a);
      this.visual.brakeLightMaterial.emissiveIntensity = 0.2;
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
}
