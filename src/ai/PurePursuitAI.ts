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
      const wp = this.waypoints[this.currentTargetIndex];
      const toWp = PurePursuitAI._toTargetWorld.copy(wp.point).sub(pos);
      const invQ = PurePursuitAI._invQuat.copy(this.vehicle.quaternion).invert();
      const localWp = PurePursuitAI._toTargetLocal.copy(toWp).applyQuaternion(invQ);
      const revSteer = localWp.x >= 0 ? -0.75 : 0.75;
      return {
        throttle: 0,
        brake: 0.85, // Rapier reverses on brake when stopped
        steer: revSteer,
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
    const minLookahead = 7.0;
    const maxLookahead = 15.0;
    const currentWp = this.waypoints[this.currentTargetIndex];

    let minUpcomingSpeed = currentWp.targetSpeedKmh;
    for (let s = 1; s <= 8; s++) {
      const wpAhead = this.waypoints[(this.currentTargetIndex + s) % count];
      if (wpAhead.targetSpeedKmh < minUpcomingSpeed) {
        minUpcomingSpeed = wpAhead.targetSpeedKmh;
      }
    }

    const cornerFactor = Math.min(1.0, minUpcomingSpeed / 160.0);
    const adaptiveLookahead = THREE.MathUtils.clamp(
      minLookahead + (speedMs * this.profile.lookaheadGain * 2.0) * cornerFactor,
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
      // Clip inside apex while keeping safe margin from inside kerbs/trees
      dRacing = Math.sign(upcomingCurvature) * Math.min(halfWidth * 0.28, Math.abs(upcomingCurvature) * 2.5);
    }
    const candRacing = PurePursuitAI._candRacing.copy(basePoint).addScaledVector(lookNormal, dRacing);

    // Candidate 2: Defensive Inside Line (deny apex to trailing car)
    let dDefend = 0;
    if (Math.abs(upcomingCurvature) > 0.04) {
      dDefend = Math.sign(upcomingCurvature) * (halfWidth * 0.28);
    } else {
      dDefend = -0.8; // Hold inside lane on straight
    }
    const candDefend = PurePursuitAI._candDefend.copy(basePoint).addScaledVector(lookNormal, dDefend);

    // Candidate 3: Overtaking Switchback / Cutback Line
    let dOvertake = dRacing;
    let hasDraftCar = false;
    let closestAheadDist = Infinity;
    let blockingCar: VehiclePhysics | null = null;

    for (const other of otherVehicles) {
      if (other.id === this.vehicle.id) continue;
      const toOther = PurePursuitAI._toOther.copy(other.position).sub(pos);
      const dotFwd = forward.dot(toOther);
      const dotRight = right.dot(toOther);

      // Check if car is ahead in longitudinal slipstream corridor
      if (dotFwd > 1.0 && dotFwd < 18.0 && Math.abs(dotRight) < 3.4) {
        if (dotFwd < closestAheadDist) {
          closestAheadDist = dotFwd;
          blockingCar = other;
        }
        // Aerodynamic slipstream detection on straights
        if (Math.abs(dotRight) < 1.6 && Math.abs(upcomingCurvature) < 0.06) {
          hasDraftCar = true;
        }
      }
    }

    // If car ahead is blocking, project its centerline offset onto lookNormal and pick clear passing lane
    if (blockingCar && closestAheadDist < 16.0) {
      let bestIdx = this.currentTargetIndex;
      let bestD2 = Infinity;
      for (let s = 0; s <= 4; s++) {
        const idx = (this.currentTargetIndex + s) % count;
        const d2 = blockingCar.position.distanceToSquared(this.waypoints[idx].point);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIdx = idx;
        }
      }
      const bWp = this.waypoints[bestIdx];
      const bNorm = bWp.normal ?? lookNormal;
      const otherFrenetD = PurePursuitAI._toTargetWorld.copy(blockingCar.position).sub(bWp.point).dot(bNorm);
      const avoidSide = otherFrenetD >= 0 ? -1 : 1;
      dOvertake = THREE.MathUtils.clamp(otherFrenetD + avoidSide * 4.0, -(halfWidth - 1.4), halfWidth - 1.4);
    }
    const candOvertake = PurePursuitAI._candOvertake.copy(basePoint).addScaledVector(lookNormal, dOvertake);

    // Evaluate Trajectory Cost Function J(c)
    // J = w_collision * Penalty_collision + w_curv * Curvature + w_track * TrackBoundary
    let bestCand = candRacing;

    const evaluateCandidate = (cand: THREE.Vector3, _isDefensive: boolean, isOvertake: boolean): number => {
      let cost = 0;
      // Curvature / distance cost
      cost += Math.abs(cand.distanceTo(pos) - adaptiveLookahead) * 0.15;

      // Trajectory-segment collision & spatial safety bubble penalties
      const sx = cand.x - pos.x;
      const sy = cand.y - pos.y;
      const sz = cand.z - pos.z;
      const segLen2 = sx * sx + sy * sy + sz * sz;
      for (const other of otherVehicles) {
        if (other.id === this.vehicle.id) continue;
        const ox = other.position.x - pos.x;
        const oy = other.position.y - pos.y;
        const oz = other.position.z - pos.z;
        const t = segLen2 > 1e-4 ? Math.max(0, Math.min(1, (ox * sx + oy * sy + oz * sz) / segLen2)) : 0;
        const dx = ox - t * sx;
        const dy = oy - t * sy;
        const dz = oz - t * sz;
        const dOther = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dOther < 3.8) {
          cost += (3.8 - dOther) * 140.0; // Severe collision penalty
        } else if (dOther < 6.0) {
          cost += (6.0 - dOther) * 18.0; // Spatial safety bubble
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
      if (isOvertake && closestAheadDist < 12.0) {
        cost -= 18.0; // Aggressive passing incentive
      }

      return cost;
    };

    const costRacing = evaluateCandidate(candRacing, false, false);
    const costDefend = evaluateCandidate(candDefend, true, false);
    const costOvertake = evaluateCandidate(candOvertake, false, true);

    if (costOvertake < costRacing && costOvertake < costDefend && closestAheadDist < 15.0) {
      bestCand = candOvertake;
    } else if (costDefend < costRacing && this.profile.aggression < 1.0) {
      bestCand = candDefend;
    } else {
      bestCand = candRacing;
    }

    const targetPoint = PurePursuitAI._targetPoint.copy(bestCand);

    // 5. PURE PURSUIT + STANLEY CROSS-TRACK LATERAL CONTROLLER
    const toTargetWorld = PurePursuitAI._toTargetWorld.copy(targetPoint).sub(pos);
    const invQuat = PurePursuitAI._invQuat.copy(this.vehicle.quaternion).invert();
    const toTargetLocal = PurePursuitAI._toTargetLocal.copy(toTargetWorld).applyQuaternion(invQuat);

    // Calculate heading deviation angle alpha
    const alpha = Math.atan2(toTargetLocal.x, Math.max(0.5, toTargetLocal.z));
    const lookaheadDist = Math.max(3.0, toTargetLocal.length());

    // Pure pursuit curvature: kappa = (2 * sin(alpha)) / L_d
    const curvature = (2.0 * Math.sin(alpha)) / lookaheadDist;
    const rawSteerAngle = Math.atan(curvature * this.wheelbase);

    // Cross-track recentering correction if drifting toward road edge
    const wpNormal = currentWp.normal ?? new THREE.Vector3(1, 0, 0);
    const latOffset = PurePursuitAI._toOther.copy(pos).sub(currentWp.point).dot(wpNormal);
    const edgeCorrection = Math.abs(latOffset) > halfWidth * 0.45 ? (-latOffset / halfWidth) * 0.35 : 0;

    // Compensate for speed-sensitive steering attenuation in VehiclePhysics
    const speedSteerBoost = 1.0 + Math.min(1.2, speedKmh / 110.0);
    const steerInput = THREE.MathUtils.clamp(
      (alpha * 1.65 + rawSteerAngle * 1.2 + edgeCorrection) * speedSteerBoost,
      -1.0,
      1.0
    );

    // 6. KAMM'S FRICTION CIRCLE & PACEJKA-AWARE PREDICTIVE BRAKING
    // Effective surface friction coefficient (mu)
    let muSurface = 1.0; // High-grip asphalt
    if (currentWp.surface === 'gravel') muSurface = 0.72;
    if (currentWp.surface === 'sand') muSurface = 0.48;

    const effAggression = THREE.MathUtils.clamp(this.profile.aggression, 0.85, 1.02);
    let adjustedTargetSpeed = currentWp.targetSpeedKmh * effAggression;

    // Tactical Slipstream boost on straights (reduced air drag in wake)
    if (hasDraftCar && Math.abs(upcomingCurvature) < 0.04) {
      adjustedTargetSpeed *= 1.05;
    }

    // Longitudinal gap control: never rear-end a slower car that overlaps our lane.
    // Steering alone can't clear a car when side-by-side, so cap speed to keep a safe following gap.
    if (blockingCar) {
      const toBlock = PurePursuitAI._toOther.copy(blockingCar.position).sub(pos);
      const gap = forward.dot(toBlock) - 2.8; // bumper-to-bumper (car length ~2.8m)
      const lateral = Math.abs(right.dot(toBlock));
      if (lateral < 2.4) {
        const otherFwdKmh = Math.max(0, blockingCar.velocity.dot(forward)) * 3.6;
        const desiredGap = 2.5 + speedMs * 0.30;
        if (gap < desiredGap) {
          const squeeze = (desiredGap - Math.max(0, gap)) * 6.0;
          // Keep a creep speed while a gap remains so the bot can still steer out and pass a parked/slow car
          const creepKmh = gap > 3.0 ? 22.0 : 0.0;
          adjustedTargetSpeed = Math.min(adjustedTargetSpeed, Math.max(creepKmh, otherFwdKmh - squeeze));
        }
      }
    }

    // Predictive braking zone lookahead (up to 22 waypoints / ~95 meters)
    let distAhead = 0;
    const maxLookaheadDist = Math.max(45.0, speedMs * 2.6);

    for (let s = 1; s <= 22; s++) {
      const idxA = (this.currentTargetIndex + s) % count;
      const wpA = this.waypoints[idxA];
      const prevA = this.waypoints[(idxA - 1 + count) % count];
      distAhead += prevA.point.distanceTo(wpA.point);
      if (distAhead > maxLookaheadDist) break;

      // Estimate local spline curvature at wpA
      const nextA = this.waypoints[(idxA + 3) % count];
      let curvSpeedLimit = wpA.targetSpeedKmh;
      if (wpA.tangent && nextA.tangent) {
        const dAngle = wpA.tangent.angleTo(nextA.tangent);
        const chordLen = Math.max(1.0, wpA.point.distanceTo(nextA.point));
        const radius = chordLen / Math.max(0.005, dAngle);
        const maxLatG = 1.25;
        const physicsCornerKmh = Math.sqrt(maxLatG * 9.81 * radius) * 3.6;
        curvSpeedLimit = Math.min(curvSpeedLimit, physicsCornerKmh);
      }

      // Friction circle cornering speed
      let wpMu = 1.0;
      if (wpA.surface === 'gravel') wpMu = 0.85;
      if (wpA.surface === 'sand') wpMu = 0.72;

      const wpSpeedKmh = Math.max(58, curvSpeedLimit * effAggression);
      const cornerTargetMs = (wpSpeedKmh * Math.sqrt(wpMu)) / 3.6;

      // Allowable speed approaching corner: v = sqrt(v_target^2 + 2 * a_decel * dist)
      const maxDecel = 6.2 * wpMu; // Conservative braking decel so AI slows before turn-in
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
        Math.abs(alpha) > 0.55 &&
        speedKmh < 55.0 &&
        currentWp.surface === 'sand' &&
        !this.vehicle.isOffTrack &&
        PRNG.global.chance(0.03 * this.profile.driftEnthusiasm)
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

    // Traction & Slide Control: modulate throttle below 0.25 when rear slip exceeds drift threshold
    // so rear tires recover lateral grip instead of spinning out
    if (Math.abs(this.vehicle.slipAngle) > 0.14) {
      throttle = Math.min(throttle, 0.20);
      handbrake = false;
    } else if (Math.abs(alpha) > 0.22) {
      throttle = Math.min(throttle, 0.55);
    }

    return {
      throttle,
      brake,
      steer: steerInput,
      handbrake,
    };
  }
}
