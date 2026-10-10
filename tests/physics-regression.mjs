import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runPhysicsRegressionSuite() {
  console.log('===========================================================');
  console.log('[TEST] Physics Regression Benchmarks (Rapier3D + Pacejka 94)');
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
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForSelector('#menu-root', { timeout: 30000 });
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 30000 });

    // Skip countdown and let suspension settle onto track
    await page.evaluate(() => {
      window._gameManager.countdownRemaining = 0;
    });
    await page.waitForTimeout(500);

    // Pause GameManager background animate loop to prevent race conditions during physics regression testing
    await page.evaluate(() => {
      window._gameManager.isPaused = true;
    });
    await page.waitForTimeout(100);

    // Benchmark 1: 0-100 km/h Acceleration Time
    const accelResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const wp = window._gameManager.waypoints;
      const world = window._gameManager.physicsWorld;
      const dt = 1 / 60;

      // Clean reset on starting grid
      const spawnWp = wp[0];
      const tangent = spawnWp.tangent || new THREE.Vector3(0, 0, 1);
      const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      p.reset(spawnWp.point.clone().add(new THREE.Vector3(0, 0.45, 0)), spawnQuat);

      // Settle suspension onto road surface
      for (let i = 0; i < 20; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      let totalTime = 0;
      while (p.speedKmh < 100.0 && totalTime < 10.0) {
        // Subtle steering assist to follow track centerline on gentle curve
        const closestWp = wp[p.lastClosestWpIdx || 0];
        const toCar = p.position.clone().sub(closestWp.point);
        const latOffset = toCar.dot(closestWp.normal || new THREE.Vector3(1, 0, 0));
        const steerCorrection = Math.max(-0.15, Math.min(0.15, -latOffset * 0.08));

        p.updatePhysics({ throttle: 1.0, brake: 0, steer: steerCorrection, handbrake: false }, dt, wp);
        world.world.step();
        totalTime += dt;
      }

      return {
        timeSec: totalTime,
        finalSpeedKmh: p.speedKmh,
        finalRpm: p.rpm,
        finalGear: p.currentGear,
      };
    });

    console.log('1. 0-100 km/h Sprint Benchmark:', accelResult);
    if (accelResult.timeSec > 8.5) {
      throw new Error(`0-100 km/h too sluggish: took ${accelResult.timeSec.toFixed(2)}s (max 8.5s)`);
    }
    if (accelResult.timeSec < 1.4) {
      throw new Error(`0-100 km/h unrealistically fast: took ${accelResult.timeSec.toFixed(2)}s (min 1.4s)`);
    }
    console.log(`  ✓ 0-100 km/h sprint achieved in ${accelResult.timeSec.toFixed(2)}s (Gear ${accelResult.finalGear}, ${Math.round(accelResult.finalRpm)} RPM)`);

    // Benchmark 2: 100-0 km/h Braking Distance (without reversing)
    const brakeResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const wp = window._gameManager.waypoints;
      const world = window._gameManager.physicsWorld;
      const dt = 1 / 60;
      const startPos = p.position.clone();
      let totalDist = 0;
      let brakeTime = 0;

      while (p.speedKmh > 3.0 && brakeTime < 6.0) {
        p.updatePhysics({ throttle: 0, brake: 0.95, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
        brakeTime += dt;
      }
      totalDist = p.position.distanceTo(startPos);

      return {
        distMeters: totalDist,
        stopTimeSec: brakeTime,
        remainingSpeed: p.speedKmh,
      };
    });

    console.log('2. 100-0 km/h Braking Distance Benchmark:', brakeResult);
    if (brakeResult.distMeters > 60.0) {
      throw new Error(`100-0 km/h braking distance too long: ${brakeResult.distMeters.toFixed(1)}m (max 60m)`);
    }
    if (brakeResult.distMeters < 5.0) {
      throw new Error(`100-0 km/h braking distance unrealistically short: ${brakeResult.distMeters.toFixed(1)}m`);
    }
    console.log(`  ✓ 100-0 km/h stopped in ${brakeResult.distMeters.toFixed(1)}m (${brakeResult.stopTimeSec.toFixed(2)}s)`);

    // Benchmark 3: Skidpad Lateral Acceleration via Pacejka '94
    const skidpadResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const wp = window._gameManager.waypoints;
      const world = window._gameManager.physicsWorld;
      const dt = 1 / 60;

      // Reset to track start for clean skidpad test
      const spawnWp = wp[0];
      const tangent = spawnWp.tangent || new THREE.Vector3(0, 0, 1);
      const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      p.reset(spawnWp.point.clone().add(new THREE.Vector3(0, 0.45, 0)), spawnQuat);

      // Settle suspension onto road surface
      for (let i = 0; i < 25; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      // Accelerate to ~70 km/h
      for (let i = 0; i < 110; i++) {
        p.updatePhysics({ throttle: 1.0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.world.step();
      }

      // Enter skidpad turn
      let maxLatG = 0;
      for (let i = 0; i < 90; i++) {
        p.updatePhysics({ throttle: 0.65, brake: 0, steer: -0.75, handbrake: false }, dt, wp);
        world.world.step();
        const speedMs = p.speedKmh / 3.6;
        const latG = (speedMs * Math.abs(p.angularVelocity.y)) / 9.81;
        if (Number.isFinite(latG) && latG > maxLatG) maxLatG = latG;
      }

      return {
        maxLateralG: maxLatG,
        speedKmh: p.speedKmh,
        slipAngleDeg: (p.slipAngle * 180) / Math.PI,
        isDrifting: p.isDrifting,
      };
    });

    console.log('3. Skidpad Lateral Adhesion Benchmark:', skidpadResult);
    if (skidpadResult.maxLateralG < 0.95) {
      throw new Error(`Lateral grip insufficient: peak ${skidpadResult.maxLateralG.toFixed(2)}G (min 0.95G)`);
    }
    console.log(`  ✓ Skidpad lateral adhesion sustained peak ${skidpadResult.maxLateralG.toFixed(2)}G (slip angle: ${skidpadResult.slipAngleDeg.toFixed(1)}°)`);

    // Benchmark 4: Reset Hygiene (Zero Leftover Physics State)
    const resetResult = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const spawnWp = window._gameManager.waypoints[0];
      const tangent = spawnWp.tangent || new THREE.Vector3(0, 0, 1);
      const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      p.reset(spawnWp.point.clone().add(new THREE.Vector3(0, 0.45, 0)), spawnQuat);

      return {
        speedKmh: p.speedKmh,
        steerAngle: p.steerAngle,
        slipAngle: p.slipAngle,
        isDrifting: p.isDrifting,
        linvelMag: p.rigidBody.linvel().x ** 2 + p.rigidBody.linvel().y ** 2 + p.rigidBody.linvel().z ** 2,
        angvelMag: p.rigidBody.angvel().x ** 2 + p.rigidBody.angvel().y ** 2 + p.rigidBody.angvel().z ** 2,
        frontBias: p.weightTransfer.frontBias,
        rearBias: p.weightTransfer.rearBias,
      };
    });

    console.log('4. Reset Hygiene Benchmark:', resetResult);
    if (resetResult.speedKmh !== 0 || resetResult.steerAngle !== 0 || resetResult.isDrifting !== false) {
      throw new Error('Leftover state detected after reset');
    }
    if (resetResult.linvelMag > 1e-4 || resetResult.angvelMag > 1e-4) {
      throw new Error('Non-zero residual rigid body velocities after reset');
    }
    console.log('  ✓ Clean state reset verified: 0 km/h, 0 rad steer, 0 linvel, 0 angvel');

    console.log('===========================================================');
    console.log('✓ ALL PHYSICS REGRESSION BENCHMARKS PASSED!');
    console.log('===========================================================');
  } finally {
    await page.close();
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors: ${consoleErrors.join(', ')}`);
  }
}

runPhysicsRegressionSuite().catch((err) => {
  console.error('Physics regression test failed:', err);
  process.exit(1);
});
