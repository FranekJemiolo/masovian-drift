import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';
import { VehicleInputs, VehiclePhysics } from '../physics/VehiclePhysics';
import { TrackProjection, TrackRacingProfile } from './TrackRacingProfile';

export interface AIBotProfile {
  name: string;
  color: number;
  accent: number;
  aggression: number;       // 0.8 to 1.2
  driftEnthusiasm: number;  // Tendency to initiate & hold oversteer
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

interface NearbyCarFrenet {
  deltaS: number;
  d: number;
  vS: number;
  vD: number;
  halfWidth: number;
}

export class PurePursuitAI {
  public vehicle: VehiclePhysics;
  public profile: AIBotProfile;
  public waypoints: Waypoint[];

  private track: TrackRacingProfile;
  private currentTargetIndex = 0;
  private readonly wheelbase = 2.4; // Wheelbase in meters

  // Smooth tactical lane & recovery state
  private smoothTargetD = 0;
  private initializedLane = false;
  private laneHoldTimer = 0;
  private activePassSide = 0; // -1, 0, +1
  private stuckTime = 0;
  private recoveryTimer = 0;
  private recoveryMode: 'none' | 'reverse' | 'jturn' = 'none';
  private driftFlickCooldown = 0;
  private driftFlickTimer = 0;
  private lastCommandedThrottle = 1.0;

  // Per-bot reusable structures (zero per-frame allocations)
  private readonly _projSelf: TrackProjection = {
    idx: 0,
    closestIdx: 0,
    t: 0,
    s: 0,
    d: 0,
    halfWidth: 6.5,
    surface: 'asphalt',
    sinGrade: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    normX: 1,
    normZ: 0,
    tangX: 0,
    tangZ: 1,
  };
  private readonly _projOther: TrackProjection = { ...this._projSelf };
  private readonly _lookSample = {
    x: 0,
    y: 0,
    z: 0,
    normX: 1,
    normZ: 0,
    tangX: 0,
    tangZ: 1,
    halfWidth: 6.5,
    racingD: 0,
    surface: 'asphalt' as 'asphalt' | 'gravel' | 'sand',
    sinGrade: 0,
    idx: 0,
  };
  private readonly _rejoinSample = { ...this._lookSample };
  private readonly _nearbyCars: NearbyCarFrenet[] = Array.from({ length: 12 }, () => ({
    deltaS: 0,
    d: 0,
    vS: 0,
    vD: 0,
    halfWidth: 6.5,
  }));
  private readonly _candOffsets = new Float64Array(6);

  // Static scratch objects (no heap allocations in update loop)
  private static readonly _forward = new THREE.Vector3();
  private static readonly _right = new THREE.Vector3();
  private static readonly _up = new THREE.Vector3();
  private static readonly _targetWorld = new THREE.Vector3();
  private static readonly _laneWorld = new THREE.Vector3();
  private static readonly _toWorld = new THREE.Vector3();
  private static readonly _invQuat = new THREE.Quaternion();
  private static readonly _toLocal = new THREE.Vector3();
  private static readonly _errLocal = new THREE.Vector3();

  constructor(vehicle: VehiclePhysics, profile: AIBotProfile, waypoints: Waypoint[]) {
    this.vehicle = vehicle;
    this.profile = profile;
    this.waypoints = waypoints;
    this.track = TrackRacingProfile.forWaypoints(waypoints);
  }

  public setTargetIndex(index: number): void {
    const count = this.waypoints.length;
    if (count > 0) {
      this.currentTargetIndex = THREE.MathUtils.clamp(index, 0, count - 1);
    } else {
      this.currentTargetIndex = 0;
    }
  }

  public reset(): void {
    this.currentTargetIndex = 0;
    this.smoothTargetD = 0;
    this.initializedLane = false;
    this.laneHoldTimer = 0;
    this.activePassSide = 0;
    this.stuckTime = 0;
    this.recoveryTimer = 0;
    this.recoveryMode = 'none';
    this.driftFlickCooldown = 0;
    this.driftFlickTimer = 0;
    this.lastCommandedThrottle = 1.0;
  }

  public getRacingLineProfile(): TrackRacingProfile {
    return this.track;
  }

  /**
   * Computes high-speed racing & drift control inputs using:
   * - Continuous Frenet projection & precomputed minimum-curvature apex racing line
   * - Physics-calibrated surface grip, downhill braking compensation & Kamm trail-braking
   * - Coordinate-fixed Pure Pursuit + Stanley cross-track stabilization + drift counter-steer
   * - Multi-car predictive TTC Frenet lane planning & curvilinear gap control
   */
  public update(dt: number, otherVehicles: VehiclePhysics[]): VehicleInputs {
    const safeDt = Math.min(0.05, Math.max(0.001, dt));
    const count = this.waypoints.length;
    if (count === 0) {
      return { throttle: 0, brake: 0, steer: 0, handbrake: false };
    }

    const pos = this.vehicle.position;
    const speedKmh = this.vehicle.speedKmh;

    // 1. Project vehicle continuously onto circuit Frenet frame (s, d)
    const proj = this._projSelf;
    this.track.projectToTrack(pos.x, pos.z, this.currentTargetIndex, proj);
    this.currentTargetIndex = proj.closestIdx;

    if (!this.initializedLane) {
      this.smoothTargetD = THREE.MathUtils.clamp(
        proj.d,
        -(proj.halfWidth - 1.5),
        proj.halfWidth - 1.5
      );
      this.initializedLane = true;
    }

    const forward = PurePursuitAI._forward.set(0, 0, 1).applyQuaternion(this.vehicle.quaternion);
    const right = PurePursuitAI._right.set(1, 0, 0).applyQuaternion(this.vehicle.quaternion);
    const up = PurePursuitAI._up.set(0, 1, 0).applyQuaternion(this.vehicle.quaternion);
    const invQuat = PurePursuitAI._invQuat.copy(this.vehicle.quaternion).invert();

    // Horizontal forward velocity along vehicle heading
    const fwdHorizLen = Math.hypot(forward.x, forward.z) || 1;
    const fwdHx = forward.x / fwdHorizLen;
    const fwdHz = forward.z / fwdHorizLen;
    const vFwdSigned = this.vehicle.velocity.x * fwdHx + this.vehicle.velocity.z * fwdHz;
    const speedMs = Math.max(Math.abs(vFwdSigned), speedKmh / 3.6);
    const headingAlign = fwdHx * proj.tangX + fwdHz * proj.tangZ;

    // 2. SMART STUCK, PINNED & SPUN RECOVERY CONTROLLER
    this.laneHoldTimer = Math.max(0, this.laneHoldTimer - safeDt);
    this.driftFlickCooldown = Math.max(0, this.driftFlickCooldown - safeDt);

    if (this.recoveryTimer > 0) {
      this.recoveryTimer -= safeDt;
      this.track.sampleAtArcDistance(proj.s + 15.0, proj.idx, this._rejoinSample);
      const targetD = THREE.MathUtils.clamp(
        this.track.racingLineD[this._rejoinSample.idx],
        -(this._rejoinSample.halfWidth - 2.4),
        this._rejoinSample.halfWidth - 2.4
      );
      const rPt = PurePursuitAI._targetWorld.set(
        this._rejoinSample.x + this._rejoinSample.normX * targetD,
        this._rejoinSample.y,
        this._rejoinSample.z + this._rejoinSample.normZ * targetD
      );
      const toR = PurePursuitAI._toWorld.copy(rPt).sub(pos);
      const localR = PurePursuitAI._toLocal.copy(toR).applyQuaternion(invQuat);

      if (this.recoveryMode === 'jturn') {
        const turnSign = localR.x >= 0 ? 1.0 : -1.0;
        if (headingAlign > 0.25 || this.recoveryTimer <= 0) {
          this.recoveryMode = 'none';
          this.recoveryTimer = 0;
        }
        return {
          throttle: 0.72,
          brake: 0,
          steer: turnSign,
          handbrake: false,
        };
      } else {
        // Reverse recovery: steer opposite local target X so reversing swings nose toward rejoin point
        const revSteer = localR.x >= 0 ? -0.88 : 0.88;
        if (this.recoveryTimer <= 0) {
          this.recoveryMode = 'none';
        }
        return {
          throttle: 0,
          brake: 0.90,
          steer: revSteer,
          handbrake: false,
        };
      }
    }

    // 3. COLLECT NEARBY VEHICLES IN CURVILINEAR FRENET SPACE & COMPUTE PACK PROGRESS
    let nearbyCount = 0;
    let blockingCar: NearbyCarFrenet | null = null;
    let blockingDeltaS = Infinity;
    let draftLeadCar: NearbyCarFrenet | null = null;
    let bestDraftDeltaS = Infinity;
    let trailingCarBehind = false;

    const myAbsProgress = (this.vehicle.currentLap - 1) * this.track.totalLength + proj.s;
    let leaderAbsProgress = myAbsProgress;

    for (let i = 0; i < otherVehicles.length; i++) {
      const other = otherVehicles[i];
      if (other.id === this.vehicle.id) continue;

      this.track.projectToTrack(other.position.x, other.position.z, proj.closestIdx, this._projOther);
      const otherAbsProg = (other.currentLap - 1) * this.track.totalLength + this._projOther.s;
      if (otherAbsProg > leaderAbsProgress) {
        leaderAbsProgress = otherAbsProg;
      }

      const deltaS = this.track.signedArcDelta(proj.s, this._projOther.s);
      if (deltaS < -12.0 || deltaS > 58.0) continue;
      if (Math.abs(this._projOther.d) > this._projOther.halfWidth + 5.0) continue;

      if (nearbyCount < this._nearbyCars.length) {
        const rec = this._nearbyCars[nearbyCount++];
        rec.deltaS = deltaS;
        rec.d = this._projOther.d;
        rec.halfWidth = this._projOther.halfWidth;
        rec.vS = other.velocity.x * this._projOther.tangX + other.velocity.z * this._projOther.tangZ;
        rec.vD = other.velocity.x * this._projOther.normX + other.velocity.z * this._projOther.normZ;

        if (deltaS < -1.5 && deltaS > -11.0 && Math.abs(rec.d - proj.d) < 3.4) {
          trailingCarBehind = true;
        }
        if (deltaS > 0.5 && deltaS < 38.0 && Math.abs(rec.d - proj.d) < 3.8) {
          if (deltaS < blockingDeltaS) {
            blockingDeltaS = deltaS;
            blockingCar = rec;
          }
        }
        if (deltaS > 6.5 && deltaS < 26.0 && Math.abs(rec.d - proj.d) < 2.4 && deltaS < bestDraftDeltaS) {
          bestDraftDeltaS = deltaS;
          draftLeadCar = rec;
        }
      }
    }

    // Immediate spun-around / wrong-way detection when nearly stopped anywhere in corridor
    if (headingAlign < -0.20 && speedKmh < 16.0 && Math.abs(proj.d) < proj.halfWidth + 45.0) {
      if (vFwdSigned >= -0.3) {
        this.recoveryMode = 'jturn';
        this.recoveryTimer = 1.05;
        this.stuckTime = 0;
      }
    }

    // Pinned / stuck detection: trigger whenever bogged down OR sliding sideways off-track without track progress
    const offTrackNowCheck = Math.abs(proj.d) > proj.halfWidth + 2.5;
    const vSelfSPre = this.vehicle.velocity.x * proj.tangX + this.vehicle.velocity.z * proj.tangZ;
    const yieldingInQueue = !!blockingCar && blockingCar.vS > 2.5 && this.lastCommandedThrottle <= 0.20;
    const isSlowAndStuck = (speedKmh < 8.0 || (offTrackNowCheck && vSelfSPre < 3.5)) && !yieldingInQueue;
    const isDeadlocked = speedKmh < 3.0 && Math.abs(vFwdSigned) < 0.8 && !!blockingCar;
    if (isSlowAndStuck || isDeadlocked) {
      this.stuckTime += safeDt;
      if (this.stuckTime > 0.85) {
        this.recoveryMode = 'reverse';
        this.recoveryTimer = 1.05;
        this.stuckTime = 0;
      }
    } else {
      this.stuckTime = Math.max(0, this.stuckTime - safeDt * 1.6);
    }

    const distBehindLeader = Math.max(0, leaderAbsProgress - myAbsProgress);
    const vSelfS = vSelfSPre;
    const vSelfD = this.vehicle.velocity.x * proj.normX + this.vehicle.velocity.z * proj.normZ;

    // 4. PREVIEW UPCOMING MINIMUM RADIUS TO COMPUTE SPEED- & CORNER-ADAPTIVE LOOKAHEAD
    let minUpcomingRadius = this.track.raceRadius[proj.idx];
    let previewDist = 0;
    for (let s = 0; s <= 7; s++) {
      const idxA = (proj.idx + s) % count;
      const r = this.track.raceRadius[idxA];
      if (r < minUpcomingRadius) minUpcomingRadius = r;
      previewDist += this.track.segLen[idxA];
      if (previewDist > 95.0) break;
    }

    // Use continuous smooth Frenet lateral coordinate (avoids false positives on tight hairpin discrete chords)
    const offTrackExcess = Math.max(0, Math.abs(proj.d) - (proj.halfWidth + 0.45));
    const isOffTrackNow = offTrackExcess > 0.20;
    const rejoinBlend = THREE.MathUtils.clamp(offTrackExcess / 2.5, 0.0, 1.0);
    const cornerLookScale = THREE.MathUtils.clamp((minUpcomingRadius - 22.0) / 105.0, 0.0, 1.0);
    const timeHorizon = 0.14 + this.profile.lookaheadGain * 1.15; // ~0.30 - 0.37s

    const normalLookahead = THREE.MathUtils.clamp(
      7.8 + speedMs * timeHorizon * (0.45 + 0.55 * cornerLookScale),
      7.8,
      22.5
    );
    const rejoinLookahead = THREE.MathUtils.clamp(6.8 + speedMs * 0.12, 6.8, Math.max(8.5, normalLookahead * 0.72));
    const adaptiveLookahead = THREE.MathUtils.lerp(normalLookahead, rejoinLookahead, rejoinBlend);

    this.track.sampleAtArcDistance(proj.s + adaptiveLookahead, proj.idx, this._lookSample);
    this.track.sampleAtArcDistance(proj.s + adaptiveLookahead * 0.50, proj.idx, this._rejoinSample);
    const lookSample = this._lookSample;

    // 5. MULTI-CAR PREDICTIVE TTC FRENET TRAJECTORY & LANE PLANNER
    const lookEdgeMargin =
      lookSample.surface === 'sand' ? 2.15 : lookSample.surface === 'gravel' ? 1.95 : 1.75;
    const safeMaxD = Math.max(1.4, lookSample.halfWidth - lookEdgeMargin);
    const blendedRaceD = 0.25 * this._rejoinSample.racingD + 0.75 * lookSample.racingD;
    const dRacing = THREE.MathUtils.clamp(blendedRaceD, -safeMaxD, safeMaxD);

    let chosenTargetD = dRacing;
    let hasDraft = false;

    if (isOffTrackNow) {
      // Smoothly pull target back toward interior/centerline proportional to off-track excess
      chosenTargetD = THREE.MathUtils.lerp(dRacing * 0.35, 0.0, rejoinBlend);
    } else {
      // Check drafting eligibility on straighter sections
      const isLowCurv = Math.abs(this.track.raceKappa[proj.idx]) < 0.0085;
      if (draftLeadCar && isLowCurv && vSelfS > 14.0 && (vSelfS - draftLeadCar.vS) < 2.2) {
        hasDraft = true;
      }

      // Build candidate lanes: racing, inside/outside passes, left/right clean lanes, defensive
      const cands = this._candOffsets;
      cands[0] = dRacing;
      let candCount = 1;

      if (blockingCar || nearbyCount > 0) {
        if (blockingCar) {
          const openSide = blockingCar.d >= 0 ? -1 : 1;
          // Prefer keeping/widening same side if already offset and close, plus standard inside/outside options
          const sameSide = proj.d >= blockingCar.d ? 1 : -1;
          cands[candCount++] = THREE.MathUtils.clamp(blockingCar.d + sameSide * 3.55, -safeMaxD, safeMaxD);
          cands[candCount++] = THREE.MathUtils.clamp(blockingCar.d + openSide * 3.55, -safeMaxD, safeMaxD);
        }
        cands[candCount++] = THREE.MathUtils.clamp(-safeMaxD * 0.78, -safeMaxD, safeMaxD);
        cands[candCount++] = THREE.MathUtils.clamp(safeMaxD * 0.78, -safeMaxD, safeMaxD);
        if (candCount < 6) {
          cands[candCount++] = 0.0;
        }

        // Defensive line option when conservative racer is challenged closely behind into a corner
        if (trailingCarBehind && this.profile.aggression < 1.0 && candCount < 6) {
          const insideSign = Math.sign(this.track.raceKappa[lookSample.idx]) || 1;
          cands[candCount++] = THREE.MathUtils.clamp(insideSign * safeMaxD * 0.65, -safeMaxD, safeMaxD);
        }
      }

      if (candCount === 1 && hasDraft && draftLeadCar) {
        // Tuck neatly behind slipstream leader when road ahead is clear
        const draftD = THREE.MathUtils.clamp(draftLeadCar.d, -safeMaxD, safeMaxD);
        cands[candCount++] = draftD;
      }

      let bestScore = Infinity;
      let bestCand = dRacing;

      for (let c = 0; c < candCount; c++) {
        const candD = cands[c];
        let cost = 0;

        // Evaluate TTC elliptical exclusion against ALL nearby vehicles using physically bounded lateral slew
        for (let k = 0; k < nearbyCount; k++) {
          const other = this._nearbyCars[k];
          const closingRate = Math.max(0.5, vSelfS - other.vS);
          const timeToReach = other.deltaS > 0 ? Math.max(0, (other.deltaS - 3.6) / closingRate) : 0;

          // Never dive diagonally across a blocking car's bumper when already close behind it!
          if (
            other.deltaS > 0.5 &&
            other.deltaS < 18.0 &&
            Math.abs(proj.d - other.d) < 2.25 &&
            (proj.d - other.d) * (candD - other.d) < 0 &&
            timeToReach < 1.0
          ) {
            cost += (2.4 - Math.abs(proj.d - other.d)) * 140.0;
          }

          for (let h = 0; h < 4; h++) {
            const tau = h === 0 ? 0.0 : h === 1 ? 0.22 : h === 2 ? 0.45 : 0.75;
            const relS = (other.deltaS + other.vS * tau) - vSelfS * tau;

            // Side-by-side & front/rear longitudinal danger corridor
            if (relS > -3.7 && relS < 13.5) {
              // Bounded lateral transition with ~0.15s steer response lag + current lateral velocity blend
              const maxReachableShift = Math.max(0.0, tau - 0.15) * 3.4;
              const desiredShift = candD - proj.d;
              const coastShift = vSelfD * Math.min(tau, 0.18);
              const boundedShift = THREE.MathUtils.clamp(desiredShift - coastShift, -maxReachableShift, maxReachableShift);
              const dSelfAtTau = proj.d + coastShift + boundedShift;
              const dOtherAtTau = THREE.MathUtils.clamp(
                other.d + other.vD * tau,
                -(other.halfWidth + 1.2),
                other.halfWidth + 1.2
              );
              const latSep = Math.abs(dSelfAtTau - dOtherAtTau);
              const reqSep = Math.abs(other.vS) < 3.0 ? 2.75 : 2.65;
              if (latSep < reqSep) {
                const overlap = reqSep - latSep;
                const urg = relS < 3.8 ? 1.65 : 1.0 / (0.65 + (relS - 3.8) * 0.14);
                cost += overlap * 175.0 * urg;
              }
            }
          }
        }

        // Mild racing line preference when clear
        cost += Math.abs(candD - dRacing) * 2.2;

        // Curb/edge caution buffer
        if (Math.abs(candD) > lookSample.halfWidth - 2.35) {
          cost += (Math.abs(candD) - (lookSample.halfWidth - 2.35)) * 16.0;
        }

        // Hysteresis damping: avoid zig-zagging between equal-cost passing lanes
        cost += Math.abs(candD - this.smoothTargetD) * 4.8;
        const candSide = Math.abs(candD - dRacing) > 1.2 ? Math.sign(candD - dRacing) : 0;
        if (this.laneHoldTimer > 0 && this.activePassSide !== 0 && candSide !== 0 && candSide !== this.activePassSide) {
          cost += 42.0;
        }

        // Drafting reward if in clean wake before final pass point
        if (hasDraft && draftLeadCar && Math.abs(candD - draftLeadCar.d) < 1.1 && draftLeadCar.deltaS > 9.5) {
          cost -= 8.0;
        }

        if (cost < bestScore) {
          bestScore = cost;
          bestCand = candD;
        }
      }

      const newPassSide = Math.abs(bestCand - dRacing) > 1.2 ? Math.sign(bestCand - dRacing) : 0;
      if (newPassSide !== 0 && newPassSide !== this.activePassSide && this.laneHoldTimer <= 0) {
        this.activePassSide = newPassSide;
        this.laneHoldTimer = 0.65;
      } else if (newPassSide === 0 && !blockingCar) {
        this.activePassSide = 0;
      }
      chosenTargetD = bestCand;
    }

    // Smooth lateral target offset so lane transitions never destabilize cornering grip
    const localCurv = Math.max(
      Math.abs(this.track.raceKappa[proj.idx]),
      Math.abs(this.track.raceKappa[lookSample.idx])
    );
    let maxLaneShiftRate = localCurv > 0.011 ? 1.5 : 4.2;
    if (blockingCar && blockingDeltaS < 14.0) {
      // Never whip sideways across loose gravel/sand mid-corner; change lanes calmly there
      const passRate = (proj.surface !== 'asphalt' && localCurv > 0.008) ? 2.8 : 6.2;
      maxLaneShiftRate = Math.max(maxLaneShiftRate, passRate);
    }
    maxLaneShiftRate = THREE.MathUtils.lerp(maxLaneShiftRate, 6.0, rejoinBlend);
    const maxDeltaD = maxLaneShiftRate * safeDt;
    this.smoothTargetD += THREE.MathUtils.clamp(chosenTargetD - this.smoothTargetD, -maxDeltaD, maxDeltaD);

    // 6. COORDINATE-FIXED PURE PURSUIT + STANLEY CTE + DRIFT COUNTER-STEER CONTROLLER
    const finalTargetD = THREE.MathUtils.clamp(
      this.smoothTargetD,
      -(lookSample.halfWidth - 1.5),
      lookSample.halfWidth - 1.5
    );

    const targetPoint = PurePursuitAI._targetWorld.set(
      lookSample.x + lookSample.normX * finalTargetD,
      lookSample.y,
      lookSample.z + lookSample.normZ * finalTargetD
    );

    const toTargetWorld = PurePursuitAI._toWorld.copy(targetPoint).sub(pos);
    const toTargetLocal = PurePursuitAI._toLocal.copy(toTargetWorld).applyQuaternion(invQuat);

    // Pure pursuit heading error alpha (clamped cleanly if target falls slightly abeam/behind)
    let alpha = Math.atan2(toTargetLocal.x, Math.max(0.5, toTargetLocal.z));
    if (toTargetLocal.z < 0) {
      alpha = (toTargetLocal.x >= 0 ? 1 : -1) * (Math.PI * 0.5);
    }
    const L_actual = Math.max(3.5, Math.hypot(toTargetLocal.x, toTargetLocal.z));
    const purCurvature = (2.0 * Math.sin(alpha)) / L_actual;
    const wheelAnglePursuit = Math.atan(purCurvature * this.wheelbase);

    // Invert VehiclePhysics speed-sensitive maxSteer attenuation so front wheels hit target angle accurately
    const lockRad = (this.vehicle.tuning.steeringLockDeg * Math.PI) / 180.0;
    const speedRatio = Math.min(1.0, speedKmh / 160.0);
    const maxSteerNow = THREE.MathUtils.lerp(lockRad, lockRad * 0.38, speedRatio);

    // Properly-signed Stanley Cross-Track Error computed strictly in vehicle local coordinates!
    // errLocal.x > 0 ALWAYS means target lane is toward +vehicle.right (positive steer).
    const clampedNowD = THREE.MathUtils.lerp(finalTargetD, 0.0, rejoinBlend);
    const desiredLanePt = PurePursuitAI._laneWorld.set(
      proj.centerX + proj.normX * clampedNowD,
      proj.centerY,
      proj.centerZ + proj.normZ * clampedNowD
    );
    const errLocal = PurePursuitAI._errLocal.copy(desiredLanePt).sub(pos).applyQuaternion(invQuat);
    const cteGain = THREE.MathUtils.lerp(0.26, 0.90, rejoinBlend);
    const cteMaxRad = THREE.MathUtils.lerp(0.075, 0.30, rejoinBlend);
    const stanleyAngle = THREE.MathUtils.clamp(
      Math.atan2(cteGain * errLocal.x, Math.max(7.0, speedMs + 6.0)),
      -cteMaxRad,
      cteMaxRad
    );

    let desiredWheelAngle = wheelAnglePursuit + stanleyAngle;
    // Direct full-lock capture ONLY when off-track or spun past 75 deg (never oversteer inside on-track hairpins!)
    const directBlend = Math.max(rejoinBlend, headingAlign < 0.25 ? 1.0 : 0.0);
    if (directBlend > 0) {
      const directWheelAngle = THREE.MathUtils.clamp(alpha * 1.45, -maxSteerNow, maxSteerNow);
      desiredWheelAngle = THREE.MathUtils.lerp(desiredWheelAngle, directWheelAngle, directBlend);
    }

    const baseSteer = desiredWheelAngle / Math.max(0.15, maxSteerNow);

    // Active Counter-Steer & Yaw-Rate Stabilization (bounded, and disabled off-track/severe-skew so rejoin has priority):
    // Note: in VehiclePhysics, a LEFT turn (steer < 0) produces negative yawRate and POSITIVE rear slipAngle.
    // Counter-steering RIGHT requires positive steer (+k * slipAngle, -k * (yawRate - targetYawRate)).
    const slip = this.vehicle.slipAngle;
    const absSlip = Math.abs(slip);
    const driftEnthNorm = THREE.MathUtils.clamp((this.profile.driftEnthusiasm - 0.5) / 0.8, 0.0, 1.0);
    const slipDeadband = 0.065 + driftEnthNorm * 0.11; // Grip racers ~0.065 rad, Zofia Drift ~0.175 rad
    const excessSlip = absSlip > slipDeadband ? Math.sign(slip) * (absSlip - slipDeadband) : 0;

    const currentYawRate = this.vehicle.angularVelocity.dot(up);
    const targetYawRate = THREE.MathUtils.clamp(vFwdSigned * purCurvature, -1.8, 1.8);
    const yawRateErr = currentYawRate - targetYawRate;

    const kSlip = THREE.MathUtils.lerp(0.55, 0.32, driftEnthNorm);
    const kYaw = 0.10;
    const canStabilize = !isOffTrackNow && speedKmh > 18.0 && headingAlign > 0.45 && absSlip < 0.38;
    const rawStabilize = canStabilize ? (kSlip * excessSlip - kYaw * yawRateErr) : 0;
    const steerStabilize = THREE.MathUtils.clamp(rawStabilize, -0.24, 0.24);

    const steerInput = THREE.MathUtils.clamp(baseSteer + steerStabilize, -1.0, 1.0);

    // 7. PHYSICS-CALIBRATED CORNERING, SLOPE-AWARE BRAKING & GAP CONTROL
    const aggNorm = THREE.MathUtils.clamp((this.profile.aggression - 0.90) / 0.30, 0.0, 1.0);
    const aggPaceScale = 0.90 + aggNorm * 0.085; // 0.90 (Marek) -> 0.985 (Tomek)

    // Subtle bounded competitiveness when far behind pack leader (max +4%, never past grip ceiling)
    const rubberBand = distBehindLeader > 85.0
      ? 1.0 + Math.min(0.04, ((distBehindLeader - 85.0) / 220.0) * 0.04)
      : 1.0;

    const computeSurfaceGripG = (surf: 'asphalt' | 'gravel' | 'sand'): number => {
      // Calibrated cleanly inside VehiclePhysics's 0.14 rad rear-slip threshold across all surfaces
      let baseG = 0.87;
      if (surf === 'gravel') {
        baseG = this.vehicle.upgrades.sandTires ? 0.67 : 0.55;
      } else if (surf === 'sand') {
        baseG = this.vehicle.upgrades.sandTires ? 0.48 : 0.31;
      }
      if (this.vehicle.upgrades.sportSuspension) baseG *= 1.04;
      // Preserve clean control if damaged
      const damageScale = Math.max(0.84, 1.0 - this.vehicle.damage.bodyDamage * 0.15);
      return baseG * damageScale;
    };

    // How close are we to the wide racing line vs squeezed off-line in traffic?
    const curOffRaceRatio = THREE.MathUtils.clamp(Math.abs(proj.d - this.track.racingLineD[proj.idx]) / 4.2, 0.0, 0.80);

    const getCornerSpeedKmh = (wpIdx: number, radiusScale = 1.0): number => {
      const wp = this.waypoints[wpIdx];
      const surfG = computeSurfaceGripG(wp.surface);
      const tgtDiff = Math.abs(this.smoothTargetD - this.track.racingLineD[wpIdx]);
      const wpOffRaceRatio = Math.max(
        curOffRaceRatio,
        tgtDiff > 1.5 ? THREE.MathUtils.clamp(tgtDiff / 4.2, 0.15, 0.80) : 0.0
      );
      // Blend between racing-line radius and tighter centerline radius if forced off-line
      const rawR = THREE.MathUtils.lerp(
        this.track.raceRadius[wpIdx],
        Math.min(this.track.raceRadius[wpIdx], this.track.centerRadius[wpIdx]),
        wpOffRaceRatio
      );
      const effR = Math.max(14.0, rawR * radiusScale);
      const bankedG = surfG * aggPaceScale * rubberBand + Math.abs(wp.banking) * 0.25;
      const clampedG = Math.min(bankedG, surfG * 1.01); // Hard safety cap below slip cliff

      const physicsKmh = Math.sqrt(clampedG * 9.81 * effR) * 3.6;
      const minSurfaceKmh = wp.surface === 'sand' ? 30.0 : wp.surface === 'gravel' ? 36.0 : 40.0;

      const capKmh = Math.min(physicsKmh, Math.max(wp.targetSpeedKmh * 1.08, 185.0));
      return Math.max(minSurfaceKmh, capKmh);
    };

    let adjustedTargetSpeed = getCornerSpeedKmh(proj.idx);

    if (hasDraft) {
      adjustedTargetSpeed *= 1.05;
    }

    // Gradual rejoin speed ceiling when off-track (prevents panic brake-lock on light curb drops)
    if (isOffTrackNow) {
      const mildRejoinCap = Math.max(58.0, adjustedTargetSpeed * 0.90);
      const rejoinCapKmh = THREE.MathUtils.lerp(mildRejoinCap, 42.0, rejoinBlend);
      adjustedTargetSpeed = Math.min(adjustedTargetSpeed, rejoinCapKmh);
    }

    // Predictive braking zone scan up to ~200m (15 segments) with downhill grade compensation
    const baseDecel = 7.0 + aggNorm * 0.8; // 7.0 -> 7.8 m/s^2 safely inside corner braking capacity
    let distAhead = (1.0 - proj.t) * this.track.segLen[proj.idx];
    let gradeAccum = this.track.sinGrade[proj.idx];
    let gradeSamples = 1;

    for (let s = 1; s <= 15; s++) {
      const idxA = (proj.idx + s) % count;
      if (s > 1) {
        const prevA = (idxA - 1 + count) % count;
        distAhead += this.track.segLen[prevA];
      }
      if (distAhead > 200.0) break;

      gradeAccum += this.track.sinGrade[idxA];
      gradeSamples++;
      const avgGrade = gradeAccum / gradeSamples;

      // Downhill slope (avgGrade < 0) increases stopping distance, uphill helps braking
      const surfBrakeFactor =
        this.waypoints[idxA].surface === 'sand' ? 0.62 : this.waypoints[idxA].surface === 'gravel' ? 0.82 : 1.0;
      const effDecel = Math.max(3.6, baseDecel * surfBrakeFactor + avgGrade * 9.81);

      const cornerTargetKmh = getCornerSpeedKmh(idxA);
      const cornerMs = cornerTargetKmh / 3.6;
      const allowableMs = Math.sqrt(cornerMs * cornerMs + 2.0 * effDecel * Math.max(0, distAhead));
      const allowableKmh = allowableMs * 3.6;

      if (allowableKmh < adjustedTargetSpeed) {
        adjustedTargetSpeed = allowableKmh;
      }
    }

    // Curvilinear Frenet Longitudinal Gap Control with physical lateral reachability at impact time
    for (let k = 0; k < nearbyCount; k++) {
      const other = this._nearbyCars[k];
      if (other.deltaS <= 0.4 || other.deltaS > 32.0) continue;

      const relSpeed = Math.max(2.0, vSelfS - other.vS);
      const bumperGap = Math.max(0.0, other.deltaS - 3.6);
      const ttc = Math.min(1.6, bumperGap / relSpeed);
      const reachByImpact = Math.max(0.0, ttc - 0.14) * 3.2;
      const dShift = THREE.MathUtils.clamp(this.smoothTargetD - proj.d, -reachByImpact, reachByImpact);
      const dSelfAtImpact = proj.d + dShift;
      const dOtherAtImpact = other.d + other.vD * Math.min(0.55, ttc);

      const latNow = Math.abs(other.d - proj.d);
      const latAtImpact = Math.abs(dOtherAtImpact - dSelfAtImpact);
      // Actual car body width is ~1.85m; >= 2.18m lateral separation is physically clear to pass
      const clearThresh = Math.abs(other.vS) < 3.0 ? 2.15 : 2.28;
      // If close (< 0.48s TTC) and still inline right now, we cannot clear laterally before arrival
      const effectiveSep = ttc < 0.48 ? Math.min(latNow, latAtImpact) : latAtImpact;
      const corridorOverlap = effectiveSep < clearThresh && latNow < clearThresh + 0.30;

      if (!corridorOverlap) continue;

      const desiredGap = 2.6 + speedMs * 0.30;
      if (bumperGap < desiredGap) {
        const otherKmh = Math.max(0, other.vS * 3.6);
        const plannedClear =
          (latAtImpact >= clearThresh && latNow >= 1.85) ||
          (other.deltaS < 4.5 && latNow >= 1.98 && Math.abs(this.smoothTargetD - other.d) >= 2.25);
        if (plannedClear && (bumperGap > 1.0 || latNow >= 1.98)) {
          // Keep strong rolling momentum to slice past parked/slow obstacles cleanly once laterally stepping wide
          adjustedTargetSpeed = Math.min(adjustedTargetSpeed, Math.max(46.0, otherKmh + 16.0));
        } else {
          const squeeze = (desiredGap - bumperGap) * 7.2;
          const minRoll = bumperGap > 3.2 ? 26.0 : 0.0;
          adjustedTargetSpeed = Math.min(adjustedTargetSpeed, Math.max(minRoll, otherKmh - squeeze));
        }
      }
    }

    // 8. SMOOTH THROTTLE, EBD CORNER-SAFE TRAIL-BRAKING & PERSONALITY DRIFT STYLING
    let throttle = 0;
    let brake = 0;
    let handbrake = false;

    const speedDiff = speedKmh - adjustedTargetSpeed;

    if (speedDiff > 1.8 && speedKmh > 9.0) {
      // Kamm + gentle EBD taper: keep >= 68% decel authority so braking finishes on time without 100%-steer nose-lock
      const rawBrake = THREE.MathUtils.clamp((speedDiff - 1.5) / 14.0, 0.06, 1.0);
      const steerBrakeTaper = THREE.MathUtils.clamp(
        1.0 - Math.max(0, Math.abs(steerInput) - 0.18) / 0.35,
        0.0,
        1.0
      );
      const maxCornerBrake = THREE.MathUtils.lerp(0.68, 1.0, steerBrakeTaper);
      brake = Math.min(rawBrake, maxCornerBrake);
      if (isOffTrackNow) {
        brake = Math.min(brake, 0.40);
      }
      throttle = 0;
    } else if (speedDiff > -1.5) {
      // Smooth maintenance throttle along corner apex
      throttle = THREE.MathUtils.clamp(0.78 - (speedDiff + 1.5) * 0.16, 0.18, 0.88);
      brake = 0;
    } else {
      // Proportional full-power acceleration out of corner & down straights
      throttle = THREE.MathUtils.clamp(0.75 + (-speedDiff - 1.5) * 0.06, 0.75, 1.0);
      brake = 0;
    }

    // Progressive RWD corner-exit traction cap when front wheels still carry substantial steering lock
    if (speedKmh > 52.0 && Math.abs(steerInput) > 0.17 && this.driftFlickTimer <= 0) {
      const steerLoad = THREE.MathUtils.clamp((Math.abs(steerInput) - 0.17) / 0.45, 0.0, 1.0);
      const speedLoad = THREE.MathUtils.clamp((speedKmh - 50.0) / 55.0, 0.0, 1.0);
      const kammThrottleCap = THREE.MathUtils.lerp(1.0, 0.52, steerLoad * speedLoad);
      throttle = Math.min(throttle, kammThrottleCap);
    }

    // Expressive controlled rally drift initiation for Zofia on tight asphalt hairpins
    if (this.driftFlickTimer > 0) {
      this.driftFlickTimer -= safeDt;
      if (this.driftFlickTimer > 0 && absSlip < 0.148 && !isOffTrackNow) {
        handbrake = true;
        throttle = Math.max(throttle, 0.24);
      }
    } else if (
      this.profile.driftEnthusiasm >= 1.1 &&
      !isOffTrackNow &&
      !this.vehicle.isDrifting &&
      this.driftFlickCooldown <= 0 &&
      (!blockingCar || blockingDeltaS > 22.0) &&
      speedKmh >= 36.0 &&
      speedKmh <= 56.0 &&
      Math.abs(steerInput) > 0.38 &&
      Math.abs(proj.d) < proj.halfWidth * 0.72 &&
      proj.surface === 'asphalt' &&
      minUpcomingRadius < 42.0
    ) {
      this.driftFlickTimer = 0.055;
      this.driftFlickCooldown = 4.2;
      handbrake = true;
    }

    // Critical VehiclePhysics rearDriftScale protection (only apply > 22 km/h so stuck cars always get full launch power):
    // Crossing |slipAngle| > 0.14 with throttle > 0.25 drops rearDriftScale from 0.60 -> 0.40!
    const intentionalDrift =
      this.profile.driftEnthusiasm >= 1.1 &&
      !isOffTrackNow &&
      speedKmh < 64.0 &&
      proj.surface === 'asphalt' &&
      Math.abs(proj.d) < proj.halfWidth * 0.65;

    if (throttle > 0 && isOffTrackNow && (absSlip > 0.35 || headingAlign < 0.65 || Math.abs(alpha) > 0.40)) {
      // Pivot calmly back toward the track instead of blasting laterally into obstacles
      throttle = Math.min(throttle, 0.38);
      handbrake = false;
    }

    if (throttle > 0 && speedKmh > 22.0) {
      if (isOffTrackNow && absSlip > 0.11) {
        throttle = Math.min(throttle, 0.19);
        handbrake = false;
      } else if (intentionalDrift) {
        if (absSlip > 0.165) {
          throttle = Math.min(throttle, 0.18);
          handbrake = false;
        } else if (absSlip > 0.125) {
          throttle = Math.min(throttle, THREE.MathUtils.lerp(0.24, 0.19, (absSlip - 0.125) / 0.04));
        }
      } else {
        if (absSlip > 0.134) {
          throttle = Math.min(throttle, 0.18); // Restores rearDriftScale = 0.60 so rear snaps cleanly back
          handbrake = false;
        } else if (absSlip > 0.108) {
          const tFrac = (absSlip - 0.108) / 0.026;
          throttle = Math.min(throttle, THREE.MathUtils.lerp(0.76, 0.26, tFrac));
        }
      }
    }

    const finalThrottle = THREE.MathUtils.clamp(throttle, 0, 1);
    const finalBrake = THREE.MathUtils.clamp(brake, 0, 1);
    this.lastCommandedThrottle = finalThrottle;

    return {
      throttle: finalThrottle,
      brake: finalBrake,
      steer: steerInput,
      handbrake,
    };
  }
}
