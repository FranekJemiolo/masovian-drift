import * as THREE from 'three';

export interface SoilDisplacementPoint {
  worldPos: THREE.Vector3;
  depth: number;
  radius: number;
  surface: 'asphalt' | 'sand' | 'gravel' | 'grass';
}

/**
 * Dynamic Sand Rutting & Soil Displacement System
 * Modulates terrain heightfields and shoulder voxels when spinning or sliding tires pass over loose dune sand.
 * Carves trenches in the contact patch and pushes loose displaced soil outwards into berms.
 */
export class TerrainDeformation {
  private ruts: SoilDisplacementPoint[] = [];
  public maxRuts = 256;
  public totalDisplacedVolumeM3 = 0;

  constructor() {}

  /**
   * Records a tire rut carved into soft terrain
   */
  public carveRut(
    wheelPos: THREE.Vector3,
    slipVelocity: number,
    normalForceN: number,
    surface: 'asphalt' | 'sand' | 'gravel' | 'grass'
  ): SoilDisplacementPoint | null {
    // Only carve ruts if slip speed exceeds threshold
    if (slipVelocity < 2.5 || surface === 'asphalt') return null;

    // Soil compression depth equation (up to 0.18m)
    const compressionFactor = surface === 'sand' ? 0.00012 : surface === 'gravel' ? 0.00007 : 0.00004;
    const depth = Math.min(0.18, (normalForceN * compressionFactor) * Math.min(2.0, slipVelocity / 4.0));
    const radius = surface === 'sand' ? 0.42 : 0.32;

    const rutPoint: SoilDisplacementPoint = {
      worldPos: wheelPos.clone(),
      depth,
      radius,
      surface,
    };

    if (this.ruts.length >= this.maxRuts) {
      this.ruts.shift();
    }
    this.ruts.push(rutPoint);

    this.totalDisplacedVolumeM3 += Math.PI * radius * radius * depth * 0.5;
    return rutPoint;
  }

  /**
   * Applies cumulative ruts to a target terrain mesh BufferGeometry (Y-displacement)
   */
  public applyToGeometry(geometry: THREE.BufferGeometry): void {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr) return;

    const count = posAttr.count;
    for (const rut of this.ruts) {
      for (let i = 0; i < count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const vz = posAttr.getZ(i);

        const dx = vx - rut.worldPos.x;
        const dz = vz - rut.worldPos.z;
        const distSq = dx * dx + dz * dz;
        const radSq = rut.radius * rut.radius;

        if (distSq < radSq) {
          const factor = 1.0 - Math.sqrt(distSq) / rut.radius;
          // Carve trench in center
          posAttr.setY(i, vy - rut.depth * factor * 0.6);
        } else if (distSq < radSq * 2.2) {
          // Push outer loose berm upwards
          const bermFactor = (1.0 - (distSq - radSq) / (radSq * 1.2)) * 0.35;
          posAttr.setY(i, vy + rut.depth * bermFactor * 0.4);
        }
      }
    }
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  public getRuts(): readonly SoilDisplacementPoint[] {
    return this.ruts;
  }

  public reset(): void {
    this.ruts = [];
    this.totalDisplacedVolumeM3 = 0;
  }
}
