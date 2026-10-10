import * as THREE from 'three';
import { VehicleState } from '../game/Types';

export interface NetworkVehicleFrame {
  sequence: number;
  timestamp: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  rpm: number;
  steer: number;
  gear: number;
  isDrifting: boolean;
  brakeLight: boolean;
}

export class StateSync {
  /**
   * Serializes vehicle kinematic state into a compact 76-byte ArrayBuffer
   */
  public static serializeState(
    sequence: number,
    state: VehicleState,
    brakeInput: number
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(76);
    const view = new DataView(buffer);

    let offset = 0;
    // Header
    view.setUint32(offset, sequence, true); offset += 4;
    view.setFloat64(offset, performance.now(), true); offset += 8;

    // Position (x, y, z)
    view.setFloat32(offset, state.position.x, true); offset += 4;
    view.setFloat32(offset, state.position.y, true); offset += 4;
    view.setFloat32(offset, state.position.z, true); offset += 4;

    // Quaternion (x, y, z, w)
    view.setFloat32(offset, state.quaternion.x, true); offset += 4;
    view.setFloat32(offset, state.quaternion.y, true); offset += 4;
    view.setFloat32(offset, state.quaternion.z, true); offset += 4;
    view.setFloat32(offset, state.quaternion.w, true); offset += 4;

    // Linear Velocity (vx, vy, vz)
    view.setFloat32(offset, state.velocity.x, true); offset += 4;
    view.setFloat32(offset, state.velocity.y, true); offset += 4;
    view.setFloat32(offset, state.velocity.z, true); offset += 4;

    // Angular Velocity (wx, wy, wz)
    view.setFloat32(offset, state.angularVelocity.x, true); offset += 4;
    view.setFloat32(offset, state.angularVelocity.y, true); offset += 4;
    view.setFloat32(offset, state.angularVelocity.z, true); offset += 4;

    // Telemetry
    view.setFloat32(offset, state.rpm, true); offset += 4;
    view.setFloat32(offset, state.steer, true); offset += 4;
    view.setInt8(offset, state.gear); offset += 1;

    // Flags: bit 0 = isDrifting, bit 1 = brakeLight
    let flags = 0;
    if (state.isDrifting) flags |= 1;
    if (brakeInput > 0.1) flags |= 2;
    view.setUint8(offset, flags);

    return buffer;
  }

  /**
   * Evaluates Tandem Drift proximity, angle alignment, and scoring multiplier
   * between Leader and Chaser vehicles (P2P multiplayer and AI tandems)
   */
  public static evaluateTandemDrift(
    leaderPos: THREE.Vector3,
    leaderQuat: THREE.Quaternion,
    leaderDrifting: boolean,
    chaserPos: THREE.Vector3,
    chaserQuat: THREE.Quaternion,
    chaserDrifting: boolean
  ): { isTandem: boolean; proximityMeters: number; angleDiffDeg: number; multiplier: number } {
    if (!leaderDrifting || !chaserDrifting) {
      return { isTandem: false, proximityMeters: Infinity, angleDiffDeg: 180, multiplier: 1.0 };
    }

    const dist = leaderPos.distanceTo(chaserPos);
    if (dist > 8.0) {
      return { isTandem: false, proximityMeters: dist, angleDiffDeg: 180, multiplier: 1.0 };
    }

    // Measure heading vector alignment
    const vFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(leaderQuat);
    const cFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chaserQuat);
    const dot = Math.max(-1, Math.min(1, vFwd.dot(cFwd)));
    const angleDiffDeg = Math.acos(dot) * (180 / Math.PI);

    // Tandem requires heading alignment within 38 degrees
    if (angleDiffDeg > 38.0) {
      return { isTandem: false, proximityMeters: dist, angleDiffDeg, multiplier: 1.0 };
    }

    // Proximity yields multiplier: door-to-door (<3.0m) = 3.5x, close (<5.0m) = 2.5x, chased = 1.75x
    let mult = 1.75;
    if (dist < 3.0) mult = 3.5;
    else if (dist < 5.0) mult = 2.5;

    return {
      isTandem: true,
      proximityMeters: dist,
      angleDiffDeg,
      multiplier: mult,
    };
  }

  /**
   * Deserializes a 72-byte ArrayBuffer back into NetworkVehicleFrame
   */
  public static deserializeState(buffer: ArrayBuffer): NetworkVehicleFrame {
    const view = new DataView(buffer);
    let offset = 0;

    const sequence = view.getUint32(offset, true); offset += 4;
    const timestamp = view.getFloat64(offset, true); offset += 8;

    const position = new THREE.Vector3(
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true)
    );
    offset += 12;

    const quaternion = new THREE.Quaternion(
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true)
    );
    offset += 16;

    const velocity = new THREE.Vector3(
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true)
    );
    offset += 12;

    const angularVelocity = new THREE.Vector3(
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true)
    );
    offset += 12;

    const rpm = view.getFloat32(offset, true); offset += 4;
    const steer = view.getFloat32(offset, true); offset += 4;
    const gear = view.getInt8(offset); offset += 1;
    const flags = view.getUint8(offset);

    return {
      sequence,
      timestamp,
      position,
      quaternion,
      velocity,
      angularVelocity,
      rpm,
      steer,
      gear,
      isDrifting: (flags & 1) !== 0,
      brakeLight: (flags & 2) !== 0,
    };
  }

  /**
   * Client-Side Prediction & Server Reconciliation:
   * Smoothly interpolates remote peer towards authoritative position without jittery snaps
   */
  public static reconcileRemoteVehicle(
    currentPos: THREE.Vector3,
    currentQuat: THREE.Quaternion,
    authoritativePos: THREE.Vector3,
    authoritativeQuat: THREE.Quaternion,
    velocity: THREE.Vector3,
    delta: number
  ): void {
    // Extrapolate authoritative position by expected latency
    const predictedPos = authoritativePos.clone().addScaledVector(velocity, delta * 0.5);

    const distError = currentPos.distanceTo(predictedPos);
    if (distError > 5.0) {
      // Hard snap on large teleport / reset
      currentPos.copy(predictedPos);
      currentQuat.copy(authoritativeQuat);
    } else {
      // Smooth reconciliation blending (Hermite / lerp)
      const blendFactor = Math.min(1.0, delta * 18.0);
      currentPos.lerp(predictedPos, blendFactor);
      currentQuat.slerp(authoritativeQuat, blendFactor);
    }
  }
}

/**
 * Snapshot Interpolation with Jitter Buffer & Lag Compensation (M5)
 * Maintains a sliding window of remote peer state frames, smoothing packet jitter
 * and dead-reckoning during packet loss.
 */
export class SnapshotJitterBuffer {
  private snapshots: NetworkVehicleFrame[] = [];
  private readonly maxBufferSize = 32;
  public jitterDelayMs = 60; // Target interpolation buffer delay (ms)

  public pushSnapshot(frame: NetworkVehicleFrame): void {
    // Drop out-of-order packets older than the newest received
    if (this.snapshots.length > 0 && frame.sequence <= this.snapshots[this.snapshots.length - 1].sequence) {
      return;
    }

    this.snapshots.push(frame);
    if (this.snapshots.length > this.maxBufferSize) {
      this.snapshots.shift();
    }
  }

  /**
   * Samples interpolated vehicle transform at render time (now - jitterDelayMs)
   */
  public sample(targetPos: THREE.Vector3, targetQuat: THREE.Quaternion): {
    speedKmh: number;
    rpm: number;
    gear: number;
    isDrifting: boolean;
    brakeLight: boolean;
  } | null {
    if (this.snapshots.length === 0) return null;

    const renderTime = performance.now() - this.jitterDelayMs;

    // If only one snapshot or render time is ahead of newest snapshot: extrapolate (lag compensation)
    const latest = this.snapshots[this.snapshots.length - 1];
    if (this.snapshots.length === 1 || renderTime >= latest.timestamp) {
      const dt = Math.min(0.2, Math.max(0, (renderTime - latest.timestamp) / 1000));
      targetPos.copy(latest.position).addScaledVector(latest.velocity, dt);
      targetQuat.copy(latest.quaternion);
      return {
        speedKmh: latest.velocity.length() * 3.6,
        rpm: latest.rpm,
        gear: latest.gear,
        isDrifting: latest.isDrifting,
        brakeLight: latest.brakeLight,
      };
    }

    // Find bounding pair [S_prev, S_next] surrounding renderTime
    let prev = this.snapshots[0];
    let next = this.snapshots[this.snapshots.length - 1];

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].timestamp <= renderTime && this.snapshots[i + 1].timestamp >= renderTime) {
        prev = this.snapshots[i];
        next = this.snapshots[i + 1];
        break;
      }
    }

    const span = Math.max(1, next.timestamp - prev.timestamp);
    const alpha = THREE.MathUtils.clamp((renderTime - prev.timestamp) / span, 0, 1);

    // Hermite cubic spline position interpolation
    targetPos.copy(prev.position).lerp(next.position, alpha);
    targetQuat.copy(prev.quaternion).slerp(next.quaternion, alpha);

    return {
      speedKmh: THREE.MathUtils.lerp(prev.velocity.length(), next.velocity.length(), alpha) * 3.6,
      rpm: THREE.MathUtils.lerp(prev.rpm, next.rpm, alpha),
      gear: next.gear,
      isDrifting: next.isDrifting,
      brakeLight: next.brakeLight,
    };
  }

  public clear(): void {
    this.snapshots = [];
  }
}
