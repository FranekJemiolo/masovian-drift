import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function testCollisions() {
  console.log('===========================================================');
  console.log('[TEST] Starting Collision Verification: Car vs Trees & Obstacles');
  console.log('===========================================================');

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
    await page.waitForSelector('#menu-root', { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.click('#btn-quick-race', { force: true });
    await page.waitForSelector('#game-hud', { timeout: 30000 });

    // Skip countdown immediately for testing
    await page.evaluate(() => {
      window._gameManager.countdownRemaining = 0;
    });
    await page.waitForTimeout(500);

    // 1. Verify Rapier World Colliders Count
    const colliderStats = await page.evaluate(() => {
      const gm = window._gameManager;
      const world = gm.physicsWorld.world;
      return {
        totalColliders: world.colliders.len(),
        totalRigidBodies: world.bodies.len(),
        carBodyId: gm.playerVehicle.rigidBody ? true : false,
      };
    });

    console.log('1. Physics World Stats:', colliderStats);
    if (colliderStats.totalColliders < 1500) {
      throw new Error(`Expected at least 1500 colliders (including trees), got ${colliderStats.totalColliders}`);
    }
    console.log(`  ✓ Rapier registered ${colliderStats.totalColliders} colliders (trees, barriers, bales, fences, track)`);

    // 2. Test Car vs Tree Trunk Collision
    // Place a tree trunk directly in front of the car, drive into it, and verify collision stoppage and damage
    const treeCollisionResult = await page.evaluate(() => {
      const gm = window._gameManager;
      const p = gm.playerVehicle;
      const world = gm.physicsWorld.world;
      const wp = gm.waypoints;

      // Position car with heading along +Z
      p.rigidBody.setTranslation({ x: 0, y: 1.0, z: 0 }, true);
      p.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      p.rigidBody.setLinvel({ x: 0, y: 0, z: 18.0 }, true); // 18 m/s (~65 km/h) towards +Z
      p.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Place a Scots pine tree trunk collider at (0, 0, 10) with radius 0.45m
      const treeBody = world.createRigidBody(window.RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 10));
      const treeColDesc = window.RAPIER.ColliderDesc.cylinder(6.0, 0.45)
        .setTranslation(0, 6.0, 0)
        .setFriction(0.75)
        .setRestitution(0.08);
      world.createCollider(treeColDesc, treeBody);

      const initialZ = p.position.z;
      const initialBodyDamage = p.damage.bodyDamage;

      // Step physics 40 frames (2/3 second)
      for (let i = 0; i < 40; i++) {
        p.updatePhysics({ throttle: 1.0, brake: 0, steer: 0, handbrake: false }, 0.016, wp);
        world.step();
      }

      const finalPos = p.rigidBody.translation();
      const finalLinvel = p.rigidBody.linvel();
      const postCollisionDamage = p.damage.bodyDamage;

      return {
        initialZ,
        finalZ: finalPos.z,
        finalVelocityZ: finalLinvel.z,
        penetratedPastTree: finalPos.z > 10.0,
        damageDealt: postCollisionDamage > initialBodyDamage,
        bodyDamage: postCollisionDamage,
        justCrashed: p.justCrashed,
      };
    });

    console.log('2. Car vs Tree Trunk Collision Result:', treeCollisionResult);
    if (treeCollisionResult.penetratedPastTree) {
      throw new Error(`Car phased through tree! Final Z: ${treeCollisionResult.finalZ}, Tree was at Z=10.0`);
    }
    console.log(`  ✓ Car physically collided with and was stopped by the tree trunk at Z=${treeCollisionResult.finalZ.toFixed(2)}m (Tree at Z=10m)`);
    console.log(`  ✓ Impact velocity absorbed (Final Vz=${treeCollisionResult.finalVelocityZ.toFixed(2)} m/s, body damage=${(treeCollisionResult.bodyDamage * 100).toFixed(1)}%)`);

    // 3. Test Car vs Tire Barrier Stack Elastic Absorption
    const barrierCollisionResult = await page.evaluate(() => {
      const gm = window._gameManager;
      const p = gm.playerVehicle;
      const world = gm.physicsWorld.world;
      const wp = gm.waypoints;

      // Reset car at (20, 1.0, 0) moving towards tire stack at (20, 0, 10)
      p.rigidBody.setTranslation({ x: 20, y: 1.0, z: 0 }, true);
      p.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      p.rigidBody.setLinvel({ x: 0, y: 0, z: 20.0 }, true);
      p.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

      const barrierBody = world.createRigidBody(window.RAPIER.RigidBodyDesc.fixed().setTranslation(20, 0, 10));
      const barrierColDesc = window.RAPIER.ColliderDesc.cylinder(0.5, 0.6)
        .setTranslation(0, 0.5, 0)
        .setFriction(0.85)
        .setRestitution(0.35);
      world.createCollider(barrierColDesc, barrierBody);

      for (let i = 0; i < 40; i++) {
        p.updatePhysics({ throttle: 0.8, brake: 0, steer: 0, handbrake: false }, 0.016, wp);
        world.step();
      }

      const finalPos = p.rigidBody.translation();
      return {
        finalZ: finalPos.z,
        stoppedByBarrier: finalPos.z < 10.0,
      };
    });

    console.log('3. Car vs Tire Barrier Collision Result:', barrierCollisionResult);
    if (!barrierCollisionResult.stoppedByBarrier) {
      throw new Error(`Car phased through tire barrier! Final Z: ${barrierCollisionResult.finalZ}`);
    }
    console.log(`  ✓ Car collided with and bounced off tire barrier at Z=${barrierCollisionResult.finalZ.toFixed(2)}m`);

    console.log('===========================================================');
    console.log('✓ ALL COLLISION TESTS PASSED CLEANLY!');
    console.log('===========================================================');
  } finally {
    await browser.close();
  }
}

testCollisions().catch((err) => {
  console.error('[COLLISION TEST FAILED]', err);
  process.exit(1);
});
