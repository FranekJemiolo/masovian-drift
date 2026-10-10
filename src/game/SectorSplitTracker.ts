/**
 * Trackmania-Style Micro-Sector Split Telemetry Tracker
 * Partitions track waypoints into 3 high-speed sectors and calculates live
 * +/- delta times against personal best and medal target ghosts.
 */

export interface SectorSplitEvent {
  sectorIndex: number;      // 1, 2, or 3
  sectorTime: number;       // Elapsed time within sector (seconds)
  splitDelta: number;       // Delta vs best time (negative = ahead/green, positive = behind/red)
  isAhead: boolean;
  totalLapTime: number;
  displayUntil: number;     // Timestamp (ms) to keep HUD banner visible
}

export class SectorSplitTracker {
  private sectorGates = [45, 92, 139]; // Waypoint index boundaries for 3 sectors
  private lastSectorPassed = -1;
  private sectorStartLapTime = 0;

  // Best recorded sector times (seconds)
  public bestSectorTimes: [number, number, number] = [18.5, 21.2, 17.8];
  public currentSectorDeltas: (number | null)[] = [null, null, null];
  public lastEvent: SectorSplitEvent | null = null;

  public update(checkpointIndex: number, currentLapTime: number): SectorSplitEvent | null {
    // Check if vehicle has crossed a sector gate boundary
    let crossedSector = -1;
    for (let i = 0; i < this.sectorGates.length; i++) {
      if (checkpointIndex >= this.sectorGates[i] && this.lastSectorPassed < i) {
        crossedSector = i;
        break;
      }
    }

    if (crossedSector !== -1) {
      this.lastSectorPassed = crossedSector;
      const sectorDuration = currentLapTime - this.sectorStartLapTime;
      this.sectorStartLapTime = currentLapTime;

      const bestTime = this.bestSectorTimes[crossedSector];
      const delta = sectorDuration - bestTime;
      this.currentSectorDeltas[crossedSector] = delta;

      // Update personal best sector if faster
      if (sectorDuration < bestTime) {
        this.bestSectorTimes[crossedSector] = sectorDuration;
      }

      this.lastEvent = {
        sectorIndex: crossedSector + 1,
        sectorTime: Math.round(sectorDuration * 1000) / 1000,
        splitDelta: Math.round(delta * 1000) / 1000,
        isAhead: delta <= 0,
        totalLapTime: currentLapTime,
        displayUntil: performance.now() + 3200, // Show for 3.2s
      };

      return this.lastEvent;
    }

    // Reset sector tracking on new lap
    if (checkpointIndex < 5 && this.lastSectorPassed === this.sectorGates.length - 1) {
      this.lastSectorPassed = -1;
      this.sectorStartLapTime = 0;
    }

    return null;
  }

  public reset(): void {
    this.lastSectorPassed = -1;
    this.sectorStartLapTime = 0;
    this.currentSectorDeltas = [null, null, null];
    this.lastEvent = null;
  }
}
