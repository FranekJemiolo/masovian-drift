import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';

export interface TrackMeshResult {
  trackGroup: THREE.Group;
  roadMesh: THREE.Mesh;
  curbsMesh: THREE.Mesh;
  markingsMesh: THREE.Mesh;
  terrainMesh: THREE.Mesh;
  startFinishGantry: THREE.Group;
  checkpoints: { position: THREE.Vector3; index: number; radius: number }[];
}

export class TrackMeshBuilder {
  public static buildTrack(waypoints: Waypoint[]): TrackMeshResult {
    const trackGroup = new THREE.Group();
    const count = waypoints.length;

    // 1. Raised Roadbed Vertices & Geometry
    const roadVertices: number[] = [];
    const roadIndices: number[] = [];
    const roadColors: number[] = [];
    const roadUvs: number[] = [];

    // Road Markings (Dashed Centerline, White Edges, Start Grid)
    const markVertices: number[] = [];
    const markIndices: number[] = [];
    const markColors: number[] = [];

    // Curbs & Shoulders (3D Raised Red/White Bevels)
    const curbVertices: number[] = [];
    const curbIndices: number[] = [];
    const curbColors: number[] = [];

    const asphaltDark = new THREE.Color(0x222227);
    const asphaltLight = new THREE.Color(0x2b2b32);
    const gravelColor = new THREE.Color(0x605a52);
    const sandColor = new THREE.Color(0xd4a373);
    const whiteMarking = new THREE.Color(0xffffff);
    const yellowMarking = new THREE.Color(0xfacc15);
    const redKerb = new THREE.Color(0xdc2626);
    const whiteKerb = new THREE.Color(0xf1f5f9);

    const ROAD_ELEVATION = 0.35; // Firmly elevated above terrain!

    for (let i = 0; i <= count; i++) {
      const wp = waypoints[i % count];
      const pt = wp.point;
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const halfWidth = wp.width * 0.5;

      // Base surface color
      let baseColor = (i % 2 === 0) ? asphaltDark : asphaltLight;
      if (wp.surface === 'gravel') baseColor = gravelColor;
      if (wp.surface === 'sand') baseColor = sandColor;

      const yRoad = pt.y + ROAD_ELEVATION;

      // 4 Main Road Cross-Section Points:
      // Left Edge, Left Center, Right Center, Right Edge
      const pLeft = pt.clone().addScaledVector(normal, -halfWidth);
      const pRight = pt.clone().addScaledVector(normal, halfWidth);

      // --- 1. Roadbed Geometry ---
      const rIdx = (i * 2);
      roadVertices.push(pLeft.x, yRoad, pLeft.z);
      roadVertices.push(pRight.x, yRoad, pRight.z);

      roadColors.push(baseColor.r, baseColor.g, baseColor.b);
      roadColors.push(baseColor.r, baseColor.g, baseColor.b);

      roadUvs.push(0, i * 0.25);
      roadUvs.push(1, i * 0.25);

      // --- 2. Road Markings Geometry (Dashed centerline + white edge lines) ---
      // Left white line
      const lineThickness = 0.22;
      const mLeftIn = pt.clone().addScaledVector(normal, -(halfWidth - 0.4));
      const mLeftOut = pt.clone().addScaledVector(normal, -(halfWidth - 0.4 + lineThickness));

      // Right white line
      const mRightIn = pt.clone().addScaledVector(normal, (halfWidth - 0.4 - lineThickness));
      const mRightOut = pt.clone().addScaledVector(normal, (halfWidth - 0.4));

      // Centerline dashes (4 waypoints on, 4 waypoints off)
      const isCenterDash = (i % 6) < 3;
      const mCenterL = pt.clone().addScaledVector(normal, -lineThickness * 0.5);
      const mCenterR = pt.clone().addScaledVector(normal, lineThickness * 0.5);

      const yMark = yRoad + 0.02; // Sits slightly above road surface

      const mIdx = (i * 6);
      markVertices.push(mLeftOut.x, yMark, mLeftOut.z);
      markVertices.push(mLeftIn.x, yMark, mLeftIn.z);
      markVertices.push(mRightIn.x, yMark, mRightIn.z);
      markVertices.push(mRightOut.x, yMark, mRightOut.z);
      markVertices.push(mCenterL.x, yMark, mCenterL.z);
      markVertices.push(mCenterR.x, yMark, mCenterR.z);

      const edgeColor = (wp.surface === 'sand') ? yellowMarking : whiteMarking;
      for (let k = 0; k < 4; k++) {
        markColors.push(edgeColor.r, edgeColor.g, edgeColor.b);
      }
      // Centerline color (transparent black if off)
      const cDashCol = isCenterDash ? whiteMarking : new THREE.Color(0, 0, 0);
      markColors.push(cDashCol.r, cDashCol.g, cDashCol.b);
      markColors.push(cDashCol.r, cDashCol.g, cDashCol.b);

      // --- 3. 3D Raised Curbs & Sloped Shoulders ---
      const curbWidth = 1.35;
      const curbHeight = 0.22;
      const isRed = Math.floor(i * 0.6) % 2 === 0;
      const curColor = isRed ? redKerb : whiteKerb;

      // Outer kerb points
      const cLeftOuter = pt.clone().addScaledVector(normal, -(halfWidth + curbWidth));
      const cRightOuter = pt.clone().addScaledVector(normal, halfWidth + curbWidth);
      // Shoulder embankment (slopes down to ground)
      const sLeftBase = pt.clone().addScaledVector(normal, -(halfWidth + curbWidth + 1.2));
      const sRightBase = pt.clone().addScaledVector(normal, halfWidth + curbWidth + 1.2);

      const cIdx = (i * 6);
      // L inner, L top, L base, R inner, R top, R base
      curbVertices.push(pLeft.x, yRoad, pLeft.z);
      curbVertices.push(cLeftOuter.x, yRoad + curbHeight, cLeftOuter.z);
      curbVertices.push(sLeftBase.x, pt.y - 0.1, sLeftBase.z);

      curbVertices.push(pRight.x, yRoad, pRight.z);
      curbVertices.push(cRightOuter.x, yRoad + curbHeight, cRightOuter.z);
      curbVertices.push(sRightBase.x, pt.y - 0.1, sRightBase.z);

      curbColors.push(curColor.r, curColor.g, curColor.b);
      curbColors.push(curColor.r, curColor.g, curColor.b);
      curbColors.push(gravelColor.r, gravelColor.g, gravelColor.b);

      curbColors.push(curColor.r, curColor.g, curColor.b);
      curbColors.push(curColor.r, curColor.g, curColor.b);
      curbColors.push(gravelColor.r, gravelColor.g, gravelColor.b);

      if (i < count) {
        // Road indices
        const r0 = i * 2;
        const r1 = i * 2 + 1;
        const r2 = (i + 1) * 2;
        const r3 = (i + 1) * 2 + 1;
        roadIndices.push(r0, r1, r2);
        roadIndices.push(r1, r3, r2);

        // Markings indices
        const mi0 = i * 6;
        const mi1 = (i + 1) * 6;
        // Left line quad
        markIndices.push(mi0, mi0 + 1, mi1);
        markIndices.push(mi0 + 1, mi1 + 1, mi1);
        // Right line quad
        markIndices.push(mi0 + 2, mi0 + 3, mi1 + 2);
        markIndices.push(mi0 + 3, mi1 + 3, mi1 + 2);
        // Centerline dash quad
        if (isCenterDash) {
          markIndices.push(mi0 + 4, mi0 + 5, mi1 + 4);
          markIndices.push(mi0 + 5, mi1 + 5, mi1 + 4);
        }

        // Curbs indices
        const ci0 = i * 6;
        const ci1 = (i + 1) * 6;
        // Left curb top
        curbIndices.push(ci0, ci1, ci0 + 1);
        curbIndices.push(ci0 + 1, ci1, ci1 + 1);
        // Left curb shoulder
        curbIndices.push(ci0 + 1, ci1 + 1, ci0 + 2);
        curbIndices.push(ci0 + 2, ci1 + 1, ci1 + 2);

        // Right curb top
        curbIndices.push(ci0 + 3, ci0 + 4, ci1 + 3);
        curbIndices.push(ci0 + 4, ci1 + 4, ci1 + 3);
        // Right curb shoulder
        curbIndices.push(ci0 + 4, ci0 + 5, ci1 + 4);
        curbIndices.push(ci0 + 5, ci1 + 5, ci1 + 4);
      }
    }

    // --- Build Road Mesh ---
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
    roadGeo.setAttribute('color', new THREE.Float32BufferAttribute(roadColors, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
      metalness: 0.1,
      flatShading: true,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    trackGroup.add(roadMesh);

    // --- Build Markings Mesh ---
    const markGeo = new THREE.BufferGeometry();
    markGeo.setAttribute('position', new THREE.Float32BufferAttribute(markVertices, 3));
    markGeo.setAttribute('color', new THREE.Float32BufferAttribute(markColors, 3));
    markGeo.setIndex(markIndices);
    markGeo.computeVertexNormals();

    const markMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      depthWrite: false,
    });
    const markingsMesh = new THREE.Mesh(markGeo, markMat);
    markingsMesh.renderOrder = 2;
    trackGroup.add(markingsMesh);

    // --- Build Curbs Mesh ---
    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbVertices, 3));
    curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(curbColors, 3));
    curbGeo.setIndex(curbIndices);
    curbGeo.computeVertexNormals();

    const curbMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.05,
      flatShading: true,
    });
    const curbsMesh = new THREE.Mesh(curbGeo, curbMat);
    curbsMesh.castShadow = true;
    curbsMesh.receiveShadow = true;
    trackGroup.add(curbsMesh);

    // --- 4. Carved Terrain Heightfield (Guaranteed below road!) ---
    const terrainGeo = new THREE.PlaneGeometry(1400, 1400, 70, 70);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);

      // Check distance to closest track point
      let minTrackDist = Infinity;
      let closestWpY = 0;
      for (let k = 0; k < count; k += 3) {
        const d = Math.hypot(vx - waypoints[k].point.x, vz - waypoints[k].point.z);
        if (d < minTrackDist) {
          minTrackDist = d;
          closestWpY = waypoints[k].point.y;
        }
      }

      // Natural dune waves
      let h = Math.sin(vx * 0.012) * Math.cos(vz * 0.012) * 1.6 +
              Math.sin(vx * 0.025 + vz * 0.018) * 0.8 - 0.2;

      // CARVE TRACK BED: if near track, suppress height below the road!
      if (minTrackDist < 20.0) {
        const blend = minTrackDist / 20.0;
        h = Math.min(h, closestWpY - 0.25) * (1.0 - blend) + h * blend;
      }

      pos.setY(i, h);
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x34422e, // Rich Mazovian pine needle ground
      roughness: 0.95,
      flatShading: true,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    trackGroup.add(terrainMesh);

    // --- 5. Start/Finish Gantry & Checkerboard Grid ---
    const startWp = waypoints[0];
    const gantry = new THREE.Group();
    const gantryPos = startWp.point.clone();
    if (startWp.tangent) {
      gantryPos.addScaledVector(startWp.tangent, 18.0);
      gantry.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startWp.tangent);
    }
    gantry.position.copy(gantryPos);

    const metalMat = new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.8, roughness: 0.2 });
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0xd92b2b, roughness: 0.4 });

    // Truss pillars
    const pLeft = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9.5, 0.9), metalMat);
    pLeft.position.set(-11.5, 4.75, 0);
    pLeft.castShadow = true;
    gantry.add(pLeft);

    const pRight = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9.5, 0.9), metalMat);
    pRight.position.set(11.5, 4.75, 0);
    pRight.castShadow = true;
    gantry.add(pRight);

    // Overhead beam & Grand banner
    const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 0.9, 0.9), metalMat);
    beam.position.set(0, 9.0, 0);
    gantry.add(beam);

    const banner = new THREE.Mesh(new THREE.BoxGeometry(18, 2.4, 0.35), bannerMat);
    banner.position.set(0, 7.5, 0);
    gantry.add(banner);

    // Starting lights (5 glowing green/red lights)
    for (let k = -2; k <= 2; k++) {
      const lightMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.38, 0.25, 10),
        new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          emissive: 0x16a34a,
          emissiveIntensity: 1.5,
        })
      );
      lightMesh.rotation.x = Math.PI / 2;
      lightMesh.position.set(k * 1.6, 6.0, 0.2);
      gantry.add(lightMesh);
    }

    // Checkerboard starting line on road
    const checkerGeo = new THREE.PlaneGeometry(startWp.width - 1.0, 2.0, 12, 2);
    checkerGeo.rotateX(-Math.PI / 2);
    const checkerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
    });
    const checkerMesh = new THREE.Mesh(checkerGeo, checkerMat);
    checkerMesh.position.set(0, 0.38, -1.0);
    gantry.add(checkerMesh);

    trackGroup.add(gantry);

    // --- 6. Metal Armco Barriers on Sharp Forest Corners ---
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.9,
      roughness: 0.25,
      flatShading: true,
    });
    for (let i = 20; i < 45; i += 2) {
      const wp = waypoints[i];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const pos = wp.point.clone().addScaledVector(normal, -(wp.width * 0.5 + 1.8));

      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 3.8), barrierMat);
      rail.position.set(pos.x, wp.point.y + ROAD_ELEVATION + 0.45, pos.z);
      if (wp.tangent) {
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
      }
      rail.castShadow = true;
      trackGroup.add(rail);
    }

    // 7. Checkpoints along circuit
    const checkpointStep = Math.floor(count / 12);
    const checkpoints: { position: THREE.Vector3; index: number; radius: number }[] = [];
    for (let i = 0; i < count; i += checkpointStep) {
      checkpoints.push({
        position: waypoints[i].point.clone(),
        index: checkpoints.length,
        radius: waypoints[i].width * 0.85,
      });
    }

    return {
      trackGroup,
      roadMesh,
      curbsMesh,
      markingsMesh,
      terrainMesh,
      startFinishGantry: gantry,
      checkpoints,
    };
  }
}
