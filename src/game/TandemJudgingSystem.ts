import * as THREE from 'three';

export interface TandemJudgingScorecard {
  run: 1 | 2; // Heat 1 (Lead), Heat 2 (Chase)
  role: 'lead' | 'chase';
  lineScore: number;       // 0 to 30 pts (clipping point adherence & track boundary precision)
  angleScore: number;      // 0 to 30 pts (drift angle magnitude, consistency, no snap corrections)
  speedScore: number;      // 0 to 20 pts (entry initiation speed & transition pace)
  proximityScore: number;  // 0 to 20 pts (door-to-door distance in chase position)
  deductions: number;      // penalties (straightening out, off-track, collision)
  totalScore: number;      // 0 to 100 pts
}

/**
 * Formula Drift / D1GP Electronic Judging System
 * Evaluates competitive tandem drift battles across two heats using official 100-point judging criteria:
 * - Line (30 pts): Outer Clipping Zones (OCZ) and Inner Clipping Points (ICP).
 * - Angle (30 pts): Slip angle magnitude (ideal 35° - 60°) and fluid transitions.
 * - Speed (20 pts): High-speed commitment into clipping zones.
 * - Proximity (20 pts): Distance maintenance in chase position (< 3m yields max points).
 */
export class TandemJudgingSystem {
  public heat: 1 | 2 = 1;
  public playerRole: 'lead' | 'chase' = 'lead';

  public heat1Score: TandemJudgingScorecard | null = null;
  public heat2Score: TandemJudgingScorecard | null = null;

  // Active run frame accumulators
  private frameCount = 0;
  private lineAcc = 0;
  private angleAcc = 0;
  private speedAcc = 0;
  private proximityAcc = 0;
  private deductions = 0;

  constructor() {}

  public startHeat(heat: 1 | 2, role: 'lead' | 'chase'): void {
    this.heat = heat;
    this.playerRole = role;
    this.frameCount = 0;
    this.lineAcc = 0;
    this.angleAcc = 0;
    this.speedAcc = 0;
    this.proximityAcc = 0;
    this.deductions = 0;
  }

  /**
   * Evaluates one frame of telemetry during judged tandem drift
   */
  public evaluateFrame(
    playerSlipAngleRad: number,
    playerSpeedKmh: number,
    distToClippingZoneM: number,
    chaseProximityDistM: number,
    isOffTrack: boolean,
    didSpinOut: boolean
  ): void {
    this.frameCount++;

    // 1. Line Evaluation (30 pts max)
    // Closer to clipping point = higher line score
    const lineQuality = Math.max(0, 1.0 - distToClippingZoneM / 6.0);
    this.lineAcc += lineQuality * 30.0;

    // 2. Angle Evaluation (30 pts max)
    const angleDeg = Math.abs(playerSlipAngleRad) * (180.0 / Math.PI);
    let angleQuality = 0;
    if (angleDeg >= 30 && angleDeg <= 65) {
      angleQuality = 1.0;
    } else if (angleDeg > 15 && angleDeg < 30) {
      angleQuality = (angleDeg - 15) / 15.0;
    } else if (angleDeg > 65) {
      angleQuality = Math.max(0.3, 1.0 - (angleDeg - 65) / 25.0);
    }
    this.angleAcc += angleQuality * 30.0;

    // 3. Speed Evaluation (20 pts max)
    const speedQuality = Math.min(1.0, Math.max(0.0, (playerSpeedKmh - 30.0) / 70.0));
    this.speedAcc += speedQuality * 20.0;

    // 4. Proximity Evaluation (20 pts max - heavily weighted in chase position)
    if (this.playerRole === 'chase') {
      const proxQuality = Math.max(0, 1.0 - (chaseProximityDistM - 1.8) / 10.0);
      this.proximityAcc += proxQuality * 20.0;
    } else {
      // In lead, score pace consistency
      this.proximityAcc += 16.0;
    }

    // Deductions
    if (isOffTrack) this.deductions += 0.5;
    if (didSpinOut) this.deductions += 15.0;
  }

  /**
   * Finalizes score for the current heat
   */
  public finalizeHeat(): TandemJudgingScorecard {
    const frames = Math.max(1, this.frameCount);
    const lineScore = Math.round(this.lineAcc / frames);
    const angleScore = Math.round(this.angleAcc / frames);
    const speedScore = Math.round(this.speedAcc / frames);
    const proximityScore = Math.round(this.proximityAcc / frames);
    const deductions = Math.min(50, Math.round(this.deductions));

    const totalScore = Math.max(0, Math.min(100, lineScore + angleScore + speedScore + proximityScore - deductions));

    const scorecard: TandemJudgingScorecard = {
      run: this.heat,
      role: this.playerRole,
      lineScore,
      angleScore,
      speedScore,
      proximityScore,
      deductions,
      totalScore,
    };

    if (this.heat === 1) {
      this.heat1Score = scorecard;
    } else {
      this.heat2Score = scorecard;
    }

    return scorecard;
  }

  /**
   * Determines tournament outcome across both heats
   */
  public getBattleResult(): { winner: 'player' | 'opponent' | 'one-more-time'; playerTotal: number; message: string } {
    const s1 = this.heat1Score?.totalScore ?? 0;
    const s2 = this.heat2Score?.totalScore ?? 0;
    const playerTotal = Math.round((s1 + s2) / 2);

    if (Math.abs(s1 - s2) <= 3) {
      return { winner: 'one-more-time', playerTotal, message: 'ONE MORE TIME (OMT)! Scores tied within 3 points.' };
    } else if (playerTotal >= 80) {
      return { winner: 'player', playerTotal, message: `VICTORY! Masterful tandem performance (${playerTotal}/100 pts).` };
    } else {
      return { winner: 'opponent', playerTotal, message: `DEFEAT (${playerTotal}/100 pts). Opponent had superior chase proximity.` };
    }
  }

  public reset(): void {
    this.heat = 1;
    this.playerRole = 'lead';
    this.heat1Score = null;
    this.heat2Score = null;
    this.frameCount = 0;
  }
}
