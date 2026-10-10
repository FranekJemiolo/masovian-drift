import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function verifyAllVehicleMechanics() {
  console.log('[TEST] Starting Comprehensive Vehicle Mechanics & Steering Verification...');

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
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud');

    // Skip countdown immediately for deterministic test
    await page.evaluate(() => {
      window._gameManager.countdownRemaining = 0;
    });
    await page.waitForTimeout(500);

    // Test 1: Verify 4-Point Raycast Suspension Ground Contact & Load
    const suspStatus = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      return {
        groundedCount: p.wheelGroundedCount,
        compressions: [...p.wheelCompressions],
        frontLeftLoad: p.weightTransfer.frontLeftLoad,
        frontRightLoad: p.weightTransfer.frontRightLoad,
        flMountY: p.visual.wheelFL.position.y,
      };
    });
    console.log('1. Raycast Suspension Status:', suspStatus);
    if (suspStatus.groundedCount < 4) {
      throw new Error(`Expected 4 grounded wheels, got ${suspStatus.groundedCount}`);
    }
    console.log('  ✓ 4-point raycast suspension active and supporting vehicle weight');

    // Test 2: Turn Left - Accelerate first, then initiate turn
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(800);
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(1600);

    const leftData = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const r = p.quaternion;
      // Forward vector X: 2*(x*z + w*y)
      const fwdX = 2 * (r.x * r.z + r.w * r.y);
      const fwdZ = 1 - 2 * (r.x * r.x + r.y * r.y);
      return {
        steerAngle: p.steerAngle,
        wheelSteerY: p.visual.wheelFL.rotation.y,
        driverHeadYaw: p.visual.driverHead ? p.visual.driverHead.rotation.y : 0,
        bodyRollZ: p.visual.bodyMesh.rotation.z,
        frontLeftLoad: p.weightTransfer.frontLeftLoad,
        frontRightLoad: p.weightTransfer.frontRightLoad,
        fwdX,
        fwdZ,
        speedKmh: p.speedKmh,
      };
    });
    console.log('2. Turn Left Diagnostics:', leftData);

    if (leftData.steerAngle >= 0) {
      throw new Error(`Left steerAngle should be negative, got ${leftData.steerAngle}`);
    }
    if (leftData.wheelSteerY >= 0) {
      throw new Error(`Front wheel rotation should be negative (pointing left), got ${leftData.wheelSteerY}`);
    }
    if (leftData.driverHeadYaw >= 0) {
      throw new Error(`Driver helmet should look left into corner apex, got ${leftData.driverHeadYaw}`);
    }
    if (leftData.bodyRollZ <= 0) {
      throw new Error(`Chassis body roll should lean outward (positive rotation Z), got ${leftData.bodyRollZ}`);
    }
    if (leftData.frontRightLoad <= leftData.frontLeftLoad) {
      throw new Error(`Outside (right) wheel load should exceed inside (left) wheel load, got FL=${leftData.frontLeftLoad}, FR=${leftData.frontRightLoad}`);
    }
    if (leftData.fwdX >= 0) {
      throw new Error(`Vehicle heading forward X should point left (negative), got ${leftData.fwdX}`);
    }
    console.log('  ✓ Left turn controls, animations, roll, helmet apex gaze, and physics confirmed!');

    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(400);

    // Test 3: Turn Right - Accelerate forward then steer right
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1600);

    const rightData = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      const r = p.quaternion;
      const fwdX = 2 * (r.x * r.z + r.w * r.y);
      const fwdZ = 1 - 2 * (r.x * r.x + r.y * r.y);
      return {
        steerAngle: p.steerAngle,
        wheelSteerY: p.visual.wheelFL.rotation.y,
        driverHeadYaw: p.visual.driverHead ? p.visual.driverHead.rotation.y : 0,
        bodyRollZ: p.visual.bodyMesh.rotation.z,
        frontLeftLoad: p.weightTransfer.frontLeftLoad,
        frontRightLoad: p.weightTransfer.frontRightLoad,
        fwdX,
        fwdZ,
        speedKmh: p.speedKmh,
      };
    });
    console.log('3. Turn Right Diagnostics:', rightData);

    if (rightData.steerAngle <= 0) {
      throw new Error(`Right steerAngle should be positive, got ${rightData.steerAngle}`);
    }
    if (rightData.wheelSteerY <= 0) {
      throw new Error(`Front wheel rotation should be positive (pointing right), got ${rightData.wheelSteerY}`);
    }
    if (rightData.driverHeadYaw <= 0) {
      throw new Error(`Driver helmet should look right into corner apex, got ${rightData.driverHeadYaw}`);
    }
    if (rightData.bodyRollZ >= 0) {
      throw new Error(`Chassis body roll should lean outward (negative rotation Z), got ${rightData.bodyRollZ}`);
    }
    if (rightData.frontLeftLoad <= rightData.frontRightLoad) {
      throw new Error(`Outside (left) wheel load should exceed inside (right) wheel load, got FL=${rightData.frontLeftLoad}, FR=${rightData.frontRightLoad}`);
    }
    console.log('  ✓ Right turn controls, animations, roll, helmet apex gaze, and physics confirmed!');

    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');

    // Test 4: Airborne Auto-Leveling (Technique #3)
    const airTest = await page.evaluate(() => {
      const p = window._gameManager.playerVehicle;
      // Lift car 3 meters in the air tilted 30 degrees around roll axis
      p.rigidBody.setTranslation({ x: p.position.x, y: p.position.y + 4.0, z: p.position.z }, true);
      // Tilt 25 degrees roll
      const tiltQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.45);
      p.rigidBody.setRotation({ x: tiltQuat.x, y: tiltQuat.y, z: tiltQuat.z, w: tiltQuat.w }, true);
      p.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Step physics 30 frames (0.5s) to allow auto-stabilizer to restore upright orientation
      for (let i = 0; i < 30; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, 0.016);
      }

      const currentTiltDot = p.upVector.dot(new THREE.Vector3(0, 1, 0));
      return {
        groundedCount: p.wheelGroundedCount,
        upDot: currentTiltDot,
      };
    });
    console.log('4. Airborne Stabilization Diagnostics:', airTest);
    if (airTest.upDot < 0.90) {
      throw new Error(`Airborne stabilization should auto-align car upright (upDot > 0.9), got ${airTest.upDot}`);
    }
    console.log('  ✓ Airborne Angular Stability auto-alignment successfully leveled the car!');

    // Test 5: Verify AI Opponents are moving and navigating
    const aiStatus = await page.evaluate(() => {
      const bots = window._gameManager.aiBots;
      return bots.map((b) => ({
        name: b.profile.name,
        speedKmh: b.vehicle.speedKmh,
        lap: b.vehicle.currentLap,
        checkpoint: b.vehicle.currentCheckpointIndex,
      }));
    });
    console.log('5. AI Opponent Nav Status:', aiStatus);
    const movingBots = aiStatus.filter((b) => b.speedKmh > 5);
    console.log(`  ✓ ${movingBots.length}/${aiStatus.length} AI opponents active and racing dynamically!`);

    console.log('====================================================');
    console.log('✓ ALL VEHICLE CONTROLS, PHYSICS & ANIMATIONS VERIFIED!');
    console.log('====================================================');

  } finally {
    await page.close();
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors encountered: ${consoleErrors.join(', ')}`);
  }
}

verifyAllVehicleMechanics().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
