import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';
import { StaticObstacleKind, StaticObstacleRegistry } from '../physics/StaticObstacleRegistry';

export interface FrenetStaticHazard {
  s: number;
  d: number;
  radius: number;
  kind: StaticObstacleKind;
  wpIdx: number;
}

export interface NearbyStaticHazardSample {
  deltaS: number;
  d: number;
  radius: number;
  kind: StaticObstacleKind;
}

export interface TrackProjection {
  idx: number;        // Segment start waypoint index [0, count - 1]
  closestIdx: number; // Nearest discrete waypoint index [0, count - 1]
  t: number;          // Interpolation factor along segment idx -> nextIdx [0, 1]
  s: number;          // Continuous closed-loop arc distance [0, totalLength)
  d: number;          // Signed lateral offset along interpolated wp.normal
  halfWidth: number;
  surface: 'asphalt' | 'gravel' | 'sand';
  sinGrade: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  normX: number;
  normZ: number;
  tangX: number;
  tangZ: number;
}

export class TrackRacingProfile {
  public readonly count: number;
  public readonly totalLength: number;
  public readonly waypoints: Waypoint[];

  public readonly segLen: Float64Array;
  public readonly cumDist: Float64Array;
  public readonly sinGrade: Float64Array;
  public readonly normX: Float64Array;
  public readonly normZ: Float64Array;
  public readonly tangX: Float64Array;
  public readonly tangZ: Float64Array;
  public readonly halfWidth: Float64Array;

  // Centerline & Optimal Minimum-Curvature Racing Line geometry
  public readonly centerKappa: Float64Array;
  public readonly racingLineD: Float64Array;
  public readonly raceX: Float64Array;
  public readonly raceY: Float64Array;
  public readonly raceZ: Float64Array;
  public readonly raceKappa: Float64Array;
  public readonly raceRadius: Float64Array;
  public readonly centerRadius: Float64Array;

  // Spatial bucketed cache of trackside static hazards projected into Frenet (s, d)
  private _hazardBuckets: FrenetStaticHazard[][] = [];
  private _syncedObstacleVersion = -1;
  private readonly _hazardProj: TrackProjection = {
    idx: 0,
    closestIdx: 0,
    t: 0,
    s: 0,
    d: 0,
    halfWidth: 6.5,
    surface: 'asphalt',
    sinGrade: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    normX: 1,
    normZ: 0,
    tangX: 0,
    tangZ: 1,
  };

  private static readonly _cache = new WeakMap<Waypoint[], TrackRacingProfile>();

  public static forWaypoints(waypoints: Waypoint[]): TrackRacingProfile {
    let cached = this._cache.get(waypoints);
    if (!cached) {
      cached = new TrackRacingProfile(waypoints);
      this._cache.set(waypoints, cached);
    }
    return cached;
  }

  private constructor(waypoints: Waypoint[]) {
    this.waypoints = waypoints;
    const N = waypoints.length;
    this.count = N;

    this.segLen = new Float64Array(N);
    this.cumDist = new Float64Array(N);
    this.sinGrade = new Float64Array(N);
    this.normX = new Float64Array(N);
    this.normZ = new Float64Array(N);
    this.tangX = new Float64Array(N);
    this.tangZ = new Float64Array(N);
    this.halfWidth = new Float64Array(N);

    this.centerKappa = new Float64Array(N);
    this.racingLineD = new Float64Array(N);
    this.raceX = new Float64Array(N);
    this.raceY = new Float64Array(N);
    this.raceZ = new Float64Array(N);
    this.raceKappa = new Float64Array(N);
    this.raceRadius = new Float64Array(N);
    this.centerRadius = new Float64Array(N);

    if (N === 0) {
      this.totalLength = 0;
      return;
    }

    // 1. Precompute arc lengths, unit horizontal tangents/normals, and elevation slope
    let accDist = 0;
    for (let i = 0; i < N; i++) {
      const wp = waypoints[i];
      const next = waypoints[(i + 1) % N];
      const prev = waypoints[(i - 1 + N) % N];

      this.cumDist[i] = accDist;
      const dx = next.point.x - wp.point.x;
      const dy = next.point.y - wp.point.y;
      const dz = next.point.z - wp.point.z;
      const sl = Math.hypot(dx, dy, dz);
      this.segLen[i] = Math.max(0.5, sl);
      accDist += this.segLen[i];

      let tx = wp.tangent ? wp.tangent.x : next.point.x - prev.point.x;
      let tz = wp.tangent ? wp.tangent.z : next.point.z - prev.point.z;
      const tLen = Math.hypot(tx, tz) || 1;
      tx /= tLen;
      tz /= tLen;
      this.tangX[i] = tx;
      this.tangZ[i] = tz;

      let nx = wp.normal ? wp.normal.x : -tz;
      let nz = wp.normal ? wp.normal.z : tx;
      const nLen = Math.hypot(nx, nz) || 1;
      this.normX[i] = nx / nLen;
      this.normZ[i] = nz / nLen;

      this.halfWidth[i] = wp.width * 0.5;
    }
    this.totalLength = accDist;

    for (let i = 0; i < N; i++) {
      const prev = (i - 1 + N) % N;
      const next = (i + 1) % N;
      const spanDist = Math.max(1.0, this.segLen[prev] + this.segLen[i]);
      this.sinGrade[i] = THREE.MathUtils.clamp(
        (waypoints[next].point.y - waypoints[prev].point.y) / spanDist,
        -0.35,
        0.35
      );
    }

    // 2. Solve Optimal Minimum-Curvature Outside-Apex-Outside Racing Line
    this.solveRacingLine();
  }

  private ptX(i: number, di: number): number {
    return this.waypoints[i].point.x + this.normX[i] * di;
  }

  private ptZ(i: number, di: number): number {
    return this.waypoints[i].point.z + this.normZ[i] * di;
  }

  private computeKappaAt(j: number, dArr: Float64Array, jOverride = -1, dOverride = 0): number {
    const N = this.count;
    const jp = (j - 1 + N) % N;
    const jn = (j + 1) % N;

    const dp = jp === jOverride ? dOverride : dArr[jp];
    const dc = j === jOverride ? dOverride : dArr[j];
    const dn = jn === jOverride ? dOverride : dArr[jn];

    const x0 = this.ptX(jp, dp), z0 = this.ptZ(jp, dp);
    const x1 = this.ptX(j, dc),  z1 = this.ptZ(j, dc);
    const x2 = this.ptX(jn, dn), z2 = this.ptZ(jn, dn);

    const v1x = x1 - x0, v1z = z1 - z0;
    const v2x = x2 - x1, v2z = z2 - z1;
    const l1 = Math.hypot(v1x, v1z);
    const l2 = Math.hypot(v2x, v2z);
    const l12 = Math.hypot(x2 - x0, z2 - z0);
    if (l1 < 0.5 || l2 < 0.5 || l12 < 0.5) return 0;

    // Signed Menger curvature (positive = curves toward +wp.normal)
    const cross = v1x * v2z - v1z * v2x;
    return (2.0 * cross) / (l1 * l2 * l12);
  }

  private solveRacingLine(): void {
    const N = this.count;
    if (N < 5) return;

    const d = this.racingLineD;
    const zeros = new Float64Array(N);
    const maxOff = new Float64Array(N);

    // Track width safety margins per surface (sand/gravel narrower drift buffer than asphalt)
    for (let i = 0; i < N; i++) {
      const surf = this.waypoints[i].surface;
      const margin = surf === 'sand' ? 2.2 : surf === 'gravel' ? 2.1 : 1.9;
      maxOff[i] = Math.max(1.6, this.halfWidth[i] - margin);
      this.centerKappa[i] = this.computeKappaAt(i, zeros);
      this.centerRadius[i] = 1.0 / Math.max(1e-4, Math.abs(this.centerKappa[i]));
    }

    const localEnergy = (i: number, candD: number): number => {
      const ip1 = (i - 1 + N) % N;
      const in1 = (i + 1) % N;
      let e = 0;
      for (const idx of [ip1, i, in1]) {
        const k = this.computeKappaAt(idx, d, i, candD);
        // Minimax corner flattening (k^2 + quartic peak curvature penalty)
        const k2 = k * k;
        e += k2 + 1800.0 * k2 * k2;
      }
      // Subtle smoothness & centerline regularization on long straights
      const dDiff = d[in1] - candD;
      const dPrev = candD - d[ip1];
      const slopeDiff = dDiff - dPrev;
      e += 0.000018 * (dDiff * dDiff + dPrev * dPrev) +
           0.000004 * (candD * candD) +
           0.000012 * (slopeDiff * slopeDiff);
      return e;
    };

    const step = 0.04;
    for (let iter = 0; iter < 200; iter++) {
      for (let i = 0; i < N; i++) {
        const e0 = localEnergy(i, d[i]);
        const ep = localEnergy(i, d[i] + step);
        const em = localEnergy(i, d[i] - step);
        const grad = (ep - em) / (2.0 * step);
        const hess = Math.max(1e-5, (ep - 2.0 * e0 + em) / (step * step));
        const delta = THREE.MathUtils.clamp(-0.55 * (grad / hess), -0.45, 0.45);
        d[i] = THREE.MathUtils.clamp(d[i] + delta, -maxOff[i], maxOff[i]);
      }
    }

    // Store world coordinates and effective radius of solved racing line
    for (let i = 0; i < N; i++) {
      const di = d[i];
      this.raceX[i] = this.ptX(i, di);
      this.raceY[i] = this.waypoints[i].point.y;
      this.raceZ[i] = this.ptZ(i, di);
      const kr = this.computeKappaAt(i, d);
      this.raceKappa[i] = kr;
      this.raceRadius[i] = 1.0 / Math.max(1e-4, Math.abs(kr));
    }
  }

  /**
   * Finds nearest track index in O(window) normally or O(N) if displaced > 36m.
   */
  public findClosestIndex(x: number, z: number, hintIdx = -1): number {
    const N = this.count;
    let bestIdx = hintIdx >= 0 && hintIdx < N ? hintIdx : 0;
    let bestD2 = Infinity;

    if (hintIdx >= 0 && hintIdx < N) {
      const hw = this.waypoints[hintIdx];
      const dHint2 = (x - hw.point.x) ** 2 + (z - hw.point.z) ** 2;
      if (dHint2 < 1296.0) { // < 36m
        for (let k = -6; k <= 14; k++) {
          const idx = (hintIdx + k + N) % N;
          const p = this.waypoints[idx].point;
          const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestIdx = idx;
          }
        }
        return bestIdx;
      }
    }

    for (let i = 0; i < N; i++) {
      const p = this.waypoints[i].point;
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * Projects world (x, z) onto continuous closed-loop Frenet coordinates (s, d) without discrete snaps.
   */
  public projectToTrack(x: number, z: number, hintIdx: number, out: TrackProjection): void {
    const N = this.count;
    const closestIdx = this.findClosestIndex(x, z, hintIdx);
    const prevIdx = (closestIdx - 1 + N) % N;

    let bestSegIdx = closestIdx;
    let bestT = 0;
    let bestDistSq = Infinity;

    for (const segIdx of [prevIdx, closestIdx]) {
      const nextIdx = (segIdx + 1) % N;
      const a = this.waypoints[segIdx].point;
      const b = this.waypoints[nextIdx].point;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > 1e-4 ? THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lenSq, 0, 1) : 0;
      const cx = a.x + t * dx;
      const cz = a.z + t * dz;
      const dSq = (x - cx) ** 2 + (z - cz) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestSegIdx = segIdx;
        bestT = t;
      }
    }

    const nextIdx = (bestSegIdx + 1) % N;
    const w0 = this.waypoints[bestSegIdx];
    const w1 = this.waypoints[nextIdx];

    const centerX = w0.point.x + (w1.point.x - w0.point.x) * bestT;
    const centerY = w0.point.y + (w1.point.y - w0.point.y) * bestT;
    const centerZ = w0.point.z + (w1.point.z - w0.point.z) * bestT;

    let nx = this.normX[bestSegIdx] + (this.normX[nextIdx] - this.normX[bestSegIdx]) * bestT;
    let nz = this.normZ[bestSegIdx] + (this.normZ[nextIdx] - this.normZ[bestSegIdx]) * bestT;
    const nLen = Math.hypot(nx, nz) || 1;
    nx /= nLen;
    nz /= nLen;

    let tx = this.tangX[bestSegIdx] + (this.tangX[nextIdx] - this.tangX[bestSegIdx]) * bestT;
    let tz = this.tangZ[bestSegIdx] + (this.tangZ[nextIdx] - this.tangZ[bestSegIdx]) * bestT;
    const tLen = Math.hypot(tx, tz) || 1;
    tx /= tLen;
    tz /= tLen;

    out.idx = bestSegIdx;
    out.closestIdx = closestIdx;
    out.t = bestT;
    out.s = (this.cumDist[bestSegIdx] + this.segLen[bestSegIdx] * bestT) % this.totalLength;
    out.d = (x - centerX) * nx + (z - centerZ) * nz;
    out.halfWidth = this.halfWidth[bestSegIdx] + (this.halfWidth[nextIdx] - this.halfWidth[bestSegIdx]) * bestT;
    out.surface = w0.surface;
    out.sinGrade = this.sinGrade[bestSegIdx] + (this.sinGrade[nextIdx] - this.sinGrade[bestSegIdx]) * bestT;
    out.centerX = centerX;
    out.centerY = centerY;
    out.centerZ = centerZ;
    out.normX = nx;
    out.normZ = nz;
    out.tangX = tx;
    out.tangZ = tz;
  }

  /**
   * Samples racing line offset, center, normal, halfWidth at continuous arc coordinate s.
   */
  public sampleAtArcDistance(sQuery: number, startIdxHint: number, out: {
    x: number;
    y: number;
    z: number;
    normX: number;
    normZ: number;
    tangX: number;
    tangZ: number;
    halfWidth: number;
    racingD: number;
    surface: 'asphalt' | 'gravel' | 'sand';
    sinGrade: number;
    idx: number;
  }): void {
    const N = this.count;
    const L = this.totalLength;
    const sWrapped = ((sQuery % L) + L) % L;

    let idx = startIdxHint >= 0 && startIdxHint < N ? startIdxHint : 0;
    // Step circularly around hint until cumDist[idx] <= sWrapped < cumDist[idx] + segLen[idx]
    for (let step = 0; step < N; step++) {
      const sStart = this.cumDist[idx];
      const sEnd = sStart + this.segLen[idx];
      if (sWrapped >= sStart - 1e-6 && sWrapped <= sEnd + 1e-6) {
        break;
      }
      // Handle wrap-around cleanly: step forward or backward
      const deltaFwd = ((sWrapped - sStart) % L + L) % L;
      if (deltaFwd < L * 0.5) {
        idx = (idx + 1) % N;
      } else {
        idx = (idx - 1 + N) % N;
      }
    }

    const next = (idx + 1) % N;
    const u = THREE.MathUtils.clamp((sWrapped - this.cumDist[idx]) / this.segLen[idx], 0, 1);
    const w0 = this.waypoints[idx];
    const w1 = this.waypoints[next];

    out.idx = idx;
    out.x = w0.point.x + (w1.point.x - w0.point.x) * u;
    out.y = w0.point.y + (w1.point.y - w0.point.y) * u;
    out.z = w0.point.z + (w1.point.z - w0.point.z) * u;

    let nx = this.normX[idx] + (this.normX[next] - this.normX[idx]) * u;
    let nz = this.normZ[idx] + (this.normZ[next] - this.normZ[idx]) * u;
    const nLen = Math.hypot(nx, nz) || 1;
    out.normX = nx / nLen;
    out.normZ = nz / nLen;

    let tx = this.tangX[idx] + (this.tangX[next] - this.tangX[idx]) * u;
    let tz = this.tangZ[idx] + (this.tangZ[next] - this.tangZ[idx]) * u;
    const tLen = Math.hypot(tx, tz) || 1;
    out.tangX = tx / tLen;
    out.tangZ = tz / tLen;

    out.halfWidth = this.halfWidth[idx] + (this.halfWidth[next] - this.halfWidth[idx]) * u;
    out.racingD = this.racingLineD[idx] + (this.racingLineD[next] - this.racingLineD[idx]) * u;
    out.surface = u < 0.5 ? w0.surface : w1.surface;
    out.sinGrade = this.sinGrade[idx] + (this.sinGrade[next] - this.sinGrade[idx]) * u;
  }

  /**
   * Computes shortest signed arc distance Δs from sFrom to sTo in [-L/2, +L/2].
   */
  public signedArcDelta(sFrom: number, sTo: number): number {
    const L = this.totalLength;
    let d = (sTo - sFrom) % L;
    if (d > L * 0.5) d -= L;
    if (d < -L * 0.5) d += L;
    return d;
  }

  private ensureHazardsSynced(): void {
    const ver = StaticObstacleRegistry.version;
    if (ver === this._syncedObstacleVersion) return;

    const N = this.count;
    if (this._hazardBuckets.length !== N) {
      this._hazardBuckets = Array.from({ length: N }, () => []);
    } else {
      for (let i = 0; i < N; i++) {
        this._hazardBuckets[i].length = 0;
      }
    }

    if (N > 0) {
      const obsList = StaticObstacleRegistry.obstacles;
      const proj = this._hazardProj;
      for (let i = 0; i < obsList.length; i++) {
        const obs = obsList[i];
        this.projectToTrack(obs.x, obs.z, -1, proj);
        // Ignore obstacles far outside the recovery/off-track corridor
        if (Math.abs(proj.d) > proj.halfWidth + obs.radius + 32.0) continue;
        this._hazardBuckets[proj.closestIdx].push({
          s: proj.s,
          d: proj.d,
          radius: obs.radius,
          kind: obs.kind,
          wpIdx: proj.closestIdx,
        });
      }
    }

    this._syncedObstacleVersion = ver;
  }

  /**
   * Zero-allocation query of trackside static hazards near [sSelf + sMinDelta, sSelf + sMaxDelta].
   * Populates pre-allocated `out` slots and returns the populated count.
   */
  public queryStaticHazardsNear(
    sSelf: number,
    closestIdxHint: number,
    sMinDelta: number,
    sMaxDelta: number,
    maxAbsD: number,
    out: NearbyStaticHazardSample[]
  ): number {
    if (this.count === 0) return 0;
    this.ensureHazardsSynced();

    const N = this.count;
    const baseIdx = ((closestIdxHint % N) + N) % N;
    const maxSlots = out.length;
    let count = 0;

    // Step across +/- 5 waypoint buckets (~75m each side) so segment length variations never clip hazards
    for (let offset = -5; offset <= 5; offset++) {
      const bIdx = (baseIdx + offset + N) % N;
      const bucket = this._hazardBuckets[bIdx];
      for (let j = 0; j < bucket.length; j++) {
        const h = bucket[j];
        if (Math.abs(h.d) > maxAbsD + h.radius) continue;
        const deltaS = this.signedArcDelta(sSelf, h.s);
        if (deltaS < sMinDelta || deltaS > sMaxDelta) continue;
        if (count >= maxSlots) return count;
        const slot = out[count++];
        slot.deltaS = deltaS;
        slot.d = h.d;
        slot.radius = h.radius;
        slot.kind = h.kind;
      }
    }
    return count;
  }
}

