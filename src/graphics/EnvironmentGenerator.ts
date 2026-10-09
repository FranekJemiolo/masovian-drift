import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';

export class EnvironmentGenerator {
  /**
   * Procedurally generates dense pine forests, Mazovian birch groves,
   * and authentic Świdermajer wooden villas using InstancedMesh for maximum 60 FPS performance.
   */
  public static generateEnvironment(
    scene: THREE.Scene,
    waypoints: Waypoint[]
  ): THREE.Group {
    const envGroup = new THREE.Group();
    const wpCount = waypoints.length;
    const dummy = new THREE.Object3D();

    // -------------------------------------------------------------
    // 1. TIERED PINE FORESTS (3-Tier Conical Needles, 1200 Trees)
    // -------------------------------------------------------------
    const pineCount = 1200;

    // Pine Trunk Geometry (Textured bark)
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 6.5, 6);
    trunkGeo.translate(0, 3.25, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x4a3525,
      roughness: 0.9,
      flatShading: true,
    });
    const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, pineCount);
    trunkInstanced.castShadow = true;
    trunkInstanced.receiveShadow = true;

    // Create 3-Tiered Pine Foliage Geometry
    const t1 = new THREE.ConeGeometry(4.0, 4.2, 7);
    t1.translate(0, 4.8, 0);
    const t2 = new THREE.ConeGeometry(3.0, 3.8, 7);
    t2.translate(0, 7.2, 0);
    const t3 = new THREE.ConeGeometry(1.9, 3.4, 7);
    t3.translate(0, 9.4, 0);

    // Merge tiers into one foliage geometry
    const tieredPineGeo = this.mergeGeometriesSimple([t1, t2, t3]);
    const pineFoliageMat = new THREE.MeshStandardMaterial({
      color: 0x245a43, // Rich vibrant pine needle green
      roughness: 0.8,
      flatShading: true,
    });
    const pineFoliageInstanced = new THREE.InstancedMesh(tieredPineGeo, pineFoliageMat, pineCount);
    pineFoliageInstanced.castShadow = true;
    pineFoliageInstanced.receiveShadow = true;

    // Rigorous clearance check against EVERY track waypoint:
    // Guarantees zero trees spawn on or near the road surface or starting straight
    const isPositionClearOfRoad = (x: number, z: number): boolean => {
      for (let k = 0; k < wpCount; k++) {
        const wp = waypoints[k];
        const dx = x - wp.point.x;
        const dz = z - wp.point.z;
        const distSq = dx * dx + dz * dz;
        // On starting straight (grid & launch area), enforce 25m clearance!
        const isStart = k < 18 || k > wpCount - 18;
        const reqDist = isStart ? 25.0 : (wp.width * 0.5 + 4.8);
        if (distSq < reqDist * reqDist) {
          return false;
        }
      }
      return true;
    };

    let placedPines = 0;
    let pineAttempts = 0;
    while (placedPines < pineCount && pineAttempts < pineCount * 4) {
      pineAttempts++;
      const wpIdx = Math.floor(Math.random() * wpCount);
      const wp = waypoints[wpIdx];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);

      const isStartStraight = wpIdx < 18 || wpIdx > wpCount - 18;
      const minClearance = isStartStraight ? 26.0 : (wp.width * 0.5 + 6.0);
      const side = Math.random() < 0.5 ? -1 : 1;
      const distFromTrack = minClearance + Math.random() * 120.0;
      const alongOffset = (Math.random() - 0.5) * 16.0;

      const posX = wp.point.x + normal.x * distFromTrack * side + (wp.tangent ? wp.tangent.x * alongOffset : 0);
      const posZ = wp.point.z + normal.z * distFromTrack * side + (wp.tangent ? wp.tangent.z * alongOffset : 0);
      const posY = wp.point.y;

      if (!isPositionClearOfRoad(posX, posZ)) {
        continue;
      }

      const scale = 0.85 + Math.random() * 0.65;
      const rotY = Math.random() * Math.PI * 2;

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set((Math.random() - 0.5) * 0.04, rotY, (Math.random() - 0.5) * 0.04);
      dummy.scale.set(scale, scale * (0.9 + Math.random() * 0.25), scale);
      dummy.updateMatrix();

      trunkInstanced.setMatrixAt(placedPines, dummy.matrix);
      pineFoliageInstanced.setMatrixAt(placedPines, dummy.matrix);

      // Random color variation for organic Mazovian forest
      const col = new THREE.Color().setHSL(
        0.38 + (Math.random() - 0.5) * 0.05,
        0.55 + Math.random() * 0.25,
        0.24 + Math.random() * 0.14
      );
      pineFoliageInstanced.setColorAt(placedPines, col);
      placedPines++;
    }

    trunkInstanced.instanceMatrix.needsUpdate = true;
    pineFoliageInstanced.instanceMatrix.needsUpdate = true;
    if (pineFoliageInstanced.instanceColor) pineFoliageInstanced.instanceColor.needsUpdate = true;

    envGroup.add(trunkInstanced);
    envGroup.add(pineFoliageInstanced);

    // -------------------------------------------------------------
    // 2. MAZOVIAN BIRCH GROVES (Brzozy Brodawkowate, 400 Trees)
    // -------------------------------------------------------------
    const birchCount = 400;

    // Slender white birch trunk
    const birchTrunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 6.0, 6);
    birchTrunkGeo.translate(0, 3.0, 0);
    const birchTrunkMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9, // Crisp white bark
      roughness: 0.5,
      flatShading: true,
    });
    const birchTrunkInstanced = new THREE.InstancedMesh(birchTrunkGeo, birchTrunkMat, birchCount);
    birchTrunkInstanced.castShadow = true;

    // Soft rounded birch foliage canopy
    const b1 = new THREE.DodecahedronGeometry(2.4, 0);
    b1.translate(0, 6.2, 0);
    const b2 = new THREE.DodecahedronGeometry(1.8, 0);
    b2.translate(0.5, 7.8, 0.3);
    const birchFoliageGeo = this.mergeGeometriesSimple([b1, b2]);

    const birchFoliageMat = new THREE.MeshStandardMaterial({
      color: 0x84cc16, // Fresh bright spring birch green
      roughness: 0.65,
      flatShading: true,
    });
    const birchFoliageInstanced = new THREE.InstancedMesh(birchFoliageGeo, birchFoliageMat, birchCount);
    birchFoliageInstanced.castShadow = true;
    birchFoliageInstanced.receiveShadow = true;

    let placedBirches = 0;
    let birchAttempts = 0;
    while (placedBirches < birchCount && birchAttempts < birchCount * 4) {
      birchAttempts++;
      const wpIdx = Math.floor(Math.random() * wpCount);
      const wp = waypoints[wpIdx];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);

      const isStartStraight = wpIdx < 18 || wpIdx > wpCount - 18;
      const minClearance = isStartStraight ? 26.0 : (wp.width * 0.5 + 8.0);
      const side = Math.random() < 0.5 ? -1 : 1;
      const distFromTrack = minClearance + Math.random() * 80.0;

      const posX = wp.point.x + normal.x * distFromTrack * side;
      const posZ = wp.point.z + normal.z * distFromTrack * side;
      const posY = wp.point.y;

      if (!isPositionClearOfRoad(posX, posZ)) {
        continue;
      }

      const scale = 0.9 + Math.random() * 0.5;
      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set((Math.random() - 0.5) * 0.08, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.08);
      dummy.scale.set(scale, scale * (0.95 + Math.random() * 0.25), scale);
      dummy.updateMatrix();

      birchTrunkInstanced.setMatrixAt(placedBirches, dummy.matrix);
      birchFoliageInstanced.setMatrixAt(placedBirches, dummy.matrix);

      const bCol = new THREE.Color().setHSL(
        0.24 + Math.random() * 0.06,
        0.75 + Math.random() * 0.2,
        0.42 + Math.random() * 0.12
      );
      birchFoliageInstanced.setColorAt(placedBirches, bCol);
      placedBirches++;
    }

    birchTrunkInstanced.instanceMatrix.needsUpdate = true;
    birchFoliageInstanced.instanceMatrix.needsUpdate = true;
    if (birchFoliageInstanced.instanceColor) birchFoliageInstanced.instanceColor.needsUpdate = true;

    envGroup.add(birchTrunkInstanced);
    envGroup.add(birchFoliageInstanced);

    // -------------------------------------------------------------
    // 3. ŚWIDERMAJER WOODEN RESORT VILLAS (Warsaw Architecture)
    // -------------------------------------------------------------
    const villaCount = 20;

    // Villa Body (Warm Mazovian timber walls)
    const villaBodyGeo = new THREE.BoxGeometry(16, 7.5, 12);
    villaBodyGeo.translate(0, 3.75, 0);
    const villaBodyMat = new THREE.MeshStandardMaterial({
      color: 0x92704a, // Warm weathered pine timber
      roughness: 0.8,
      flatShading: true,
    });
    const villaBodyInstanced = new THREE.InstancedMesh(villaBodyGeo, villaBodyMat, villaCount);
    villaBodyInstanced.castShadow = true;
    villaBodyInstanced.receiveShadow = true;

    // Villa Gabled Shingle Roof
    const roofGeo = new THREE.ConeGeometry(12.5, 6.2, 4);
    roofGeo.translate(0, 10.6, 0);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x3d271d, // Cedar shingles
      roughness: 0.7,
      flatShading: true,
    });
    const roofInstanced = new THREE.InstancedMesh(roofGeo, roofMat, villaCount);
    roofInstanced.castShadow = true;

    // Villa Openwork Carved Veranda / Porch ("Lalki" architectural woodwork)
    const verandaGeo = new THREE.BoxGeometry(14, 4.5, 4.2);
    verandaGeo.translate(0, 2.25, 7.5);
    const verandaMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9, // Clean whitewashed carved wooden veranda
      roughness: 0.5,
      flatShading: true,
    });
    const verandaInstanced = new THREE.InstancedMesh(verandaGeo, verandaMat, villaCount);
    verandaInstanced.castShadow = true;

    // Red Brick Chimneys
    const chimneyGeo = new THREE.BoxGeometry(1.2, 5.2, 1.2);
    chimneyGeo.translate(3.5, 12.0, 0);
    const chimneyMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b, // Mazovian red brick
      roughness: 0.85,
      flatShading: true,
    });
    const chimneyInstanced = new THREE.InstancedMesh(chimneyGeo, chimneyMat, villaCount);
    chimneyInstanced.castShadow = true;

    // Glowing Warm Windows (Amber interior lights)
    const windowGeo = new THREE.BoxGeometry(14.2, 2.2, 12.2);
    windowGeo.translate(0, 4.2, 0);
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xeab308,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    const windowInstanced = new THREE.InstancedMesh(windowGeo, windowMat, villaCount);

    const villaLocations = [
      { wpIdx: 6, dist: 35, side: 1, rot: 0.3 },     // Gurewicz Sanatorium villa
      { wpIdx: 18, dist: 38, side: -1, rot: -0.7 },
      { wpIdx: 30, dist: 34, side: 1, rot: 1.1 },
      { wpIdx: 42, dist: 36, side: -1, rot: -1.4 },
      { wpIdx: 54, dist: 40, side: 1, rot: 0.2 },
      { wpIdx: 66, dist: 32, side: 1, rot: 2.0 },
      { wpIdx: 78, dist: 36, side: -1, rot: -0.5 },
      { wpIdx: 90, dist: 38, side: 1, rot: -1.2 },
      { wpIdx: 102, dist: 32, side: -1, rot: 1.4 },
      { wpIdx: 114, dist: 30, side: 1, rot: -0.6 },
      { wpIdx: 126, dist: 36, side: -1, rot: 0.8 },
      { wpIdx: 138, dist: 32, side: 1, rot: -0.3 },
      { wpIdx: 14, dist: 55, side: 1, rot: 0.9 },
      { wpIdx: 38, dist: 58, side: -1, rot: -1.1 },
      { wpIdx: 62, dist: 50, side: 1, rot: 1.6 },
      { wpIdx: 86, dist: 54, side: -1, rot: 0.4 },
      { wpIdx: 110, dist: 48, side: 1, rot: -1.8 },
      { wpIdx: 122, dist: 52, side: -1, rot: 0.7 },
      { wpIdx: 26, dist: 46, side: -1, rot: -0.4 },
      { wpIdx: 74, dist: 50, side: 1, rot: 1.3 },
    ];

    for (let k = 0; k < villaCount; k++) {
      const loc = villaLocations[k];
      const wp = waypoints[loc.wpIdx % wpCount];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);

      const posX = wp.point.x + normal.x * loc.dist * loc.side;
      const posZ = wp.point.z + normal.z * loc.dist * loc.side;
      const posY = wp.point.y;

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(0, loc.rot, 0);
      dummy.scale.set(1.0, 1.0, 1.0);
      dummy.updateMatrix();

      villaBodyInstanced.setMatrixAt(k, dummy.matrix);
      roofInstanced.setMatrixAt(k, dummy.matrix);
      verandaInstanced.setMatrixAt(k, dummy.matrix);
      chimneyInstanced.setMatrixAt(k, dummy.matrix);
      windowInstanced.setMatrixAt(k, dummy.matrix);
    }

    villaBodyInstanced.instanceMatrix.needsUpdate = true;
    roofInstanced.instanceMatrix.needsUpdate = true;
    verandaInstanced.instanceMatrix.needsUpdate = true;
    chimneyInstanced.instanceMatrix.needsUpdate = true;
    windowInstanced.instanceMatrix.needsUpdate = true;

    envGroup.add(villaBodyInstanced);
    envGroup.add(roofInstanced);
    envGroup.add(verandaInstanced);
    envGroup.add(chimneyInstanced);
    envGroup.add(windowInstanced);

    scene.add(envGroup);
    return envGroup;
  }

  /**
   * Helper to merge multiple simple BufferGeometries into one
   */
  private static mergeGeometriesSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const merged = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let indexOffset = 0;

    for (const g of geos) {
      const pos = g.getAttribute('position');
      const norm = g.getAttribute('normal');
      const uv = g.getAttribute('uv');
      const idx = g.getIndex();

      if (pos) {
        for (let i = 0; i < pos.count; i++) {
          positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          if (norm) normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
          if (uv) uvs.push(uv.getX(i), uv.getY(i));
        }
      }

      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + indexOffset);
        }
      }
      indexOffset += pos.count;
    }

    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length > 0) merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    if (uvs.length > 0) merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (indices.length > 0) merged.setIndex(indices);

    return merged;
  }
}
