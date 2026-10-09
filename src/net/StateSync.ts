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
   * Serializes vehicle kinematic state into a compact 72-byte ArrayBuffer
   */
  public static serializeState(
    sequence: number,
    state: VehicleState,
    brakeInput: number
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(72);
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
