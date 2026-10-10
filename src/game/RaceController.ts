import { VehiclePhysics } from '../physics/VehiclePhysics';
import { EvolutionStore } from '../economy/EvolutionStore';
import { ECONOMY_CONFIG } from '../config/GameConfig';

export interface RaceResults {
  rank: number;
  totalTime: number;
  bestLap: number;
  driftScore: number;
  prizePln: number;
}

/**
 * Race Controller Subsystem (C1)
 * Manages race timing, countdown sequencing, checkpoint validation,
 * finish triggers, and tournament rewards. Decoupled from rendering and input.
 */
export class RaceController {
  public isRacing = false;
  public isPaused = false;
  public isFinished = false;
  public countdownRemaining = 3.2;
  public totalRaceTime = 0;

  private totalLaps: number;
  private evolutionStore: EvolutionStore;

  constructor(evolutionStore: EvolutionStore, totalLaps = 2) {
    this.evolutionStore = evolutionStore;
    this.totalLaps = totalLaps;
  }

  public reset(totalLaps = 2): void {
    this.isRacing = false;
    this.isPaused = false;
    this.isFinished = false;
    this.countdownRemaining = 3.2;
    this.totalRaceTime = 0;
    this.totalLaps = totalLaps;
  }

  /**
   * Advances countdown and total race time
   */
  public updateTiming(dt: number): { countdownJustFinished: boolean; countdownDisplay: string | null } {
    if (this.isPaused) {
      return { countdownJustFinished: false, countdownDisplay: null };
    }

    let countdownJustFinished = false;
    let countdownDisplay: string | null = null;

    if (this.countdownRemaining > 0) {
      this.countdownRemaining -= dt;
      if (this.countdownRemaining <= 0) {
        this.countdownRemaining = 0;
        this.isRacing = true;
        countdownJustFinished = true;
      } else {
        const sec = Math.ceil(this.countdownRemaining);
        countdownDisplay = sec > 0 ? `${sec}` : 'START!';
      }
    } else if (this.isRacing && !this.isFinished) {
      this.totalRaceTime += dt;
    }

    return { countdownJustFinished, countdownDisplay };
  }

  /**
   * Evaluates race finish condition for the player vehicle
   */
  public checkFinish(playerVehicle: VehiclePhysics): RaceResults | null {
    if (this.isFinished || !playerVehicle) return null;

    if (playerVehicle.currentLap > this.totalLaps) {
      this.isFinished = true;
      this.isRacing = false;

      const rank = playerVehicle.raceRank || 1;
      const driftScore = playerVehicle.driftScore || 0;
      const prizePln = this.evolutionStore.rewardRaceFinish(rank, driftScore);

      return {
        rank,
        totalTime: this.totalRaceTime,
        bestLap: playerVehicle.bestLapTime || this.totalRaceTime / this.totalLaps,
        driftScore,
        prizePln,
      };
    }

    return null;
  }
}
