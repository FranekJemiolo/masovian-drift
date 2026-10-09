import * as THREE from 'three';

export interface VehicleState {
  id: string;
  name: string;
  isPlayer: boolean;
  isAI: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  slipAngle: number;
  isDrifting: boolean;
  driftScore: number;
  damage: VehicleDamage;
  weightTransfer: WeightTransferState;
  lap: number;
  checkpointIndex: number;
  lapTime: number;
  bestLapTime: number;
  raceFinished: boolean;
  raceRank: number;
}

export interface WeightTransferState {
  frontLeftLoad: number;   // Normal force ratio (1.0 = baseline equilibrium)
  frontRightLoad: number;
  rearLeftLoad: number;
  rearRightLoad: number;
  frontBias: number;       // Ratio of load on front axle (0.0 to 1.0, baseline ~0.40)
  rearBias: number;        // Ratio of load on rear axle (0.0 to 1.0, baseline ~0.60)
  rollAngle: number;       // Lateral chassis tilt (radians)
  pitchAngle: number;      // Longitudinal chassis pitch (radians)
}

export interface VehicleDamage {
  bodyDamage: number;         // 0.0 (pristine) to 1.0 (wrecked)
  aerodynamicDragPenalty: number; // Multiplier on drag coeff (1.0 to 2.2)
  steeringAlignmentOffset: number; // Angular pull in radians (-0.05 to +0.05)
  engineWear: number;         // 0.0 to 1.0
}

export interface VehicleSpecs {
  name: string;
  era: 'Classic' | 'Golden' | 'Modern';
  mass: number;               // kg (e.g. 1200)
  enginePowerKw: number;      // kW
  maxRpm: number;             // e.g. 7500
  idleRpm: number;            // e.g. 900
  flywheelInertia: number;    // kg*m^2 (lower = snappier throttle, less momentum uphill)
  gearRatios: number[];       // [reverse, 1st, 2nd, 3rd, 4th, 5th]
  finalDrive: number;
  dragCoefficient: number;    // baseline Cd (e.g. 0.32)
  bodyColor: number;          // Hex color for livery
  accentColor: number;
}

export interface PlayerCarProfile {
  id: string;
  modelName: string;
  era: 'Classic' | 'Golden' | 'Modern';
  specs: VehicleSpecs;
  damage: VehicleDamage;
  upgrades: {
    lightweightFlywheel: boolean;
    sportSuspension: boolean;
    openExhaust: boolean;
    sandTires: boolean;
  };
  valuePln: number;
}

export interface EconomyState {
  currencyPln: number;
  currentCarId: string;
  garage: PlayerCarProfile[];
  unlockedEras: ('Classic' | 'Golden' | 'Modern')[];
}

export type GameMode = 'quick-race' | 'split-screen' | 'career' | 'multiplayer-host' | 'multiplayer-join';
