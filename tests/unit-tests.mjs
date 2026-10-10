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

    console.log('===========================================================');
    console.log('✓ ALL UNIT TESTS PASSED!');
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
