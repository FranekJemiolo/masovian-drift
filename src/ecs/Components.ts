import { soa } from 'bitecs';

export const MAX_ENTITIES = 512;

/**
 * 3D World Position (Structure of Arrays - Float32Array)
 */
export const Position = soa({
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
  z: new Float32Array(MAX_ENTITIES),
});

/**
 * 3D World Orientation Quaternion (Structure of Arrays - Float32Array)
 */
export const Rotation = soa({
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
  z: new Float32Array(MAX_ENTITIES),
  w: new Float32Array(MAX_ENTITIES),
});

/**
 * Linear & Angular Velocity (Structure of Arrays - Float32Array)
 */
export const Velocity = soa({
  vx: new Float32Array(MAX_ENTITIES),
  vy: new Float32Array(MAX_ENTITIES),
  vz: new Float32Array(MAX_ENTITIES),
  angularY: new Float32Array(MAX_ENTITIES),
});

/**
 * Analog & Digital Vehicle Inputs (Structure of Arrays - Float32Array)
 */
export const VehicleInput = soa({
  throttle: new Float32Array(MAX_ENTITIES),
  brake: new Float32Array(MAX_ENTITIES),
  steer: new Float32Array(MAX_ENTITIES),
  handbrake: new Float32Array(MAX_ENTITIES), // 1.0 = engaged, 0.0 = released
});

/**
 * Powertrain, Drift & Structural Telemetry (Structure of Arrays - Float32Array)
 */
export const VehicleTelemetry = soa({
  speedKmh: new Float32Array(MAX_ENTITIES),
  rpm: new Float32Array(MAX_ENTITIES),
  gear: new Float32Array(MAX_ENTITIES),
  driftScore: new Float32Array(MAX_ENTITIES),
  slipAngle: new Float32Array(MAX_ENTITIES),
  damage: new Float32Array(MAX_ENTITIES),
  engineHealth: new Float32Array(MAX_ENTITIES),
  lap: new Float32Array(MAX_ENTITIES),
  checkpoint: new Float32Array(MAX_ENTITIES),
});

/**
 * Two-Sample Fixed-State Interpolation Buffer for Visual Smoothing (Phase 2)
 * Stores previous tick (t-1), current tick (t), and computed render pose (lerp/slerp).
 */
export const TwoSampleStateBuffer = soa({
  prevPosX: new Float32Array(MAX_ENTITIES),
  prevPosY: new Float32Array(MAX_ENTITIES),
  prevPosZ: new Float32Array(MAX_ENTITIES),

  prevRotX: new Float32Array(MAX_ENTITIES),
  prevRotY: new Float32Array(MAX_ENTITIES),
  prevRotZ: new Float32Array(MAX_ENTITIES),
  prevRotW: new Float32Array(MAX_ENTITIES),

  currPosX: new Float32Array(MAX_ENTITIES),
  currPosY: new Float32Array(MAX_ENTITIES),
  currPosZ: new Float32Array(MAX_ENTITIES),

  currRotX: new Float32Array(MAX_ENTITIES),
  currRotY: new Float32Array(MAX_ENTITIES),
  currRotZ: new Float32Array(MAX_ENTITIES),
  currRotW: new Float32Array(MAX_ENTITIES),

  renderPosX: new Float32Array(MAX_ENTITIES),
  renderPosY: new Float32Array(MAX_ENTITIES),
  renderPosZ: new Float32Array(MAX_ENTITIES),

  renderRotX: new Float32Array(MAX_ENTITIES),
  renderRotY: new Float32Array(MAX_ENTITIES),
  renderRotZ: new Float32Array(MAX_ENTITIES),
  renderRotW: new Float32Array(MAX_ENTITIES),
});

/**
 * Vehicle Classification & Role Tags (Uint8Array)
 */
export const VehicleRole = soa({
  isPlayer: new Uint8Array(MAX_ENTITIES),
  isAI: new Uint8Array(MAX_ENTITIES),
  isPeer: new Uint8Array(MAX_ENTITIES),
  isGhost: new Uint8Array(MAX_ENTITIES),
});
