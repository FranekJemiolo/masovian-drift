import { VehiclePhysics } from '../../physics/VehiclePhysics';
import {
  Position,
  Rotation,
  Velocity,
  VehicleTelemetry,
  TwoSampleStateBuffer,
} from '../Components';

export class PhysicsSyncSystem {
  /**
   * Called on every fixed physics step tick (e.g. 60Hz).
   * Advances the two-sample fixed state buffer: prev <= curr, curr <= new physics transform.
   */
  public static syncVehiclePhysics(eid: number, vehicle: VehiclePhysics): void {
    if (eid <= 0) return;

    // Shift previous state
    TwoSampleStateBuffer.prevPosX[eid] = TwoSampleStateBuffer.currPosX[eid];
    TwoSampleStateBuffer.prevPosY[eid] = TwoSampleStateBuffer.currPosY[eid];
    TwoSampleStateBuffer.prevPosZ[eid] = TwoSampleStateBuffer.currPosZ[eid];

    TwoSampleStateBuffer.prevRotX[eid] = TwoSampleStateBuffer.currRotX[eid];
    TwoSampleStateBuffer.prevRotY[eid] = TwoSampleStateBuffer.currRotY[eid];
    TwoSampleStateBuffer.prevRotZ[eid] = TwoSampleStateBuffer.currRotZ[eid];
    TwoSampleStateBuffer.prevRotW[eid] = TwoSampleStateBuffer.currRotW[eid];

    // Read new state from Rapier body
    const pos = vehicle.position;
    const quat = vehicle.quaternion;
    const vel = vehicle.velocity;

    TwoSampleStateBuffer.currPosX[eid] = pos.x;
    TwoSampleStateBuffer.currPosY[eid] = pos.y;
    TwoSampleStateBuffer.currPosZ[eid] = pos.z;

    TwoSampleStateBuffer.currRotX[eid] = quat.x;
    TwoSampleStateBuffer.currRotY[eid] = quat.y;
    TwoSampleStateBuffer.currRotZ[eid] = quat.z;
    TwoSampleStateBuffer.currRotW[eid] = quat.w;

    // Direct Position & Rotation sync
    Position.x[eid] = pos.x;
    Position.y[eid] = pos.y;
    Position.z[eid] = pos.z;

    Rotation.x[eid] = quat.x;
    Rotation.y[eid] = quat.y;
    Rotation.z[eid] = quat.z;
    Rotation.w[eid] = quat.w;

    Velocity.vx[eid] = vel.x;
    Velocity.vy[eid] = vel.y;
    Velocity.vz[eid] = vel.z;
    Velocity.angularY[eid] = vehicle.angularVelocity.y;

    // Telemetry sync
    VehicleTelemetry.speedKmh[eid] = vehicle.speedKmh;
    VehicleTelemetry.rpm[eid] = vehicle.rpm;
    VehicleTelemetry.gear[eid] = vehicle.currentGear;
    VehicleTelemetry.driftScore[eid] = vehicle.driftScore;
    VehicleTelemetry.slipAngle[eid] = vehicle.slipAngle;
    VehicleTelemetry.damage[eid] = vehicle.damage.bodyDamage;
    VehicleTelemetry.engineHealth[eid] = Math.max(0, 1.0 - vehicle.damage.engineWear);
    VehicleTelemetry.lap[eid] = vehicle.currentLap;
    VehicleTelemetry.checkpoint[eid] = vehicle.currentCheckpointIndex;
  }
}
