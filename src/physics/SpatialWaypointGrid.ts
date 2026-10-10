import * as THREE from 'three';
import { Waypoint } from './TrackWaypoints';

/**
 * 2D Spatial Hash Grid for O(1) Waypoint and Track Geometry Queries (P6)
 * Divides the 2D world plane (X-Z) into uniform spatial cells, eliminating
 * expensive O(N) linear iteration during terrain heightfield sculpting,
 * AI line prediction, and vehicle kerb surface detection.
 */
interface GridEntry {
  waypoint: Waypoint;
  index: number;
}

export class SpatialWaypointGrid {
  private cellSize: number;
  private invCellSize: number;
  private grid: Map<string, GridEntry[]> = new Map();
  private waypoints: Waypoint[];

  constructor(waypoints: Waypoint[], cellSize = 40.0) {
    this.waypoints = waypoints;
    this.cellSize = cellSize;
    this.invCellSize = 1.0 / cellSize;
    this.buildGrid();
  }

  private hashKey(cx: number, cz: number): string {
    return `${cx}:${cz}`;
  }

  private buildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < this.waypoints.length; i++) {
      const wp = this.waypoints[i];
      const cx = Math.floor(wp.point.x * this.invCellSize);
      const cz = Math.floor(wp.point.z * this.invCellSize);
      const key = this.hashKey(cx, cz);

      let bucket = this.grid.get(key);
      if (!bucket) {
        bucket = [];
        this.grid.set(key, bucket);
      }
      bucket.push({ waypoint: wp, index: i });
    }
  }

  /**
   * Finds the closest waypoint to (x, z) in O(1) amortized time by querying
   * neighboring spatial cells within the search radius.
   */
  public findClosest(
    x: number,
    z: number,
    maxRadius = 120.0
  ): { waypoint: Waypoint | null; distance: number; index: number } {
    const centerCx = Math.floor(x * this.invCellSize);
    const centerCz = Math.floor(z * this.invCellSize);
    const cellRadius = Math.ceil(maxRadius * this.invCellSize);

    let closestWp: Waypoint | null = null;
    let minDistanceSq = maxRadius * maxRadius;
    let closestIdx = -1;

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const key = this.hashKey(centerCx + dx, centerCz + dz);
        const bucket = this.grid.get(key);
        if (!bucket) continue;

        for (let k = 0; k < bucket.length; k++) {
          const entry = bucket[k];
          const wp = entry.waypoint;
          const distSq = (x - wp.point.x) * (x - wp.point.x) + (z - wp.point.z) * (z - wp.point.z);
          if (distSq < minDistanceSq) {
            minDistanceSq = distSq;
            closestWp = wp;
            closestIdx = entry.index;
          }
        }
      }
    }

    // Fallback: If no waypoint in radius, perform global nearest search
    if (!closestWp && this.waypoints.length > 0) {
      minDistanceSq = Infinity;
      for (let i = 0; i < this.waypoints.length; i++) {
        const wp = this.waypoints[i];
        const distSq = (x - wp.point.x) * (x - wp.point.x) + (z - wp.point.z) * (z - wp.point.z);
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          closestWp = wp;
          closestIdx = i;
        }
      }
    }

    return {
      waypoint: closestWp,
      distance: Math.sqrt(minDistanceSq),
      index: closestIdx,
    };
  }
}
