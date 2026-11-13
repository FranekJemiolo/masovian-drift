import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';
import { SpatialWaypointGrid } from '../physics/SpatialWaypointGrid';
import { SurfaceNets } from '../voxel/SurfaceNets';
import { TrackGuidance, TrackGuidanceBundle } from './TrackGuidance';

export interface TrackMeshResult {
  trackGroup: THREE.Group;
  roadMesh: THREE.Mesh;
  curbsMesh: THREE.Mesh;
  markingsMesh: THREE.Mesh;
  terrainMesh: THREE.Mesh;
  riverMesh: THREE.Mesh;
  grassMesh?: THREE.InstancedMesh;
  startFinishGantry: THREE.Group;
  checkpoints: { position: THREE.Vector3; index: number; radius: number }[];
  guidance?: TrackGuidanceBundle;
}

export class TrackMeshBuilder {
  public static readonly ROAD_ELEVATION = 0.40; // Firmly elevated above terrain!

  /**
   * Evaluates exact mathematical terrain elevation at (vx, vz) across the 1.6km x 1.6km map
   */
  public static getTerrainHeight(
    vx: number,
    vz: number,
    waypoints?: Waypoint[],
    spatialGrid?: SpatialWaypointGrid
  ): number {
    let minTrackDist = 999.0;
    let closestWpY = 0.0;
    const evalSegs = (wps: Waypoint[], centerIdx: number, radiusSteps: number) => {
      const n = wps.length;
      for (let off = -radiusSteps; off <= radiusSteps; off++) {
        const k = (centerIdx + off + n) % n;
        const a = wps[k].point;
        const b = wps[(k + 1) % n].point;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 1e-4 ? Math.max(0, Math.min(1, ((vx - a.x) * dx + (vz - a.z) * dz) / l2)) : 0;
        const cx = a.x + t * dx;
        const cz = a.z + t * dz;
        const d = Math.hypot(vx - cx, vz - cz);
        if (d < minTrackDist) {
          minTrackDist = d;
          closestWpY = a.y * (1.0 - t) + b.y * t;
        }
      }
    };
    if (spatialGrid) {
      const query = spatialGrid.findClosest(vx, vz, 60.0);
      minTrackDist = query.distance;
      closestWpY = query.waypoint ? query.waypoint.point.y : 0;
      if (waypoints && query.index >= 0) {
        evalSegs(waypoints, query.index, 3);
      }
    } else if (waypoints && waypoints.length > 0) {
      for (let k = 0; k < waypoints.length; k++) {
        const a = waypoints[k].point;
        const b = waypoints[(k + 1) % waypoints.length].point;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 1e-4 ? Math.max(0, Math.min(1, ((vx - a.x) * dx + (vz - a.z) * dz) / l2)) : 0;
        const cx = a.x + t * dx;
        const cz = a.z + t * dz;
        const d = Math.hypot(vx - cx, vz - cz);
        if (d < minTrackDist) {
          minTrackDist = d;
          closestWpY = a.y * (1.0 - t) + b.y * t;
        }
      }
    }

    // 1. Base rolling glacial plain
    let h = Math.sin(vx * 0.012) * Math.cos(vz * 0.012) * 1.8 +
            Math.sin(vx * 0.022 + vz * 0.016) * 0.9;

    // 2. Inland sand dunes (Wydmy Otwockie/Józefowskie) in northern & eastern pine forests
    if (vz > 120.0 || (vx > 60.0 && vz < -160.0)) {
      const duneRidge = (Math.sin(vx * 0.018 + 0.8) * 1.5 + Math.cos(vz * 0.015) * 1.6);
      h += Math.max(0, duneRidge);
    }

    // 3. Serpentine Świder River Valley Trench & Asymmetric Banks
    const riverCenterlineX = 235.0 + Math.sin(vz * 0.016) * 45.0 - (vz + 40.0) * 0.22;
    const distToRiverCenter = Math.abs(vx - riverCenterlineX);
    const inRiverCorridor = Math.abs(vz) < 260.0 && distToRiverCenter < 80.0;

    let isRiverBed = false;
    if (inRiverCorridor) {
      const riverBedWidth = 32.0;
      if (distToRiverCenter < riverBedWidth) {
        const normDist = distToRiverCenter / riverBedWidth;
        const riverH = -1.15 + normDist * normDist * 0.65;
        h = Math.min(h, riverH);
        isRiverBed = true;
      } else if (vx < riverCenterlineX && distToRiverCenter < 70.0) {
        const shoalBlend = (distToRiverCenter - riverBedWidth) / 38.0;
        const shoalH = -0.50 + shoalBlend * 0.65;
        h = Math.min(h, shoalH);
      } else if (vx >= riverCenterlineX && distToRiverCenter < 65.0) {
        const cutbankBlend = (distToRiverCenter - riverBedWidth) / 33.0;
        h = Math.max(h, 0.4 + cutbankBlend * 2.2);
      }
    }

    // SMOOTH TRACK EMBANKMENT & BED: near road, both raise low terrain and carve high dunes
    // so terrain always meets the road shoulder cleanly below curbs with zero cliff drop-offs or polygon pokethrough!
    if (minTrackDist < 54.0) {
      const targetBedY = closestWpY + TrackMeshBuilder.ROAD_ELEVATION - 0.16;
      if (minTrackDist <= 22.0) {
        h = targetBedY;
      } else {
        const t = (minTrackDist - 22.0) / 32.0;
        const smoothBlend = t * t * (3.0 - 2.0 * t);
        h = targetBedY * (1.0 - smoothBlend) + h * smoothBlend;
      }
    }

    if (!isRiverBed && h < -0.35) {
      h = -0.35;
    }

    return h;
  }

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
    const asphaltDark = new THREE.Color(0x333742); // Clean slate aggregate tarmac
    const asphaltLight = new THREE.Color(0x3e4450); // Alternating aggregate tarmac
    const gravelColor = new THREE.Color(0x8a7d6e); // Mazovian gravel
    const sandColor = new THREE.Color(0xdfb17b); // Golden Świder river sand
    const whiteMarking = new THREE.Color(0xffffff);
    const yellowMarking = new THREE.Color(0xfbbf24);
    const redKerb = new THREE.Color(0xef4444);
    const whiteKerb = new THREE.Color(0xffffff);

    const ROAD_ELEVATION = TrackMeshBuilder.ROAD_ELEVATION;

    interface CurbNode {
      pL: THREE.Vector3;
      cLO: THREE.Vector3;
      sLB: THREE.Vector3;
      pR: THREE.Vector3;
      cRO: THREE.Vector3;
      sRB: THREE.Vector3;
      yL: number;
      ycL: number;
      yR: number;
      ycR: number;
      yBase: number;
      isCorner: boolean;
    }
    const curbNodes: CurbNode[] = [];

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
      // Keep cross-slope flush with unbanked physics segment floors so wheels & curbs always match terrain and physics!
      const yLeft = yRoad;
      const yRight = yRoad;

      const prevWp = waypoints[(i - 1 + count) % count];
      const nextWp = waypoints[(i + 1) % count];
      let curvature = 0;
      if (prevWp.tangent && nextWp.tangent) {
        curvature = prevWp.tangent.angleTo(nextWp.tangent);
      }
      const isMainStraight = (i <= 8 || i >= 135);
      const isCorner = !isMainStraight && (curvature > 0.035 || wp.surface !== 'asphalt');

      // Authentic Mazovian worn road surface with gentle 0.6% drainage crown (~4cm center arch):
      const crown = halfWidth * 0.006;
      const oxidizedCenter = (wp.surface === 'asphalt') ? new THREE.Color(0x4b5563) : baseColor;
      const racingLineColor = (wp.surface === 'asphalt' && isCorner)
        ? new THREE.Color(0x1f2937) // #1F2937 Darkened rubberized patch layers through corner entries & exits
        : ((wp.surface === 'asphalt') ? new THREE.Color(0x2d3440) : baseColor);
      const vergeColorL = (wp.surface === 'asphalt') ? new THREE.Color(0x52525b) : baseColor;
      const vergeColorR = (wp.surface === 'asphalt') ? new THREE.Color(0x52525b) : baseColor;

      const pVergeL = pt.clone().addScaledVector(normal, -halfWidth);
      const pVergeR = pt.clone().addScaledVector(normal, halfWidth);
      const pLeft = pt.clone().addScaledVector(normal, -(halfWidth * 0.86));
      const pRight = pt.clone().addScaledVector(normal, halfWidth * 0.86);
      const pRaceL = pt.clone().addScaledVector(normal, -halfWidth * 0.45);
      const pRaceR = pt.clone().addScaledVector(normal, halfWidth * 0.45);

      const yRaceL = yRoad + crown * 0.65;
      const yRaceR = yRoad + crown * 0.65;
      const yCenter = yRoad + crown;

      // 7 Roadbed cross-section vertices (terminating cleanly at +-halfWidth where curbsMesh begins, zero overlap!)
      const slicePts = [
        { p: pVergeL, y: yLeft, c: vergeColorL, u: 0.0 },
        { p: pLeft, y: yLeft + crown * 0.2, c: baseColor, u: 0.1 },
        { p: pRaceL, y: yRaceL, c: racingLineColor, u: 0.3 },
        { p: pt, y: yCenter, c: oxidizedCenter, u: 0.5 },
        { p: pRaceR, y: yRaceR, c: racingLineColor, u: 0.7 },
        { p: pRight, y: yRight + crown * 0.2, c: baseColor, u: 0.9 },
        { p: pVergeR, y: yRight, c: vergeColorR, u: 1.0 },
      ];

      for (const sp of slicePts) {
        roadVertices.push(sp.p.x, sp.y, sp.p.z);
        roadColors.push(sp.c.r, sp.c.g, sp.c.b);
        roadUvs.push(sp.u, i * 0.25);
      }

      // --- 2. Road Markings Geometry (Dashed centerline + white edge lines) ---
      const lineThickness = 0.38;
      // Left white continuous line (symmetric with right edge marking, +Y up winding)
      const mLeftOut = pt.clone().addScaledVector(normal, -(halfWidth - 0.45));
      const mLeftIn = pt.clone().addScaledVector(normal, -(halfWidth - 0.45 - lineThickness));

      // Right white continuous line
      const mRightIn = pt.clone().addScaledVector(normal, (halfWidth - 0.45 - lineThickness));
      const mRightOut = pt.clone().addScaledVector(normal, (halfWidth - 0.45));

      // Centerline dashes (3 waypoints on, 3 waypoints off)
      const isCenterDash = (i % 6) < 3;
      const mCenterL = pt.clone().addScaledVector(normal, -lineThickness * 0.5);
      const mCenterR = pt.clone().addScaledVector(normal, lineThickness * 0.5);

      const yMarkLeft = yLeft + 0.035;
      const yMarkRight = yRight + 0.035;
      const yMarkCenter = yCenter + 0.035;

      markVertices.push(mLeftOut.x, yMarkLeft, mLeftOut.z);
      markVertices.push(mLeftIn.x, yMarkLeft, mLeftIn.z);
      markVertices.push(mRightIn.x, yMarkRight, mRightIn.z);
      markVertices.push(mRightOut.x, yMarkRight, mRightOut.z);
      markVertices.push(mCenterL.x, yMarkCenter, mCenterL.z);
      markVertices.push(mCenterR.x, yMarkCenter, mCenterR.z);

      const edgeColor = (wp.surface === 'sand') ? yellowMarking : whiteMarking;
      for (let k = 0; k < 4; k++) {
        markColors.push(edgeColor.r, edgeColor.g, edgeColor.b);
      }
      markColors.push(whiteMarking.r, whiteMarking.g, whiteMarking.b);
      markColors.push(whiteMarking.r, whiteMarking.g, whiteMarking.b);

      // --- 3. 3D Raised Curbs Cross-Section Nodes (0.08m height) ---
      const curbWidth = isCorner ? 1.35 : 1.1;
      const curbHeight = isCorner ? 0.08 : 0.0; // 0.08m raised 3D apex kerb

      // Outer kerb points
      const cLeftOuter = pt.clone().addScaledVector(normal, -(halfWidth + curbWidth));
      const cRightOuter = pt.clone().addScaledVector(normal, halfWidth + curbWidth);
      // Shoulder embankment (slopes down to ground)
      const sLeftBase = pt.clone().addScaledVector(normal, -(halfWidth + curbWidth + 1.8));
      const sRightBase = pt.clone().addScaledVector(normal, halfWidth + curbWidth + 1.8);

      const yCurbLeft = yLeft + curbHeight;
      const yCurbRight = yRight + curbHeight;

      curbNodes.push({
        pL: pVergeL,
        cLO: cLeftOuter,
        sLB: sLeftBase,
        pR: pVergeR,
        cRO: cRightOuter,
        sRB: sRightBase,
        yL: yLeft,
        ycL: yCurbLeft,
        yR: yRight,
        ycR: yCurbRight,
        yBase: yRoad - 0.22,
        isCorner,
      });

      if (i < count) {
        // Road indices: 6 quads between 7 vertices of slice i and slice i+1
        for (let q = 0; q < 6; q++) {
          const v0 = i * 7 + q;
          const v1 = i * 7 + q + 1;
          const v2 = (i + 1) * 7 + q;
          const v3 = (i + 1) * 7 + q + 1;
          roadIndices.push(v0, v1, v2);
          roadIndices.push(v1, v3, v2);
        }

        // Markings indices
        const mi0 = i * 6;
        const mi1 = (i + 1) * 6;
        // Left line quad
        markIndices.push(mi0, mi0 + 1, mi1);
        markIndices.push(mi0 + 1, mi1 + 1, mi1);
        // Right line quad
        markIndices.push(mi0 + 2, mi0 + 3, mi1 + 2);
        markIndices.push(mi0 + 3, mi1 + 3, mi1 + 2);
        // Centerline dash quad (connect only between active dash waypoints)
        if (isCenterDash && ((i + 1) % 6) < 3) {
          markIndices.push(mi0 + 4, mi0 + 5, mi1 + 4);
          markIndices.push(mi0 + 5, mi1 + 5, mi1 + 4);
        }
      }
    }

    // --- Build Crisp Curbs Quads (0.08m raised 3D apex kerbs with red/white serrations) ---
    for (let i = 0; i < count; i++) {
      const n0 = curbNodes[i];
      const n1 = curbNodes[i + 1];
      const segCorner = n0.isCorner || n1.isCorner;
      const isRed = (i % 2 === 0);
      const curColor = segCorner ? (isRed ? redKerb : whiteKerb) : gravelColor;

      const pushQuad = (
        v0: THREE.Vector3, y0: number, c0: THREE.Color,
        v1: THREE.Vector3, y1: number, c1: THREE.Color,
        v2: THREE.Vector3, y2: number, c2: THREE.Color,
        v3: THREE.Vector3, y3: number, c3: THREE.Color
      ) => {
        const base = curbVertices.length / 3;
        curbVertices.push(v0.x, y0, v0.z, v1.x, y1, v1.z, v2.x, y2, v2.z, v3.x, y3, v3.z);
        curbColors.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b, c3.r, c3.g, c3.b);
        curbIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      };

      // Left curb top
      pushQuad(
        n0.pL, n0.yL, curColor,
        n0.cLO, n0.ycL, curColor,
        n1.pL, n1.yL, curColor,
        n1.cLO, n1.ycL, curColor
      );
      // Left shoulder (natural earth/gravel runoff)
      pushQuad(
        n0.cLO, n0.ycL, gravelColor,
        n0.sLB, n0.yBase, gravelColor,
        n1.cLO, n1.ycL, gravelColor,
        n1.sLB, n1.yBase, gravelColor
      );
      // Right curb top
      pushQuad(
        n0.cRO, n0.ycR, curColor,
        n0.pR, n0.yR, curColor,
        n1.cRO, n1.ycR, curColor,
        n1.pR, n1.yR, curColor
      );
      // Right shoulder (natural earth/gravel runoff)
      pushQuad(
        n0.sRB, n0.yBase, gravelColor,
        n0.cRO, n0.ycR, gravelColor,
        n1.sRB, n1.yBase, gravelColor,
        n1.cRO, n1.ycR, gravelColor
      );
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
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
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

    // --- 4. Carved Terrain Heightfield (Guaranteed below road & smoothly banked!) ---
    const terrainGeo = new THREE.PlaneGeometry(1600, 1600, 160, 160);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position;
    const terrainColors: number[] = [];

    const grassCol = new THREE.Color(0x4f703e); // Lush Mazovian pine forest floor
    const grassLightCol = new THREE.Color(0x5d8349); // Meadow highlights
    const pineNeedleCol = new THREE.Color(0x2f4325); // Deep Scots pine understory
    const riverSandCol = new THREE.Color(0xdfaf78); // Golden Świder river sand
    const riverDampSandCol = new THREE.Color(0xb0824b); // Moist shoreline sand
    const duneSandCol = new THREE.Color(0xe5d09f); // Inland parabolic dune sand

    const spatialGrid = new SpatialWaypointGrid(waypoints, 50.0);

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);

      // Check distance to closest track point via O(1) spatial grid (P6)
      const query = spatialGrid.findClosest(vx, vz, 60.0);
      const minTrackDist = query.distance;
      const closestWpY = query.waypoint ? query.waypoint.point.y : 0;
      const closestSurface = query.waypoint ? query.waypoint.surface : 'asphalt';

      // Authentic Masovian Topography via getTerrainHeight
      const h = TrackMeshBuilder.getTerrainHeight(vx, vz, waypoints, spatialGrid);
      pos.setY(i, h);

      // Check features for coloration
      const riverCenterlineX = 235.0 + Math.sin(vz * 0.016) * 45.0 - (vz + 40.0) * 0.22;
      const distToRiverCenter = Math.abs(vx - riverCenterlineX);
      const inRiverCorridor = Math.abs(vz) < 260.0 && distToRiverCenter < 80.0;
      const isRiverBed = inRiverCorridor && distToRiverCenter < 32.0;
      const isSandyShoal = inRiverCorridor && !isRiverBed && vx < riverCenterlineX && distToRiverCenter < 70.0;
      const isCutbank = inRiverCorridor && !isRiverBed && vx >= riverCenterlineX && distToRiverCenter < 65.0;

      // Authentic regional terrain coloration
      let groundC = ((vx + vz) % 18 < 9) ? pineNeedleCol : grassCol;
      if (closestSurface === 'sand' && minTrackDist < 55.0) {
        groundC = riverSandCol;
      } else if (isRiverBed) {
        groundC = riverDampSandCol;
      } else if (isSandyShoal) {
        groundC = ((vx + vz) % 6 < 3) ? riverSandCol : duneSandCol;
      } else if (isCutbank || (h > 2.8 && minTrackDist > 40.0)) {
        groundC = duneSandCol;
      } else if (h > 1.2) {
        groundC = grassLightCol;
      }

      terrainColors.push(groundC.r, groundC.g, groundC.b);
    }
    terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
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
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const gridYellowMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    // Checkerboard starting line at Waypoint 0
    const startLineGeo = new THREE.PlaneGeometry(startWp.width - 1.0, 2.5, 14, 2);
    startLineGeo.rotateX(-Math.PI / 2);
    const startLineMesh = new THREE.Mesh(
      startLineGeo,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.3,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    );
    startLineMesh.position.set(startWp.point.x, startWp.point.y + ROAD_ELEVATION + 0.06, startWp.point.z);
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

      // Grid box outline in crisp painted white
      const boxGeo = new THREE.PlaneGeometry(2.8, 5.0);
      boxGeo.rotateX(-Math.PI / 2);
      const boxMesh = new THREE.Mesh(boxGeo, gridMat);
      boxMesh.position.set(gPos.x, startWp.point.y + ROAD_ELEVATION + 0.06, gPos.z);
      if (startWp.tangent) {
        boxMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startWp.tangent);
      }
      boxMesh.renderOrder = 3;
      trackGroup.add(boxMesh);

      // Pre-baked rubber launch skid marks
      const skidGeo = new THREE.PlaneGeometry(0.32, 4.2);
      skidGeo.rotateX(-Math.PI / 2);
      const skidMat = new THREE.MeshBasicMaterial({
        color: 0x111827,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      for (const skidSide of [-0.75, 0.75]) {
        const skidMesh = new THREE.Mesh(skidGeo, skidMat);
        skidMesh.position.set(
          gPos.x + norm.x * skidSide,
          startWp.point.y + ROAD_ELEVATION + 0.063,
          gPos.z + norm.z * skidSide
        );
        if (startWp.tangent) {
          skidMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startWp.tangent);
        }
        skidMesh.renderOrder = 4;
        trackGroup.add(skidMesh);
      }
    }

    // --- 7. Roadside Verge Marker Posts (Słupki Pikietażowe) ---
    // Iconic white/red reflector marker posts along the track edges
    const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8);
    postGeo.translate(0, 0.55, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const postRedGeo = new THREE.CylinderGeometry(0.126, 0.126, 0.26, 8);
    postRedGeo.translate(0, 0.78, 0);
    const postRedMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.35,
      roughness: 0.25,
    });

    const postCount = Math.floor(count / 2);
    const postInstancedL = new THREE.InstancedMesh(postGeo, postMat, postCount);
    const postInstancedR = new THREE.InstancedMesh(postGeo, postMat, postCount);
    const postRedInstancedL = new THREE.InstancedMesh(postRedGeo, postRedMat, postCount);
    const postRedInstancedR = new THREE.InstancedMesh(postRedGeo, postRedMat, postCount);
    postInstancedL.castShadow = true;
    postInstancedR.castShadow = true;

    const dummyPost = new THREE.Object3D();
    let postIdx = 0;
    for (let i = 0; i < count && postIdx < postCount; i += 2) {
      const wp = waypoints[i];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const halfW = wp.width * 0.5 + 2.8;

      // Left post anchored cleanly into verge terrain
      const pL = wp.point.clone().addScaledVector(norm, -halfW);
      const hPostL = TrackMeshBuilder.getTerrainHeight(pL.x, pL.z, waypoints, spatialGrid) - 0.04;
      dummyPost.position.set(pL.x, hPostL, pL.z);
      dummyPost.updateMatrix();
      postInstancedL.setMatrixAt(postIdx, dummyPost.matrix);
      postRedInstancedL.setMatrixAt(postIdx, dummyPost.matrix);

      // Right post anchored cleanly into verge terrain
      const pR = wp.point.clone().addScaledVector(norm, halfW);
      const hPostR = TrackMeshBuilder.getTerrainHeight(pR.x, pR.z, waypoints, spatialGrid) - 0.04;
      dummyPost.position.set(pR.x, hPostR, pR.z);
      dummyPost.updateMatrix();
      postInstancedR.setMatrixAt(postIdx, dummyPost.matrix);
      postRedInstancedR.setMatrixAt(postIdx, dummyPost.matrix);

      postIdx++;
    }
    postInstancedL.count = postIdx;
    postInstancedR.count = postIdx;
    postRedInstancedL.count = postIdx;
    postRedInstancedR.count = postIdx;
    postInstancedL.instanceMatrix.needsUpdate = true;
    postInstancedR.instanceMatrix.needsUpdate = true;
    postRedInstancedL.instanceMatrix.needsUpdate = true;
    postRedInstancedR.instanceMatrix.needsUpdate = true;
    trackGroup.add(postInstancedL);
    trackGroup.add(postInstancedR);
    trackGroup.add(postRedInstancedL);
    trackGroup.add(postRedInstancedR);

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
      const pos = wp.point.clone().addScaledVector(normal, -(wp.width * 0.5 + 6.5));

      // Guardrail
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, 4.2), barrierMat);
      rail.position.set(pos.x, wp.point.y + ROAD_ELEVATION + 0.45, pos.z);
      if (wp.tangent) {
        const yaw = Math.atan2(wp.tangent.x, wp.tangent.z);
        rail.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      }
      rail.castShadow = true;
      rail.receiveShadow = true;
      trackGroup.add(rail);

      // Post
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), barrierMat);
      post.position.set(pos.x, wp.point.y + ROAD_ELEVATION + 0.2, pos.z);
      post.receiveShadow = true;
      trackGroup.add(post);

      // Sponsor board on every 4th segment
      if (i % 4 === 0) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 3.8), hoardingMat);
        board.position.set(pos.x, wp.point.y + ROAD_ELEVATION + 0.55, pos.z);
        if (wp.tangent) {
          const yaw = Math.atan2(wp.tangent.x, wp.tangent.z);
          board.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        }
        board.castShadow = true;
        board.receiveShadow = true;
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
      const bPos = wp.point.clone().addScaledVector(norm, -(wp.width * 0.5 + 4.8));
      const bGroundY = TrackMeshBuilder.getTerrainHeight(bPos.x, bPos.z, waypoints, spatialGrid);
      const bBoardCenterY = wp.point.y + ROAD_ELEVATION + 0.9;
      const bBoardBottomY = bBoardCenterY - 0.7;
      const yaw = wp.tangent ? Math.atan2(wp.tangent.x, wp.tangent.z) : 0;
      const legMat = barrierMat;
      const legHeight = Math.max(0.4, bBoardBottomY - (bGroundY - 0.1));

      for (const legZ of [-0.75, 0.75]) {
        const legGeo = new THREE.CylinderGeometry(0.05, 0.05, legHeight, 6);
        const legMesh = new THREE.Mesh(legGeo, legMat);
        const offsetX = Math.sin(yaw) * legZ;
        const offsetZ = Math.cos(yaw) * legZ;
        legMesh.position.set(bPos.x + offsetX, (bGroundY - 0.1) + legHeight * 0.5, bPos.z + offsetZ);
        legMesh.castShadow = true;
        trackGroup.add(legMesh);
      }

      const bMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 2.2), boardMat);
      bMesh.position.set(bPos.x, bBoardCenterY, bPos.z);
      if (wp.tangent) {
        bMesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      }
      bMesh.castShadow = true;
      bMesh.receiveShadow = true;
      trackGroup.add(bMesh);

      // Stripe indicator
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 1.8), boardStripeMat);
      stripe.position.set(bPos.x, bBoardCenterY, bPos.z);
      if (wp.tangent) {
        stripe.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      }
      trackGroup.add(stripe);
    }

    // --- 10. Yellow Hay Bales on Chicane Apexes ---
    const hayMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.9, flatShading: true });
    const chicaneWps = [35, 36, 48, 49];
    for (const cIdx of chicaneWps) {
      const wp = waypoints[cIdx];
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const hPos = wp.point.clone().addScaledVector(norm, wp.width * 0.5 + 5.8);
      const hayGroundY = TrackMeshBuilder.getTerrainHeight(hPos.x, hPos.z, waypoints, spatialGrid);

      const bale = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), hayMat);
      bale.position.set(hPos.x, hayGroundY + 0.52, hPos.z);
      bale.castShadow = true;
      bale.receiveShadow = true;
      trackGroup.add(bale);
    }

    // --- 11. Shimmering Świder River Water Body (GPU Gerstner Waves & Fresnel, G6/P2) ---
    const waterGeo = new THREE.PlaneGeometry(160, 520, 32, 64);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeepWater: { value: new THREE.Color(0x162c24) }, // Rich peaty Masovian river depth
        uShallowWater: { value: new THREE.Color(0x2d5c4b) }, // Shimmering golden-green river shallows
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
    riverMesh.position.set(235, -0.76, 0);
    trackGroup.add(riverMesh);

    // --- 11b. Volumetric Surface Nets Sandy Shoals & Riverbank Dunes ---
    const snMin = new THREE.Vector3(215, -1.6, -160);
    const snMax = new THREE.Vector3(295, 1.4, 160);
    const snField = SurfaceNets.generateMasovianTerrainField(24, 10, 32, snMin, snMax);
    const snGeo = SurfaceNets.extractIsosurface(snField, 24, 10, 32, snMin, snMax, 0.0);
    const snMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: false,
    });
    const snShoalMesh = new THREE.Mesh(snGeo, snMat);
    snShoalMesh.position.set(0, -0.45, 0);
    snShoalMesh.receiveShadow = true;
    trackGroup.add(snShoalMesh);

    // 12. Wind-Animated Shoulder Grass InstancedMesh (G5 - Tapered Natural Blades)
    const grassPositions: number[] = [];
    const grassUvs: number[] = [];
    const grassIndices: number[] = [];
    // Build 3 intersected tapered blades per tuft (star configuration, zero rectangular cardboard cutouts!)
    const bladeAngles = [0, Math.PI / 3, (2 * Math.PI) / 3];
    for (let b = 0; b < bladeAngles.length; b++) {
      const ang = bladeAngles[b];
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const halfBaseW = 0.11;
      const tipH = 0.68 + (b % 2) * 0.12;
      const lean = 0.08 * (b === 1 ? -1 : 1);

      const vIdx = grassPositions.length / 3;
      // Base Left, Base Right, Mid Left, Mid Right, Sharp Tip
      grassPositions.push(
        -halfBaseW * cosA, 0.0, -halfBaseW * sinA,
        halfBaseW * cosA, 0.0, halfBaseW * sinA,
        -halfBaseW * 0.45 * cosA + lean * 0.35 * sinA, tipH * 0.52, -halfBaseW * 0.45 * sinA - lean * 0.35 * cosA,
        halfBaseW * 0.45 * cosA + lean * 0.35 * sinA, tipH * 0.52, halfBaseW * 0.45 * sinA - lean * 0.35 * cosA,
        lean * sinA, tipH, -lean * cosA
      );
      grassUvs.push(
        0.0, 0.0,
        1.0, 0.0,
        0.15, 0.52,
        0.85, 0.52,
        0.5, 1.0
      );
      grassIndices.push(
        vIdx + 0, vIdx + 1, vIdx + 2,
        vIdx + 1, vIdx + 3, vIdx + 2,
        vIdx + 2, vIdx + 3, vIdx + 4
      );
    }

    const grassGeom = new THREE.BufferGeometry();
    grassGeom.setAttribute('position', new THREE.Float32BufferAttribute(grassPositions, 3));
    grassGeom.setAttribute('uv', new THREE.Float32BufferAttribute(grassUvs, 2));
    grassGeom.setIndex(grassIndices);
    grassGeom.computeVertexNormals();

    const grassMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uBaseColor: { value: new THREE.Color(0x274e22) },
        uTipColor: { value: new THREE.Color(0x84b34b) },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vNormal;

        void main() {
          vUv = uv;
          vNormal = normalMatrix * normal;

          vec4 instPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float heightFactor = clamp(position.y / 0.80, 0.0, 1.0);

          // Organic wind flutter based on world coordinates & time
          float sway = sin(uTime * 3.2 + instPos.x * 0.18 + instPos.z * 0.15) *
                       cos(uTime * 1.9 + instPos.z * 0.12);

          vec3 displaced = position;
          displaced.x += sway * 0.22 * heightFactor;
          displaced.z += sway * 0.18 * heightFactor;

          vec4 worldPos = modelMatrix * instanceMatrix * vec4(displaced, 1.0);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uBaseColor;
        uniform vec3 uTipColor;
        varying vec2 vUv;
        varying vec3 vNormal;

        void main() {
          vec3 col = mix(uBaseColor, uTipColor, vUv.y);
          float light = clamp(abs(dot(normalize(vNormal), vec3(0.4, 0.8, 0.4))), 0.65, 1.0);
          gl_FragColor = vec4(col * light, 1.0);
        }
      `,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    const totalGrassInstances = 1400;
    const grassMesh = new THREE.InstancedMesh(grassGeom, grassMat, totalGrassInstances);
    grassMesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let grassIdx = 0;
    for (let i = 0; i < count && grassIdx < totalGrassInstances; i++) {
      const wp = waypoints[i];
      if (wp.surface === 'sand') continue; // Keep Świder sandy river bends open and clean
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const tang = wp.tangent ?? new THREE.Vector3(0, 0, 1);
      const halfW = wp.width * 0.5;

      // Populate 5 tufts on left verge and 5 tufts on right verge outside curbs & gravel shoulders
      for (let t = 0; t < 5; t++) {
        const seed = i * 5 + t;
        const hash1 = Math.abs(Math.sin(seed * 12.9898)) % 1;
        const hash2 = Math.abs(Math.cos(seed * 78.233)) % 1;
        const hash3 = Math.abs(Math.sin(seed * 43.123)) % 1;
        const alongOffset = (t - 2) * 1.65;

        // Left verge instance (strictly outside 1.35m curb + 1.8m shoulder)
        if (grassIdx < totalGrassInstances) {
          const distL = halfW + 3.3 + hash1 * 4.8;
          const posX = wp.point.x - norm.x * distL + tang.x * alongOffset;
          const posZ = wp.point.z - norm.z * distL + tang.z * alongOffset;
          const hL = TrackMeshBuilder.getTerrainHeight(posX, posZ, waypoints, spatialGrid);
          const scale = 0.72 + hash2 * 0.58;
          dummy.position.set(posX, hL - 0.02, posZ);
          dummy.rotation.set(0, hash3 * Math.PI * 2, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          grassMesh.setMatrixAt(grassIdx++, dummy.matrix);
        }

        // Right verge instance (strictly outside 1.35m curb + 1.8m shoulder)
        if (grassIdx < totalGrassInstances) {
          const distR = halfW + 3.3 + hash2 * 4.8;
          const posX = wp.point.x + norm.x * distR + tang.x * alongOffset;
          const posZ = wp.point.z + norm.z * distR + tang.z * alongOffset;
          const hR = TrackMeshBuilder.getTerrainHeight(posX, posZ, waypoints, spatialGrid);
          const scale = 0.72 + hash1 * 0.58;
          dummy.position.set(posX, hR - 0.02, posZ);
          dummy.rotation.set(0, hash1 * Math.PI * 2, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          grassMesh.setMatrixAt(grassIdx++, dummy.matrix);
        }
      }
    }
    grassMesh.count = grassIdx;
    grassMesh.instanceMatrix.needsUpdate = true;
    trackGroup.add(grassMesh);

    // 13. Checkpoints along circuit
    const checkpointStep = Math.floor(count / 14);
    const checkpoints: { position: THREE.Vector3; index: number; radius: number }[] = [];
    for (let i = 0; i < count; i += checkpointStep) {
      checkpoints.push({
        position: waypoints[i].point.clone().add(new THREE.Vector3(0, TrackMeshBuilder.ROAD_ELEVATION, 0)),
        index: checkpoints.length,
        radius: Math.max(26.0, waypoints[i].width * 2.0),
      });
    }

    // 14. CMR Corner Chevron Boards + NFS Holographic Corner Walls + Dynamic Racing Line
    const guidance = TrackGuidance.build(
      waypoints,
      ROAD_ELEVATION,
      (x, z) => TrackMeshBuilder.getTerrainHeight(x, z, waypoints, spatialGrid)
    );
    trackGroup.add(guidance.group);

    return {
      trackGroup,
      roadMesh,
      curbsMesh,
      markingsMesh,
      terrainMesh,
      riverMesh,
      grassMesh,
      startFinishGantry: gantry,
      checkpoints,
      guidance,
    };
  }
}
