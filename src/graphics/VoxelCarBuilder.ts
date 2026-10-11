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
  headlightBeams?: [THREE.Mesh, THREE.Mesh];
  headlightBeamMat?: THREE.MeshBasicMaterial;
  exhaustPipes: THREE.Vector3[];
  contactShadowMesh?: THREE.Mesh;
  contactShadowMaterial?: THREE.MeshBasicMaterial;
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

    // Common materials (PBR with clearcoat car paint and glass reflection - G4)
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.22,
      metalness: 0.28,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
      reflectivity: 0.65,
      flatShading: true,
    });
    const accentMat = new THREE.MeshPhysicalMaterial({
      color: accentColor,
      roughness: 0.35,
      metalness: 0.3,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
      flatShading: true,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      roughness: 0.05,
      metalness: 0.15,
      transmission: 0.55,
      ior: 1.52,
      transparent: true,
      opacity: 0.88,
      flatShading: true,
    });
    const blackTrimMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.8,
      flatShading: true,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      metalness: 0.92,
      roughness: 0.12,
      flatShading: true,
    });
    const stainlessMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.96,
      roughness: 0.18,
      flatShading: true,
    });
    const headLightMat = new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      emissive: 0xfef08a,
      emissiveIntensity: 1.6,
      flatShading: true,
    });
    // Multi-tiered rear light cluster materials
    const brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
      flatShading: true,
    });
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.2,
      flatShading: true,
    });
    const reverseLightMat = new THREE.MeshStandardMaterial({
      color: 0xf9fafb,
      emissive: 0xf9fafb,
      emissiveIntensity: 1.0,
      flatShading: true,
    });

    // Fuchs Rim Materials
    const fuchsLipMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db, // #D1D5DB anodized aluminum lip
      metalness: 0.88,
      roughness: 0.20,
      flatShading: true,
    });
    const fuchsPetalMat = new THREE.MeshStandardMaterial({
      color: 0x111827, // #111827 satin black recessed petals
      roughness: 0.78,
      metalness: 0.22,
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
    const rearWindow = addBox(1.14, 0.32, 0.72, 0, 0.76, -0.88, glassMat);
    rearWindow.rotation.x = Math.PI * 0.16;

    // Side windows (L & R)
    addBox(0.06, 0.32, 0.95, -0.6, 0.77, -0.2, glassMat);
    addBox(0.06, 0.32, 0.95, 0.6, 0.77, -0.2, glassMat);

    // A/B/C Pillars
    addBox(0.08, 0.4, 0.08, -0.59, 0.76, 0.35, bodyMat);
    addBox(0.08, 0.4, 0.08, 0.59, 0.76, 0.35, bodyMat);
    addBox(0.08, 0.4, 0.12, -0.59, 0.76, -0.65, bodyMat);
    addBox(0.08, 0.4, 0.12, 0.59, 0.76, -0.65, bodyMat);

    // 4. Iconic Rear Engine Deck Vents & Air-Cooled Boxer Fan
    // Alternating dark recessed voxel slits (1 x 1 x 8 voxels) across decklid
    for (let i = 0; i < 8; i++) {
      const slitZ = -1.14 - i * 0.07;
      addBox(0.88, 0.025, 0.038, 0, 0.71, slitZ, blackTrimMat);
    }
    // Iconic Air-Cooled Boxer Turbine Fan (recessed horizontally under decklid louvers)
    const fanGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.04, 12);
    const fanMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });
    const fan = new THREE.Mesh(fanGeo, fanMat);
    fan.position.set(0, 0.44, -1.35);
    bodyGroup.add(fan);

    // 5. Authentic 1973 Boxer 2.7 Carrera RS Ducktail Spoiler
    const ducktailGroup = new THREE.Group();
    ducktailGroup.position.set(0, 0.73, -1.74);

    // Aerodynamic swept-up ducktail body
    const spoilerRamp = addBox(1.34, 0.13, 0.36, 0, 0.06, 0, bodyMat, ducktailGroup);
    spoilerRamp.rotation.x = -0.38; // upward kick angle!

    // Raised trailing edge lip
    const spoilerLip = addBox(1.36, 0.07, 0.08, 0, 0.17, -0.16, accentMat, ducktailGroup);
    spoilerLip.rotation.x = -0.38;

    // Sculpted ducktail side aerodynamic endplates
    addBox(0.08, 0.17, 0.36, -0.64, 0.06, 0, bodyMat, ducktailGroup);
    addBox(0.08, 0.17, 0.36, 0.64, 0.06, 0, bodyMat, ducktailGroup);
    bodyGroup.add(ducktailGroup);

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

    // Volumetric Headlight Dust Cones
    const coneGeo = new THREE.CylinderGeometry(0.08, 1.85, 18.0, 12, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, -0.15, 9.0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfffae0,
      transparent: true,
      opacity: isPlayer ? 0.06 : 0.03,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    coneMat.visible = false;

    const leftBeam = new THREE.Mesh(coneGeo, coneMat);
    leftBeam.position.set(-0.5, 0.55, 1.84);
    bodyGroup.add(leftBeam);

    const rightBeam = new THREE.Mesh(coneGeo, coneMat);
    rightBeam.position.set(0.5, 0.55, 1.84);
    bodyGroup.add(rightBeam);

    // Front indicators / rally pods
    addBox(0.22, 0.08, 0.08, -0.52, 0.36, 1.95, indicatorMat);
    addBox(0.22, 0.08, 0.08, 0.52, 0.36, 1.95, indicatorMat);

    // 10. Multi-tiered rear light clusters (Running/Brake, Turn indicators, Reverse)
    // Left cluster
    addBox(0.34, 0.06, 0.06, -0.52, 0.58, -2.04, indicatorMat);  // Amber turn indicator (top)
    addBox(0.34, 0.07, 0.06, -0.52, 0.52, -2.04, brakeLightMat); // Red brake light (mid)
    addBox(0.18, 0.05, 0.06, -0.43, 0.46, -2.04, reverseLightMat); // White reverse light (inner low)
    addBox(0.16, 0.05, 0.06, -0.61, 0.46, -2.04, brakeLightMat); // Red reflector

    // Right cluster
    addBox(0.34, 0.06, 0.06, 0.52, 0.58, -2.04, indicatorMat);  // Amber turn indicator (top)
    addBox(0.34, 0.07, 0.06, 0.52, 0.52, -2.04, brakeLightMat); // Red brake light (mid)
    addBox(0.18, 0.05, 0.06, 0.43, 0.46, -2.04, reverseLightMat); // White reverse light (inner low)
    addBox(0.16, 0.05, 0.06, 0.61, 0.46, -2.04, brakeLightMat); // Red reflector

    // Center continuous red running/reflector strip
    addBox(0.66, 0.05, 0.05, 0, 0.52, -2.03, brakeLightMat);

    // 11. Twin Stainless Exhaust Tips beneath rear bumper
    const exhaustPipes = [
      new THREE.Vector3(-0.42, 0.20, -2.12),
      new THREE.Vector3(0.42, 0.20, -2.12),
    ];
    for (const ep of exhaustPipes) {
      // Outer stainless steel tip
      addBox(0.14, 0.12, 0.28, ep.x, ep.y, ep.z + 0.08, stainlessMat);
      // Dark hollow inner bore
      addBox(0.08, 0.06, 0.06, ep.x, ep.y, ep.z - 0.04, blackTrimMat);
    }

    // 12. Wheels with Fuchs-Style 5-Spoke Rims (FL, FR, RL, RR)
    const brakeRotorMaterials: THREE.MeshStandardMaterial[] = [];

    const createWheel = (x: number, z: number, isRight: boolean): { pivot: THREE.Group; spin: THREE.Group } => {
      const pivotGroup = new THREE.Group();
      pivotGroup.position.set(x, 0.32, z);

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

      // Anodized Aluminum Outer Rim Lip (#D1D5DB)
      const rimLipGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.245, 16);
      const rimLipMesh = new THREE.Mesh(rimLipGeo, fuchsLipMat);
      rimLipMesh.rotation.z = Math.PI / 2;
      spinGroup.add(rimLipMesh);

      // Center Hub (#111827)
      const centerHubGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.252, 10);
      const centerHub = new THREE.Mesh(centerHubGeo, fuchsPetalMat);
      centerHub.rotation.z = Math.PI / 2;
      spinGroup.add(centerHub);

      // 5-Spoke Fuchs Star Petals (#111827 satin black)
      const spokeLength = 0.13;
      const spokeGeo = new THREE.BoxGeometry(0.042, spokeLength, 0.248);
      for (let s = 0; s < 5; s++) {
        const spokeMesh = new THREE.Mesh(spokeGeo, fuchsPetalMat);
        const ang = (s * Math.PI * 2) / 5;
        spokeMesh.position.set(
          Math.cos(ang) * (spokeLength * 0.48),
          Math.sin(ang) * (spokeLength * 0.48),
          0
        );
        spokeMesh.rotation.z = ang - Math.PI / 2;
        spinGroup.add(spokeMesh);
      }

      // Ventilated Steel Brake Rotor
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

      // Brembo-style Brake Caliper
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

    // Procedural Ambient Contact Shadow under chassis (G3 / G4)
    // Attached directly beneath chassis at y = 0.01 relative to ground / chassis contact
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(64, 64, 10, 64, 64, 64);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
      grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.45)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 128, 128);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowGeo = new THREE.PlaneGeometry(2.3, 4.4);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.80,
      depthWrite: false,
    });
    const contactShadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    contactShadowMesh.position.set(0, 0.01, 0);
    root.add(contactShadowMesh);

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
      headlightBeams: [leftBeam, rightBeam],
      headlightBeamMat: coneMat,
      exhaustPipes,
      contactShadowMesh,
      contactShadowMaterial: shadowMat,
    };
  }



  /**
   * Builds a translucent holographic ghost car for Time Trial lap replays (M8)
   */
  public static createGhostCar(): THREE.Group {
    const visual = VoxelCarBuilder.createVoxelBoxer(0x38bdf8, 0x0284c7, false);
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    visual.root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = ghostMat;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    return visual.root;
  }
}
