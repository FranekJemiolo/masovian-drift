import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Waypoint } from '../physics/TrackWaypoints';
import { PRNG } from '../utils/PRNG';
import { SSVDAG, SwidermajerVoxelBuilder } from '../voxel/SSVDAG';
import { TrackMeshBuilder } from './TrackMeshBuilder';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export class EnvironmentGenerator {
  /**
   * Procedurally generates dense pine forests, Mazovian birch groves,
   * tire barriers, hay bales, fences, and authentic Świdermajer wooden villas
   * using InstancedMesh for maximum 60 FPS performance, and registers exact
   * Rapier solid colliders on the physics world.
   */
  public static generateEnvironment(
    scene: THREE.Scene,
    waypoints: Waypoint[],
    physicsWorld?: PhysicsWorld
  ): THREE.Group {
    const rng = new PRNG(1920042);
    const envGroup = new THREE.Group();
    const wpCount = waypoints.length;
    const dummy = new THREE.Object3D();

    const rapierWorld = physicsWorld?.world;
    const envBody = rapierWorld
      ? rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0))
      : null;

    // -------------------------------------------------------------
    // 1. MAZOVIAN SCOTS PINE FORESTS (Pinus sylvestris, 1200 Trees)
    // -------------------------------------------------------------
    const pineCount = 1200;

    // Tall, bare reddish-brown lower Scots pine trunk (8m to 14m height, avg 11.5m)
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.46, 11.5, 7);
    trunkGeo.translate(0, 5.75, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x7c2d12, // Rich reddish-brown Scots pine bark (#7C2D12)
      roughness: 0.9,
      flatShading: true,
    });
    const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, pineCount);
    trunkInstanced.castShadow = true;
    trunkInstanced.receiveShadow = true;

    // High, flat-topped dense voxel canopies concentrated in the upper 30% of the tree (8.5m - 12.5m)
    const t1 = new THREE.CylinderGeometry(4.2, 4.5, 1.8, 8);
    t1.translate(0, 8.8, 0);
    const t2 = new THREE.CylinderGeometry(3.2, 3.5, 1.6, 8);
    t2.translate(0, 10.4, 0);
    const t3 = new THREE.CylinderGeometry(1.8, 2.2, 1.2, 7);
    t3.translate(0, 11.8, 0);

    // Merge tiers into one Scots pine canopy geometry
    const scotsPineCanopyGeo = this.mergeGeometriesSimple([t1, t2, t3]);
    const pineFoliageMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a2f, // Deep Mazovian pine needle green
      roughness: 0.82,
      flatShading: true,
    });
    const pineFoliageInstanced = new THREE.InstancedMesh(scotsPineCanopyGeo, pineFoliageMat, pineCount);
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
        const reqDist = isStart ? 25.0 : (wp.width * 0.5 + 5.2);
        if (distSq < reqDist * reqDist) {
          return false;
        }
      }
      return true;
    };

    let placedPines = 0;
    let pineAttempts = 0;
    while (placedPines < pineCount && pineAttempts < pineCount * 5) {
      pineAttempts++;
      const wpIdx = Math.floor(rng.next() * wpCount);
      const wp = waypoints[wpIdx];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);

      const isStartStraight = wpIdx < 18 || wpIdx > wpCount - 18;
      const minClearance = isStartStraight ? 26.0 : (wp.width * 0.5 + 6.2);
      const side = rng.chance(0.5) ? -1 : 1;
      const distFromTrack = minClearance + rng.next() * 125.0;
      const alongOffset = (rng.next() - 0.5) * 16.0;

      const posX = wp.point.x + normal.x * distFromTrack * side + (wp.tangent ? wp.tangent.x * alongOffset : 0);
      const posZ = wp.point.z + normal.z * distFromTrack * side + (wp.tangent ? wp.tangent.z * alongOffset : 0);

      // Multi-octave coherent noise mask to cluster pines in organic groves along the dunes
      const clusterMask = Math.sin(posX * 0.024) * Math.cos(posZ * 0.024) + Math.sin(posX * 0.052 + 1.2) * Math.cos(posZ * 0.048);
      if (clusterMask < -0.35 && rng.next() > 0.18) {
        continue;
      }

      if (!isPositionClearOfRoad(posX, posZ)) {
        continue;
      }

      // Exact terrain elevation lookup anchors lower trunk directly into the ground with zero floating
      const terrainY = TrackMeshBuilder.getTerrainHeight(posX, posZ, waypoints);
      const posY = terrainY - 0.40; // Trunk extends 0.40m into soil to eradicate floating gap

      const scale = 0.82 + rng.next() * 0.55;
      const rotY = rng.next() * Math.PI * 2;
      const rotX = (rng.next() - 0.5) * 0.03;
      const rotZ = (rng.next() - 0.5) * 0.03;
      const scaleY = scale * (0.92 + rng.next() * 0.28);

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(rotX, rotY, rotZ);
      dummy.scale.set(scale, scaleY, scale);
      dummy.updateMatrix();

      trunkInstanced.setMatrixAt(placedPines, dummy.matrix);
      pineFoliageInstanced.setMatrixAt(placedPines, dummy.matrix);

      if (envBody && rapierWorld) {
        // Solid Scots Pine trunk collider (radius 0.38m, height 11.5m scaled)
        const halfH = (11.5 * scaleY) * 0.5;
        const radius = 0.38 * scale;
        const treeCol = RAPIER.ColliderDesc.cylinder(halfH, radius)
          .setTranslation(posX, posY + halfH, posZ)
          .setFriction(0.75)
          .setRestitution(0.08);
        rapierWorld.createCollider(treeCol, envBody);
      }

      // Deterministic color variation for organic Mazovian forest
      const col = new THREE.Color().setHSL(
        0.37 + (rng.next() - 0.5) * 0.04,
        0.58 + rng.next() * 0.22,
        0.20 + rng.next() * 0.12
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
      color: 0x4f7d38, // Authentic silver birch canopy green
      roughness: 0.72,
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
      const posY = TrackMeshBuilder.getTerrainHeight(posX, posZ) - 0.25;

      if (!isPositionClearOfRoad(posX, posZ)) {
        continue;
      }

      const scale = 0.9 + rng.next() * 0.5;
      const rotX = (rng.next() - 0.5) * 0.08;
      const rotY = rng.next() * Math.PI * 2;
      const rotZ = (rng.next() - 0.5) * 0.08;
      const scaleY = scale * (0.95 + rng.next() * 0.25);

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(rotX, rotY, rotZ);
      dummy.scale.set(scale, scaleY, scale);
      dummy.updateMatrix();

      birchTrunkInstanced.setMatrixAt(placedBirches, dummy.matrix);
      birchFoliageInstanced.setMatrixAt(placedBirches, dummy.matrix);

      if (envBody && rapierWorld) {
        // Solid Birch trunk collider (radius 0.28m, height 6.0m scaled)
        const halfH = (6.0 * scaleY) * 0.5;
        const radius = 0.28 * scale;
        const birchCol = RAPIER.ColliderDesc.cylinder(halfH, radius)
          .setTranslation(posX, posY + halfH, posZ)
          .setFriction(0.70)
          .setRestitution(0.08);
        rapierWorld.createCollider(birchCol, envBody);
      }

      const bCol = new THREE.Color().setHSL(
        0.26 + rng.next() * 0.05,
        0.52 + rng.next() * 0.18,
        0.32 + rng.next() * 0.10
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
    // 3. AUTHENTIC ŚWIDERMAJER PROCEDURAL VILLAS (Michał Elwiro Andriolli Architecture)
    // -------------------------------------------------------------
    const villaCount = 20;

    // 1. Two-story timber frames: Ground floor pine siding (#854D0E)
    const gfGeo = new THREE.BoxGeometry(15.2, 3.8, 11.2);
    gfGeo.translate(0, 1.9, 0);
    const gfMat = new THREE.MeshStandardMaterial({
      color: 0x854d0e, // Warm horizontal pine siding (#854D0E)
      roughness: 0.85,
      flatShading: true,
    });
    const gfInstanced = new THREE.InstancedMesh(gfGeo, gfMat, villaCount);
    gfInstanced.castShadow = true;
    gfInstanced.receiveShadow = true;

    // 2. Two-story timber frames: Second floor pine siding (#B45309)
    const ufGeo = new THREE.BoxGeometry(14.0, 3.6, 10.2);
    ufGeo.translate(0, 5.6, 0);
    const ufMat = new THREE.MeshStandardMaterial({
      color: 0xb45309, // Second floor pine siding (#B45309)
      roughness: 0.85,
      flatShading: true,
    });
    const ufInstanced = new THREE.InstancedMesh(ufGeo, ufMat, villaCount);
    ufInstanced.castShadow = true;
    ufInstanced.receiveShadow = true;

    // 3. Multi-Gabled Rooflines with distinct pine needle overhangs & finials
    const rMain = new THREE.ConeGeometry(12.8, 5.4, 4);
    rMain.rotateY(Math.PI / 4);
    rMain.translate(0, 10.1, 0);
    const rGable = new THREE.ConeGeometry(8.6, 4.8, 4);
    rGable.rotateY(Math.PI / 4);
    rGable.translate(0, 9.6, 2.6);
    // Decorative carved finials at gables
    const finial1 = new THREE.CylinderGeometry(0.08, 0.18, 1.6, 5);
    finial1.translate(0, 13.4, 0);
    const finial2 = new THREE.CylinderGeometry(0.08, 0.18, 1.5, 5);
    finial2.translate(0, 12.6, 2.6);
    const roofCompositeGeo = this.mergeGeometriesSimple([rMain, rGable, finial1, finial2]);

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x3d271d, // Weathered Mazovian shingle roof
      roughness: 0.75,
      flatShading: true,
    });
    const roofInstanced = new THREE.InstancedMesh(roofCompositeGeo, roofMat, villaCount);
    roofInstanced.castShadow = true;
    roofInstanced.receiveShadow = true;

    // 4. Openwork Fretwork Verandas (Laubzega woodwork: pierced balustrades, carved posts, pediment arches)
    const balustrade = new THREE.BoxGeometry(13.6, 0.9, 3.2);
    balustrade.translate(0, 0.45, 6.8);
    const verandaRoof = new THREE.BoxGeometry(14.0, 0.35, 3.4);
    verandaRoof.translate(0, 3.3, 6.8);
    const balconyRailing = new THREE.BoxGeometry(10.2, 0.85, 2.2);
    balconyRailing.translate(0, 4.25, 6.0);
    const verandaArch = new THREE.BoxGeometry(7.0, 0.4, 0.3);
    verandaArch.translate(0, 3.0, 8.4);
    const fretworkGeo = this.mergeGeometriesSimple([balustrade, verandaRoof, balconyRailing, verandaArch]);

    const fretworkMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9, // Clean whitewashed pierced fretwork woodwork
      roughness: 0.55,
      flatShading: true,
    });
    const fretworkInstanced = new THREE.InstancedMesh(fretworkGeo, fretworkMat, villaCount);
    fretworkInstanced.castShadow = true;
    fretworkInstanced.receiveShadow = true;

    // 5. Red Brick Chimneys
    const chimneyGeo = new THREE.BoxGeometry(1.2, 5.2, 1.2);
    chimneyGeo.translate(3.5, 12.0, 0);
    const chimneyMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b, // Mazovian red brick
      roughness: 0.85,
      flatShading: true,
    });
    const chimneyInstanced = new THREE.InstancedMesh(chimneyGeo, chimneyMat, villaCount);
    chimneyInstanced.castShadow = true;
    chimneyInstanced.receiveShadow = true;

    // 6. Inset Glowing Interior Windows (recessed by 0.08m into frames to prevent exterior clipping)
    // Wall frames are 15.2 and 14.0 wide; inset windows are 15.04 and 13.84 (-0.16m total, 0.08m inset each side)
    const winGf = new THREE.BoxGeometry(15.04, 1.6, 11.04);
    winGf.translate(0, 2.1, 0);
    const winUf = new THREE.BoxGeometry(13.84, 1.5, 10.04);
    winUf.translate(0, 5.7, 0);
    const windowCompositeGeo = this.mergeGeometriesSimple([winGf, winUf]);

    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xeab308,
      emissiveIntensity: 0.5,
      roughness: 0.25,
    });
    const windowInstanced = new THREE.InstancedMesh(windowCompositeGeo, windowMat, villaCount);
    windowInstanced.receiveShadow = true;

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
      const posY = TrackMeshBuilder.getTerrainHeight(posX, posZ);

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(0, loc.rot, 0);
      dummy.scale.set(1.0, 1.0, 1.0);
      dummy.updateMatrix();

      gfInstanced.setMatrixAt(k, dummy.matrix);
      ufInstanced.setMatrixAt(k, dummy.matrix);
      roofInstanced.setMatrixAt(k, dummy.matrix);
      fretworkInstanced.setMatrixAt(k, dummy.matrix);
      chimneyInstanced.setMatrixAt(k, dummy.matrix);
      windowInstanced.setMatrixAt(k, dummy.matrix);

      if (envBody && rapierWorld) {
        // Two-story Świdermajer villa solid obstacle
        const q = dummy.quaternion;
        const villaCol = RAPIER.ColliderDesc.cuboid(8.0, 4.0, 6.0)
          .setTranslation(posX, posY + 4.0, posZ)
          .setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w))
          .setFriction(0.65)
          .setRestitution(0.05);
        rapierWorld.createCollider(villaCol, envBody);
      }
    }

    gfInstanced.instanceMatrix.needsUpdate = true;
    ufInstanced.instanceMatrix.needsUpdate = true;
    roofInstanced.instanceMatrix.needsUpdate = true;
    fretworkInstanced.instanceMatrix.needsUpdate = true;
    chimneyInstanced.instanceMatrix.needsUpdate = true;
    windowInstanced.instanceMatrix.needsUpdate = true;

    gfInstanced.computeBoundingSphere();
    ufInstanced.computeBoundingSphere();
    roofInstanced.computeBoundingSphere();
    fretworkInstanced.computeBoundingSphere();
    chimneyInstanced.computeBoundingSphere();
    windowInstanced.computeBoundingSphere();

    envGroup.add(gfInstanced);
    envGroup.add(ufInstanced);
    envGroup.add(roofInstanced);
    envGroup.add(fretworkInstanced);
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
      const posY = TrackMeshBuilder.getTerrainHeight(posX, posZ) + 0.02;

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

      if (envBody && rapierWorld) {
        // Red & White tire barrier stack (radius 0.58m, height 0.96m, elastic energy dissipation)
        const tireCol = RAPIER.ColliderDesc.cylinder(0.48, 0.58)
          .setTranslation(posX, posY + 0.48, posZ)
          .setFriction(0.85)
          .setRestitution(0.28);
        rapierWorld.createCollider(tireCol, envBody);
      }
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
      const posY = TrackMeshBuilder.getTerrainHeight(posX, posZ) + 0.02;

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(0, rng.next() * Math.PI, 0);
      dummy.scale.set(1.0, 1.0 + (placedHay % 3) * 0.2, 1.0);
      dummy.updateMatrix();

      hayInstanced.setMatrixAt(placedHay, dummy.matrix);
      const hColor = new THREE.Color().setHSL(0.12 + rng.next() * 0.03, 0.85, 0.44 + rng.next() * 0.1);
      hayInstanced.setColorAt(placedHay, hColor);

      if (envBody && rapierWorld) {
        // Golden straw hay bale obstacle (box halfExtents 0.8m x (0.6 * scaleY) x 0.8m)
        const scaleY = 1.0 + (placedHay % 3) * 0.2;
        const q = dummy.quaternion;
        const baleCol = RAPIER.ColliderDesc.cuboid(0.8, 0.6 * scaleY, 0.8)
          .setTranslation(posX, posY + 0.6 * scaleY, posZ)
          .setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w))
          .setFriction(0.80)
          .setRestitution(0.12);
        rapierWorld.createCollider(baleCol, envBody);
      }
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
    fenceInstanced.receiveShadow = true;

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
      const posY = TrackMeshBuilder.getTerrainHeight(posX, posZ) - 0.05;

      dummy.position.set(posX, posY, posZ);
      if (wp.tangent) {
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
      }
      dummy.scale.set(1.0, 1.0, 1.0);
      dummy.updateMatrix();

      fenceInstanced.setMatrixAt(placedFences, dummy.matrix);

      if (envBody && rapierWorld) {
        // Rural split-rail timber fence section (halfExtents 0.15m x 0.65m x 1.9m)
        const q = dummy.quaternion;
        const fenceCol = RAPIER.ColliderDesc.cuboid(0.15, 0.65, 1.9)
          .setTranslation(posX, posY + 0.65, posZ)
          .setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w))
          .setFriction(0.70)
          .setRestitution(0.05);
        rapierWorld.createCollider(fenceCol, envBody);
      }
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
      const posY = TrackMeshBuilder.getTerrainHeight(posX, posZ);
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

      if (envBody && rapierWorld) {
        // Grandstand spectator pavilion solid seating tier
        const q = standGroup.quaternion;
        const standCol = RAPIER.ColliderDesc.cuboid(5.0, 0.8, 2.0)
          .setTranslation(posX, posY + 0.8, posZ)
          .setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w))
          .setFriction(0.70)
          .setRestitution(0.05);
        rapierWorld.createCollider(standCol, envBody);
      }

      envGroup.add(standGroup);
    }

    // -------------------------------------------------------------
    // 8. DISTANT WIND TURBINES (Rotating Horizon Monoliths)
    // -------------------------------------------------------------
    EnvironmentGenerator.turbineRotors = [];
    const turbineLocations = [
      { x: -320, z: -280 },
      { x: -440, z: 120 },
      { x: -280, z: 380 },
      { x: 380, z: 320 },
      { x: 420, z: -220 },
    ];

    const towerMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.1 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.2 });

    for (const tl of turbineLocations) {
      const turbineGroup = new THREE.Group();
      const turbY = TrackMeshBuilder.getTerrainHeight(tl.x, tl.z);
      turbineGroup.position.set(tl.x, turbY, tl.z);

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

      if (envBody && rapierWorld) {
        // Conical wind turbine tower solid base
        const turbCol = RAPIER.ColliderDesc.cylinder(26.0, 2.1)
          .setTranslation(tl.x, turbY + 26.0, tl.z)
          .setFriction(0.60)
          .setRestitution(0.05);
        rapierWorld.createCollider(turbCol, envBody);
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
      const shX = wp.point.x + norm.x * sh.dist * sh.side;
      const shZ = wp.point.z + norm.z * sh.dist * sh.side;
      const shY = TrackMeshBuilder.getTerrainHeight(shX, shZ);
      shGroup.position.set(shX, shY, shZ);

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

      if (envBody && rapierWorld) {
        // Roadside shrine column collider
        const shrineCol = RAPIER.ColliderDesc.cuboid(0.45, 1.8, 0.45)
          .setTranslation(shX, shY + 1.8, shZ)
          .setFriction(0.60)
          .setRestitution(0.05);
        rapierWorld.createCollider(shrineCol, envBody);
      }

      envGroup.add(shGroup);
    }

    // -------------------------------------------------------------
    // 10. AUTHENTIC ŚWIDERMAJER RESORT VILLAS (SSVDAG & Greedy Meshing)
    // -------------------------------------------------------------
    const villaVolume = SwidermajerVoxelBuilder.generateVillaVolume(32, 24, 24);
    const ssvdag = new SSVDAG(32);
    const stats = ssvdag.buildFromVolume(villaVolume, 32, 24, 24);
    console.log(
      `[SSVDAG] Świdermajer villa compressed: ${stats.uniqueNodes}/${stats.totalNodes} nodes (${stats.compressionRatio.toFixed(1)}% deduplication)`
    );

    const villaGeo = SwidermajerVoxelBuilder.greedyMesh(villaVolume, 32, 24, 24);
    const villaMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      flatShading: true,
    });

    const villaSites = [
      { wpIdx: 35, dist: 34.0, side: 1, rotY: 0.2 },
      { wpIdx: 95, dist: 38.0, side: -1, rotY: Math.PI + 0.3 },
      { wpIdx: 155, dist: 32.0, side: 1, rotY: -0.4 },
    ];

    for (const site of villaSites) {
      if (site.wpIdx < wpCount) {
        const wp = waypoints[site.wpIdx];
        const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
        const villaMesh = new THREE.Mesh(villaGeo, villaMat);
        const vX = wp.point.x + norm.x * site.dist * site.side;
        const vZ = wp.point.z + norm.z * site.dist * site.side;
        const vY = TrackMeshBuilder.getTerrainHeight(vX, vZ);
        villaMesh.position.set(vX, vY, vZ);
        villaMesh.rotation.y = site.rotY;
        villaMesh.scale.set(0.48, 0.48, 0.48);
        villaMesh.castShadow = true;
        villaMesh.receiveShadow = true;

        if (envBody && rapierWorld) {
          // SSVDAG Resort villa solid obstacle
          const q = villaMesh.quaternion;
          const ssvdagCol = RAPIER.ColliderDesc.cuboid(7.68, 5.76, 5.76)
            .setTranslation(vX, vY + 5.76, vZ)
            .setRotation(new RAPIER.Quaternion(q.x, q.y, q.z, q.w))
            .setFriction(0.65)
            .setRestitution(0.05);
          rapierWorld.createCollider(ssvdagCol, envBody);
        }

        envGroup.add(villaMesh);
      }
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
