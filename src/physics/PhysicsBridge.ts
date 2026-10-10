import * as THREE from 'three';

/**
 * High-Speed Physics Synchronization Bridge
 * Manages zero-copy shared memory or transferable binary buffers between
 * the physics evaluation loop and the main rendering thread.
 */

export const VEHICLE_STATE_FLOATS = 32; // 128 bytes per vehicle (32 * 4 bytes)
export const MAX_SYNC_VEHICLES = 8;
export const TOTAL_PHYSICS_BUFFER_BYTES = (4 + MAX_SYNC_VEHICLES * VEHICLE_STATE_FLOATS) * 4;

export class PhysicsBridge {
  public sharedBuffer: ArrayBuffer | SharedArrayBuffer;
  public floatView: Float32Array;
  public uintView: Uint32Array;

  // Scratch objects for zero-allocation reading
  private static readonly _pos = new THREE.Vector3();
  private static readonly _quat = new THREE.Quaternion();

  constructor() {
    // Attempt SharedArrayBuffer if cross-origin isolated; fallback to regular ArrayBuffer
    if (typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated) {
      this.sharedBuffer = new SharedArrayBuffer(TOTAL_PHYSICS_BUFFER_BYTES);
    } else {
      this.sharedBuffer = new ArrayBuffer(TOTAL_PHYSICS_BUFFER_BYTES);
    }
    this.floatView = new Float32Array(this.sharedBuffer);
    this.uintView = new Uint32Array(this.sharedBuffer);
  }

  /**
   * Writes vehicle physics state into the shared buffer block
   */
  public writeVehicleState(
    slotIndex: number,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    vel: THREE.Vector3,
    angVelY: number,
    speedKmh: number,
    rpm: number,
    gear: number,
    driftScore: number,
    slipAngle: number,
    damage: number,
    engineHealth: number
  ): void {
    if (slotIndex < 0 || slotIndex >= MAX_SYNC_VEHICLES) return;
    const base = 4 + slotIndex * VEHICLE_STATE_FLOATS;

    // Position (vec3 + pad)
    this.floatView[base + 0] = pos.x;
    this.floatView[base + 1] = pos.y;
    this.floatView[base + 2] = pos.z;
    this.floatView[base + 3] = 0.0;

    // Rotation quaternion (xyzw)
    this.floatView[base + 4] = quat.x;
    this.floatView[base + 5] = quat.y;
    this.floatView[base + 6] = quat.z;
    this.floatView[base + 7] = quat.w;

    // Velocity (vec3 + angVelY)
    this.floatView[base + 8] = vel.x;
    this.floatView[base + 9] = vel.y;
    this.floatView[base + 10] = vel.z;
    this.floatView[base + 11] = angVelY;

    // Powertrain & Telemetry
    this.floatView[base + 12] = speedKmh;
    this.floatView[base + 13] = rpm;
    this.floatView[base + 14] = gear;
    this.floatView[base + 15] = driftScore;

    this.floatView[base + 16] = slipAngle;
    this.floatView[base + 17] = damage;
    this.floatView[base + 18] = engineHealth;
    this.floatView[base + 19] = 0.0; // surface
  }

  /**
   * Reads vehicle physics state out of the shared buffer block
   */
  public readVehicleState(
    slotIndex: number,
    outPos: THREE.Vector3,
    outQuat: THREE.Quaternion
  ): void {
    if (slotIndex < 0 || slotIndex >= MAX_SYNC_VEHICLES) return;
    const base = 4 + slotIndex * VEHICLE_STATE_FLOATS;

    outPos.set(
      this.floatView[base + 0],
      this.floatView[base + 1],
      this.floatView[base + 2]
    );

    outQuat.set(
      this.floatView[base + 4],
      this.floatView[base + 5],
      this.floatView[base + 6],
      this.floatView[base + 7]
    );
  }
}
