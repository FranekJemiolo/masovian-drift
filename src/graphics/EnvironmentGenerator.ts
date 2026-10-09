import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';

export class EnvironmentGenerator {
  /**
   * Procedurally generates dense pine forests and Świdermajer wooden villas
   * using InstancedMesh for maximum GPU performance (single draw call per batch).
   */
  public static generateEnvironment(
    scene: THREE.Scene,
    waypoints: Waypoint[]
  ): THREE.Group {
    const envGroup = new THREE.Group();

    // -------------------------------------------------------------
    // 1. INSTANCED PINE FORESTS (Thousands of trees in 2 draw calls)
    // -------------------------------------------------------------
    const treeCount = 1400;

    // Pine Trunk Geometry & Material
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 7.5, 6);
    trunkGeo.translate(0, 3.75, 0); // Origin at base
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x3d2817,
      roughness: 0.9,
      flatShading: true,
    });
    const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    trunkInstanced.castShadow = true;
    trunkInstanced.receiveShadow = true;

    // Pine Foliage Geometry & Material (Stepped conical voxel pine layers)
    const foliageGeo = new THREE.ConeGeometry(3.6, 9.0, 7);
    foliageGeo.translate(0, 9.0, 0);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x1b4332, // Dark pine green
      roughness: 0.85,
      flatShading: true,
    });
    const foliageInstanced = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
    foliageInstanced.castShadow = true;
    foliageInstanced.receiveShadow = true;

    // Populate pine trees avoiding the road surface
    const dummy = new THREE.Object3D();
    const wpCount = waypoints.length;
    let placedTrees = 0;

    // Distribute trees around circuit
    for (let i = 0; i < treeCount; i++) {
      // Pick random waypoint along track
      const wpIdx = Math.floor(Math.random() * wpCount);
      const wp = waypoints[wpIdx];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);

      // Distance from center of track: at least track width/2 + 5m clearance up to 140m into forest
      const side = Math.random() < 0.5 ? -1 : 1;
      const distFromTrack = (wp.width * 0.5 + 4.5) + Math.random() * 120.0;
      const alongTrackOffset = (Math.random() - 0.5) * 18.0;

      const posX = wp.point.x + normal.x * distFromTrack * side + (wp.tangent ? wp.tangent.x * alongTrackOffset : 0);
      const posZ = wp.point.z + normal.z * distFromTrack * side + (wp.tangent ? wp.tangent.z * alongTrackOffset : 0);
      const posY = wp.point.y;

      const scale = 0.75 + Math.random() * 0.7;
      const rotY = Math.random() * Math.PI * 2;

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set((Math.random() - 0.5) * 0.05, rotY, (Math.random() - 0.5) * 0.05);
      dummy.scale.set(scale, scale * (0.85 + Math.random() * 0.3), scale);
      dummy.updateMatrix();

      trunkInstanced.setMatrixAt(placedTrees, dummy.matrix);
      foliageInstanced.setMatrixAt(placedTrees, dummy.matrix);

      // Random tint to pine foliage for depth
      const greenVariation = new THREE.Color().setHSL(
        0.38 + Math.random() * 0.06,
        0.5 + Math.random() * 0.3,
        0.18 + Math.random() * 0.12
      );
      foliageInstanced.setColorAt(placedTrees, greenVariation);

      placedTrees++;
    }

    trunkInstanced.instanceMatrix.needsUpdate = true;
    foliageInstanced.instanceMatrix.needsUpdate = true;
    if (foliageInstanced.instanceColor) foliageInstanced.instanceColor.needsUpdate = true;

    envGroup.add(trunkInstanced);
    envGroup.add(foliageInstanced);

    // -------------------------------------------------------------
    // 2. ŚWIDERMAJER WOODEN VILLAS (Warsaw Suburbs Architecture)
    // -------------------------------------------------------------
    // Świdermajer style: Wooden 2-story summer villas, gabled roofs,
    // openwork carved verandas/porches, and decorative eaves.
    const villaCount = 18;

    // Villa Body InstancedMesh (Warm pine timber walls)
    const villaBodyGeo = new THREE.BoxGeometry(16, 8, 12);
    villaBodyGeo.translate(0, 4, 0);
    const villaBodyMat = new THREE.MeshStandardMaterial({
      color: 0x8c6d48, // Weathered Mazovian timber
      roughness: 0.85,
      flatShading: true,
    });
    const villaBodyInstanced = new THREE.InstancedMesh(villaBodyGeo, villaBodyMat, villaCount);
    villaBodyInstanced.castShadow = true;
    villaBodyInstanced.receiveShadow = true;

    // Villa Gabled Roof InstancedMesh (Steep dark wooden shingle roof)
    const roofGeo = new THREE.ConeGeometry(12.5, 6, 4); // 4-sided pyramid / gabled roof
    roofGeo.translate(0, 11, 0);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x3e2723, // Dark cedar shingles
      roughness: 0.75,
      flatShading: true,
    });
    const roofInstanced = new THREE.InstancedMesh(roofGeo, roofMat, villaCount);
    roofInstanced.castShadow = true;

    // Villa Openwork Veranda InstancedMesh (Carved wooden porch)
    const verandaGeo = new THREE.BoxGeometry(14, 4.2, 4.5);
    verandaGeo.translate(0, 2.1, 7.5);
    const verandaMat = new THREE.MeshStandardMaterial({
      color: 0xdfd3c3, // Whitewashed pine porch openwork
      roughness: 0.7,
      flatShading: true,
    });
    const verandaInstanced = new THREE.InstancedMesh(verandaGeo, verandaMat, villaCount);
    verandaInstanced.castShadow = true;

    // Villa Chimney InstancedMesh (Red Mazovian brick)
    const chimneyGeo = new THREE.BoxGeometry(1.2, 5.0, 1.2);
    chimneyGeo.translate(3.5, 12.5, 0);
    const chimneyMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      roughness: 0.9,
      flatShading: true,
    });
    const chimneyInstanced = new THREE.InstancedMesh(chimneyGeo, chimneyMat, villaCount);
    chimneyInstanced.castShadow = true;

    // Place villas at picturesque locations around the circuit
    const villaLocations = [
      { wpIdx: 4, dist: 28, side: 1, rot: 0.4 },     // Villa near Start / Gurewicz
      { wpIdx: 12, dist: 32, side: -1, rot: -0.8 },  // Forest clearing villa
      { wpIdx: 24, dist: 26, side: 1, rot: 1.2 },    // Villa near Józefów right
      { wpIdx: 36, dist: 30, side: -1, rot: -1.5 },  // Sandy chicane villa
      { wpIdx: 48, dist: 34, side: 1, rot: 0.2 },    // Świder river dune boarding house
      { wpIdx: 60, dist: 28, side: 1, rot: 2.1 },    // Riverbank villa
      { wpIdx: 72, dist: 32, side: -1, rot: -0.4 },  // Otwock pine alley estate
      { wpIdx: 84, dist: 36, side: 1, rot: -1.1 },   // Western chicane villa
      { wpIdx: 96, dist: 28, side: -1, rot: 1.5 },   // Veranda S-bends villa
      { wpIdx: 108, dist: 25, side: 1, rot: -0.6 },  // Final hairpin dacha
      { wpIdx: 18, dist: 48, side: 1, rot: 0.9 },
      { wpIdx: 42, dist: 52, side: -1, rot: -1.0 },
      { wpIdx: 66, dist: 45, side: 1, rot: 1.7 },
      { wpIdx: 78, dist: 50, side: -1, rot: 0.3 },
      { wpIdx: 90, dist: 42, side: 1, rot: -2.0 },
      { wpIdx: 102, dist: 46, side: -1, rot: 0.8 },
      { wpIdx: 114, dist: 40, side: 1, rot: -0.2 },
      { wpIdx: 2, dist: 44, side: -1, rot: 1.4 },
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
    }

    villaBodyInstanced.instanceMatrix.needsUpdate = true;
    roofInstanced.instanceMatrix.needsUpdate = true;
    verandaInstanced.instanceMatrix.needsUpdate = true;
    chimneyInstanced.instanceMatrix.needsUpdate = true;

    envGroup.add(villaBodyInstanced);
    envGroup.add(roofInstanced);
    envGroup.add(verandaInstanced);
    envGroup.add(chimneyInstanced);

    // -------------------------------------------------------------
    // 3. WOODEN FENCES ALONG FOREST ROADS (InstancedMesh)
    // -------------------------------------------------------------
    const fenceCount = 350;
    const fenceGeo = new THREE.BoxGeometry(4.2, 1.0, 0.15);
    fenceGeo.translate(0, 0.5, 0);
    const fenceMat = new THREE.MeshStandardMaterial({
      color: 0x5c4033,
      roughness: 0.9,
      flatShading: true,
    });
    const fenceInstanced = new THREE.InstancedMesh(fenceGeo, fenceMat, fenceCount);
    fenceInstanced.castShadow = true;

    let fenceIdx = 0;
    for (let i = 0; i < wpCount && fenceIdx < fenceCount; i += 2) {
      const wp = waypoints[i];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const side = (i % 4 === 0) ? 1 : -1;
      const dist = wp.width * 0.5 + 2.2;

      const posX = wp.point.x + normal.x * dist * side;
      const posZ = wp.point.z + normal.z * dist * side;
      const posY = wp.point.y;

      dummy.position.set(posX, posY, posZ);
      if (wp.tangent) {
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), wp.tangent);
      }
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      fenceInstanced.setMatrixAt(fenceIdx++, dummy.matrix);
    }

    fenceInstanced.instanceMatrix.needsUpdate = true;
    envGroup.add(fenceInstanced);

    scene.add(envGroup);
    return envGroup;
  }
}
