import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173/masovian-drift/';
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

    // Pause background rAF loop for deterministic world-collider & destructible verification
    await page.evaluate(() => {
      window._gameManager.isPaused = true;
    });
    await page.waitForTimeout(80);

    // 4. Verify Wheel & Center Raycasts Exclude Sensors (No Phantom Compression Spike)
    const sensorRayTest = await page.evaluate(() => {
      const gm = window._gameManager;
      const p = gm.playerVehicle;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const THREE = window.THREE;
      const RAPIER = window.RAPIER;
      const dt = 1 / 60;

      const wp0 = wp[0];
      const tang = wp0.tangent || new THREE.Vector3(0, 0, 1);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tang);
      p.reset(wp0.point.clone().add(new THREE.Vector3(0, 0.45, 0)), quat);
      for (let i = 0; i < 25; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.step();
        p.syncFromRigidBody(dt);
      }

      const baselineMaxComp = Math.max(...p.wheelCompressions);
      const baseY = p.position.y;

      // Place a floating sensor slab directly intersecting wheel rays above road
      const sensorBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(p.position.x, wp0.point.y + 0.36, p.position.z)
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(3.0, 0.14, 3.0).setSensor(true),
        sensorBody
      );

      for (let i = 0; i < 15; i++) {
        p.updatePhysics({ throttle: 0, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.step();
        p.syncFromRigidBody(dt);
      }

      const afterMaxComp = Math.max(...p.wheelCompressions);
      const yDelta = Math.abs(p.position.y - baseY);
      world.removeRigidBody(sensorBody);

      return { baselineMaxComp, afterMaxComp, yDelta, grounded: p.wheelGroundedCount };
    });

    console.log('4. Raycast Sensor Exclusion Result:', sensorRayTest);
    if (sensorRayTest.afterMaxComp > sensorRayTest.baselineMaxComp + 0.03 || sensorRayTest.yDelta > 0.04) {
      throw new Error(`Suspension ray reacted to sensor collider: ${JSON.stringify(sensorRayTest)}`);
    }
    console.log(`  ✓ Wheel rays excluded sensor volume cleanly (baselineComp=${sensorRayTest.baselineMaxComp.toFixed(3)}, after=${sensorRayTest.afterMaxComp.toFixed(3)})`);

    // 5. Verify Solid Armco Guardrail (wp[24]) & Start/Finish Gantry Pillar Deflection
    const barrierAndGantryResult = await page.evaluate(() => {
      const gm = window._gameManager;
      const p = gm.playerVehicle;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const THREE = window.THREE;
      const dt = 1 / 60;

      // 5A: Armco guardrail along outside of Turn 1 (wp[24])
      const wp24 = wp[24];
      const n24 = wp24.normal.clone();
      const t24 = wp24.tangent.clone();
      const railPos = wp24.point.clone().addScaledVector(n24, -(wp24.width * 0.5 + 6.5));
      const startArmco = railPos.clone().addScaledVector(n24, 4.5).addScaledVector(t24, -2.5);
      startArmco.y = wp24.point.y + 0.45;
      const aimDir = railPos.clone().sub(startArmco).setY(0).normalize();
      const aimQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), aimDir);
      p.reset(startArmco, aimQuat);
      p.rigidBody.setLinvel({ x: aimDir.x * 16.5, y: 0, z: aimDir.z * 16.5 }, true);
      p.lastVelocity.set(aimDir.x * 16.5, 0, aimDir.z * 16.5);
      p.spawnGraceTimer = 0.05;
      p.damage.bodyDamage = 0;

      let armcoMinSignedDist = Infinity;
      for (let i = 0; i < 35; i++) {
        p.updatePhysics({ throttle: 0.4, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.step();
        p.syncFromRigidBody(dt);
        const signed = (p.position.x - railPos.x) * n24.x + (p.position.z - railPos.z) * n24.z;
        if (signed < armcoMinSignedDist) armcoMinSignedDist = signed;
      }
      const armcoDamage = +p.damage.bodyDamage.toFixed(3);

      // 5B: Start/Finish gantry right lattice pillar (s = +38m, sideX = -11.5m)
      const wp0 = wp[0];
      const t0 = wp0.tangent || new THREE.Vector3(0, 0, 1);
      const gantryPos = wp0.point.clone().addScaledVector(t0, 38.0);
      const gantryQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t0);
      const pillarPos = new THREE.Vector3(-11.5, 0, 0).applyQuaternion(gantryQuat).add(gantryPos);
      const startGantry = pillarPos.clone().addScaledVector(t0, -8.5);
      startGantry.y = wp0.point.y + 0.45;

      p.reset(startGantry, gantryQuat);
      p.rigidBody.setLinvel({ x: t0.x * 18.0, y: 0, z: t0.z * 18.0 }, true);
      p.lastVelocity.set(t0.x * 18.0, 0, t0.z * 18.0);
      p.spawnGraceTimer = 0.05;
      p.damage.bodyDamage = 0;

      let gantryMaxPastDist = -Infinity;
      for (let i = 0; i < 40; i++) {
        p.updatePhysics({ throttle: 0.9, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.step();
        p.syncFromRigidBody(dt);
        const past = (p.position.x - pillarPos.x) * t0.x + (p.position.z - pillarPos.z) * t0.z;
        if (past > gantryMaxPastDist) gantryMaxPastDist = past;
      }

      return {
        armcoMinSignedDist: +armcoMinSignedDist.toFixed(2),
        armcoDamage,
        gantryMaxPastDist: +gantryMaxPastDist.toFixed(2),
        gantrySpeedAfter: +p.speedKmh.toFixed(1),
        gantryDamage: +p.damage.bodyDamage.toFixed(3),
      };
    });

    console.log('5. Solid Armco & Gantry Pillar Result:', barrierAndGantryResult);
    if (barrierAndGantryResult.armcoMinSignedDist < -0.35) {
      throw new Error(`Car phased through Armco guardrail! minSignedDist=${barrierAndGantryResult.armcoMinSignedDist}m`);
    }
    if (barrierAndGantryResult.gantryMaxPastDist > -0.4 || barrierAndGantryResult.gantryDamage <= 0) {
      throw new Error(`Car phased through Start/Finish gantry pillar: ${JSON.stringify(barrierAndGantryResult)}`);
    }
    console.log(`  ✓ Armco guardrail deflected car (minSignedDist=${barrierAndGantryResult.armcoMinSignedDist}m) & gantry pillar blocked impact (damage=${barrierAndGantryResult.gantryDamage})`);

    // 6. Verify Oriented 3.8m Split-Rail Fence & Front-Bumper Hay Bale Destruction
    const destructibleResult = await page.evaluate(() => {
      const gm = window._gameManager;
      const p = gm.playerVehicle;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const EnvGen = window.EnvironmentGenerator;
      const THREE = window.THREE;
      const dt = 1 / 60;

      const fence = EnvGen.destructibleProps.find((pr) => pr.type === 'fence' && !pr.destroyed);
      const hay = EnvGen.destructibleProps.find((pr) => pr.type === 'hay' && !pr.destroyed);
      if (!fence || !hay) {
        throw new Error('Missing destructible fence or hay prop for verification');
      }

      // 6A: Drive perpendicular into fence at +1.25m offset along its oriented 3.8m length
      const fYaw = fence.yaw || 0;
      const fenceLengthAxis = new THREE.Vector3(Math.sin(fYaw), 0, Math.cos(fYaw));
      const fenceNormalAxis = new THREE.Vector3(Math.cos(fYaw), 0, -Math.sin(fYaw));
      const hitSpot = fence.position.clone().addScaledVector(fenceLengthAxis, 1.25);
      const startFence = hitSpot.clone().addScaledVector(fenceNormalAxis, 7.0);
      startFence.y += 0.35;
      const driveFenceDir = hitSpot.clone().sub(startFence).setY(0).normalize();
      const driveFenceQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), driveFenceDir);

      p.reset(startFence, driveFenceQuat);
      p.rigidBody.setLinvel({ x: driveFenceDir.x * 14.0, y: 0, z: driveFenceDir.z * 14.0 }, true);
      p.lastVelocity.set(driveFenceDir.x * 14.0, 0, driveFenceDir.z * 14.0);
      p.spawnGraceTimer = 0.05;
      p.damage.bodyDamage = 0;

      for (let i = 0; i < 45; i++) {
        p.updatePhysics({ throttle: 0.9, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.step();
        p.syncFromRigidBody(dt);
        EnvGen.updateDestructibles([p], gm.particleFX);
      }
      const fenceSpeedAfter = p.speedKmh;
      const fenceDmgAfter = p.damage.bodyDamage;

      // 6B: Drive straight at hay bale and capture car center distance when front bumper shatters it
      const hayDir = new THREE.Vector3(0, 0, 1);
      const startHay = hay.position.clone().addScaledVector(hayDir, -7.0);
      startHay.y += 0.35;
      p.reset(startHay, new THREE.Quaternion());
      p.rigidBody.setLinvel({ x: 0, y: 0, z: 14.0 }, true);
      p.lastVelocity.set(0, 0, 14.0);
      p.spawnGraceTimer = 0.05;
      p.damage.bodyDamage = 0;

      let hayDestroyedAtDist = null;
      for (let i = 0; i < 45; i++) {
        p.updatePhysics({ throttle: 0.9, brake: 0, steer: 0, handbrake: false }, dt, wp);
        world.step();
        p.syncFromRigidBody(dt);
        const wasDestroyed = hay.destroyed;
        EnvGen.updateDestructibles([p], gm.particleFX);
        if (!wasDestroyed && hay.destroyed) {
          hayDestroyedAtDist = Math.hypot(p.position.x - hay.position.x, p.position.z - hay.position.z);
        }
      }

      return {
        fenceDestroyed: fence.destroyed,
        fenceSpeedAfter: +fenceSpeedAfter.toFixed(1),
        fenceDmgAfter,
        hayDestroyed: hay.destroyed,
        hayDestroyedAtDist: hayDestroyedAtDist !== null ? +hayDestroyedAtDist.toFixed(2) : null,
        hayDmgAfter: p.damage.bodyDamage,
      };
    });

    console.log('6. Destructible Oriented Hull Result:', destructibleResult);
    if (!destructibleResult.fenceDestroyed || destructibleResult.fenceDmgAfter > 0 || destructibleResult.fenceSpeedAfter < 30) {
      throw new Error(`Oriented fence breakaway failed: ${JSON.stringify(destructibleResult)}`);
    }
    if (!destructibleResult.hayDestroyed || destructibleResult.hayDestroyedAtDist < 1.50 || destructibleResult.hayDmgAfter > 0) {
      throw new Error(`Front-bumper hay bale breakaway failed: ${JSON.stringify(destructibleResult)}`);
    }
    console.log(`  ✓ Oriented 3.8m fence & hay bale broke cleanly (hay trigger dist=${destructibleResult.hayDestroyedAtDist}m, speed kept=${destructibleResult.fenceSpeedAfter} km/h, 0 damage)`);

    // 7. Verify True-to-Body (3.80m x 1.58m) Car-to-Car Bumper Contact Distance
    const carBumperResult = await page.evaluate(() => {
      const gm = window._gameManager;
      const p1 = gm.playerVehicle;
      const aiCar = gm.aiBots[0].vehicle;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const THREE = window.THREE;
      const dt = 1 / 60;

      const wp0 = wp[0];
      const t0 = wp0.tangent || new THREE.Vector3(0, 0, 1);
      const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t0);
      const basePos = wp0.point.clone().add(new THREE.Vector3(0, 0.45, 0));

      p1.reset(basePos.clone(), q0);
      aiCar.reset(basePos.clone().addScaledVector(t0, 9.0), q0);

      for (let i = 0; i < 15; i++) {
        p1.updatePhysics({ throttle: 0, brake: 1, steer: 0, handbrake: true }, dt, wp);
        aiCar.updatePhysics({ throttle: 0, brake: 1, steer: 0, handbrake: true }, dt, wp);
        world.step();
        p1.syncFromRigidBody(dt);
        aiCar.syncFromRigidBody(dt);
      }

      p1.rigidBody.setLinvel({ x: t0.x * 16.0, y: 0, z: t0.z * 16.0 }, true);
      p1.lastVelocity.set(t0.x * 16.0, 0, t0.z * 16.0);
      p1.spawnGraceTimer = 0.05;
      aiCar.spawnGraceTimer = 0.05;
      let minSep = Infinity;
      for (let i = 0; i < 45; i++) {
        p1.updatePhysics({ throttle: 0.9, brake: 0, steer: 0, handbrake: false }, dt, wp);
        aiCar.updatePhysics({ throttle: 0, brake: 1, steer: 0, handbrake: true }, dt, wp);
        world.step();
        p1.syncFromRigidBody(dt);
        aiCar.syncFromRigidBody(dt);
        const sep = Math.hypot(aiCar.position.x - p1.position.x, aiCar.position.z - p1.position.z);
        if (sep < minSep) minSep = sep;
      }

      gm.isPaused = false;
      return {
        minCarSeparationM: +minSep.toFixed(2),
        p1Damage: +p1.damage.bodyDamage.toFixed(3),
      };
    });

    console.log('7. Car-to-Car Bumper Contact Result:', carBumperResult);
    if (carBumperResult.minCarSeparationM < 3.45) {
      throw new Error(`Cars visually clipped inside each other! minCarSeparationM=${carBumperResult.minCarSeparationM}m (expected >= 3.45m for 3.80m chassis)`);
    }
    console.log(`  ✓ Car-to-car bumper contact stops cleanly at ${carBumperResult.minCarSeparationM}m center separation (3.80m visual body aligned)`);

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
