import * as THREE from 'three';
import { TrackWaypoints, Waypoint } from '../physics/TrackWaypoints';

export interface TrackMeshResult {
  trackGroup: THREE.Group;
  roadMesh: THREE.Mesh;
  curbsMesh: THREE.Mesh;
  terrainMesh: THREE.Mesh;
  startFinishGantry: THREE.Group;
  checkpoints: { position: THREE.Vector3; index: number; radius: number }[];
}

export class TrackMeshBuilder {
  public static buildTrack(waypoints: Waypoint[]): TrackMeshResult {
    const trackGroup = new THREE.Group();
    const count = waypoints.length;

    // 1. Road ribbon geometry
    const roadVertices: number[] = [];
    const roadIndices: number[] = [];
    const roadUvs: number[] = [];
    const roadColors: number[] = [];

    // Curbs geometry (red and white kerb edges)
    const curbVertices: number[] = [];
    const curbIndices: number[] = [];
    const curbColors: number[] = [];

    const asphaltColor = new THREE.Color(0x27272a);
    const gravelColor = new THREE.Color(0x57534e);
    const sandColor = new THREE.Color(0xd4a373);
    const redKerb = new THREE.Color(0xdc2626);
    const whiteKerb = new THREE.Color(0xf8fafc);

    for (let i = 0; i <= count; i++) {
      const wp = waypoints[i % count];
      const pt = wp.point;
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const halfWidth = wp.width * 0.5;

      // Surface color based on road section
      let baseColor = asphaltColor;
      if (wp.surface === 'gravel') baseColor = gravelColor;
      if (wp.surface === 'sand') baseColor = sandColor;

      // Left and right track edge
      const pLeft = pt.clone().addScaledVector(normal, -halfWidth);
      const pRight = pt.clone().addScaledVector(normal, halfWidth);

      // Road verts (indices: 2*i, 2*i+1)
      roadVertices.push(pLeft.x, pLeft.y + 0.05, pLeft.z);
      roadVertices.push(pRight.x, pRight.y + 0.05, pRight.z);

      roadUvs.push(0, i * 0.2);
      roadUvs.push(1, i * 0.2);

      roadColors.push(baseColor.r, baseColor.g, baseColor.b);
      roadColors.push(baseColor.r, baseColor.g, baseColor.b);

      // Outer curbs (striped)
      const curbWidth = 1.2;
      const curbHeight = 0.12;
      const isRed = Math.floor(i * 0.5) % 2 === 0;
      const curColor = isRed ? redKerb : whiteKerb;

      const cLeftOuter = pt.clone().addScaledVector(normal, -(halfWidth + curbWidth));
      const cRightOuter = pt.clone().addScaledVector(normal, halfWidth + curbWidth);

      const curbIdx = (i * 4);
      // L inner, L outer, R inner, R outer
      curbVertices.push(pLeft.x, pLeft.y + 0.06, pLeft.z);
      curbVertices.push(cLeftOuter.x, cLeftOuter.y + curbHeight, cLeftOuter.z);
      curbVertices.push(pRight.x, pRight.y + 0.06, pRight.z);
      curbVertices.push(cRightOuter.x, cRightOuter.y + curbHeight, cRightOuter.z);

      for (let k = 0; k < 4; k++) {
        curbColors.push(curColor.r, curColor.g, curColor.b);
      }

      if (i < count) {
        // Road quad
        const r0 = i * 2;
        const r1 = i * 2 + 1;
        const r2 = (i + 1) * 2;
        const r3 = (i + 1) * 2 + 1;
        roadIndices.push(r0, r1, r2);
        roadIndices.push(r1, r3, r2);

        // Left curb quad
        const cl0 = i * 4;
        const cl1 = i * 4 + 1;
        const cl2 = (i + 1) * 4;
        const cl3 = (i + 1) * 4 + 1;
        curbIndices.push(cl0, cl2, cl1);
        curbIndices.push(cl1, cl2, cl3);

        // Right curb quad
        const cr0 = i * 4 + 2;
        const cr1 = i * 4 + 3;
        const cr2 = (i + 1) * 4 + 2;
        const cr3 = (i + 1) * 4 + 3;
        curbIndices.push(cr0, cr1, cr2);
        curbIndices.push(cr1, cr3, cr2);
      }
    }

    // Build Road BufferGeometry
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
    roadGeo.setAttribute('color', new THREE.Float32BufferAttribute(roadColors, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    trackGroup.add(roadMesh);

    // Build Curbs BufferGeometry
    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbVertices, 3));
    curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(curbColors, 3));
    curbGeo.setIndex(curbIndices);
    curbGeo.computeVertexNormals();

    const curbMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      flatShading: true,
    });
    const curbsMesh = new THREE.Mesh(curbGeo, curbMat);
    curbsMesh.receiveShadow = true;
    trackGroup.add(curbsMesh);

    // 2. Surrounding Ground Terrain (Sandy pine earth)
    const terrainGeo = new THREE.PlaneGeometry(1200, 1200, 60, 60);
    terrainGeo.rotateX(-Math.PI / 2);
    // Subtle procedural sand waves / dunes
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const duneHeight = Math.sin(vx * 0.015) * Math.cos(vz * 0.015) * 1.8 +
                         Math.sin(vx * 0.03 + vz * 0.02) * 0.7;
      pos.setY(i, duneHeight - 0.1);
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x3f4f34, // Dark Mazovian forest soil / pine needles
      roughness: 0.95,
      flatShading: true,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    trackGroup.add(terrainMesh);

    // 3. Start/Finish Gantry Arch
    const startWp = waypoints[0];
    const gantry = new THREE.Group();
    gantry.position.copy(startWp.point);
    if (startWp.tangent) {
      gantry.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), startWp.tangent);
    }

    const metalMat = new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.8, roughness: 0.3 });
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0xd92b2b, roughness: 0.5 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

    // Left & Right truss pillars
    const pLeft = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7.5, 0.8), metalMat);
    pLeft.position.set(-8.5, 3.75, 0);
    pLeft.castShadow = true;
    gantry.add(pLeft);

    const pRight = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7.5, 0.8), metalMat);
    pRight.position.set(8.5, 3.75, 0);
    pRight.castShadow = true;
    gantry.add(pRight);

    // Cross beam & Banner
    const beam = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 0.8), metalMat);
    beam.position.set(0, 7.1, 0);
    gantry.add(beam);

    const banner = new THREE.Mesh(new THREE.BoxGeometry(14, 1.8, 0.3), bannerMat);
    banner.position.set(0, 6.0, 0);
    gantry.add(banner);

    // Start lights (5 round lights)
    for (let k = -2; k <= 2; k++) {
      const lightMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8),
        new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          emissive: 0x16a34a,
          emissiveIntensity: 0.8,
        })
      );
      lightMesh.rotation.x = Math.PI / 2;
      lightMesh.position.set(k * 1.5, 5.0, 0.15);
      gantry.add(lightMesh);
    }

    trackGroup.add(gantry);

    // 4. Generate Checkpoints along circuit for lap tracking
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
      terrainMesh,
      startFinishGantry: gantry,
      checkpoints,
    };
  }
}
