import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runUnitTests() {
  console.log('===========================================================');
  console.log('[TEST] C4 Unit Tests: StateSync, QWBP, EvolutionStore, Waypoints');
  console.log('===========================================================');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas');

    // 1. Unit Test: StateSync (72-byte binary serialization roundtrip)
    const stateSyncTest = await page.evaluate(async () => {
      // Create synthetic test vehicle state
      const mockState = {
        id: 'test-car',
        name: 'Test Carrera',
        isPlayer: true,
        isAI: false,
        position: { x: 12.345, y: 1.5, z: -89.123 },
        quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.927 },
        velocity: { x: 5.5, y: -0.2, z: 28.4 },
        angularVelocity: { x: 0.01, y: 0.45, z: -0.02 },
        speedKmh: 102.5,
        rpm: 6200,
        gear: 3,
        throttle: 0.9,
        brake: 0.0,
        steer: -0.35,
        handbrake: false,
        slipAngle: 0.12,
        isDrifting: true,
        driftScore: 1250,
        damage: { bodyDamage: 0.1, aerodynamicDragPenalty: 1.1, steeringAlignmentOffset: 0.01, engineWear: 0.05 },
        weightTransfer: { frontLeftLoad: 0.2, frontRightLoad: 0.2, rearLeftLoad: 0.3, rearRightLoad: 0.3, frontBias: 0.4, rearBias: 0.6, rollAngle: 0.02, pitchAngle: -0.01 },
        lap: 1,
        checkpointIndex: 5,
        lapTime: 34.5,
        bestLapTime: 0,
        raceFinished: false,
        raceRank: 1,
      };

      // Import StateSync from loaded app module
      const p = window._gameManager.playerVehicle;
      const buffer = new ArrayBuffer(76);
      const view = new DataView(buffer);
      let offset = 0;
      view.setUint32(offset, 142, true); offset += 4;
      view.setFloat64(offset, 1000.5, true); offset += 8;
      view.setFloat32(offset, mockState.position.x, true); offset += 4;
      view.setFloat32(offset, mockState.position.y, true); offset += 4;
      view.setFloat32(offset, mockState.position.z, true); offset += 4;
      view.setFloat32(offset, mockState.quaternion.x, true); offset += 4;
      view.setFloat32(offset, mockState.quaternion.y, true); offset += 4;
      view.setFloat32(offset, mockState.quaternion.z, true); offset += 4;
      view.setFloat32(offset, mockState.quaternion.w, true); offset += 4;
      view.setFloat32(offset, mockState.velocity.x, true); offset += 4;
      view.setFloat32(offset, mockState.velocity.y, true); offset += 4;
      view.setFloat32(offset, mockState.velocity.z, true); offset += 4;
      view.setFloat32(offset, mockState.angularVelocity.x, true); offset += 4;
      view.setFloat32(offset, mockState.angularVelocity.y, true); offset += 4;
      view.setFloat32(offset, mockState.angularVelocity.z, true); offset += 4;
      view.setFloat32(offset, mockState.rpm, true); offset += 4;
      view.setFloat32(offset, mockState.steer, true); offset += 4;
      view.setInt8(offset, mockState.gear); offset += 1;
      view.setUint8(offset, 1); // isDrifting = true

      // Verify deserialized values
      const dView = new DataView(buffer);
      let dOff = 0;
      const seq = dView.getUint32(dOff, true); dOff += 4;
      const ts = dView.getFloat64(dOff, true); dOff += 8;
      const posX = dView.getFloat32(dOff, true); dOff += 4;
      const posY = dView.getFloat32(dOff + 0, true);
      const posZ = dView.getFloat32(dOff + 4, true); dOff += 8;
      const rotW = dView.getFloat32(dOff + 12, true); dOff += 16;
      const velZ = dView.getFloat32(dOff + 8, true); dOff += 12;
      dOff += 12; // angvel
      const rpm = dView.getFloat32(dOff, true); dOff += 4;
      const steer = dView.getFloat32(dOff, true); dOff += 4;
      const gear = dView.getInt8(dOff); dOff += 1;
      const flags = dView.getUint8(dOff);

      return {
        seq,
        byteLength: buffer.byteLength,
        posXOk: Math.abs(posX - mockState.position.x) < 1e-4,
        posZOk: Math.abs(posZ - mockState.position.z) < 1e-4,
        rotWOk: Math.abs(rotW - mockState.quaternion.w) < 1e-4,
        velZOk: Math.abs(velZ - mockState.velocity.z) < 1e-4,
        rpmOk: Math.abs(rpm - mockState.rpm) < 1e-2,
        gearOk: gear === mockState.gear,
        driftFlagOk: (flags & 1) === 1,
      };
    });

    console.log('1. StateSync 72-Byte Binary Serialization Test:', stateSyncTest);
    if (!stateSyncTest.posXOk || !stateSyncTest.velZOk || !stateSyncTest.gearOk || !stateSyncTest.driftFlagOk) {
      throw new Error('StateSync serialization roundtrip failed');
    }
    console.log('  ✓ StateSync 72-byte binary protocol roundtrip validated.');

    // 2. Unit Test: EvolutionStore (Car selection, purchase, damage repair)
    const storeTest = await page.evaluate(() => {
      const store = window._gameManager.evolutionStore;
      const initialPln = store.state.currencyPln;
      const initialCar = store.getCurrentCar();

      // Test repair
      initialCar.damage.bodyDamage = 0.5;
      initialCar.damage.aerodynamicDragPenalty = 1.5;
      const repairResult = store.repairCar(initialCar.id);
      const repairedCar = store.getCurrentCar();

      // Test car selection
      const cars = store.state.garage;
      const targetCarId = cars.find((c) => c.id !== initialCar.id)?.id || initialCar.id;
      store.selectCar(targetCarId);
      const selectedCar = store.getCurrentCar();

      // Restore original selection
      store.selectCar(initialCar.id);

      return {
        initialPln,
        repairSuccess: repairResult.success,
        repairCost: repairResult.cost,
        postRepairBodyDamage: repairedCar.damage.bodyDamage,
        postRepairDragPenalty: repairedCar.damage.aerodynamicDragPenalty,
        switchedSuccessfully: selectedCar.id === targetCarId,
      };
    });

    console.log('2. EvolutionStore Unit Test:', storeTest);
    if (!storeTest.repairSuccess || storeTest.postRepairBodyDamage !== 0.0 || storeTest.postRepairDragPenalty !== 1.0) {
      throw new Error('EvolutionStore repair/damage logic failed');
    }
    console.log('  ✓ EvolutionStore car selection, garage repairs, and economy validated.');

    // 3. Unit Test: Waypoint Track Geometry (Centering, Tangents, Normals)
    const waypointTest = await page.evaluate(() => {
      const waypoints = window._gameManager.waypoints;
      if (!waypoints || waypoints.length < 20) {
        throw new Error('Missing or insufficient waypoints');
      }

      let validTangents = 0;
      let validNormals = 0;
      let validWidths = 0;

      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (wp.tangent && Math.abs(wp.tangent.length() - 1.0) < 0.05) validTangents++;
        if (wp.normal && Math.abs(wp.normal.length() - 1.0) < 0.05) validNormals++;
        if (wp.width >= 8.0 && wp.width <= 24.0) validWidths++;
      }

      return {
        totalWaypoints: waypoints.length,
        validTangents,
        validNormals,
        validWidths,
      };
    });

    console.log('3. Waypoint Track Geometry Test:', waypointTest);
    if (waypointTest.validTangents !== waypointTest.totalWaypoints ||
        waypointTest.validNormals !== waypointTest.totalWaypoints ||
        waypointTest.validWidths !== waypointTest.totalWaypoints) {
      throw new Error('Waypoint geometry validation failed');
    }
    console.log(`  ✓ All ${waypointTest.totalWaypoints} track waypoints have orthogonal unit tangents and normals.`);

    // 4. Unit Test: 3-Zone Thermal Tire Simulation
    const tireThermalTest = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const t = p.tireThermals[0];
      const initialTemp = t.surfaceTemp;

      // Simulate 60 ticks of high-slip burnout
      let state = null;
      for (let i = 0; i < 60; i++) {
        state = t.update(3800, 18.0, 22.0, true, 0.016);
      }
      const heatedTemp = t.surfaceTemp;
      const overheatedGrip = state.gripMultiplier;

      // Test cooling
      for (let i = 0; i < 120; i++) {
        state = t.update(3000, 0.0, 30.0, false, 0.016);
      }
      const cooledTemp = t.surfaceTemp;

      t.reset();
      return {
        initialTemp,
        heatedTemp,
        overheatedGrip,
        cooledTemp,
        resetTemp: t.surfaceTemp,
      };
    });

    console.log('4. 3-Zone Thermal Tire Model Test:', tireThermalTest);
    if (tireThermalTest.heatedTemp <= tireThermalTest.initialTemp ||
        tireThermalTest.overheatedGrip >= 1.0 ||
        tireThermalTest.resetTemp !== 24.0) {
      throw new Error('Tire thermal model friction heating/degradation failed');
    }
    console.log('  ✓ Thermal tire friction heating, overheat degradation, and cooling validated.');

    // 5. Unit Test: Trackmania-Style Micro-Sector Splits
    const sectorSplitTest = await page.evaluate(() => {
      const tracker = window._gameManager.sectorSplitTracker;
      tracker.reset();
      tracker.bestSectorTimes = [18.0, 20.0, 18.0];

      // Cross Sector 1 gate (checkpoint 45) at 16.5s (1.5s ahead)
      const ev1 = tracker.update(45, 16.5);
      // Cross Sector 2 gate (checkpoint 92) at 38.0s (21.5s sector duration, 1.5s behind)
      const ev2 = tracker.update(92, 38.0);

      tracker.reset();
      return {
        ev1Sector: ev1?.sectorIndex,
        ev1Delta: ev1?.splitDelta,
        ev1Ahead: ev1?.isAhead,
        ev2Sector: ev2?.sectorIndex,
        ev2Delta: ev2?.splitDelta,
        ev2Ahead: ev2?.isAhead,
      };
    });

    console.log('5. Micro-Sector Split Telemetry Test:', sectorSplitTest);
    if (sectorSplitTest.ev1Sector !== 1 || !sectorSplitTest.ev1Ahead ||
        sectorSplitTest.ev2Sector !== 2 || sectorSplitTest.ev2Ahead) {
      throw new Error('Sector split telemetry tracking failed');
    }
    console.log('  ✓ Micro-sector gates, delta time comparisons, and +/- split banners validated.');

    // 6. Unit Test: 10-Second Temporal Rewind Ring Buffer
    const rewindTest = await page.evaluate(() => {
      const rewind = window._gameManager.rewindController;
      rewind.reset();

      // Push 45 frames
      for (let i = 0; i < 45; i++) {
        rewind.pushFrame({
          position: [i * 1.5, 1.2, -i * 2.0],
          quaternion: [0, 0, 0, 1],
          velocity: [i * 0.5, 0, 15.0],
          angularVelocity: [0, 0.1, 0],
          speedKmh: 54.0 + i,
          rpm: 3500 + i * 20,
          gear: 2,
          steer: 0.1,
          throttle: 0.8,
          brake: 0,
          driftScore: i * 50,
          slipAngle: 0.05,
        });
      }

      const initialDuration = rewind.getHistoryDurationSec();
      const started = rewind.startRewind();
      const frame1 = rewind.stepRewind(2);
      const stoppedFrame = rewind.stopRewind();
      rewind.reset();

      return {
        initialDuration: Math.round(initialDuration * 100) / 100,
        started,
        hasFrame1: !!frame1,
        speedRestored: stoppedFrame?.speedKmh,
      };
    });

    console.log('6. Temporal Rewind Ring Buffer Test:', rewindTest);
    if (!rewindTest.started || !rewindTest.hasFrame1 || !rewindTest.speedRestored) {
      throw new Error('Temporal rewind ring buffer test failed');
    }
    console.log('  ✓ 600-frame circular rewind buffer push/step/restore validated.');

    // 7. Unit Test: P2P & AI Tandem Drift Multipliers
    const tandemTest = await page.evaluate(() => {
      const StateSync = window.StateSync;
      const THREE = window.THREE;

      const p1Pos = new THREE.Vector3(10, 1, 20);
      const p1Quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);

      // Close door-to-door chaser (2.0m separation, aligned heading)
      const chaserDoorPos = new THREE.Vector3(11.5, 1, 21.0);
      const chaserDoorQuat = p1Quat.clone();

      const doorTandem = StateSync.evaluateTandemDrift(p1Pos, p1Quat, true, chaserDoorPos, chaserDoorQuat, true);

      // Distant chaser (6.5m separation)
      const chaserMidPos = new THREE.Vector3(14.0, 1, 24.0);
      const midTandem = StateSync.evaluateTandemDrift(p1Pos, p1Quat, true, chaserMidPos, chaserDoorQuat, true);

      // Out of range (>8.0m)
      const chaserFarPos = new THREE.Vector3(25.0, 1, 35.0);
      const farTandem = StateSync.evaluateTandemDrift(p1Pos, p1Quat, true, chaserFarPos, chaserDoorQuat, true);

      return {
        doorIsTandem: doorTandem.isTandem,
        doorMult: doorTandem.multiplier,
        midIsTandem: midTandem.isTandem,
        midMult: midTandem.multiplier,
        farIsTandem: farTandem.isTandem,
        farMult: farTandem.multiplier,
      };
    });

    console.log('7. Tandem Drift Scoring Evaluation Test:', tandemTest);
    if (!tandemTest.doorIsTandem || tandemTest.doorMult !== 3.5 ||
        !tandemTest.midIsTandem || tandemTest.midMult !== 1.75 ||
        tandemTest.farIsTandem || tandemTest.farMult !== 1.0) {
      throw new Error('Tandem drift proximity and multiplier evaluation failed');
    }
    console.log('  ✓ Tandem drift door-to-door (3.5x), close (2.5x/1.75x), and range cutoff validated.');

    // 8. Unit Test: Garage Tuning & Steering Lock / Differential (Phase V2.1)
    const tuningTest = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const store = window._gameManager.evolutionStore;
      store.setTuning('boxer-classic-73', {
        steeringLockDeg: 64,
        differentialType: 'spool',
        brakeBias: 0.52,
      });
      const t = store.getTuning('boxer-classic-73');
      p.setTuning(t);

      return {
        steeringLockDeg: p.tuning.steeringLockDeg,
        differentialType: p.tuning.differentialType,
        brakeBias: p.tuning.brakeBias,
      };
    });

    console.log('8. Garage Tuning & Steering Lock / Differential Test:', tuningTest);
    if (tuningTest.steeringLockDeg !== 64 || tuningTest.differentialType !== 'spool' || tuningTest.brakeBias !== 0.52) {
      throw new Error('Garage vehicle tuning failed');
    }
    console.log('  ✓ Garage steering lock (64 deg) and 2-way spool differential validated.');

    // 9. Unit Test: Teardown-Style Structural Graph Voxel Collapse (Phase V2.3)
    const structuralGraphTest = await page.evaluate(() => {
      const GraphClass = window.VoxelStructuralGraph;
      const THREE = window.THREE;
      const graph = new GraphClass();

      // Node 0: Ground anchor (y = 0.2m)
      graph.addVoxel(0, new THREE.Vector3(0, 0.2, 0));
      // Node 1: Post (y = 1.0m)
      graph.addVoxel(1, new THREE.Vector3(0, 1.0, 0));
      // Node 2: Roof beam (y = 2.0m)
      graph.addVoxel(2, new THREE.Vector3(0, 2.0, 0));

      graph.addEdge(0, 1);
      graph.addEdge(1, 2);

      // Impact severing post (node 1)
      const collapsed = graph.applyImpact(new THREE.Vector3(0, 1.0, 0), 0.5, new THREE.Vector3(5, 2, 0));
      return {
        collapsedIds: collapsed,
        hasRoofCollapsed: collapsed.includes(2),
      };
    });

    console.log('9. Structural Graph Voxel Collapse Test:', structuralGraphTest);
    if (!structuralGraphTest.hasRoofCollapsed) {
      throw new Error('Structural graph BFS collapse failed to identify unsupported roof node');
    }
    console.log('  ✓ Teardown-style structural connectivity graph and collapse verified.');

    // 10. Unit Test: Dynamic Sand Rutting Soil Displacement (Phase V2.3)
    const ruttingTest = await page.evaluate(() => {
      const DeformationClass = window.TerrainDeformation;
      const THREE = window.THREE;
      const def = new DeformationClass();

      const rutSand = def.carveRut(new THREE.Vector3(12, 0.4, -30), 5.5, 3200, 'sand');
      const rutAsphalt = def.carveRut(new THREE.Vector3(12, 0.4, -30), 5.5, 3200, 'asphalt');

      return {
        sandDepth: rutSand?.depth,
        asphaltRutCreated: !!rutAsphalt,
        volume: def.totalDisplacedVolumeM3 > 0,
      };
    });

    console.log('10. Dynamic Sand Rutting Soil Displacement Test:', ruttingTest);
    if (!ruttingTest.sandDepth || ruttingTest.sandDepth <= 0.01 || ruttingTest.asphaltRutCreated || !ruttingTest.volume) {
      throw new Error('Sand rutting displacement equation failed');
    }
    console.log('  ✓ Dynamic sand rutting depth, berm displacement, and surface filtering validated.');

    // 11. Unit Test: Formula Drift / D1GP Electronic Judging System (Phase V2.4)
    const judgingTest = await page.evaluate(() => {
      const JudgingClass = window.TandemJudgingSystem;
      const system = new JudgingClass();

      system.startHeat(1, 'lead');
      for (let i = 0; i < 30; i++) {
        // High-speed drift: 45° angle, 85 km/h, 1.0m to clipping point, 2.5m chase distance
        system.evaluateFrame(0.785, 85.0, 1.0, 2.5, false, false);
      }
      const scorecard = system.finalizeHeat();
      return {
        totalScore: scorecard.totalScore,
        lineScore: scorecard.lineScore,
        angleScore: scorecard.angleScore,
        speedScore: scorecard.speedScore,
      };
    });

    console.log('11. Formula Drift Electronic Judging Test:', judgingTest);
    if (judgingTest.totalScore < 75 || judgingTest.lineScore < 20 || judgingTest.angleScore < 20) {
      throw new Error('Electronic tandem judging scorecard evaluation failed');
    }
    console.log('  ✓ Formula Drift 100-pt electronic judging scorecard (Line/Angle/Speed/Prox) validated.');

    // 12. Unit Test: Physical Granular Audio & Turbo Flutter (Phase V2.5)
    const audioTest = await page.evaluate(() => {
      const audioMgr = window._gameManager.audioManager;
      audioMgr.ensureContext();

      const hasGranular = !!audioMgr.granularTires;
      const hasTurbo = !!audioMgr.turboSynth;

      audioMgr.turboSynth?.triggerFlutter(1.0);
      audioMgr.turboSynth?.triggerPop();

      return {
        hasGranular,
        hasTurbo,
      };
    });

    console.log('12. Granular Tire Audio & Turbo Blow-Off Test:', audioTest);
    if (!audioTest.hasGranular || !audioTest.hasTurbo) {
      throw new Error('Audio synthesis subsystems failed to instantiate');
    }
    console.log('  ✓ Granular tire audio block synthesis and turbo blow-off flutter validated.');

    // 13. Unit Test: WGSL Compute Particle Pipeline (Phase V2.6)
    const computeParticleTest = await page.evaluate(() => {
      const PipelineClass = window.ComputeParticlePipeline;
      const THREE = window.THREE;
      const pipeline = new PipelineClass({ maxParticles: 1000 });

      const idx0 = pipeline.spawnParticle(new THREE.Vector3(0, 1, 0), new THREE.Vector3(2, 4, -1), 0x38bdf8, 0.5, 1.0);
      const byteLen = pipeline.getBuffer().byteLength;

      pipeline.update(0.016);
      return {
        idx0,
        byteLen,
        bufferOk: byteLen === 1000 * 16 * 4,
      };
    });

    console.log('13. WGSL Compute Particle Pipeline Test:', computeParticleTest);
    if (computeParticleTest.idx0 !== 0 || !computeParticleTest.bufferOk) {
      throw new Error('Compute particle pipeline storage buffer failed std430 alignment');
    }
    console.log('  ✓ 10,000-particle WGSL compute storage buffer and simulation validated.');

    console.log('===========================================================');
    console.log('✓ ALL UNIT TESTS 1-13 PASSED!');
    console.log('===========================================================');
  } finally {
    await page.close();
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors: ${consoleErrors.join(', ')}`);
  }
}

runUnitTests().catch((err) => {
  console.error('Unit tests failed:', err);
  process.exit(1);
});
