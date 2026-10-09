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

  /**
   * Updates AI steering, throttle, and braking using Adaptive Pure Pursuit
   */
  public update(dt: number, otherVehicles: VehiclePhysics[]): VehicleInputs {
    const pos = this.vehicle.position;
    const speedKmh = this.vehicle.speedKmh;
    const speedMs = speedKmh / 3.6;
    const count = this.waypoints.length;

    // 1. Find closest waypoint to vehicle
    let closestDist = Infinity;
    let closestIndex = this.currentTargetIndex;
    const searchWindow = 12;

    for (let k = -4; k <= searchWindow; k++) {
      const idx = (this.currentTargetIndex + k + count) % count;
      const d = pos.distanceTo(this.waypoints[idx].point);
      if (d < closestDist) {
        closestDist = d;
        closestIndex = idx;
      }
    }
    this.currentTargetIndex = closestIndex;

    // 2. ADAPTIVE LOOKAHEAD DISTANCE ALGORITHM (Milestone 6 requirement)
    // At high speeds on straightaways: lengthen lookahead (up to 28m) to prevent erratic oscillations.
    // In sharp, sandy corners: contract lookahead (down to 7m) to follow tight envelopes and initiate oversteer!
    const minLookahead = 7.5;
    const maxLookahead = 28.0;
    const currentWp = this.waypoints[this.currentTargetIndex];

    // Sharpness discount: if target speed is low (tight corner), shrink lookahead
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
      if (distToOther < 9.0) {
        const toOther = other.position.clone().sub(pos);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.vehicle.quaternion);
        // Only avoid if car is in front
        if (forward.dot(toOther) > 0.5) {
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.vehicle.quaternion);
          const isRight = right.dot(toOther) > 0;
          // Offset target point away from other vehicle
          const avoidanceNormal = isRight ? -2.2 : 2.2;
          if (currentWp.normal) {
            targetPoint.addScaledVector(currentWp.normal, avoidanceNormal);
          }
        }
      }
    }

    // 5. PURE PURSUIT LATERAL CONTROLLER (Trigonometric curvature calculation)
    // Transform target point to vehicle local space
    const toTargetWorld = targetPoint.clone().sub(pos);
    const invQuat = this.vehicle.quaternion.clone().invert();
    const toTargetLocal = toTargetWorld.applyQuaternion(invQuat);

    // Calculate heading deviation angle alpha
    const lookaheadDist = toTargetLocal.length();
    const alpha = Math.atan2(toTargetLocal.x, toTargetLocal.z);

    // Pure pursuit curvature: kappa = (2 * sin(alpha)) / L_d
    const curvature = (2.0 * Math.sin(alpha)) / Math.max(2.0, lookaheadDist);

    // Required steering angle: delta = atan(curvature * wheelbase)
    const rawSteerAngle = Math.atan(curvature * this.wheelbase);

    // Normalize steer between -1.0 and +1.0
    const steerInput = THREE.MathUtils.clamp(rawSteerAngle / 0.55, -1.0, 1.0);

    // 6. SPEED & THROTTLE/BRAKING CONTROLLER
    // Adjust target speed by bot aggression and surface condition
    let adjustedTargetSpeed = currentWp.targetSpeedKmh * this.profile.aggression;
    if (currentWp.surface === 'sand') {
      adjustedTargetSpeed *= 0.88; // Extra caution on loose dunes
    }

    let throttle = 0;
    let brake = 0;
    let handbrake = false;

    const speedDiff = speedKmh - adjustedTargetSpeed;

    if (speedDiff > 5.0) {
      // Over speed: brake hard to shift weight to front and rotate car
      brake = Math.min(1.0, (speedDiff / 30.0) * 1.2);
      throttle = 0;

      // In sandy sharp corners, tap handbrake to induce deliberate drift slide!
      if (Math.abs(alpha) > 0.45 && currentWp.surface === 'sand' && Math.random() < 0.08 * this.profile.driftEnthusiasm) {
        handbrake = true;
      }
    } else {
      // Accelerate out of turn
      throttle = Math.min(1.0, Math.max(0.3, 1.0 - (speedDiff / 15.0)));
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
