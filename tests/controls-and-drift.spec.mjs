import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runControlsAndDriftVerification() {
  console.log('================================================================');
  console.log('[TEST] Vehicle Controls & Drift Physics Verification Suite');
  console.log('================================================================');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForSelector('#menu-root', { timeout: 30000 });
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 30000 });

    // Skip countdown immediately
    await page.evaluate(() => {
      window._gameManager.countdownRemaining = 0;
    });
    await page.waitForTimeout(500);

    // Pause background animate loop for deterministic physics stepping
    await page.evaluate(() => {
      window._gameManager.isPaused = true;
    });
    await page.waitForTimeout(100);

    // -------------------------------------------------------------------------
    // TEST 1: Pressing Left Arrow moves the car to the left (not right!)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: Left Arrow Turn Direction ---');
    const leftTurnResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const wp = window._gameManager.waypoints;
      const world = window._gameManager.physicsWorld;
      const dt = 1 / 60;

      // Spawn facing forward (+Z direction)
      const spawnWp = wp[0];
      const tangent = spawnWp.tangent || new THREE.Vector3(0, 0, 1);
      const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      p.reset(spawnWp.point.clone().add(new THREE.Vector3(0, 0.45, 0)), spawnQuat);

      // Settle suspension
      for (let i = 0; i < 20; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      const initialPos = p.position.clone();

      // Accelerate forward for 40 frames
      for (let i = 0; i < 40; i++) {
        p.updatePhysics({ throttle: 1.0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      const preTurnPos = p.position.clone();

      // Press Left Arrow (steer = -1.0) for 45 frames
      for (let i = 0; i < 45; i++) {
        p.updatePhysics({ throttle: 0.85, brake: 0, steer: -1.0, handbrake: false }, dt, wp);
        world.world.step();
      }

      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion);
      const lf = p.wheelbase * 0.58;
      const frontCenter = p.position.clone().addScaledVector(fwd, lf);

      return {
        initialX: initialPos.x,
        preTurnX: preTurnPos.x,
        finalX: p.position.x,
        frontX: frontCenter.x,
        deltaX: p.position.x - preTurnPos.x,
        fwdX: fwd.x,
        fwdZ: fwd.z,
        steerAngle: p.steerAngle,
        wheelSteerY: p.visual.wheelFL.rotation.y,
        speedKmh: p.speedKmh,
      };
    });

    console.log('Left Turn Result:', leftTurnResult);

    // Verify left turn invariants:
    if (leftTurnResult.steerAngle >= 0) {
      throw new Error(`Expected negative steerAngle for left turn, got ${leftTurnResult.steerAngle}`);
    }
    if (leftTurnResult.wheelSteerY >= 0) {
      throw new Error(`Front wheel visual mesh should point left (negative), got ${leftTurnResult.wheelSteerY}`);
    }
    if (leftTurnResult.fwdX >= 0) {
      throw new Error(`Vehicle heading forward vector X should point left (negative), got ${leftTurnResult.fwdX}`);
    }
    if (leftTurnResult.deltaX >= 0) {
      throw new Error(`Vehicle position moved right (deltaX=${leftTurnResult.deltaX}) instead of left!`);
    }
    if (leftTurnResult.frontX >= leftTurnResult.finalX) {
      throw new Error(`Front axle should lead to the left of vehicle COM: frontX=${leftTurnResult.frontX}, comX=${leftTurnResult.finalX}`);
    }
    console.log(`  ✓ Confirmed: Pressing Left Arrow rotates car left (heading X: ${leftTurnResult.fwdX.toFixed(2)}) and moves vehicle left (deltaX: ${leftTurnResult.deltaX.toFixed(2)}m)`);

    // -------------------------------------------------------------------------
    // TEST 2: Drift Dynamics - Only the back steps away, front guides the car
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Drift Mechanics - Rear Steps Away, Front Wheels Guide ---');
    const driftResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const wp = window._gameManager.waypoints;
      const world = window._gameManager.physicsWorld;
      const dt = 1 / 60;

      // Spawn clean
      const spawnWp = wp[0];
      const tangent = spawnWp.tangent || new THREE.Vector3(0, 0, 1);
      const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      p.reset(spawnWp.point.clone().add(new THREE.Vector3(0, 0.45, 0)), spawnQuat);

      // Settle suspension
      for (let i = 0; i < 20; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      // Build speed
      for (let i = 0; i < 90; i++) {
        p.updatePhysics({ throttle: 1.0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      const preDriftSpeed = p.speedKmh;

      // Initiate drift with handbrake + steer left
      let maxRearTransverse = 0;
      let maxFrontTransverse = 0;
      let maxRearSlipAngle = 0;
      let driftFrames = 0;
      let frontWheelPointsLeft = true;

      for (let i = 0; i < 40; i++) {
        const isHandbrake = i < 14;
        p.updatePhysics({ throttle: 0.85, brake: 0, steer: -1.0, handbrake: isHandbrake }, dt, wp);
        world.world.step();

        if (p.isDrifting) driftFrames++;

        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion);
        const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quaternion);
        const lf = p.wheelbase * 0.58;
        const lr = p.wheelbase * 0.42;

        const cosSteer = Math.cos(p.steerAngle);
        const sinSteer = Math.sin(p.steerAngle);
        const frontWheelFwd = fwd.clone().multiplyScalar(cosSteer).addScaledVector(rgt, sinSteer);

        if (frontWheelFwd.x > 0) frontWheelPointsLeft = false;

        const lateralSpeed = p.velocity.dot(rgt);
        const vFrontTransverse = lateralSpeed + p.angularVelocity.y * lf;
        const vRearTransverse = lateralSpeed - p.angularVelocity.y * lr;

        if (Math.abs(vRearTransverse) > maxRearTransverse) maxRearTransverse = Math.abs(vRearTransverse);
        if (Math.abs(vFrontTransverse) > maxFrontTransverse) maxFrontTransverse = Math.abs(vFrontTransverse);
        if (Math.abs(p.slipAngle) > maxRearSlipAngle) maxRearSlipAngle = Math.abs(p.slipAngle);
      }

      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion);
      const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quaternion);
      const cosSteer = Math.cos(p.steerAngle);
      const sinSteer = Math.sin(p.steerAngle);
      const frontWheelFwd = fwd.clone().multiplyScalar(cosSteer).addScaledVector(rgt, sinSteer);

      return {
        preDriftSpeed,
        driftFrames,
        isDrifting: p.isDrifting,
        maxRearSlipDeg: (maxRearSlipAngle * 180 / Math.PI),
        maxRearTransverse,
        maxFrontTransverse,
        ratioRearToFrontTransverse: maxRearTransverse / Math.max(0.01, maxFrontTransverse),
        frontWheelFwdX: frontWheelFwd.x,
        frontWheelPointsLeft,
        finalSpeedKmh: p.speedKmh,
      };
    });

    console.log('Drift Dynamics Result:', driftResult);

    if (driftResult.driftFrames === 0) {
      throw new Error('Vehicle failed to enter drift state');
    }
    if (driftResult.maxRearSlipDeg < 12.0) {
      throw new Error(`Rear drift slip angle too small: ${driftResult.maxRearSlipDeg.toFixed(1)}°`);
    }
    if (driftResult.maxRearTransverse <= driftResult.maxFrontTransverse) {
      throw new Error(`Rear axle did not step away! Rear transverse=${driftResult.maxRearTransverse.toFixed(2)}, Front=${driftResult.maxFrontTransverse.toFixed(2)}`);
    }
    if (driftResult.ratioRearToFrontTransverse < 1.3) {
      throw new Error(`Expected rear transverse swing to significantly exceed front (at least 1.3x), got ${driftResult.ratioRearToFrontTransverse.toFixed(2)}x`);
    }
    if (!driftResult.frontWheelPointsLeft) {
      throw new Error('Front wheels should remain pointing into the turn/drift direction');
    }
    console.log(`  ✓ Confirmed: Only the back steps away (Rear swing velocity ${driftResult.maxRearTransverse.toFixed(1)} m/s vs Front ${driftResult.maxFrontTransverse.toFixed(1)} m/s, ratio ${driftResult.ratioRearToFrontTransverse.toFixed(1)}x, slip ${driftResult.maxRearSlipDeg.toFixed(1)}°)`);
    console.log(`  ✓ Confirmed: Front wheels continuously guide vehicle (frontWheelFwdX: ${driftResult.frontWheelFwdX.toFixed(2)})`);

    // -------------------------------------------------------------------------
    // TEST 3: Counter-Steering Stabilizes Drift
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Counter-Steer Drift Catching ---');
    const counterSteerResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const wp = window._gameManager.waypoints;
      const world = window._gameManager.physicsWorld;
      const dt = 1 / 60;

      // Spawn clean
      const spawnWp = wp[0];
      const tangent = spawnWp.tangent || new THREE.Vector3(0, 0, 1);
      const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      p.reset(spawnWp.point.clone().add(new THREE.Vector3(0, 0.45, 0)), spawnQuat);

      // Settle
      for (let i = 0; i < 20; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      // Build speed
      for (let i = 0; i < 70; i++) {
        p.updatePhysics({ throttle: 1.0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      // Flick left to initiate drift
      for (let i = 0; i < 18; i++) {
        p.updatePhysics({ throttle: 0.8, brake: 0, steer: -1.0, handbrake: i < 8 }, dt, wp);
        world.world.step();
      }

      const yawRateAtFlick = p.angularVelocity.y;

      // Counter-steer RIGHT (+1.0) while sliding left to catch the drift
      for (let i = 0; i < 25; i++) {
        p.updatePhysics({ throttle: 0.7, brake: 0, steer: 1.0, handbrake: false }, dt, wp);
        world.world.step();
      }

      const yawRateAfterCounterSteer = p.angularVelocity.y;

      return {
        yawRateAtFlick,
        yawRateAfterCounterSteer,
        stabilized: Math.abs(yawRateAfterCounterSteer) < Math.abs(yawRateAtFlick) || yawRateAfterCounterSteer > 0,
      };
    });

    console.log('Counter-Steer Result:', counterSteerResult);
    if (!counterSteerResult.stabilized) {
      throw new Error(`Counter-steering failed to stabilize vehicle yaw: before=${counterSteerResult.yawRateAtFlick}, after=${counterSteerResult.yawRateAfterCounterSteer}`);
    }
    console.log(`  ✓ Confirmed: Counter-steering caught the slide and stabilized yaw rate (from ${counterSteerResult.yawRateAtFlick.toFixed(2)} to ${counterSteerResult.yawRateAfterCounterSteer.toFixed(2)} rad/s)`);

    // -------------------------------------------------------------------------
    // TEST 4: Reverse Ackermann Steering Direction
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Reverse Steering Direction ---');
    const reverseResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const wp = window._gameManager.waypoints;
      const world = window._gameManager.physicsWorld;
      const dt = 1 / 60;

      const spawnWp = wp[0];
      const tangent = spawnWp.tangent || new THREE.Vector3(0, 0, 1);
      const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      p.reset(spawnWp.point.clone().add(new THREE.Vector3(0, 0.45, 0)), spawnQuat);

      // Settle
      for (let i = 0; i < 20; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      // Reverse backwards using brake from standstill
      for (let i = 0; i < 50; i++) {
        p.updatePhysics({ throttle: 0, brake: 0.8, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      const reversingSpeed = p.velocity.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion));

      const trace = [];
      // Steer left while reversing
      for (let i = 0; i < 30; i++) {
        p.updatePhysics({ throttle: 0, brake: 0.8, steer: -1.0, handbrake: false }, dt, wp);
        world.world.step();
        if (i % 5 === 0) {
          trace.push({
            i,
            speedKmh: p.speedKmh.toFixed(1),
            fwdSpeed: p.velocity.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion)).toFixed(2),
            steerAngle: p.steerAngle.toFixed(2),
            yawRate: p.angularVelocity.y.toFixed(3),
          });
        }
      }

      const reverseYawRate = p.angularVelocity.y;

      return {
        reversingSpeed,
        reverseYawRate,
        trace,
      };
    });

    console.log('Reverse Steering Result:', reverseResult);
    if (reverseResult.reversingSpeed >= 0) {
      throw new Error(`Vehicle was not moving in reverse, speed=${reverseResult.reversingSpeed}`);
    }
    if (reverseResult.reverseYawRate <= 0) {
      throw new Error(`Reverse yaw rate should be positive when steering left in reverse, got ${reverseResult.reverseYawRate}`);
    }
    console.log(`  ✓ Confirmed: In reverse, steering left correctly produces positive yaw rate (${reverseResult.reverseYawRate.toFixed(2)} rad/s)`);

    console.log('\n================================================================');
    console.log('✓ ALL VEHICLE CONTROLS & DRIFT MECHANICS TESTS PASSED!');
    console.log('================================================================');

  } finally {
    await page.close();
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors encountered: ${consoleErrors.join(', ')}`);
  }
}

runControlsAndDriftVerification().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
