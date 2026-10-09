import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';

export interface TrackMeshResult {
  trackGroup: THREE.Group;
  roadMesh: THREE.Mesh;
  curbsMesh: THREE.Mesh;
  markingsMesh: THREE.Mesh;
  terrainMesh: THREE.Mesh;
  riverMesh: THREE.Mesh;
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

    // Road Markings (Dashed Centerline, White Edges, Start Grid Boxes, Skid Marks)
    const markVertices: number[] = [];
    const markIndices: number[] = [];
    const markColors: number[] = [];

    // Curbs & Shoulders (3D Raised Red/White Bevels)
    const curbVertices: number[] = [];
    const curbIndices: number[] = [];
    const curbColors: number[] = [];

    // High-visibility, rich arcade color palette
    const asphaltDark = new THREE.Color(0x3a3e49); // Clean slate tarmac
    const asphaltLight = new THREE.Color(0x454b57); // Alternating aggregate tarmac
    const gravelColor = new THREE.Color(0x8a7d6e); // Mazovian gravel
    const sandColor = new THREE.Color(0xdfb17b); // Golden Świder river sand
    const whiteMarking = new THREE.Color(0xffffff);
    const yellowMarking = new THREE.Color(0xfbbf24);
    const redKerb = new THREE.Color(0xef4444);
    const whiteKerb = new THREE.Color(0xf8fafc);
    const rubberMark = new THREE.Color(0x22242a);

    const ROAD_ELEVATION = 0.40; // Firmly elevated above terrain!

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
      const pLeft = pt.clone().addScaledVector(normal, -halfWidth);
      const pRight = pt.clone().addScaledVector(normal, halfWidth);

      // --- 1. Roadbed Geometry ---
      roadVertices.push(pLeft.x, yRoad, pLeft.z);
      roadVertices.push(pRight.x, yRoad, pRight.z);

      roadColors.push(baseColor.r, baseColor.g, baseColor.b);
      roadColors.push(baseColor.r, baseColor.g, baseColor.b);

      roadUvs.push(0, i * 0.25);
      roadUvs.push(1, i * 0.25);

      // --- 2. Road Markings Geometry (Dashed centerline + white edge lines) ---
      const lineThickness = 0.32;
      // Left white continuous line
      const mLeftIn = pt.clone().addScaledVector(normal, -(halfWidth - 0.45));
      const mLeftOut = pt.clone().addScaledVector(normal, -(halfWidth - 0.45 + lineThickness));

      // Right white continuous line
      const mRightIn = pt.clone().addScaledVector(normal, (halfWidth - 0.45 - lineThickness));
      const mRightOut = pt.clone().addScaledVector(normal, (halfWidth - 0.45));

      // Centerline dashes (3 waypoints on, 3 waypoints off)
      const isCenterDash = (i % 6) < 3;
      const mCenterL = pt.clone().addScaledVector(normal, -lineThickness * 0.5);
      const mCenterR = pt.clone().addScaledVector(normal, lineThickness * 0.5);

      const yMark = yRoad + 0.025; // Sits slightly above road surface

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

      // --- 3. 3D Raised Curbs (Corners only!) & Sloped Shoulders ---
      const prevWp = waypoints[(i - 1 + count) % count];
      const nextWp = waypoints[(i + 1) % count];
      let curvature = 0;
      if (prevWp.tangent && nextWp.tangent) {
        curvature = prevWp.tangent.angleTo(nextWp.tangent);
      }
      const isMainStraight = (i <= 8 || i >= 135);
      const isCorner = !isMainStraight && (curvature > 0.05 || wp.surface !== 'asphalt');

      const curbWidth = isCorner ? 1.45 : 1.2;
      const curbHeight = isCorner ? 0.20 : 0.0;
      const isRed = Math.floor(i * 0.7) % 2 === 0;
      const curColor = isCorner ? (isRed ? redKerb : whiteKerb) : gravelColor;

      // Outer kerb points
      const cLeftOuter = pt.clone().addScaledVector(normal, -(halfWidth + curbWidth));
      const cRightOuter = pt.clone().addScaledVector(normal, halfWidth + curbWidth);
      // Shoulder embankment (slopes down to ground)
      const sLeftBase = pt.clone().addScaledVector(normal, -(halfWidth + curbWidth + 1.8));
      const sRightBase = pt.clone().addScaledVector(normal, halfWidth + curbWidth + 1.8);

      // L inner, L top, L base, R inner, R top, R base
      curbVertices.push(pLeft.x, yRoad, pLeft.z);
      curbVertices.push(cLeftOuter.x, yRoad + curbHeight, cLeftOuter.z);
      curbVertices.push(sLeftBase.x, pt.y - 0.05, sLeftBase.z);

      curbVertices.push(pRight.x, yRoad, pRight.z);
      curbVertices.push(cRightOuter.x, yRoad + curbHeight, cRightOuter.z);
      curbVertices.push(sRightBase.x, pt.y - 0.05, sRightBase.z);

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
      roughness: 0.55,
      metalness: 0.15,
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
      roughness: 0.45,
      metalness: 0.1,
      flatShading: true,
    });
    const curbsMesh = new THREE.Mesh(curbGeo, curbMat);
    curbsMesh.castShadow = true;
    curbsMesh.receiveShadow = true;
    trackGroup.add(curbsMesh);

    // --- 4. Carved Terrain Heightfield (Guaranteed below road!) ---
    const terrainGeo = new THREE.PlaneGeometry(1600, 1600, 80, 80);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position;
    const terrainColors: number[] = [];

    const grassCol = new THREE.Color(0x4f703e); // Lush Mazovian pine forest floor
    const grassLightCol = new THREE.Color(0x5d8349); // Meadow highlights
    const riverSandCol = new THREE.Color(0xdfaf78); // Sandy beach

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);

      // Check distance to closest track point
      let minTrackDist = Infinity;
      let closestWpY = 0;
      let closestSurface = 'asphalt';
      for (let k = 0; k < count; k += 2) {
        const d = Math.hypot(vx - waypoints[k].point.x, vz - waypoints[k].point.z);
        if (d < minTrackDist) {
          minTrackDist = d;
          closestWpY = waypoints[k].point.y;
          closestSurface = waypoints[k].surface;
        }
      }

      // Natural rolling hills and riverbanks
      let h = Math.sin(vx * 0.012) * Math.cos(vz * 0.012) * 2.2 +
              Math.sin(vx * 0.024 + vz * 0.018) * 1.1 - 0.2;

      // CARVE TRACK BED: if near track, suppress height below the road!
      if (minTrackDist < 24.0) {
        const blend = minTrackDist / 24.0;
        h = Math.min(h, closestWpY - 0.22) * (1.0 - blend) + h * blend;
      }

      pos.setY(i, h);

      // Rich ground color variation
      let groundC = ((vx + vz) % 15 < 7) ? grassCol : grassLightCol;
      if (closestSurface === 'sand' && minTrackDist < 50.0) {
        groundC = riverSandCol;
      }
      terrainColors.push(groundC.r, groundC.g, groundC.b);
    }
    terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      flatShading: true,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    trackGroup.add(terrainMesh);

    // --- 5. Start/Finish Motorsport Gantry ---
    // Place gantry 38 meters ahead of waypoint 0 along the straight
    const startWp = waypoints[0];
    const gantry = new THREE.Group();
    const gantryPos = startWp.point.clone();
    if (startWp.tangent) {
      gantryPos.addScaledVector(startWp.tangent, 38.0);
      gantry.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startWp.tangent);
    }
    gantry.position.copy(gantryPos);

    // Aluminum lattice truss materials (bright, metallic, reflective)
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0xd8e0ea,
      metalness: 0.85,
      roughness: 0.25,
      flatShading: true,
    });
    const bannerBoardMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
    });
    const bannerRedMat = new THREE.MeshStandardMaterial({
      color: 0xd92b2b,
      roughness: 0.35,
    });

    // Main truss pillars (slender, architectural lattice look)
    const pillarHeight = 10.5;
    const pillarGeo = new THREE.BoxGeometry(0.65, pillarHeight, 0.65);
    const pLeft = new THREE.Mesh(pillarGeo, trussMat);
    pLeft.position.set(-11.5, pillarHeight * 0.5, 0);
    pLeft.castShadow = true;
    gantry.add(pLeft);

    const pRight = new THREE.Mesh(pillarGeo, trussMat);
    pRight.position.set(11.5, pillarHeight * 0.5, 0);
    pRight.castShadow = true;
    gantry.add(pRight);

    // Diagonal truss support struts
    const strutGeo = new THREE.BoxGeometry(0.35, 12.0, 0.35);
    const strutL = new THREE.Mesh(strutGeo, trussMat);
    strutL.position.set(-13.0, 5.0, -2.5);
    strutL.rotation.x = 0.35;
    gantry.add(strutL);

    const strutR = new THREE.Mesh(strutGeo, trussMat);
    strutR.position.set(13.0, 5.0, -2.5);
    strutR.rotation.x = 0.35;
    gantry.add(strutR);

    // Overhead double truss beam
    const beamGeo = new THREE.BoxGeometry(24.5, 0.65, 0.65);
    const topBeam = new THREE.Mesh(beamGeo, trussMat);
    topBeam.position.set(0, 10.0, 0);
    gantry.add(topBeam);

    const midBeam = new THREE.Mesh(beamGeo, trussMat);
    midBeam.position.set(0, 7.8, 0);
    gantry.add(midBeam);

    // Grand "MASOVIAN DRIFT" Sponsor Header
    const bannerBoard = new THREE.Mesh(new THREE.BoxGeometry(19.0, 2.0, 0.3), bannerBoardMat);
    bannerBoard.position.set(0, 8.9, 0);
    gantry.add(bannerBoard);

    const bannerRedStrip = new THREE.Mesh(new THREE.BoxGeometry(18.5, 0.45, 0.34), bannerRedMat);
    bannerRedStrip.position.set(0, 9.6, 0);
    gantry.add(bannerRedStrip);

    // 5-Light Formula 1 Starting Gantry (Red LEDs and Green LEDs)
    for (let k = -2; k <= 2; k++) {
      // Light housing box
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.4, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7 })
      );
      box.position.set(k * 1.8, 6.9, 0.2);
      gantry.add(box);

      // Top Red light
      const redLight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.15, 12),
        new THREE.MeshStandardMaterial({
          color: 0xef4444,
          emissive: 0xdc2626,
          emissiveIntensity: 1.2,
        })
      );
      redLight.rotation.x = Math.PI / 2;
      redLight.position.set(k * 1.8, 7.25, 0.4);
      gantry.add(redLight);

      // Bottom Green light
      const greenLight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.15, 12),
        new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          emissive: 0x16a34a,
          emissiveIntensity: 1.8,
        })
      );
      greenLight.rotation.x = Math.PI / 2;
      greenLight.position.set(k * 1.8, 6.55, 0.4);
      gantry.add(greenLight);
    }

    // Flagpoles on top of gantry (Polish flag & Checkered flag)
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6);
    const poleL = new THREE.Mesh(poleGeo, trussMat);
    poleL.position.set(-11.5, 12.0, 0);
    gantry.add(poleL);

    const flagGeo = new THREE.BoxGeometry(1.8, 1.0, 0.05);
    const flagL = new THREE.Mesh(flagGeo, bannerRedMat);
    flagL.position.set(-10.4, 12.6, 0);
    gantry.add(flagL);

    const poleR = new THREE.Mesh(poleGeo, trussMat);
    poleR.position.set(11.5, 12.0, 0);
    gantry.add(poleR);

    const flagR = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
    flagR.position.set(12.6, 12.6, 0);
    gantry.add(flagR);

    trackGroup.add(gantry);

    // --- 6. Staggered Starting Grid Boxes on Asphalt ---
    const gridMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });
    const gridYellowMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthWrite: false });

    // Checkerboard starting line at Waypoint 0
    const startLineGeo = new THREE.PlaneGeometry(startWp.width - 1.0, 2.5, 14, 2);
    startLineGeo.rotateX(-Math.PI / 2);
    const startLineMesh = new THREE.Mesh(
      startLineGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
    );
    startLineMesh.position.set(startWp.point.x, startWp.point.y + ROAD_ELEVATION + 0.03, startWp.point.z);
    if (startWp.tangent) {
      startLineMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startWp.tangent);
    }
    startLineMesh.renderOrder = 3;
    trackGroup.add(startLineMesh);

    // 6 Grid Boxes (Pole position, P2, P3, P4, P5, P6)
    for (let g = 0; g < 6; g++) {
      const isRight = (g % 2 === 0);
      const distBack = 6.0 + g * 8.5;
      const sideOffset = isRight ? 2.8 : -2.8;

      const norm = startWp.normal ?? new THREE.Vector3(1, 0, 0);
      const gPos = startWp.point.clone()
        .addScaledVector(startWp.tangent ?? new THREE.Vector3(0, 0, 1), -distBack)
        .addScaledVector(norm, sideOffset);

      // Grid box outline
      const boxGeo = new THREE.PlaneGeometry(2.8, 5.0);
      boxGeo.rotateX(-Math.PI / 2);
      const boxMesh = new THREE.Mesh(boxGeo, g === 0 ? gridYellowMat : gridMat);
      boxMesh.position.set(gPos.x, startWp.point.y + ROAD_ELEVATION + 0.028, gPos.z);
      if (startWp.tangent) {
        boxMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startWp.tangent);
      }
      boxMesh.renderOrder = 3;
      trackGroup.add(boxMesh);
    }

    // --- 7. Roadside Verge Marker Posts (Słupki Pikietażowe) ---
    // Iconic white/red reflector marker posts along the track edges
    const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8);
    postGeo.translate(0, 0.55, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const postRedStripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.125, 0.125, 0.28, 8),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 })
    );
    postRedStripe.position.set(0, 0.75, 0);

    const postInstancedL = new THREE.InstancedMesh(postGeo, postMat, Math.floor(count / 2));
    const postInstancedR = new THREE.InstancedMesh(postGeo, postMat, Math.floor(count / 2));
    postInstancedL.castShadow = true;
    postInstancedR.castShadow = true;

    const dummyPost = new THREE.Object3D();
    let postIdx = 0;
    for (let i = 0; i < count; i += 2) {
      const wp = waypoints[i];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const halfW = wp.width * 0.5 + 2.2;

      // Left post
      const pL = wp.point.clone().addScaledVector(norm, -halfW);
      dummyPost.position.set(pL.x, wp.point.y + ROAD_ELEVATION, pL.z);
      dummyPost.updateMatrix();
      postInstancedL.setMatrixAt(postIdx, dummyPost.matrix);

      // Right post
      const pR = wp.point.clone().addScaledVector(norm, halfW);
      dummyPost.position.set(pR.x, wp.point.y + ROAD_ELEVATION, pR.z);
      dummyPost.updateMatrix();
      postInstancedR.setMatrixAt(postIdx, dummyPost.matrix);

      postIdx++;
    }
    postInstancedL.instanceMatrix.needsUpdate = true;
    postInstancedR.instanceMatrix.needsUpdate = true;
    trackGroup.add(postInstancedL);
    trackGroup.add(postInstancedR);

    // --- 8. Metal Armco Barriers & Motorsport Hoardings ---
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.9,
      roughness: 0.25,
      flatShading: true,
    });
    const hoardingMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Vivid racing blue sponsor boards
      roughness: 0.4,
      metalness: 0.1,
    });

    for (let i = 18; i < 55; i += 2) {
      const wp = waypoints[i];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const pos = wp.point.clone().addScaledVector(normal, -(wp.width * 0.5 + 2.2));

      // Guardrail
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, 4.2), barrierMat);
      rail.position.set(pos.x, wp.point.y + ROAD_ELEVATION + 0.45, pos.z);
      if (wp.tangent) {
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
      }
      rail.castShadow = true;
      trackGroup.add(rail);

      // Post
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), barrierMat);
      post.position.set(pos.x, wp.point.y + ROAD_ELEVATION + 0.2, pos.z);
      trackGroup.add(post);

      // Sponsor board on every 4th segment
      if (i % 4 === 0) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 3.8), hoardingMat);
        board.position.set(pos.x, wp.point.y + ROAD_ELEVATION + 0.55, pos.z);
        if (wp.tangent) {
          board.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
        }
        trackGroup.add(board);
      }
    }

    // --- 9. Brake Distance Marker Boards (200m, 100m, 50m before Turn 1) ---
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });
    const boardStripeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
    const brakeMarkers = [
      { wpIdx: 12, distText: '200' },
      { wpIdx: 14, distText: '100' },
      { wpIdx: 16, distText: '50' },
    ];
    for (const bm of brakeMarkers) {
      const wp = waypoints[bm.wpIdx];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const bPos = wp.point.clone().addScaledVector(norm, -(wp.width * 0.5 + 3.2));

      const bMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 2.2), boardMat);
      bMesh.position.set(bPos.x, wp.point.y + ROAD_ELEVATION + 0.9, bPos.z);
      if (wp.tangent) {
        bMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
      }
      bMesh.castShadow = true;
      trackGroup.add(bMesh);

      // Stripe indicator
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 1.8), boardStripeMat);
      stripe.position.set(bPos.x, wp.point.y + ROAD_ELEVATION + 0.9, bPos.z);
      if (wp.tangent) {
        stripe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
      }
      trackGroup.add(stripe);
    }

    // --- 10. Yellow Hay Bales on Chicane Apexes ---
    const hayMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.9, flatShading: true });
    const chicaneWps = [35, 36, 48, 49];
    for (const cIdx of chicaneWps) {
      const wp = waypoints[cIdx];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const hPos = wp.point.clone().addScaledVector(norm, wp.width * 0.5 + 1.2);

      const bale = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), hayMat);
      bale.position.set(hPos.x, wp.point.y + ROAD_ELEVATION + 0.55, hPos.z);
      bale.castShadow = true;
      trackGroup.add(bale);
    }

    // --- 11. Shimmering Świder River Water Body (GPU Gerstner Waves & Fresnel, G6/P2) ---
    const waterGeo = new THREE.PlaneGeometry(380, 280, 64, 64);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeepWater: { value: new THREE.Color(0x022c44) },
        uShallowWater: { value: new THREE.Color(0x06b6d4) },
        uSunColor: { value: new THREE.Color(0xfff7ed) },
        uSunDir: { value: new THREE.Vector3(-0.45, 0.82, -0.36).normalize() },
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vWaveHeight;

        void main() {
          vUv = uv;
          vec3 pos = position;

          // Gerstner wave formulation: 3 overlapping sine/cosine wavefronts
          float t = uTime;
          float w1 = sin(pos.x * 0.05 + t * 2.2) * cos(pos.z * 0.05 + t * 1.8) * 0.22;
          float w2 = sin((pos.x + pos.z) * 0.08 + t * 3.1) * 0.10;
          float w3 = cos(pos.x * 0.12 - t * 1.5 + pos.z * 0.09) * 0.06;
          float totalWave = w1 + w2 + w3;
          pos.y += totalWave;
          vWaveHeight = totalWave;

          // Compute perturbed surface normal from wave derivatives
          float dw_dx = (cos(pos.x * 0.05 + t * 2.2) * 0.05 * cos(pos.z * 0.05 + t * 1.8) * 0.22)
                      + (cos((pos.x + pos.z) * 0.08 + t * 3.1) * 0.08 * 0.10);
          float dw_dz = (-sin(pos.x * 0.05 + t * 2.2) * 0.22 * sin(pos.z * 0.05 + t * 1.8) * 0.05)
                      + (cos((pos.x + pos.z) * 0.08 + t * 3.1) * 0.08 * 0.10);
          vec3 n = normalize(vec3(-dw_dx, 1.0, -dw_dz));
          vNormal = normalize(normalMatrix * n);

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uDeepWater;
        uniform vec3 uShallowWater;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vWaveHeight;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 normal = normalize(vNormal);

          // Fresnel reflectance: Schlick approximation
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.5);
          fresnel = clamp(fresnel * 0.75 + 0.15, 0.0, 1.0);

          // Base depth gradient modulated by wave height
          float depthFactor = clamp((vWaveHeight + 0.3) / 0.6, 0.0, 1.0);
          vec3 waterCol = mix(uDeepWater, uShallowWater, depthFactor * 0.75);

          // Sun specular sparkle (Blinn-Phong)
          vec3 halfVec = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(normal, halfVec), 0.0), 120.0);
          vec3 specular = uSunColor * spec * 1.8;

          // Subtle foam on crests
          float foam = smoothstep(0.18, 0.32, vWaveHeight);
          vec3 foamCol = vec3(0.92, 0.98, 1.0);

          vec3 finalColor = mix(waterCol, uShallowWater * 1.25, fresnel);
          finalColor += specular;
          finalColor = mix(finalColor, foamCol, foam * 0.6);

          gl_FragColor = vec4(finalColor, 0.92);
        }
      `,
      transparent: true,
      depthWrite: true,
    });
    const riverMesh = new THREE.Mesh(waterGeo, waterMat);
    riverMesh.position.set(240, -0.65, -30);
    trackGroup.add(riverMesh);

    // 12. Checkpoints along circuit
    const checkpointStep = Math.floor(count / 14);
    const checkpoints: { position: THREE.Vector3; index: number; radius: number }[] = [];
    for (let i = 0; i < count; i += checkpointStep) {
      checkpoints.push({
        position: waypoints[i].point.clone(),
        index: checkpoints.length,
        radius: waypoints[i].width * 0.9,
      });
    }

    return {
      trackGroup,
      roadMesh,
      curbsMesh,
      markingsMesh,
      terrainMesh,
      riverMesh,
      startFinishGantry: gantry,
      checkpoints,
    };
  }
}
