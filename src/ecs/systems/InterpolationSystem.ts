import * as THREE from 'three';
import { TwoSampleStateBuffer } from '../Components';
import { ECSWorldManager } from '../World';

export class InterpolationSystem {
  // Reusable scratch objects for zero-allocation per-frame interpolation (P1)
  private static readonly _scratchQ0 = new THREE.Quaternion();
  private static readonly _scratchQ1 = new THREE.Quaternion();

  /**
   * Applies linear interpolation (lerp) for positions and spherical linear interpolation (slerp)
   * for rotations across all registered entities based on the fractional time alpha elapsed
   * since the last fixed physics tick.
   *
   * @param alpha Fractional factor in [0.0, 1.0] derived from physics accumulator / fixedTimeStep
   */
  public static update(alpha: number): void {
    const clampedAlpha = Math.max(0.0, Math.min(1.0, alpha));
    const ecs = ECSWorldManager.getInstance();
    const meshMap = ecs.entityMeshMap;

    for (let eid = 1; eid < meshMap.length; eid++) {
      const mesh = meshMap[eid];
      if (!mesh) continue;

      // 1. Position Linear Interpolation (lerp)
      const p0x = TwoSampleStateBuffer.prevPosX[eid];
      const p0y = TwoSampleStateBuffer.prevPosY[eid];
      const p0z = TwoSampleStateBuffer.prevPosZ[eid];

      const p1x = TwoSampleStateBuffer.currPosX[eid];
      const p1y = TwoSampleStateBuffer.currPosY[eid];
      const p1z = TwoSampleStateBuffer.currPosZ[eid];

      const rx = p0x + (p1x - p0x) * clampedAlpha;
      const ry = p0y + (p1y - p0y) * clampedAlpha;
      const rz = p0z + (p1z - p0z) * clampedAlpha;

      TwoSampleStateBuffer.renderPosX[eid] = rx;
      TwoSampleStateBuffer.renderPosY[eid] = ry;
      TwoSampleStateBuffer.renderPosZ[eid] = rz;

      // 2. Rotation Spherical Linear Interpolation (slerp)
      const q0x = TwoSampleStateBuffer.prevRotX[eid];
      const q0y = TwoSampleStateBuffer.prevRotY[eid];
      const q0z = TwoSampleStateBuffer.prevRotZ[eid];
      const q0w = TwoSampleStateBuffer.prevRotW[eid];

      const q1x = TwoSampleStateBuffer.currRotX[eid];
      const q1y = TwoSampleStateBuffer.currRotY[eid];
      const q1z = TwoSampleStateBuffer.currRotZ[eid];
      const q1w = TwoSampleStateBuffer.currRotW[eid];

      this._scratchQ0.set(q0x, q0y, q0z, q0w);
      this._scratchQ1.set(q1x, q1y, q1z, q1w);
      this._scratchQ0.slerp(this._scratchQ1, clampedAlpha);

      TwoSampleStateBuffer.renderRotX[eid] = this._scratchQ0.x;
      TwoSampleStateBuffer.renderRotY[eid] = this._scratchQ0.y;
      TwoSampleStateBuffer.renderRotZ[eid] = this._scratchQ0.z;
      TwoSampleStateBuffer.renderRotW[eid] = this._scratchQ0.w;

      // 3. Write directly into Three.js Object3D visual root
      mesh.position.set(rx, ry, rz);
      mesh.quaternion.set(
        this._scratchQ0.x,
        this._scratchQ0.y,
        this._scratchQ0.z,
        this._scratchQ0.w
      );
    }
  }
}
