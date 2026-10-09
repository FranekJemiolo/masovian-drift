import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';
import { VehicleInputs, VehiclePhysics } from '../physics/VehiclePhysics';

export interface AIBotProfile {
  name: string;
  color: number;
  accent: number;
  aggression: number;       // 0.8 to 1.2
  driftEnthusiasm: number;  // Tendency to initiate oversteer
  lookaheadGain: number;    // Sensitivity parameter
}

export const AI_BOT_PROFILES: AIBotProfile[] = [
  {
    name: 'Kuba "Bokser" Wisła',
    color: 0xef4444, // Crimson Red
    accent: 0x111111,
    aggression: 1.15,
    driftEnthusiasm: 0.85,
    lookaheadGain: 0.16,
  },
  {
    name: 'Ania Mazur',
    color: 0xe2e8f0, // Mazovian Silver
    accent: 0x1e293b,
    aggression: 1.05,
    driftEnthusiasm: 0.65,
    lookaheadGain: 0.18,
  },
  {
    name: 'Tomek Turbo',
    color: 0x3b82f6, // Turbo Blue
    accent: 0xf97316,
    aggression: 1.2,
    driftEnthusiasm: 0.75,
    lookaheadGain: 0.15,
  },
  {
    name: 'Zofia Drift',
    color: 0xfacc15, // Dune Gold
    accent: 0x000000,
    aggression: 0.95,
    driftEnthusiasm: 1.3,
    lookaheadGain: 0.14,
  },
  {
    name: 'Marek Otwock',
    color: 0x22c55e, // Pine Green
    accent: 0xf8fafc,
    aggression: 0.9,
    driftEnthusiasm: 0.5,
    lookaheadGain: 0.20,
  },
];

export class PurePursuitAI {
  public vehicle: VehiclePhysics;
  public profile: AIBotProfile;
  public waypoints: Waypoint[];

  private currentTargetIndex = 0;
  private readonly wheelbase = 2.4; // Wheelbase in meters

  constructor(vehicle: VehiclePhysics, profile: AIBotProfile, waypoints: Waypoint[]) {
    this.vehicle = vehicle;
    this.profile = profile;
    this.waypoints = waypoints;
  }

  public setTargetIndex(index: number): void {
    this.currentTargetIndex = THREE.MathUtils.clamp(index, 0, this.waypoints.length - 1);
  }

  /**
   * Updates AI steering, throttle, and braking using Adaptive Pure Pursuit
   */
  public update(dt: number, otherVehicles: VehiclePhysics[]): VehicleInputs {
    const pos = this.vehicle.position;
    const speedKmh = this.vehicle.speedKmh;
    const speedMs = speedKmh / 3.6;
    const count = this.waypoints.length;

    // 1. Find closest waypoint to vehicle along race spline
    let closestDist = Infinity;
    let closestIndex = this.currentTargetIndex;

    const currentDist = pos.distanceTo(this.waypoints[this.currentTargetIndex].point);
    if (currentDist > 20.0) {
      // Full circuit search if displaced or initializing
      for (let i = 0; i < count; i++) {
        const d = pos.distanceTo(this.waypoints[i].point);
        if (d < closestDist) {
          closestDist = d;
          closestIndex = i;
        }
      }
    } else {
      // Local progression window
      const searchWindow = 14;
      for (let k = -4; k <= searchWindow; k++) {
        const idx = (this.currentTargetIndex + k + count) % count;
        const d = pos.distanceTo(this.waypoints[idx].point);
        if (d < closestDist) {
          closestDist = d;
          closestIndex = idx;
        }
      }
    }
    this.currentTargetIndex = closestIndex;

    // 2. ADAPTIVE LOOKAHEAD DISTANCE ALGORITHM
    const minLookahead = 8.0;
    const maxLookahead = 28.0;
    const currentWp = this.waypoints[this.currentTargetIndex];

    const cornerFactor = Math.min(1.0, currentWp.targetSpeedKmh / 160.0);
    const adaptiveLookahead = THREE.MathUtils.clamp(
      minLookahead + (speedMs * this.profile.lookaheadGain * 3.8) * cornerFactor,
      minLookahead,
      maxLookahead
    );

    // 3. Find lookahead target point along waypoint spline
    let lookaheadIndex = this.currentTargetIndex;
    let accumulatedDist = 0;

    while (accumulatedDist < adaptiveLookahead) {
      const nextIdx = (lookaheadIndex + 1) % count;
      accumulatedDist += this.waypoints[lookaheadIndex].point.distanceTo(this.waypoints[nextIdx].point);
      lookaheadIndex = nextIdx;
    }

    const targetPoint = this.waypoints[lookaheadIndex].point.clone();

    // 4. Opponent Avoidance (lateral offset when approaching cars ahead)
    for (const other of otherVehicles) {
      if (other.id === this.vehicle.id) continue;
      const distToOther = pos.distanceTo(other.position);
      if (distToOther < 8.0) {
        const toOther = other.position.clone().sub(pos);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.vehicle.quaternion);
        // Only avoid if car is ahead
        if (forward.dot(toOther) > 0.3) {
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.vehicle.quaternion);
          const isRight = right.dot(toOther) > 0;
          const avoidanceNormal = isRight ? -2.2 : 2.2;
          if (currentWp.normal) {
            targetPoint.addScaledVector(currentWp.normal, avoidanceNormal);
          }
        }
      }
    }

    // 5. PURE PURSUIT LATERAL CONTROLLER
    const toTargetWorld = targetPoint.clone().sub(pos);
    const invQuat = this.vehicle.quaternion.clone().invert();
    const toTargetLocal = toTargetWorld.applyQuaternion(invQuat);

    // Calculate heading deviation angle alpha
    const alpha = Math.atan2(toTargetLocal.x, Math.max(0.5, toTargetLocal.z));
    const lookaheadDist = Math.max(3.0, toTargetLocal.length());

    // Pure pursuit curvature: kappa = (2 * sin(alpha)) / L_d
    const curvature = (2.0 * Math.sin(alpha)) / lookaheadDist;

    // Required steering angle
    const rawSteerAngle = Math.atan(curvature * this.wheelbase);
    const steerInput = THREE.MathUtils.clamp(rawSteerAngle / 0.55, -1.0, 1.0);

    // 6. SPEED & THROTTLE/BRAKING CONTROLLER
    let adjustedTargetSpeed = currentWp.targetSpeedKmh * this.profile.aggression;
    if (currentWp.surface === 'sand') {
      adjustedTargetSpeed *= 0.88;
    }

    let throttle = 0;
    let brake = 0;
    let handbrake = false;

    const speedDiff = speedKmh - adjustedTargetSpeed;

    if (speedDiff > 8.0) {
      // Over speed: brake into turn
      brake = Math.min(1.0, (speedDiff / 25.0));
      throttle = 0;

      // Sandy hairpins drift tap
      if (Math.abs(alpha) > 0.45 && currentWp.surface === 'sand' && Math.random() < 0.08 * this.profile.driftEnthusiasm) {
        handbrake = true;
      }
    } else if (speedDiff > 0.0) {
      // Modulate throttle near limit
      throttle = 0.7;
      brake = 0;
    } else {
      // Full throttle acceleration down straights!
      throttle = 1.0;
      brake = 0;
    }

    return {
      throttle,
      brake,
      steer: steerInput,
      handbrake,
    };
  }
}
