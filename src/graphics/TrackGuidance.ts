import * as THREE from 'three';
import { Waypoint } from '../physics/TrackWaypoints';
import { TrackProjection, TrackRacingProfile } from '../ai/TrackRacingProfile';

export function createTrackProjection(): TrackProjection {
  return {
    idx: 0,
    closestIdx: -1,
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
}

export type PacenoteDirection = 'LEFT' | 'RIGHT' | 'STRAIGHT';

export interface UpcomingPacenote {
  direction: PacenoteDirection;
  grade: number; // 1 (Hairpin) .. 6 (Long Flat), 0 = Straight
  label: string;
  distanceM: number;
  minRadiusM: number;
  brakeNow: boolean;
  surfaceWarning: 'GRAVEL' | 'SAND' | null;
  entryArcS: number;
  apexArcS: number;
  entryIdx: number;
  apexIdx: number;
}

export interface TrackGuidanceBundle {
  group: THREE.Group;
  chevronBoardsMesh: THREE.Group;
  cornerWallsMesh: THREE.Mesh;
  racingLineMesh: THREE.Mesh;
  chevronBoardsCount: number;
  isGuideEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  update: (timeSec: number, carS: number, carSpeedMs: number) => void;
}

function surfaceGrip(surface: Waypoint['surface']): number {
  if (surface === 'sand') return 0.65;
  if (surface === 'gravel') return 0.76;
  return 0.92;
}

function gradeFromRadius(radiusM: number): { grade: number; label: string } {
  if (radiusM < 28) return { grade: 1, label: 'HAIRPIN' };
  if (radiusM < 40) return { grade: 2, label: 'SHARP' };
  if (radiusM < 56) return { grade: 3, label: 'MEDIUM' };
  if (radiusM < 82) return { grade: 4, label: 'FAST' };
  if (radiusM < 112) return { grade: 5, label: 'KINK' };
  return { grade: 6, label: 'LONG' };
}

function createArcSample() {
  return {
    x: 0,
    y: 0,
    z: 0,
    normX: 1,
    normZ: 0,
    tangX: 0,
    tangZ: 1,
    halfWidth: 6.5,
    racingD: 0,
    surface: 'asphalt' as 'asphalt' | 'gravel' | 'sand',
    sinGrade: 0,
    idx: 0,
  };
}

/**
 * Computes the next rally co-driver pacenote ahead of `currentS` along the track.
 * Curvature convention: centerKappa > 0 turns toward +wp.normal (driver's RIGHT),
 * centerKappa < 0 turns toward -wp.normal (driver's LEFT).
 */
export function computeUpcomingPacenote(
  profile: TrackRacingProfile,
  currentS: number,
  currentSpeedMs: number,
  waypoints: Waypoint[]
): UpcomingPacenote {
  const sample = createArcSample();

  const scanMax = 180;
  const stepM = 4;
  const entryThreshold = 0.0074; // ~135m radius

  let foundDist = -1;
  let turnSign = 0;

  for (let d = 8; d <= scanMax; d += stepM) {
    profile.sampleAtArcDistance(currentS + d, 0, sample);
    const k = profile.centerKappa[sample.idx];
    if (Math.abs(k) > entryThreshold) {
      // Confirm sustained curvature so tiny spline ripples don't trigger false notes
      const nextIdx = (sample.idx + 1) % profile.count;
      const kNext = profile.centerKappa[nextIdx];
      if (Math.sign(k) === Math.sign(kNext) || Math.abs(k) > 0.011) {
        foundDist = d;
        turnSign = Math.sign(k);
        break;
      }
    }
  }

  // Check surface change up to 120m ahead
  let surfaceWarning: 'GRAVEL' | 'SAND' | null = null;
  for (let d = 6; d <= 120; d += 12) {
    profile.sampleAtArcDistance(currentS + d, 0, sample);
    const surf = waypoints[sample.idx]?.surface;
    if (surf === 'sand') {
      surfaceWarning = 'SAND';
      break;
    }
    if (surf === 'gravel' && !surfaceWarning) {
      surfaceWarning = 'GRAVEL';
    }
  }

  if (foundDist < 0 || turnSign === 0) {
    return {
      direction: 'STRAIGHT',
      grade: 0,
      label: 'FLAT OUT',
      distanceM: 170,
      minRadiusM: 250,
      brakeNow: false,
      surfaceWarning,
      entryArcS: (currentS + 140) % profile.totalLength,
      apexArcS: (currentS + 140) % profile.totalLength,
      entryIdx: sample.idx,
      apexIdx: sample.idx,
    };
  }

  const entryArcS = (currentS + foundDist) % profile.totalLength;
  profile.sampleAtArcDistance(entryArcS, 0, sample);
  const entryIdx = sample.idx;

  // Trace contiguous bend of matching direction up to 96m past entry to find tightest apex
  let minRadiusM = 1.0 / Math.max(1e-4, Math.abs(profile.centerKappa[entryIdx]));
  let apexArcS = entryArcS;
  let apexIdx = entryIdx;
  let minSafeSpeedMs = Infinity;
  let lowGapCount = 0;

  for (let along = 0; along <= 96; along += 4) {
    const sCur = (entryArcS + along) % profile.totalLength;
    profile.sampleAtArcDistance(sCur, apexIdx, sample);
    const k = profile.centerKappa[sample.idx];
    if (Math.sign(k) !== turnSign && Math.abs(k) > 0.008) break; // Reversed into opposite bend

    if (Math.abs(k) < 0.006) {
      lowGapCount++;
      if (lowGapCount > 2) break;
    } else {
      lowGapCount = 0;
    }

    const absK = Math.max(Math.abs(k), Math.abs(profile.raceKappa[sample.idx]) * 0.92);
    const r = Math.min(profile.centerRadius[sample.idx], 1.0 / Math.max(1e-4, absK));
    if (r < minRadiusM) {
      minRadiusM = r;
      apexArcS = sCur;
      apexIdx = sample.idx;
    }
    const surf = waypoints[sample.idx]?.surface ?? 'asphalt';
    const grip = surfaceGrip(surf);
    const safeCornerV = Math.sqrt(grip * 9.81 * Math.max(12, r));
    if (safeCornerV < minSafeSpeedMs) {
      minSafeSpeedMs = safeCornerV;
    }
    if (surf === 'sand') surfaceWarning = 'SAND';
    else if (surf === 'gravel' && surfaceWarning !== 'SAND') surfaceWarning = 'GRAVEL';
  }

  const { grade, label } = gradeFromRadius(minRadiusM);
  const distanceM = Math.max(5, Math.round(foundDist / 5) * 5);
  const excessV2 = Math.max(0, currentSpeedMs * currentSpeedMs - minSafeSpeedMs * minSafeSpeedMs);
  const brakeNeedDist = Math.max(70, excessV2 / 12.5 + 32);
  const brakeNow =
    grade > 0 &&
    grade <= 5 &&
    distanceM <= brakeNeedDist &&
    currentSpeedMs > minSafeSpeedMs * 1.04;

  return {
    direction: turnSign > 0 ? 'RIGHT' : 'LEFT',
    grade,
    label,
    distanceM,
    minRadiusM,
    brakeNow,
    surfaceWarning,
    entryArcS,
    apexArcS,
    entryIdx,
    apexIdx,
  };
}

function createChevronSignTexture(sharp: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // High-contrast backing
  ctx.fillStyle = sharp ? '#dc2626' : '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer reflective border
  ctx.strokeStyle = sharp ? '#ffffff' : '#facc15';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  // Draw bold double right-pointing chevrons (flipped cleanly via repeat.x for Left signs)
  ctx.fillStyle = sharp ? '#ffffff' : '#facc15';
  const offsets = [24, 128];
  for (const ox of offsets) {
    ctx.beginPath();
    ctx.moveTo(ox, 18);
    ctx.lineTo(ox + 44, 18);
    ctx.lineTo(ox + 94, 64);
    ctx.lineTo(ox + 44, 110);
    ctx.lineTo(ox, 110);
    ctx.lineTo(ox + 48, 64);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export class TrackGuidance {
  public static build(
    waypoints: Waypoint[],
    roadElevation: number,
    getTerrainHeight: (x: number, z: number) => number
  ): TrackGuidanceBundle {
    const profile = TrackRacingProfile.forWaypoints(waypoints);
    const group = new THREE.Group();
    group.name = 'track-guidance-group';

    // 1. Colin McRae Rally Outer-Apex Corner Chevron Signs
    const chevronGroup = TrackGuidance.buildCornerChevronBoards(
      waypoints,
      profile,
      roadElevation,
      getTerrainHeight
    );
    group.add(chevronGroup);

    // 2. Need for Speed Holographic Corner Barrier Walls (single ShaderMaterial draw call)
    const cornerWallsMesh = TrackGuidance.buildHolographicCornerWalls(
      waypoints,
      profile,
      roadElevation
    );
    group.add(cornerWallsMesh);

    // 3. NFS / Forza Dynamic Ideal Racing Line & Braking Ribbon (single ShaderMaterial draw call)
    const racingLineMesh = TrackGuidance.buildDynamicRacingLineRibbon(
      waypoints,
      profile,
      roadElevation
    );
    group.add(racingLineMesh);

    let guideEnabled = true;

    return {
      group,
      chevronBoardsMesh: chevronGroup,
      cornerWallsMesh,
      racingLineMesh,
      chevronBoardsCount: chevronGroup.userData.boardCount ?? 0,
      isGuideEnabled: () => guideEnabled,
      setEnabled: (enabled: boolean) => {
        guideEnabled = enabled;
        racingLineMesh.visible = enabled;
        cornerWallsMesh.visible = enabled;
        const rMat = racingLineMesh.material as THREE.ShaderMaterial;
        if (rMat.uniforms?.uVisible) rMat.uniforms.uVisible.value = enabled ? 1.0 : 0.0;
      },
      update: (timeSec: number, carS: number, carSpeedMs: number) => {
        const wMat = cornerWallsMesh.material as THREE.ShaderMaterial;
        if (wMat.uniforms?.uTime) {
          wMat.uniforms.uTime.value = timeSec;
        }
        const rMat = racingLineMesh.material as THREE.ShaderMaterial;
        if (rMat.uniforms) {
          rMat.uniforms.uTime.value = timeSec;
          rMat.uniforms.uCarS.value = carS;
          rMat.uniforms.uCarSpeedMs.value = carSpeedMs;
        }
      },
    };
  }

  private static buildCornerChevronBoards(
    waypoints: Waypoint[],
    profile: TrackRacingProfile,
    roadElevation: number,
    getTerrainHeight: (x: number, z: number) => number
  ): THREE.Group {
    const N = waypoints.length;
    const container = new THREE.Group();
    container.name = 'cmr-corner-chevrons';

    // Existing hay bales at [35, 36, 48, 49] on +normal, river pier near wp[56]
    const haySet = new Set([35, 36, 48, 49]);

    interface BoardPlacement {
      x: number;
      y: number;
      z: number;
      groundY: number;
      yaw: number;
      sharp: boolean;
      isRightTurn: boolean;
    }

    const placements: BoardPlacement[] = [];
    let lastPlacedArcS = -999;

    for (let i = 0; i < N; i++) {
      const k = profile.centerKappa[i];
      const absK = Math.abs(k);
      if (absK < 0.0076) continue; // Frame sweeping & tight bends (~R < 130m)

      const s = profile.cumDist[i];
      if (s - lastPlacedArcS < (absK > 0.021 ? 15.0 : 21.0)) continue;
      if (i > N - 3 && placements.length > 0 && (profile.totalLength - s) < 18.0) continue;

      const wp = waypoints[i];
      const tang = wp.tangent ?? new THREE.Vector3(0, 0, 1);
      const norm = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const halfW = wp.width * 0.5;
      const isRightTurn = k > 0;
      const outerSign = isRightTurn ? -1 : 1;

      // Place cleanly outside 3.15m curb+shoulder and inside 6.5m Armco barriers
      let lateralDist = halfW + 4.95;
      // Avoid encroaching on static chicane hay bales (located at +(halfW + 5.8))
      if (haySet.has(i) && outerSign > 0) {
        lateralDist = halfW + 3.95;
      }
      // Keep Świder Overlook Pier sightline clean
      if (i >= 54 && i <= 58 && outerSign > 0) {
        continue;
      }

      const px = wp.point.x + norm.x * (outerSign * lateralDist);
      const pz = wp.point.z + norm.z * (outerSign * lateralDist);
      const groundY = getTerrainHeight(px, pz);
      const roadY = wp.point.y + roadElevation;
      const centerY = Math.max(roadY, groundY) + 1.05;

      // Face approaching cars (-tangent angled slightly toward apex so sign stands flat across sightline)
      const faceDirX = -tang.x * 0.90 - norm.x * (outerSign * 0.44);
      const faceDirZ = -tang.z * 0.90 - norm.z * (outerSign * 0.44);
      const yaw = Math.atan2(faceDirX, faceDirZ);

      placements.push({
        x: px,
        y: centerY,
        z: pz,
        groundY,
        yaw,
        sharp: absK > 0.0215,
        isRightTurn,
      });
      lastPlacedArcS = s;
    }

    container.userData.boardCount = placements.length;
    if (placements.length === 0) return container;

    // 4 InstancedMeshes for sign panels (Yellow/Red x Right/Left UV orientation) + 1 InstancedMesh for dual posts
    const texYellowRight = createChevronSignTexture(false);
    const texYellowLeft = texYellowRight.clone();
    texYellowLeft.repeat.set(-1, 1);
    texYellowLeft.offset.set(1, 0);
    texYellowLeft.needsUpdate = true;

    const texRedRight = createChevronSignTexture(true);
    const texRedLeft = texRedRight.clone();
    texRedLeft.repeat.set(-1, 1);
    texRedLeft.offset.set(1, 0);
    texRedLeft.needsUpdate = true;

    const makeBoardMat = (tex: THREE.CanvasTexture, sharp: boolean) =>
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(sharp ? 0xffffff : 0xfacc15),
        emissiveIntensity: sharp ? 0.35 : 0.25,
        roughness: 0.32,
        metalness: 0.15,
      });

    const boardGeo = new THREE.BoxGeometry(2.15, 0.98, 0.10);
    const postGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.0, 6);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.75,
      roughness: 0.35,
    });

    const buckets: BoardPlacement[][] = [[], [], [], []]; // 0:YR, 1:YL, 2:RR, 3:RL
    for (const p of placements) {
      const idx = (p.sharp ? 2 : 0) + (p.isRightTurn ? 0 : 1);
      buckets[idx].push(p);
    }

    const bucketMats = [
      makeBoardMat(texYellowRight, false),
      makeBoardMat(texYellowLeft, false),
      makeBoardMat(texRedRight, true),
      makeBoardMat(texRedLeft, true),
    ];

    const dummy = new THREE.Object3D();

    buckets.forEach((list, bIdx) => {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(boardGeo, bucketMats[bIdx], list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      list.forEach((p, idx) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      container.add(mesh);
    });

    const postsMesh = new THREE.InstancedMesh(postGeo, postMat, placements.length * 2);
    postsMesh.castShadow = true;
    let postIdx = 0;
    for (const p of placements) {
      const postHeight = Math.max(0.55, (p.y - 0.35) - (p.groundY - 0.12));
      const postCenterY = (p.groundY - 0.12) + postHeight * 0.5;
      const rightX = Math.cos(p.yaw);
      const rightZ = -Math.sin(p.yaw);
      for (const side of [-0.68, 0.68]) {
        dummy.position.set(p.x + rightX * side, postCenterY, p.z + rightZ * side);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(1, postHeight, 1);
        dummy.updateMatrix();
        postsMesh.setMatrixAt(postIdx++, dummy.matrix);
      }
    }
    postsMesh.count = postIdx;
    postsMesh.instanceMatrix.needsUpdate = true;
    container.add(postsMesh);

    return container;
  }

  private static buildHolographicCornerWalls(
    waypoints: Waypoint[],
    profile: TrackRacingProfile,
    roadElevation: number
  ): THREE.Mesh {
    const N = waypoints.length;
    const subSteps = 2; // 280 slices smoothly around circuit
    const totalSamples = N * subSteps;
    const threshold = 0.0076;

    const positions: number[] = [];
    const uvs: number[] = [];
    const sharpnessAttr: number[] = [];
    const edgeFadeAttr: number[] = [];
    const dirAttr: number[] = [];
    const indices: number[] = [];

    const tmpSample = createArcSample();

    // Group continuous corner runs so each outer-apex ribbon forms clean unbroken geometry
    const isCornerSample = (stepIdx: number): { active: boolean; sign: number; sharp: number } => {
      const arcS = ((stepIdx % totalSamples) / totalSamples) * profile.totalLength;
      profile.sampleAtArcDistance(arcS, 0, tmpSample);
      const k = profile.centerKappa[tmpSample.idx];
      const absK = Math.abs(k);
      if (absK <= threshold) return { active: false, sign: 0, sharp: 0 };
      const sharp = THREE.MathUtils.clamp((absK - threshold) / 0.022, 0, 1);
      return { active: true, sign: Math.sign(k), sharp };
    };

    let i = 0;
    while (i < totalSamples) {
      const startInfo = isCornerSample(i);
      if (!startInfo.active) {
        i++;
        continue;
      }

      const runIndices: number[] = [i];
      let j = i + 1;
      while (j < totalSamples + 4 && runIndices.length < totalSamples) {
        const nextInfo = isCornerSample(j % totalSamples);
        if (!nextInfo.active || nextInfo.sign !== startInfo.sign) break;
        runIndices.push(j % totalSamples);
        j++;
      }

      if (runIndices.length >= 3) {
        const baseVert = positions.length / 3;
        const outerSign = -startInfo.sign; // outer wall of turn

        runIndices.forEach((sampleStep, kIdx) => {
          const arcS = (sampleStep / totalSamples) * profile.totalLength;
          profile.sampleAtArcDistance(arcS, 0, tmpSample);
          const info = isCornerSample(sampleStep);
          const lateralDist = tmpSample.halfWidth + 2.25;
          const wx = tmpSample.x + tmpSample.normX * (outerSign * lateralDist);
          const wz = tmpSample.z + tmpSample.normZ * (outerSign * lateralDist);
          const yBot = tmpSample.y + roadElevation + 0.14;
          const yTop = yBot + 2.25;

          const uNorm = kIdx / (runIndices.length - 1);
          const fade = Math.min(1.0, Math.min(uNorm * 4.5, (1.0 - uNorm) * 4.5));
          const meterCoord = kIdx * (profile.totalLength / totalSamples);

          // Bottom vertex
          positions.push(wx, yBot, wz);
          uvs.push(meterCoord, 0);
          sharpnessAttr.push(info.sharp);
          edgeFadeAttr.push(fade);
          dirAttr.push(1.0);

          // Top vertex
          positions.push(wx, yTop, wz);
          uvs.push(meterCoord, 1);
          sharpnessAttr.push(info.sharp);
          edgeFadeAttr.push(fade);
          dirAttr.push(1.0);
        });

        for (let q = 0; q < runIndices.length - 1; q++) {
          const v0 = baseVert + q * 2;
          const v1 = v0 + 1;
          const v2 = v0 + 2;
          const v3 = v0 + 3;
          indices.push(v0, v2, v1);
          indices.push(v1, v2, v3);
        }
      }

      i = j;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aSharpness', new THREE.Float32BufferAttribute(sharpnessAttr, 1));
    geo.setAttribute('aEdgeFade', new THREE.Float32BufferAttribute(edgeFadeAttr, 1));
    geo.setAttribute('aDir', new THREE.Float32BufferAttribute(dirAttr, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute float aSharpness;
        attribute float aEdgeFade;
        attribute float aDir;
        varying vec2 vUv;
        varying float vSharpness;
        varying float vEdgeFade;
        varying float vDir;

        void main() {
          vUv = uv;
          vSharpness = aSharpness;
          vEdgeFade = aEdgeFade;
          vDir = aDir;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vSharpness;
        varying float vEdgeFade;
        varying float vDir;

        void main() {
          // Animated NFS chevron pattern pointing forward along corner travel
          float verticalShape = abs(vUv.y - 0.5) * 2.0;
          float phase = vUv.x * 0.24 - uTime * 2.3 * vDir + verticalShape * 0.55;
          float chev = abs(fract(phase) - 0.5) * 2.0;
          float chevronBeam = smoothstep(0.62, 0.24, chev);

          // Crisp glowing lower rail + pulsing top rim
          float bottomLine = smoothstep(0.14, 0.0, vUv.y);
          float topFade = smoothstep(1.0, 0.12, vUv.y);

          vec3 colCyan = vec3(0.02, 0.88, 1.0);
          vec3 colOrange = vec3(1.0, 0.36, 0.04);
          vec3 baseCol = mix(colCyan, colOrange, smoothstep(0.18, 0.78, vSharpness));

          float glow = (chevronBeam * 0.85 + bottomLine * 0.95) * topFade * vEdgeFade;
          float alpha = clamp(glow * 0.72, 0.0, 0.78);
          if (alpha < 0.02) discard;

          vec3 finalCol = baseCol * (1.15 + bottomLine * 0.45);
          gl_FragColor = vec4(finalCol, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'nfs-holographic-corner-walls';
    mesh.renderOrder = 3;
    return mesh;
  }

  private static buildDynamicRacingLineRibbon(
    waypoints: Waypoint[],
    profile: TrackRacingProfile,
    roadElevation: number
  ): THREE.Mesh {
    const slices = waypoints.length * 4; // 560 slices (~3.57m per slice)
    const stepS = profile.totalLength / slices;
    const rawSafeSpeed = new Float64Array(slices);
    const sliceSamples: {
      x: number;
      y: number;
      z: number;
      normX: number;
      normZ: number;
      racingD: number;
      halfWidth: number;
      arcS: number;
    }[] = [];

    const tmp = createArcSample();

    for (let i = 0; i < slices; i++) {
      const arcS = i * stepS;
      profile.sampleAtArcDistance(arcS, 0, tmp);
      const surf = waypoints[tmp.idx]?.surface ?? 'asphalt';
      const grip = surfaceGrip(surf);
      const r = 1.0 / Math.max(0.0022, Math.abs(profile.raceKappa[tmp.idx]));
      rawSafeSpeed[i] = THREE.MathUtils.clamp(Math.sqrt(grip * 9.81 * r), 14.0, 58.0);
      sliceSamples.push({
        x: tmp.x,
        y: tmp.y,
        z: tmp.z,
        normX: tmp.normX,
        normZ: tmp.normZ,
        racingD: tmp.racingD,
        halfWidth: tmp.halfWidth,
        arcS,
      });
    }

    // Backward braking-zone deceleration propagation around the loop (~10.5 m/s^2)
    const entrySafeSpeed = new Float64Array(rawSafeSpeed);
    const maxDecel = 10.5;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = slices - 1; i >= 0; i--) {
        const next = (i + 1) % slices;
        const limit = Math.sqrt(entrySafeSpeed[next] * entrySafeSpeed[next] + 2 * maxDecel * stepS);
        if (limit < entrySafeSpeed[i]) {
          entrySafeSpeed[i] = limit;
        }
      }
    }

    const halfRibbon = 0.92;
    const positions: number[] = [];
    const uvs: number[] = [];
    const arcSAttr: number[] = [];
    const safeSpeedAttr: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= slices; i++) {
      const idx = i % slices;
      const s = sliceSamples[idx];
      const cx = s.x + s.normX * s.racingD;
      const cz = s.z + s.normZ * s.racingD;
      // Clear road crown (halfWidth * 0.006) and road markings (+0.035m)
      const crown = s.halfWidth * 0.006;
      const cy = s.y + roadElevation + crown + 0.065;

      const lx = cx - s.normX * halfRibbon;
      const lz = cz - s.normZ * halfRibbon;
      const rx = cx + s.normX * halfRibbon;
      const rz = cz + s.normZ * halfRibbon;

      positions.push(lx, cy, lz);
      positions.push(rx, cy, rz);

      const uDist = i * stepS;
      uvs.push(0.0, uDist);
      uvs.push(1.0, uDist);

      const sVal = i === slices ? profile.totalLength : s.arcS;
      arcSAttr.push(sVal, sVal);
      safeSpeedAttr.push(entrySafeSpeed[idx], entrySafeSpeed[idx]);

      if (i < slices) {
        const v0 = i * 2;
        const v1 = v0 + 1;
        const v2 = v0 + 2;
        const v3 = v0 + 3;
        indices.push(v0, v1, v2);
        indices.push(v1, v3, v2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aArcS', new THREE.Float32BufferAttribute(arcSAttr, 1));
    geo.setAttribute('aSafeSpeedMs', new THREE.Float32BufferAttribute(safeSpeedAttr, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCarS: { value: 0 },
        uCarSpeedMs: { value: 0 },
        uTotalLen: { value: profile.totalLength },
        uVisible: { value: 1.0 },
      },
      vertexShader: `
        attribute float aArcS;
        attribute float aSafeSpeedMs;
        varying vec2 vUv;
        varying float vArcS;
        varying float vSafeSpeedMs;

        void main() {
          vUv = uv;
          vArcS = aArcS;
          vSafeSpeedMs = aSafeSpeedMs;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uCarS;
        uniform float uCarSpeedMs;
        uniform float uTotalLen;
        uniform float uVisible;
        varying vec2 vUv;
        varying float vArcS;
        varying float vSafeSpeedMs;

        void main() {
          if (uVisible < 0.5) discard;

          // Signed wrapped ahead distance along circuit (-20m .. +totalLen-20m)
          float dAhead = mod(vArcS - uCarS + uTotalLen, uTotalLen);
          if (dAhead > uTotalLen * 0.5) dAhead -= uTotalLen;

          // Show dynamic ribbon smoothly from 6m behind nose to 165m ahead
          float windowMask = smoothstep(-6.0, 2.5, dAhead) * smoothstep(165.0, 48.0, dAhead);
          if (windowMask < 0.01) discard;

          // Center-symmetric chevron pointing forward along the racing line
          float latOffset = abs(vUv.x - 0.5) * 2.0; // 0 at center, 1 at edge
          float sideEdgeFade = smoothstep(1.0, 0.62, latOffset);
          float chevronPhase = fract(vUv.y * 0.28 - uTime * 2.6 - latOffset * 0.65);
          float chevronBody = smoothstep(0.58, 0.48, chevronPhase) * smoothstep(0.06, 0.16, chevronPhase);
          float railMask = smoothstep(0.92, 0.72, latOffset) * 0.14;

          // Speed margin coloring: green/cyan on throttle -> amber lift -> crimson brake zone
          float speedRatio = max(uCarSpeedMs, 10.0) / max(vSafeSpeedMs, 10.0);
          vec3 colFast = vec3(0.06, 0.90, 0.62);
          vec3 colCaution = vec3(0.98, 0.74, 0.06);
          vec3 colBrake = vec3(1.0, 0.16, 0.16);

          vec3 guideCol = mix(colFast, colCaution, smoothstep(0.84, 1.00, speedRatio));
          guideCol = mix(guideCol, colBrake, smoothstep(1.00, 1.14, speedRatio));

          // Extra urgency pulse when deep in red braking zone
          float brakePulse = mix(1.0, 0.80 + 0.25 * sin(uTime * 12.0), smoothstep(1.02, 1.15, speedRatio));
          float alpha = clamp((chevronBody * 0.78 + railMask) * sideEdgeFade * windowMask * brakePulse, 0.0, 0.82);
          if (alpha < 0.02) discard;

          gl_FragColor = vec4(guideCol * 1.15, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'nfs-dynamic-racing-line';
    mesh.renderOrder = 2;
    return mesh;
  }
}
