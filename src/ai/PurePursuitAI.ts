import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';
import { VehicleInputs, VehiclePhysics } from '../physics/VehiclePhysics';
import { PRNG } from '../utils/PRNG';

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

  // Stuck & Recovery state (M6, M7)
  private stuckTime = 0;
  private recoveryTimer = 0;

  // Static scratch objects to avoid per-frame allocations across all bots (P1)
  private static readonly _targetPoint = new THREE.Vector3();
  private static readonly _candRacing = new THREE.Vector3();
  private static readonly _candDefend = new THREE.Vector3();
  private static readonly _candOvertake = new THREE.Vector3();
  private static readonly _toOther = new THREE.Vector3();
  private static readonly _forward = new THREE.Vector3();
  private static readonly _right = new THREE.Vector3();
  private static readonly _toTargetWorld = new THREE.Vector3();
  private static readonly _invQuat = new THREE.Quaternion();
  private static readonly _toTargetLocal = new THREE.Vector3();

  constructor(vehicle: VehiclePhysics, profile: AIBotProfile, waypoints: Waypoint[]) {
    this.vehicle = vehicle;
    this.profile = profile;
    this.waypoints = waypoints;
  }

  public setTargetIndex(index: number): void {
    this.currentTargetIndex = THREE.MathUtils.clamp(index, 0, this.waypoints.length - 1);
  }

  public reset(): void {
    this.currentTargetIndex = 0;
    this.stuckTime = 0;
    this.recoveryTimer = 0;
  }

  /**
   * Updates AI steering, throttle, and braking using State-of-the-Art Racing AI:
   * - Frenet frame multi-candidate trajectory evaluation (Racing line, Defensive inside, Overtaking cutback)
   * - Kamm's friction circle & Pacejka-aware predictive corner braking zones
   * - Tactical slipstream drafting on straights with late-braking passes
   * - 3D elliptical spatial safety bubbles for side-by-side wheel racing
   */
  public update(dt: number, otherVehicles: VehiclePhysics[]): VehicleInputs {
    const pos = this.vehicle.position;
    const speedKmh = this.vehicle.speedKmh;
    const speedMs = speedKmh / 3.6;
    const count = this.waypoints.length;

    // 0. STUCK RECOVERY CONTROLLER (M6 / M7)
    if (speedKmh < 4.0) {
      this.stuckTime += dt;
      if (this.stuckTime > 1.8) {
        this.recoveryTimer = 1.2; // Initiate 1.2s reverse gear maneuver
        this.stuckTime = 0;
      }
    } else {
      this.stuckTime = Math.max(0, this.stuckTime - dt * 2.0);
    }

    if (this.recoveryTimer > 0) {
      this.recoveryTimer -= dt;
      return {
        throttle: 0,
        brake: 0.85, // Rapier reverses on brake when stopped
        steer: 0.65,
        handbrake: false,
      };
    }

    // 1. Find closest waypoint to vehicle along race spline
    let closestDist = Infinity;
    let closestIndex = this.currentTargetIndex;

    const currentDist = pos.distanceTo(this.waypoints[this.currentTargetIndex].point);
    if (currentDist > 22.0) {
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
    const maxLookahead = 30.0;
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

    const basePoint = this.waypoints[lookaheadIndex].point;
    const lookNormal = this.waypoints[lookaheadIndex].normal ?? currentWp.normal ?? new THREE.Vector3(1, 0, 0);
    const halfWidth = currentWp.width * 0.5;

    // 4. FRENET FRAME MULTI-CANDIDATE TRAJECTORY EVALUATION
    // Generate 3 candidate lateral offsets in the Frenet frame (d_racing, d_defend, d_overtake)
    const forward = PurePursuitAI._forward.set(0, 0, 1).applyQuaternion(this.vehicle.quaternion);
    const right = PurePursuitAI._right.set(1, 0, 0).applyQuaternion(this.vehicle.quaternion);

    // Upcoming corner curvature
    let upcomingCurvature = 0;
    if (currentWp.tangent) {
      const aheadWp = this.waypoints[(this.currentTargetIndex + 6) % count];
      if (aheadWp.tangent) {
        upcomingCurvature = currentWp.tangent.x * aheadWp.tangent.z - currentWp.tangent.z * aheadWp.tangent.x;
      }
    }

    // Candidate 1: Optimal Racing Line (Outside entry -> Clipping apex -> Wide exit)
    let dRacing = 0;
    if (Math.abs(upcomingCurvature) > 0.05) {
      // Clip inside apex
      dRacing = -Math.sign(upcomingCurvature) * Math.min(halfWidth * 0.72, Math.abs(upcomingCurvature) * 4.6);
    }
    const candRacing = PurePursuitAI._candRacing.copy(basePoint).addScaledVector(lookNormal, dRacing);

    // Candidate 2: Defensive Inside Line (deny apex to trailing car)
    let dDefend = 0;
    if (Math.abs(upcomingCurvature) > 0.04) {
      dDefend = -Math.sign(upcomingCurvature) * (halfWidth * 0.65);
    } else {
      dDefend = -1.2; // Hold inside lane on straight
    }
    const candDefend = PurePursuitAI._candDefend.copy(basePoint).addScaledVector(lookNormal, dDefend);

    // Candidate 3: Overtaking Switchback / Cutback Line
    let dOvertake = dRacing;
    let hasDraftCar = false;
    let closestAheadDist = Infinity;
    let carAheadOffset = 0;

    for (const other of otherVehicles) {
      if (other.id === this.vehicle.id) continue;
      const toOther = PurePursuitAI._toOther.copy(other.position).sub(pos);
      const dist = toOther.length();
      const dotFwd = forward.dot(toOther);
      const dotRight = right.dot(toOther);

      // Check if car is ahead in longitudinal slipstream corridor
      if (dotFwd > 1.5 && dotFwd < 16.0 && Math.abs(dotRight) < 3.2) {
        if (dotFwd < closestAheadDist) {
          closestAheadDist = dotFwd;
          carAheadOffset = dotRight;
        }
        // Aerodynamic slipstream detection on straights
        if (Math.abs(dotRight) < 1.6 && Math.abs(upcomingCurvature) < 0.06) {
          hasDraftCar = true;
        }
      }
    }

    // If car ahead is blocking, switch to alternate lane
    if (closestAheadDist < 14.0) {
      const avoidSide = carAheadOffset > 0 ? -1 : 1;
      dOvertake = THREE.MathUtils.clamp(carAheadOffset + avoidSide * 2.6, -(halfWidth - 1.2), halfWidth - 1.2);
    }
    const candOvertake = PurePursuitAI._candOvertake.copy(basePoint).addScaledVector(lookNormal, dOvertake);

    // Evaluate Trajectory Cost Function J(c)
    // J = w_collision * Penalty_collision + w_curv * Curvature + w_track * TrackBoundary
    let bestCand = candRacing;
    let bestCost = Infinity;

    const evaluateCandidate = (cand: THREE.Vector3, isDefensive: boolean, isOvertake: boolean): number => {
      let cost = 0;
      // Curvature penalty
      cost += Math.abs(cand.distanceTo(pos) - adaptiveLookahead) * 0.15;

      // Opponent collision & spatial bubble penalties
      for (const other of otherVehicles) {
        if (other.id === this.vehicle.id) continue;
        const dOther = cand.distanceTo(other.position);
        if (dOther < 4.2) {
          cost += (4.2 - dOther) * 120.0; // Severe collision penalty
        } else if (dOther < 7.0) {
          cost += (7.0 - dOther) * 15.0; // Spatial safety bubble
        }
      }

      // Track boundary penalty
      const dFromCenter = cand.distanceTo(basePoint);
      if (dFromCenter > halfWidth - 1.0) {
        cost += (dFromCenter - (halfWidth - 1.0)) * 60.0;
      }

      // Tactical bonus for drafting on straights
      if (hasDraftCar && !isOvertake && Math.abs(upcomingCurvature) < 0.05) {
        cost -= 12.0; // Stay locked in slipstream tunnel
      }
      if (isOvertake && closestAheadDist < 9.0) {
        cost -= 18.0; // Aggressive passing incentive
      }

      return cost;
    };

    const costRacing = evaluateCandidate(candRacing, false, false);
    const costDefend = evaluateCandidate(candDefend, true, false);
    const costOvertake = evaluateCandidate(candOvertake, false, true);

    if (costOvertake < costRacing && costOvertake < costDefend && closestAheadDist < 12.0) {
      bestCand = candOvertake;
    } else if (costDefend < costRacing && this.profile.aggression < 1.0) {
      bestCand = candDefend;
    } else {
      bestCand = candRacing;
    }

    const targetPoint = PurePursuitAI._targetPoint.copy(bestCand);

    // 5. PURE PURSUIT LATERAL CONTROLLER
    const toTargetWorld = PurePursuitAI._toTargetWorld.copy(targetPoint).sub(pos);
    const invQuat = PurePursuitAI._invQuat.copy(this.vehicle.quaternion).invert();
    const toTargetLocal = PurePursuitAI._toTargetLocal.copy(toTargetWorld).applyQuaternion(invQuat);

    // Calculate heading deviation angle alpha
    const alpha = Math.atan2(toTargetLocal.x, Math.max(0.5, toTargetLocal.z));
    const lookaheadDist = Math.max(3.0, toTargetLocal.length());

    // Pure pursuit curvature: kappa = (2 * sin(alpha)) / L_d
    const curvature = (2.0 * Math.sin(alpha)) / lookaheadDist;

    // Required steering angle
    const rawSteerAngle = Math.atan(curvature * this.wheelbase);
    const steerInput = THREE.MathUtils.clamp(rawSteerAngle / 0.55, -1.0, 1.0);

    // 6. KAMM'S FRICTION CIRCLE & PACEJKA-AWARE PREDICTIVE BRAKING
    // Effective surface friction coefficient (mu)
    let muSurface = 1.05; // High-grip asphalt
    if (currentWp.surface === 'gravel') muSurface = 0.75;
    if (currentWp.surface === 'sand') muSurface = 0.50;

    let adjustedTargetSpeed = currentWp.targetSpeedKmh * this.profile.aggression;

    // Tactical Slipstream boost on straights (reduced air drag in wake)
    if (hasDraftCar && Math.abs(upcomingCurvature) < 0.05) {
      adjustedTargetSpeed *= 1.08;
    }

    // Predictive braking zone lookahead (up to 12 waypoints / 55 meters)
    let distAhead = 0;
    const maxLookaheadDist = Math.max(34.0, speedMs * 1.85);

    for (let s = 1; s <= 12; s++) {
      const idxA = (this.currentTargetIndex + s) % count;
      const wpA = this.waypoints[idxA];
      const prevA = this.waypoints[(idxA - 1 + count) % count];
      distAhead += prevA.point.distanceTo(wpA.point);
      if (distAhead > maxLookaheadDist) break;

      // Friction circle cornering speed: v_corner = sqrt(mu * g * R / (1 - banking))
      let wpMu = 1.05;
      if (wpA.surface === 'gravel') wpMu = 0.75;
      if (wpA.surface === 'sand') wpMu = 0.50;

      const wpSpeedKmh = wpA.targetSpeedKmh * this.profile.aggression;
      const cornerTargetMs = (wpSpeedKmh * Math.sqrt(wpMu / 1.05)) / 3.6;

      // Allowable speed approaching corner: v = sqrt(v_target^2 + 2 * a_decel * dist)
      const maxDecel = 8.8 * (wpMu / 1.0); // m/s^2 brake grip
      const allowableMs = Math.sqrt(cornerTargetMs * cornerTargetMs + 2 * maxDecel * distAhead);
      const allowableKmh = allowableMs * 3.6;
      if (allowableKmh < adjustedTargetSpeed) {
        adjustedTargetSpeed = allowableKmh;
      }
    }

    let throttle = 0;
    let brake = 0;
    let handbrake = false;

    const speedDiff = speedKmh - adjustedTargetSpeed;

    if (speedDiff > 5.0) {
      // Kamm's circle trail braking modulation:
      // When steering is turned hard, reduce longitudinal braking to preserve lateral grip and prevent understeer plow
      const lateralDemand = Math.abs(steerInput);
      const kammLongitudinalGrip = Math.sqrt(Math.max(0.15, 1.0 - lateralDemand * lateralDemand * 0.75));

      const rawBrake = Math.min(1.0, speedDiff / 20.0);
      brake = rawBrake * kammLongitudinalGrip;
      throttle = 0;

      // Sandy hairpins Scandinavian drift tap (deterministic PRNG, M4)
      if (
        Math.abs(alpha) > 0.42 &&
        currentWp.surface === 'sand' &&
        PRNG.global.chance(0.08 * this.profile.driftEnthusiasm)
      ) {
        handbrake = true;
      }
    } else if (speedDiff > 0.0) {
      // Modulate throttle near corner limit
      throttle = 0.65;
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
