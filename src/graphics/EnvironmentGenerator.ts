import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';
import { PRNG } from '../utils/PRNG';

export class EnvironmentGenerator {
  /**
   * Procedurally generates dense pine forests, Mazovian birch groves,
   * and authentic Świdermajer wooden villas using InstancedMesh for maximum 60 FPS performance.
   */
  public static generateEnvironment(
    scene: THREE.Scene,
    waypoints: Waypoint[]
  ): THREE.Group {
    const rng = new PRNG(1920042);
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
      const wpIdx = Math.floor(rng.next() * wpCount);
      const wp = waypoints[wpIdx];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);

      const isStartStraight = wpIdx < 18 || wpIdx > wpCount - 18;
      const minClearance = isStartStraight ? 26.0 : (wp.width * 0.5 + 6.0);
      const side = rng.chance(0.5) ? -1 : 1;
      const distFromTrack = minClearance + rng.next() * 120.0;
      const alongOffset = (rng.next() - 0.5) * 16.0;

      const posX = wp.point.x + normal.x * distFromTrack * side + (wp.tangent ? wp.tangent.x * alongOffset : 0);
      const posZ = wp.point.z + normal.z * distFromTrack * side + (wp.tangent ? wp.tangent.z * alongOffset : 0);
      const posY = wp.point.y;

      if (!isPositionClearOfRoad(posX, posZ)) {
        continue;
      }

      const scale = 0.85 + rng.next() * 0.65;
      const rotY = rng.next() * Math.PI * 2;

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set((rng.next() - 0.5) * 0.04, rotY, (rng.next() - 0.5) * 0.04);
      dummy.scale.set(scale, scale * (0.9 + rng.next() * 0.25), scale);
      dummy.updateMatrix();

      trunkInstanced.setMatrixAt(placedPines, dummy.matrix);
      pineFoliageInstanced.setMatrixAt(placedPines, dummy.matrix);

      // Deterministic color variation for organic Mazovian forest
      const col = new THREE.Color().setHSL(
        0.38 + (rng.next() - 0.5) * 0.05,
        0.55 + rng.next() * 0.25,
        0.24 + rng.next() * 0.14
      );
      pineFoliageInstanced.setColorAt(placedPines, col);
      placedPines++;
    }

    trunkInstanced.instanceMatrix.needsUpdate = true;
    pineFoliageInstanced.instanceMatrix.needsUpdate = true;
    if (pineFoliageInstanced.instanceColor) pineFoliageInstanced.instanceColor.needsUpdate = true;

    trunkInstanced.computeBoundingSphere();
    pineFoliageInstanced.computeBoundingSphere();

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
      const wpIdx = Math.floor(rng.next() * wpCount);
      const wp = waypoints[wpIdx];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);

      const isStartStraight = wpIdx < 18 || wpIdx > wpCount - 18;
      const minClearance = isStartStraight ? 26.0 : (wp.width * 0.5 + 8.0);
      const side = rng.chance(0.5) ? -1 : 1;
      const distFromTrack = minClearance + rng.next() * 80.0;

      const posX = wp.point.x + normal.x * distFromTrack * side;
      const posZ = wp.point.z + normal.z * distFromTrack * side;
      const posY = wp.point.y;

      if (!isPositionClearOfRoad(posX, posZ)) {
        continue;
      }

      const scale = 0.9 + rng.next() * 0.5;
      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set((rng.next() - 0.5) * 0.08, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 0.08);
      dummy.scale.set(scale, scale * (0.95 + rng.next() * 0.25), scale);
      dummy.updateMatrix();

      birchTrunkInstanced.setMatrixAt(placedBirches, dummy.matrix);
      birchFoliageInstanced.setMatrixAt(placedBirches, dummy.matrix);

      const bCol = new THREE.Color().setHSL(
        0.24 + rng.next() * 0.06,
        0.75 + rng.next() * 0.2,
        0.42 + rng.next() * 0.12
      );
      birchFoliageInstanced.setColorAt(placedBirches, bCol);
      placedBirches++;
    }

    birchTrunkInstanced.instanceMatrix.needsUpdate = true;
    birchFoliageInstanced.instanceMatrix.needsUpdate = true;
    if (birchFoliageInstanced.instanceColor) birchFoliageInstanced.instanceColor.needsUpdate = true;

    birchTrunkInstanced.computeBoundingSphere();
    birchFoliageInstanced.computeBoundingSphere();

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

    villaBodyInstanced.computeBoundingSphere();
    roofInstanced.computeBoundingSphere();
    verandaInstanced.computeBoundingSphere();
    chimneyInstanced.computeBoundingSphere();
    windowInstanced.computeBoundingSphere();

    envGroup.add(villaBodyInstanced);
    envGroup.add(roofInstanced);
    envGroup.add(verandaInstanced);
    envGroup.add(chimneyInstanced);
    envGroup.add(windowInstanced);

    // -------------------------------------------------------------
    // 4. RED & WHITE TIRE BARRIER STACKS (120 Stacks on Corner Runoffs)
    // -------------------------------------------------------------
    const tireStackCount = 120;
    // 3 stacked tires (Bottom red, Middle white, Top red)
    const tire1 = new THREE.CylinderGeometry(0.55, 0.55, 0.32, 10);
    tire1.translate(0, 0.16, 0);
    const tire2 = new THREE.CylinderGeometry(0.55, 0.55, 0.32, 10);
    tire2.translate(0, 0.48, 0);
    const tire3 = new THREE.CylinderGeometry(0.55, 0.55, 0.32, 10);
    tire3.translate(0, 0.80, 0);
    const tireStackGeo = this.mergeGeometriesSimple([tire1, tire2, tire3]);

    const tireStackMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626, // Vivid motorsport red
      roughness: 0.8,
      flatShading: true,
    });
    const tireStackInstanced = new THREE.InstancedMesh(tireStackGeo, tireStackMat, tireStackCount);
    tireStackInstanced.castShadow = true;
    tireStackInstanced.receiveShadow = true;

    let placedTires = 0;
    for (let k = 10; k < wpCount - 10 && placedTires < tireStackCount; k += 3) {
      const wp = waypoints[k];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const halfW = wp.width * 0.5 + 2.8;

      // Place on outer runoff side
      const side = (k % 6 < 3) ? 1 : -1;
      const posX = wp.point.x + norm.x * halfW * side;
      const posZ = wp.point.z + norm.z * halfW * side;
      const posY = wp.point.y + 0.40;

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(0, rng.next() * Math.PI * 2, 0);
      dummy.scale.set(1.0, 1.0, 1.0);
      dummy.updateMatrix();

      tireStackInstanced.setMatrixAt(placedTires, dummy.matrix);
      // Alternate between red/white color stacks
      const isRedStack = placedTires % 2 === 0;
      tireStackInstanced.setColorAt(
        placedTires,
        isRedStack ? new THREE.Color(0xdc2626) : new THREE.Color(0xf1f5f9)
      );
      placedTires++;
    }
    tireStackInstanced.instanceMatrix.needsUpdate = true;
    if (tireStackInstanced.instanceColor) tireStackInstanced.instanceColor.needsUpdate = true;
    tireStackInstanced.computeBoundingSphere();
    envGroup.add(tireStackInstanced);

    // -------------------------------------------------------------
    // 5. GOLDEN STRAW HAY BALES (100 Bales along Farmland & Chicanes)
    // -------------------------------------------------------------
    const hayCount = 100;
    const hayGeo = new THREE.BoxGeometry(1.6, 1.2, 1.6);
    hayGeo.translate(0, 0.6, 0);
    const hayMat = new THREE.MeshStandardMaterial({
      color: 0xca8a04, // Warm Mazovian golden harvest straw
      roughness: 0.95,
      flatShading: true,
    });
    const hayInstanced = new THREE.InstancedMesh(hayGeo, hayMat, hayCount);
    hayInstanced.castShadow = true;
    hayInstanced.receiveShadow = true;

    let placedHay = 0;
    for (let k = 15; k < wpCount - 15 && placedHay < hayCount; k += 4) {
      const wp = waypoints[k];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const side = (k % 8 < 4) ? -1 : 1;
      const dist = wp.width * 0.5 + 3.8 + (k % 3) * 1.5;

      const posX = wp.point.x + norm.x * dist * side;
      const posZ = wp.point.z + norm.z * dist * side;
      const posY = wp.point.y + 0.38;

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(0, rng.next() * Math.PI, 0);
      dummy.scale.set(1.0, 1.0 + (placedHay % 3) * 0.2, 1.0);
      dummy.updateMatrix();

      hayInstanced.setMatrixAt(placedHay, dummy.matrix);
      const hColor = new THREE.Color().setHSL(0.12 + rng.next() * 0.03, 0.85, 0.44 + rng.next() * 0.1);
      hayInstanced.setColorAt(placedHay, hColor);
      placedHay++;
    }
    hayInstanced.instanceMatrix.needsUpdate = true;
    if (hayInstanced.instanceColor) hayInstanced.instanceColor.needsUpdate = true;
    hayInstanced.computeBoundingSphere();
    envGroup.add(hayInstanced);

    // -------------------------------------------------------------
    // 6. RURAL SPLIT-RAIL TIMBER FENCES (140 Fence Sections)
    // -------------------------------------------------------------
    const fenceCount = 140;
    // Wooden post + two horizontal rails
    const postBox = new THREE.BoxGeometry(0.18, 1.3, 0.18);
    postBox.translate(0, 0.65, 0);
    const railTop = new THREE.BoxGeometry(0.12, 0.14, 3.8);
    railTop.translate(0, 1.05, 1.9);
    const railBottom = new THREE.BoxGeometry(0.12, 0.14, 3.8);
    railBottom.translate(0, 0.55, 1.9);
    const fenceSectionGeo = this.mergeGeometriesSimple([postBox, railTop, railBottom]);

    const fenceMat = new THREE.MeshStandardMaterial({
      color: 0x785637, // Weathered pine timber
      roughness: 0.9,
      flatShading: true,
    });
    const fenceInstanced = new THREE.InstancedMesh(fenceSectionGeo, fenceMat, fenceCount);
    fenceInstanced.castShadow = true;

    let placedFences = 0;
    for (let k = 4; k < wpCount - 8 && placedFences < fenceCount; k += 2) {
      // Don't crowd the sharpest corners
      if (k > 40 && k < 60) continue;

      const wp = waypoints[k];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const dist = wp.width * 0.5 + 4.5;
      const side = (k % 4 === 0) ? 1 : -1;

      const posX = wp.point.x + norm.x * dist * side;
      const posZ = wp.point.z + norm.z * dist * side;
      const posY = wp.point.y + 0.38;

      dummy.position.set(posX, posY, posZ);
      if (wp.tangent) {
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
      }
      dummy.scale.set(1.0, 1.0, 1.0);
      dummy.updateMatrix();

      fenceInstanced.setMatrixAt(placedFences, dummy.matrix);
      placedFences++;
    }
    fenceInstanced.instanceMatrix.needsUpdate = true;
    fenceInstanced.computeBoundingSphere();
    envGroup.add(fenceInstanced);

    // -------------------------------------------------------------
    // 7. SPECTATOR PAVILIONS & CHEERING VOXEL FANS (8 Grandstands)
    // -------------------------------------------------------------
    const standLocations = [
      { wpIdx: 2, side: 1, dist: 14.0 },  // Main straight spectator hub
      { wpIdx: 12, side: -1, dist: 16.0 }, // Turn 1 braking zone
      { wpIdx: 34, side: 1, dist: 15.0 },  // Lake curve arena
      { wpIdx: 68, side: -1, dist: 16.0 }, // Forest hairpin
      { wpIdx: 98, side: 1, dist: 15.0 },  // High-speed S-bends
      { wpIdx: 132, side: -1, dist: 14.0 }, // Final corner grandstand
    ];

    const standMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, flatShading: true });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xd92b2b, roughness: 0.4, flatShading: true });
    const fanShirtMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5 });
    const fanCapMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3 });

    for (const st of standLocations) {
      const wp = waypoints[st.wpIdx];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const standGroup = new THREE.Group();

      const posX = wp.point.x + norm.x * st.dist * st.side;
      const posZ = wp.point.z + norm.z * st.dist * st.side;
      const posY = wp.point.y + 0.40;
      standGroup.position.set(posX, posY, posZ);

      if (wp.tangent) {
        standGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
        if (st.side === -1) standGroup.rotateY(Math.PI);
      }

      // Wooden platform tiers
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.8, 4.0), standMat);
      t1.position.set(0, 0.4, 0);
      t1.castShadow = true;
      standGroup.add(t1);

      const t2 = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.8, 2.8), standMat);
      t2.position.set(0, 1.2, -0.6);
      t2.castShadow = true;
      standGroup.add(t2);

      // Striped Canopy Awning
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.15, 4.6), canopyMat);
      canopy.position.set(0, 4.2, 0);
      canopy.rotation.x = 0.12;
      canopy.castShadow = true;
      standGroup.add(canopy);

      // Canopy support poles
      // Canopy support poles
      const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4.2, 6);
      for (const px of [-4.8, 4.8]) {
        for (const pz of [-1.8, 1.8]) {
          const pole = new THREE.Mesh(poleGeo, standMat);
          pole.position.set(px, 2.1, pz);
          standGroup.add(pole);
        }
      }

      // Swaying Polish / Mazovian racing flags atop canopy (G11)
      for (const fx of [-4.5, 4.5]) {
        const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 5), standMat);
        flagPole.position.set(fx, 5.2, 0);
        standGroup.add(flagPole);

        const flagClothGeo = new THREE.PlaneGeometry(1.2, 0.7);
        flagClothGeo.translate(0.6, 0, 0);
        const flagClothMat = new THREE.MeshStandardMaterial({
          color: fx < 0 ? 0xd92b2b : 0xf8fafc,
          roughness: 0.7,
          side: THREE.DoubleSide,
        });
        const flagMesh = new THREE.Mesh(flagClothGeo, flagClothMat);
        flagMesh.position.set(fx, 5.8, 0);
        flagMesh.userData.phase = fx;
        standGroup.add(flagMesh);
        EnvironmentGenerator.flags.push(flagMesh);
      }

      // Voxel Spectators Cheering with procedural jumping animation (G11)
      for (let fx = -4.0; fx <= 4.0; fx += 1.3) {
        const fanGroup = new THREE.Group();
        fanGroup.position.set(fx, 1.8, -0.4);
        fanGroup.userData.baseY = 1.8;

        // Body
        const fan = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.55, 0.28), fanShirtMat);
        fan.position.set(0, 0.275, 0);
        fanGroup.add(fan);

        // Head / Cap
        const fanHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), fanCapMat);
        fanHead.position.set(0, 0.65, 0);
        fanGroup.add(fanHead);

        standGroup.add(fanGroup);
        EnvironmentGenerator.spectators.push(fanGroup);
      }

      envGroup.add(standGroup);
    }

    // -------------------------------------------------------------
    // 8. DISTANT WIND TURBINES (Rotating Horizon Monoliths)
    // -------------------------------------------------------------
    EnvironmentGenerator.turbineRotors = [];
    const turbineLocations = [
      { x: -320, z: -280, y: 12 },
      { x: -440, z: 120, y: 16 },
      { x: -280, z: 380, y: 14 },
      { x: 380, z: 320, y: 18 },
      { x: 420, z: -220, y: 15 },
    ];

    const towerMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.1 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.2 });

    for (const tl of turbineLocations) {
      const turbineGroup = new THREE.Group();
      turbineGroup.position.set(tl.x, tl.y, tl.z);

      // Slender conical tower (52m tall)
      const towerGeo = new THREE.CylinderGeometry(1.4, 2.8, 52, 10);
      const towerMesh = new THREE.Mesh(towerGeo, towerMat);
      towerMesh.position.set(0, 26, 0);
      towerMesh.castShadow = true;
      turbineGroup.add(towerMesh);

      // Nacelle generator pod
      const nacelleGeo = new THREE.BoxGeometry(3.2, 3.0, 7.5);
      const nacelleMesh = new THREE.Mesh(nacelleGeo, towerMat);
      nacelleMesh.position.set(0, 52, 0);
      turbineGroup.add(nacelleMesh);

      // Rotating Rotor Hub & 3 Aerodynamic Blades
      const rotorGroup = new THREE.Group();
      rotorGroup.position.set(0, 52, 3.8);

      const hubGeo = new THREE.CylinderGeometry(1.6, 1.6, 1.2, 12);
      hubGeo.rotateX(Math.PI / 2);
      const hubMesh = new THREE.Mesh(hubGeo, towerMat);
      rotorGroup.add(hubMesh);

      // 3 Blades (120 deg apart, 22m length)
      for (let b = 0; b < 3; b++) {
        const bladeArm = new THREE.Group();
        bladeArm.rotation.z = (b * Math.PI * 2) / 3;

        const bladeGeo = new THREE.BoxGeometry(0.85, 22.0, 0.25);
        bladeGeo.translate(0, 11.0, 0);
        const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
        bladeArm.add(bladeMesh);

        // Red safety tip
        const tipGeo = new THREE.BoxGeometry(0.88, 3.5, 0.27);
        tipGeo.translate(0, 20.25, 0);
        const tipMesh = new THREE.Mesh(tipGeo, canopyMat);
        bladeArm.add(tipMesh);

        rotorGroup.add(bladeArm);
      }

      turbineGroup.add(rotorGroup);
      EnvironmentGenerator.turbineRotors.push(rotorGroup);
      envGroup.add(turbineGroup);
    }

    // -------------------------------------------------------------
    // 9. HISTORIC MAZOVIAN ROADSIDE SHRINES (Przydrożne Kapliczki)
    // -------------------------------------------------------------
    const shrineLocations = [
      { wpIdx: 22, dist: 16.0, side: 1 },
      { wpIdx: 82, dist: 15.0, side: -1 },
      { wpIdx: 120, dist: 14.0, side: 1 },
    ];
    const shrineWoodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8, flatShading: true });
    const shrineRoofMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.6 });

    for (const sh of shrineLocations) {
      const wp = waypoints[sh.wpIdx];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const shGroup = new THREE.Group();
      shGroup.position.set(
        wp.point.x + norm.x * sh.dist * sh.side,
        wp.point.y + 0.40,
        wp.point.z + norm.z * sh.dist * sh.side
      );

      // Stone/Wood Column base
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.6, 0.9), shrineWoodMat);
      col.position.set(0, 1.8, 0);
      col.castShadow = true;
      shGroup.add(col);

      // Small niche cabinet
      const niche = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.8), shrineWoodMat);
      niche.position.set(0, 3.8, 0);
      shGroup.add(niche);

      // Peaked roof
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 4), shrineRoofMat);
      roof.position.set(0, 4.8, 0);
      roof.rotateY(Math.PI / 4);
      shGroup.add(roof);

      envGroup.add(shGroup);
    }

    scene.add(envGroup);
    return envGroup;
  }

  public static turbineRotors: THREE.Group[] = [];
  public static spectators: THREE.Group[] = [];
  public static flags: THREE.Mesh[] = [];
  public static animTime = 0;

  /**
   * Gently spins distant wind turbines, animates cheering voxel spectators, and sways racing flags (G11)
   */
  public static update(delta: number): void {
    EnvironmentGenerator.animTime += delta;
    const t = EnvironmentGenerator.animTime;

    // 1. Wind turbines
    const rotSpeed = 0.35;
    for (const rotor of EnvironmentGenerator.turbineRotors) {
      rotor.rotation.z += rotSpeed * delta;
    }

    // 2. Cheering voxel spectators (procedural jumping animation)
    for (let i = 0; i < EnvironmentGenerator.spectators.length; i++) {
      const sp = EnvironmentGenerator.spectators[i];
      sp.position.y = (sp.userData.baseY || 1.8) + Math.abs(Math.sin(t * 6.5 + i * 0.8)) * 0.16;
    }

    // 3. Swaying racing flags in the breeze
    for (const fl of EnvironmentGenerator.flags) {
      fl.rotation.y = Math.sin(t * 4.5 + (fl.userData.phase || 0)) * 0.22;
    }
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
