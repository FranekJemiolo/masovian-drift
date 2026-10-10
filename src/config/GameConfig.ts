/**
 * Centralized Game Configuration and Constants (C3)
 * Eliminates scattered magic numbers and unifies physics, suspension,
 * rendering presets, audio envelopes, and tournament progression rules.
 */

export const PHYSICS_CONFIG = {
  fixedDeltaTime: 1 / 60,
  maxSubsteps: 4,
  gravity: -9.81,

  // 4-Point Raycast Suspension (Hooke's Law)
  suspension: {
    restLength: 0.42,
    wheelRadius: 0.32,
    springStiffness: 44000.0, // N/m
    dampingBump: 4200.0,      // Ns/m (compression)
    dampingRebound: 3100.0,   // Ns/m (extension)
    antiRollBarStiffness: 9500.0, // Front/rear anti-roll coupling
  },

  // Pacejka '94 Magic Formula Lateral Dynamics
  pacejka: {
    B: 10.0, // Stiffness factor
    C: 1.30, // Shape factor
    D: 1.00, // Peak friction factor
    E: 0.97, // Curvature factor
  },

  // Friction Ellipse Weighting
  frictionEllipseExponent: 2.0,

  // Weight Transfer Ratios
  weightDistribution: {
    frontStatic: 0.40,
    rearStatic: 0.60, // Rear-engine boxer bias
    cgHeight: 0.34,   // Center of gravity height (m)
    wheelbase: 2.38,  // Track length (m)
    trackWidth: 1.62, // Lateral track stance (m)
  },

  // Powertrain & Gearbox
  powertrain: {
    idleRpm: 900,
    redlineRpm: 7200,
    revLimiterCutRpm: 7250,
    peakTorqueRpmLow: 3800,
    peakTorqueRpmHigh: 5800,
    clutchEngageRate: 14.0,
  },
} as const;

export const GRAPHICS_CONFIG = {
  shadowMapSize: 2048,
  shadowFrustumSize: 150.0,
  shadowTexelSize: 150.0 / 2048.0,
  targetFps: 60,
  frameBudgetMs: 16.66,

  // Dynamic Resolution Scaling (P9)
  drs: {
    enabled: true,
    minScale: 0.70,
    maxScale: 1.00,
    dropThresholdMs: 18.5,  // Scale down if frame time > 18.5ms (< 54 FPS)
    recoverThresholdMs: 13.5, // Scale up if frame time < 13.5ms (> 74 FPS)
    scaleStep: 0.05,
    sampleWindowSize: 30,
  },

  // Volumetric Headlights
  headlights: {
    coneLength: 16.0,
    coneRadiusStart: 0.12,
    coneRadiusEnd: 1.35,
    emissiveIntensity: 2.4,
  },
} as const;

export const ECONOMY_CONFIG = {
  startingBudgetPln: 18500,
  rewards: {
    race1st: 12500,
    race2nd: 8000,
    race3rd: 5500,
    raceFinish: 3000,
    driftPointMultiplier: 0.04,
  },
  repairCosts: {
    baseBodyRepairPerPct: 35.0,
    engineTunePerPct: 55.0,
  },
  upgrades: {
    lightweightFlywheelCost: 4500,
    sportSuspensionCost: 6500,
    openExhaustCost: 3500,
    sandTiresCost: 4000,
  },
} as const;

export const AI_CONFIG = {
  frenetLookaheadMin: 12.0,
  frenetLookaheadMax: 36.0,
  safetyBubbleRadius: 3.2,
  slipstreamDraftDistMin: 2.0,
  slipstreamDraftDistMax: 16.0,
  stuckVelocityThreshold: 1.5,
  stuckTimeoutSec: 2.2,
} as const;
