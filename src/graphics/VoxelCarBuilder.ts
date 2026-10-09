import * as THREE from 'three';

export interface CarVisualElements {
  root: THREE.Group;
  bodyMesh: THREE.Group;
  wheelFL: THREE.Group;
  wheelFR: THREE.Group;
  wheelRL: THREE.Group;
  wheelRR: THREE.Group;
  wheelSpins: [THREE.Group, THREE.Group, THREE.Group, THREE.Group]; // FL, FR, RL, RR spin hubs
  brakeLightMaterial: THREE.MeshStandardMaterial;
  brakeRotorMaterials: THREE.MeshStandardMaterial[];
  driverHead: THREE.Group;
  headlightLight: THREE.SpotLight | null;
  exhaustPipes: THREE.Vector3[];
}

export class VoxelCarBuilder {
  /**
   * Builds a procedural voxel Boxer sports car with authentic rear-engine proportions
   */
  public static createVoxelBoxer(
    color: number = 0xd92b2b,
    accentColor: number = 0x111111,
    isPlayer: boolean = false
  ): CarVisualElements {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    // Common materials (pixel-friendly solid colors with low roughness)
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.2,
      flatShading: true,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.6,
      metalness: 0.1,
      flatShading: true,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1a2634,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.85,
      flatShading: true,
    });
    const blackTrimMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.8,
      flatShading: true,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.85,
      roughness: 0.2,
      flatShading: true,
    });
    const headLightMat = new THREE.MeshStandardMaterial({
      color: 0xfffae0,
      emissive: 0xfffae0,
      emissiveIntensity: 0.9,
      flatShading: true,
    });
    const brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0x450a0a,
      emissiveIntensity: 0.2,
      flatShading: true,
    });
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.4,
      flatShading: true,
    });

    const addBox = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: THREE.Material,
      parent: THREE.Group = bodyGroup
    ): THREE.Mesh => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // 1. Lower Chassis base
    addBox(1.5, 0.2, 3.8, 0, 0.25, 0, blackTrimMat);

    // 2. Main lower body (sloping down at front, wider at rear)
    // Front nose
    addBox(1.36, 0.28, 1.2, 0, 0.44, 1.25, bodyMat);
    // Front bumper
    addBox(1.4, 0.22, 0.35, 0, 0.28, 1.9, blackTrimMat);

    // Mid section (doors & cabin floor)
    addBox(1.44, 0.34, 1.4, 0, 0.45, 0.0, bodyMat);

    // Rear engine deck (bulging rear boxer fender structure - wider 1.62m!)
    addBox(1.56, 0.42, 1.5, 0, 0.49, -1.25, bodyMat);
    // Rear bumper
    addBox(1.5, 0.26, 0.32, 0, 0.3, -2.0, blackTrimMat);

    // 3. Cabin & Greenhouse (roof, pillars, windows)
    // Windshield (sloped box)
    const windshield = addBox(1.22, 0.38, 0.65, 0, 0.76, 0.45, glassMat);
    windshield.rotation.x = -Math.PI * 0.12;

    // Roof
    addBox(1.18, 0.12, 1.1, 0, 0.94, -0.2, bodyMat);

    // Rear window (fastback slope down toward engine deck)
    const rearWindow = addBox(1.16, 0.36, 0.8, 0, 0.75, -0.95, glassMat);
    rearWindow.rotation.x = Math.PI * 0.15;

    // Side windows (L & R)
    addBox(0.06, 0.32, 0.95, -0.6, 0.77, -0.2, glassMat);
    addBox(0.06, 0.32, 0.95, 0.6, 0.77, -0.2, glassMat);

    // A/B/C Pillars
    addBox(0.08, 0.4, 0.08, -0.59, 0.76, 0.35, bodyMat);
    addBox(0.08, 0.4, 0.08, 0.59, 0.76, 0.35, bodyMat);
    addBox(0.08, 0.4, 0.12, -0.59, 0.76, -0.65, bodyMat);
    addBox(0.08, 0.4, 0.12, 0.59, 0.76, -0.65, bodyMat);

    // 4. Iconic Rear Engine Deck Vents & Air-Cooled Boxer Fan
    for (let i = 0; i < 4; i++) {
      addBox(0.8, 0.03, 0.06, 0, 0.71, -1.2 - i * 0.12, blackTrimMat);
    }
    // Iconic Air-Cooled Boxer Turbine Fan (visible under decklid)
    const fanGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12);
    fanGeo.rotateX(Math.PI / 2);
    const fanMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 });
    const fan = new THREE.Mesh(fanGeo, fanMat);
    fan.position.set(0, 0.62, -1.38);
    bodyGroup.add(fan);

    // 5. Classic Ducktail / Whale-Tail Rear Spoiler
    addBox(1.3, 0.08, 0.35, 0, 0.78, -1.82, accentMat);
    addBox(0.2, 0.12, 0.2, -0.4, 0.72, -1.8, blackTrimMat);
    addBox(0.2, 0.12, 0.2, 0.4, 0.72, -1.8, blackTrimMat);

    // 6. Motorsport Aero (Front Splitter, Side Skirts, Rear Diffuser Fins)
    // Low front chin splitter
    addBox(1.44, 0.05, 0.45, 0, 0.16, 1.88, blackTrimMat);
    // Left & Right Ground-effect side skirts
    addBox(0.08, 0.06, 2.0, -0.74, 0.17, 0.0, blackTrimMat);
    addBox(0.08, 0.06, 2.0, 0.74, 0.17, 0.0, blackTrimMat);
    // Rear diffuser vertical aerodynamic fins
    addBox(0.04, 0.14, 0.5, -0.32, 0.18, -1.98, blackTrimMat);
    addBox(0.04, 0.14, 0.5, 0, 0.18, -1.98, blackTrimMat);
    addBox(0.04, 0.14, 0.5, 0.32, 0.18, -1.98, blackTrimMat);

    // 7. Interior Cockpit (Steering Wheel, Dashboard, Roll Cage, Voxel Driver with Helmet)
    // Dashboard
    addBox(1.15, 0.18, 0.35, 0, 0.65, 0.25, blackTrimMat);
    // Sports Steering Wheel
    const steerWheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 6, 14), blackTrimMat);
    steerWheel.position.set(-0.32, 0.70, 0.14);
    steerWheel.rotation.x = Math.PI * 0.28;
    bodyGroup.add(steerWheel);

    // Racing Bucket Seats (Driver & Co-driver)
    addBox(0.44, 0.52, 0.38, -0.32, 0.56, -0.16, blackTrimMat);
    addBox(0.48, 0.14, 0.14, -0.32, 0.86, -0.22, blackTrimMat); // Driver Headrest wings
    addBox(0.44, 0.52, 0.38, 0.32, 0.56, -0.16, blackTrimMat); // Passenger seat

    // Lightweight Motorsport Roll Cage
    addBox(0.04, 0.46, 0.04, -0.48, 0.76, -0.48, accentMat);
    addBox(0.04, 0.46, 0.04, 0.48, 0.76, -0.48, accentMat);
    addBox(0.96, 0.04, 0.04, 0, 0.96, -0.48, accentMat);
    addBox(0.04, 0.04, 0.8, -0.48, 0.96, -0.08, accentMat);
    addBox(0.04, 0.04, 0.8, 0.48, 0.96, -0.08, accentMat);

    // Voxel Driver Model (Torso, arms on steering wheel, animated helmet looking at apex)
    const driverSuitMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.6, flatShading: true }); // Racing blue suit
    const driverHelmetMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2, metalness: 0.3, flatShading: true }); // Gloss white helmet
    const driverVisorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.95 }); // Dark tinted visor

    // Driver Torso & Arms
    addBox(0.36, 0.34, 0.26, -0.32, 0.60, -0.12, driverSuitMat);
    addBox(0.08, 0.08, 0.26, -0.42, 0.65, 0.01, driverSuitMat); // Left arm
    addBox(0.08, 0.08, 0.26, -0.22, 0.65, 0.01, driverSuitMat); // Right arm

    // Driver Head & Helmet (Pivot for apex lookahead)
    const driverHead = new THREE.Group();
    driverHead.position.set(-0.32, 0.83, -0.10);
    const helmetMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.26), driverHelmetMat);
    helmetMesh.castShadow = true;
    driverHead.add(helmetMesh);

    const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.06), driverVisorMat);
    visorMesh.position.set(0, 0.01, 0.13);
    driverHead.add(visorMesh);
    bodyGroup.add(driverHead);

    // 8. Flared Wheel Arches (Wide rear boxer stance!)
    // Front arches
    addBox(0.12, 0.26, 0.85, -0.73, 0.45, 1.05, bodyMat);
    addBox(0.12, 0.26, 0.85, 0.73, 0.45, 1.05, bodyMat);
    // Rear flared arches (extra wide)
    addBox(0.16, 0.32, 0.95, -0.78, 0.46, -1.05, bodyMat);
    addBox(0.16, 0.32, 0.95, 0.78, 0.46, -1.05, bodyMat);

    // 9. Headlights (round voxel pods with bezels)
    addBox(0.26, 0.26, 0.14, -0.5, 0.55, 1.84, headLightMat);
    addBox(0.26, 0.26, 0.14, 0.5, 0.55, 1.84, headLightMat);
    // Chrome headlight rings
    addBox(0.3, 0.3, 0.04, -0.5, 0.55, 1.80, chromeMat);
    addBox(0.3, 0.3, 0.04, 0.5, 0.55, 1.80, chromeMat);

    // Front indicators / rally pods
    addBox(0.22, 0.08, 0.08, -0.52, 0.36, 1.95, indicatorMat);
    addBox(0.22, 0.08, 0.08, 0.52, 0.36, 1.95, indicatorMat);

    // 10. Rear Tail lights (Continuous wide bar + brake lights)
    addBox(1.3, 0.12, 0.08, 0, 0.55, -2.04, brakeLightMat);
    addBox(0.25, 0.12, 0.08, -0.55, 0.55, -2.05, brakeLightMat);
    addBox(0.25, 0.12, 0.08, 0.55, 0.55, -2.05, brakeLightMat);

    // 11. Dual Chrome Exhaust Tips (lowered at rear bumper)
    addBox(0.12, 0.12, 0.3, -0.42, 0.22, -2.08, chromeMat);
    addBox(0.12, 0.12, 0.3, 0.42, 0.22, -2.08, chromeMat);
    const exhaustPipes = [
      new THREE.Vector3(-0.42, 0.22, -2.15),
      new THREE.Vector3(0.42, 0.22, -2.15),
    ];

    // 12. Wheels (FL, FR, RL, RR) with isolated steer pivot, brake rotors, and Fuchs/BBS hubs
    const brakeRotorMaterials: THREE.MeshStandardMaterial[] = [];

    const createWheel = (x: number, z: number, isRight: boolean): { pivot: THREE.Group; spin: THREE.Group } => {
      const pivotGroup = new THREE.Group();
      pivotGroup.position.set(x, 0.32, z);

      // Separate spin group so rotating around X does not cause gimbal wobble with Y steering
      const spinGroup = new THREE.Group();
      pivotGroup.add(spinGroup);

      // Tire (cylinder rotated 90 deg)
      const tireGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 16);
      const tireMat = new THREE.MeshStandardMaterial({
        color: 0x18181b,
        roughness: 0.92,
        flatShading: true,
      });
      const tireMesh = new THREE.Mesh(tireGeo, tireMat);
      tireMesh.rotation.z = Math.PI / 2;
      tireMesh.castShadow = true;
      spinGroup.add(tireMesh);

      // Chrome Deep-Dish Outer Rim Lip
      const rimLipGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.245, 12);
      const rimLipMesh = new THREE.Mesh(rimLipGeo, chromeMat);
      rimLipMesh.rotation.z = Math.PI / 2;
      spinGroup.add(rimLipMesh);

      // Satin Black Fuchs / BBS Spoke Inset
      const spokeGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.25, 5);
      const spokeMesh = new THREE.Mesh(spokeGeo, blackTrimMat);
      spokeMesh.rotation.z = Math.PI / 2;
      spinGroup.add(spokeMesh);

      // Ventilated Steel Brake Rotor (heats up and glows orange-red under heavy braking!)
      const rotorGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.05, 12);
      const rotorMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.9,
        roughness: 0.3,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0,
      });
      brakeRotorMaterials.push(rotorMat);
      const rotorMesh = new THREE.Mesh(rotorGeo, rotorMat);
      rotorMesh.rotation.z = Math.PI / 2;
      spinGroup.add(rotorMesh);

      // Brembo-style Brake Caliper (stays attached to kingpin pivot, upright!)
      const caliperMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.45,
      });
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.08), caliperMat);
      caliper.position.set(isRight ? -0.06 : 0.06, 0.1, 0);
      pivotGroup.add(caliper);

      root.add(pivotGroup);
      return { pivot: pivotGroup, spin: spinGroup };
    };

    const wheelFLData = createWheel(-0.76, 1.05, false);
    const wheelFRData = createWheel(0.76, 1.05, true);
    const wheelRLData = createWheel(-0.80, -1.05, false);
    const wheelRRData = createWheel(0.80, -1.05, true);

    // Headlight spot for player with volumetric ground cast
    let headlightLight: THREE.SpotLight | null = null;
    if (isPlayer) {
      headlightLight = new THREE.SpotLight(0xfffae0, 2.8, 55, Math.PI * 0.28, 0.45, 1);
      headlightLight.position.set(0, 0.6, 1.8);
      headlightLight.target.position.set(0, 0.2, 12);
      root.add(headlightLight);
      root.add(headlightLight.target);
    }

    return {
      root,
      bodyMesh: bodyGroup,
      wheelFL: wheelFLData.pivot,
      wheelFR: wheelFRData.pivot,
      wheelRL: wheelRLData.pivot,
      wheelRR: wheelRRData.pivot,
      wheelSpins: [wheelFLData.spin, wheelFRData.spin, wheelRLData.spin, wheelRRData.spin],
      brakeLightMaterial: brakeLightMat,
      brakeRotorMaterials,
      driverHead,
      headlightLight,
      exhaustPipes,
    };
  }
}
