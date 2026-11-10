import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runAIRacingVerification() {
  console.log('===================================================================');
  console.log('[TEST] AI Racing, Trajectory Optimization & Overtake Verification');
  console.log('===================================================================');

  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`  [Browser Console Error]: ${msg.text()}`);
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    console.error(`  [Uncaught Page Error]: ${err.message}`);
    pageErrors.push(err.message);
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#menu-root', { timeout: 30000 });
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 30000 });
    await page.waitForFunction(() => window._gameManager?.aiBots?.length === 5, { timeout: 15000 });

    // -------------------------------------------------------------------------
    // TEST 1: TrackRacingProfile Geometry & Curvature Minimization
    // -------------------------------------------------------------------------
    console.log('\n1. Verifying TrackRacingProfile curvature minimization & road bounds...');
    const profileCheck = await page.evaluate(() => {
      const gm = window._gameManager;
      const track = gm.aiBots[0].getRacingLineProfile();
      let sumCenterSq = 0;
      let sumRaceSq = 0;
      let peakCenter = 0;
      let peakRace = 0;
      let maxAbsRaceD = 0;
      let minMarginM = Infinity;

      for (let i = 0; i < track.count; i++) {
        const ck = Math.abs(track.centerKappa[i]);
        const rk = Math.abs(track.raceKappa[i]);
        sumCenterSq += ck * ck;
        sumRaceSq += rk * rk;
        if (ck > peakCenter) peakCenter = ck;
        if (rk > peakRace) peakRace = rk;
        const absD = Math.abs(track.racingLineD[i]);
        if (absD > maxAbsRaceD) maxAbsRaceD = absD;
        const margin = track.halfWidth[i] - absD;
        if (margin < minMarginM) minMarginM = margin;
      }

      const rmsCenter = Math.sqrt(sumCenterSq / track.count);
      const rmsRace = Math.sqrt(sumRaceSq / track.count);
      const rmsReductionPct = ((rmsCenter - rmsRace) / Math.max(1e-6, rmsCenter)) * 100;
      const peakReductionPct = ((peakCenter - peakRace) / Math.max(1e-6, peakCenter)) * 100;

      return {
        waypointCount: track.count,
        totalLengthM: +track.totalLength.toFixed(1),
        rmsCenter: +rmsCenter.toFixed(5),
        rmsRace: +rmsRace.toFixed(5),
        peakCenter: +peakCenter.toFixed(5),
        peakRace: +peakRace.toFixed(5),
        rmsReductionPct: +rmsReductionPct.toFixed(1),
        peakReductionPct: +peakReductionPct.toFixed(1),
        maxAbsRaceD: +maxAbsRaceD.toFixed(2),
        minMarginM: +minMarginM.toFixed(2),
      };
    });

    console.log('  TrackRacingProfile metrics:', profileCheck);
    if (profileCheck.waypointCount !== 140) {
      throw new Error(`Expected 140 waypoints, got ${profileCheck.waypointCount}`);
    }
    if (profileCheck.totalLengthM < 1800 || profileCheck.totalLengthM > 2300) {
      throw new Error(`Unexpected track length ${profileCheck.totalLengthM}m`);
    }
    if (profileCheck.rmsReductionPct < 8.0 || profileCheck.peakReductionPct < 10.0) {
      throw new Error(`Insufficient racing-line smoothing: rms=${profileCheck.rmsReductionPct}%, peak=${profileCheck.peakReductionPct}%`);
    }
    if (profileCheck.minMarginM < 1.2) {
      throw new Error(`Racing line violates track edge margin: minMarginM=${profileCheck.minMarginM}m`);
    }
    console.log(`  ✓ Minimax racing line reduced RMS curvature by ${profileCheck.rmsReductionPct}% (peak ${profileCheck.peakReductionPct}%) with >= ${profileCheck.minMarginM}m road margin`);

    // -------------------------------------------------------------------------
    // TEST 2: Live Unpaused Countdown Freeze & Grid Launch Around Parked P1
    // -------------------------------------------------------------------------
    console.log('\n2. Verifying live pre-race countdown & real-time Race Loop overtake around parked P1...');
    // Check countdown freeze while live animate loop is running
    await page.waitForTimeout(500);
    const countdownCheck = await page.evaluate(() => {
      const gm = window._gameManager;
      return {
        isCountingDown: gm.isCountingDown,
        botSpeeds: gm.aiBots.map((b) => +b.vehicle.speedKmh.toFixed(2)),
      };
    });
    console.log('  During countdown:', countdownCheck);
    if (countdownCheck.botSpeeds.some((s) => s > 0.2)) {
      throw new Error(`Bots crept during countdown: ${JSON.stringify(countdownCheck.botSpeeds)}`);
    }

    // Wait for race to go live and reach >= 3.5s of simulated totalRaceTime with P1 parked untouched on pole
    await page.waitForFunction(
      () => window._gameManager && !window._gameManager.isCountingDown && window._gameManager.totalRaceTime >= 3.5,
      { timeout: 45000 }
    );

    const liveLaunchCheck = await page.evaluate(() => {
      const gm = window._gameManager;
      const p = gm.playerVehicle;
      const track = gm.aiBots[0].getRacingLineProfile();
      const projP = { idx: 0, closestIdx: 0, t: 0, s: 0, d: 0, halfWidth: 7.5, surface: 'asphalt', sinGrade: 0, centerX: 0, centerY: 0, centerZ: 0, normX: 1, normZ: 0, tangX: 0, tangZ: 1 };
      track.projectToTrack(p.position.x, p.position.z, 0, projP);

      const bots = gm.aiBots.map((b) => {
        const proj = { ...projP };
        track.projectToTrack(b.vehicle.position.x, b.vehicle.position.z, b.currentTargetIndex, proj);
        const deltaAheadOfP1 = track.signedArcDelta(projP.s, proj.s);
        return {
          name: b.profile.name,
          speedKmh: +b.vehicle.speedKmh.toFixed(1),
          deltaAheadOfP1: +deltaAheadOfP1.toFixed(1),
          d: +proj.d.toFixed(2),
          damage: +b.vehicle.damage.bodyDamage.toFixed(3),
          isOffTrack: b.vehicle.isOffTrack,
        };
      });

      return {
        totalRaceTime: +gm.totalRaceTime.toFixed(2),
        p1Damage: +p.damage.bodyDamage.toFixed(4),
        bots,
      };
    });

    console.log('  Live race @ >= 3.5s (P1 parked untouched):', JSON.stringify(liveLaunchCheck, null, 2));
    if (liveLaunchCheck.p1Damage > 0) {
      throw new Error(`AI collided with parked P1 during live launch! p1Damage=${liveLaunchCheck.p1Damage}`);
    }
    for (const bot of liveLaunchCheck.bots) {
      if (bot.deltaAheadOfP1 <= 10.0) {
        throw new Error(`${bot.name} failed to clear parked P1 cleanly (deltaAhead=${bot.deltaAheadOfP1}m)`);
      }
      if (bot.speedKmh < 40.0) {
        throw new Error(`${bot.name} moving too slowly in Sector 1 (${bot.speedKmh} km/h)`);
      }
      if (bot.damage > 0.05) {
        throw new Error(`${bot.name} sustained damage during grid overtake (${bot.damage})`);
      }
    }
    console.log(`  ✓ All 5 AI bots launched through live animate() pipeline and overtook parked P1 cleanly with 0 damage`);

    // -------------------------------------------------------------------------
    // TEST 3: Bidirectional Cross-Track Error Steering & Wrong-Way J-Turn Recovery
    // -------------------------------------------------------------------------
    console.log('\n3. Verifying left/right CTE rejoin signs & 180-deg wrong-way J-turn recovery...');
    const controlUnitCheck = await page.evaluate(() => {
      const gm = window._gameManager;
      gm.isPaused = true;
      gm.allVehicles.forEach((v) => v.clearInputOverride());

      const THREE = window.THREE;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const dt = 1 / 60;
      const bot = gm.aiBots[0];
      const track = bot.getRacingLineProfile();

      const testSideOffset = (signedD) => {
        const refWp = wp[5];
        const yaw = Math.atan2(refWp.tangent.x, refWp.tangent.z);
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const pos = refWp.point.clone().addScaledVector(refWp.normal, signedD);
        pos.y += 0.4;

        bot.reset();
        bot.vehicle.reset(pos, quat);
        bot.vehicle.rigidBody.setLinvel(
          { x: refWp.tangent.x * 16.0, y: 0, z: refWp.tangent.z * 16.0 },
          true
        );
        bot.setTargetIndex(5);

        const projStart = { idx: 0, closestIdx: 0, t: 0, s: 0, d: 0, halfWidth: 7.5, surface: 'asphalt', sinGrade: 0, centerX: 0, centerY: 0, centerZ: 0, normX: 1, normZ: 0, tangX: 0, tangZ: 1 };
        bot.vehicle.syncFromRigidBody(dt);
        track.projectToTrack(bot.vehicle.position.x, bot.vehicle.position.z, 5, projStart);
        const initialAbsD = Math.abs(projStart.d);

        let peakAbsSteer = 0;
        let firstSteer = 0;
        for (let f = 0; f < 65; f++) {
          const inp = bot.update(dt, []);
          if (f === 10) firstSteer = inp.steer;
          if (Math.abs(inp.steer) > peakAbsSteer) peakAbsSteer = Math.abs(inp.steer);
          bot.vehicle.updatePhysics(inp, dt, wp);
          world.step();
        }
        bot.vehicle.syncFromRigidBody(dt);
        track.projectToTrack(bot.vehicle.position.x, bot.vehicle.position.z, 5, projStart);
        const finalAbsD = Math.abs(projStart.d);

        return {
          signedD,
          initialAbsD: +initialAbsD.toFixed(2),
          finalAbsD: +finalAbsD.toFixed(2),
          firstSteer: +firstSteer.toFixed(3),
          peakAbsSteer: +peakAbsSteer.toFixed(3),
        };
      };

      const leftSide = testSideOffset(-5.0);
      const rightSide = testSideOffset(5.0);

      // Wrong-way 180 deg recovery test at wp 8
      const recWp = wp[8];
      const backYaw = Math.atan2(-recWp.tangent.x, -recWp.tangent.z);
      const backQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), backYaw);
      const recPos = recWp.point.clone();
      recPos.y += 0.4;
      bot.reset();
      bot.vehicle.reset(recPos, backQuat);
      bot.vehicle.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bot.setTargetIndex(8);

      let maxHeadingAlign = -1;
      for (let f = 0; f < 60 * 5; f++) {
        const inp = bot.update(dt, []);
        bot.vehicle.updatePhysics(inp, dt, wp);
        world.step();
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bot.vehicle.quaternion);
        const proj = { idx: 0, closestIdx: 0, t: 0, s: 0, d: 0, halfWidth: 7.5, surface: 'asphalt', sinGrade: 0, centerX: 0, centerY: 0, centerZ: 0, normX: 1, normZ: 0, tangX: 0, tangZ: 1 };
        track.projectToTrack(bot.vehicle.position.x, bot.vehicle.position.z, bot.currentTargetIndex, proj);
        const align = fwd.x * proj.tangX + fwd.z * proj.tangZ;
        if (align > maxHeadingAlign) maxHeadingAlign = align;
        if (align > 0.70 && bot.vehicle.speedKmh > 25) break;
      }

      const endFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bot.vehicle.quaternion);
      const endProj = { idx: 0, closestIdx: 0, t: 0, s: 0, d: 0, halfWidth: 7.5, surface: 'asphalt', sinGrade: 0, centerX: 0, centerY: 0, centerZ: 0, normX: 1, normZ: 0, tangX: 0, tangZ: 1 };
      track.projectToTrack(bot.vehicle.position.x, bot.vehicle.position.z, bot.currentTargetIndex, endProj);
      const finalAlign = endFwd.x * endProj.tangX + endFwd.z * endProj.tangZ;

      gm.isPaused = false;
      return {
        leftSide,
        rightSide,
        jturn: {
          maxHeadingAlign: +maxHeadingAlign.toFixed(3),
          finalAlign: +finalAlign.toFixed(3),
          finalSpeedKmh: +bot.vehicle.speedKmh.toFixed(1),
        },
      };
    });

    console.log('  CTE & Recovery unit checks:', JSON.stringify(controlUnitCheck, null, 2));
    if (controlUnitCheck.leftSide.finalAbsD >= controlUnitCheck.leftSide.initialAbsD - 0.8) {
      throw new Error(`Left offset (-5.0m) failed to converge toward track center: ${JSON.stringify(controlUnitCheck.leftSide)}`);
    }
    if (controlUnitCheck.rightSide.finalAbsD >= controlUnitCheck.rightSide.initialAbsD - 0.8) {
      throw new Error(`Right offset (+5.0m) failed to converge toward track center: ${JSON.stringify(controlUnitCheck.rightSide)}`);
    }
    if (controlUnitCheck.jturn.finalAlign < 0.6 || controlUnitCheck.jturn.finalSpeedKmh < 20) {
      throw new Error(`180-deg wrong-way J-turn recovery failed: ${JSON.stringify(controlUnitCheck.jturn)}`);
    }
    console.log('  ✓ Bidirectional CTE steering & 180-deg J-turn spin recovery verified');

    // -------------------------------------------------------------------------
    // TEST 4: Full 2-Lap 5-Bot Race Benchmark with Parked P1 & Real GameManager Progression
    // -------------------------------------------------------------------------
    console.log('\n4. Running full 2-lap 5-bot race benchmark (parked P1, checkVehicleRecovery active)...');
    const raceResult = await page.evaluate(() => {
      const gm = window._gameManager;
      gm.restartRace();
      gm.countdownRemaining = -1.2;
      gm.isPaused = true;
      gm.allVehicles.forEach((v) => v.clearInputOverride());

      const dt = 1 / 60;
      const totalFrames = 175 * 60;
      const p = gm.playerVehicle;
      const bots = gm.aiBots;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;

      const stats = bots.map((b) => ({
        name: b.profile.name,
        crashes: 0,
        inCrash: false,
        offTrackSec: 0,
        wrongWaySec: 0,
        driftSec: 0,
        maxSpeedKmh: 0,
        maxOffExcessM: 0,
        lapTimes: [],
        lapStartT: 0,
        prevPos: b.vehicle.position.clone(),
        respawnCount: 0,
        cumS: 0,
        lastS: null,
        lap: 1,
      }));

      let p1Contacts = 0;
      let p1MinDist = Infinity;

      for (let f = 0; f < totalFrames; f++) {
        const simT = f * dt;

        // P1 parked on start grid
        p.updatePhysics({ throttle: 0, brake: 1, steer: 0, handbrake: true }, dt, wp);
        for (let i = 0; i < bots.length; i++) {
          const inp = bots[i].update(dt, gm.allVehicles);
          bots[i].vehicle.updatePhysics(inp, dt, wp);
        }

        world.step();

        for (const v of gm.allVehicles) {
          v.syncFromRigidBody(dt);
          gm.checkVehicleRecovery(v, dt);
        }
        gm.updateRaceProgression(dt);

        if (p.justCrashed > 0) p1Contacts++;

        let allDone = true;
        for (let i = 0; i < bots.length; i++) {
          const b = bots[i];
          const v = b.vehicle;
          const st = stats[i];
          const track = b.getRacingLineProfile();

          const dp = Math.hypot(v.position.x - p.position.x, v.position.z - p.position.z);
          if (dp < p1MinDist) p1MinDist = dp;

          const jumpDist = Math.hypot(v.position.x - st.prevPos.x, v.position.z - st.prevPos.z);
          if (jumpDist > 12.0) st.respawnCount++;
          st.prevPos.copy(v.position);

          if (v.speedKmh > st.maxSpeedKmh) st.maxSpeedKmh = v.speedKmh;
          if (v.isOffTrack) st.offTrackSec += dt;
          if (v.isWrongWay) st.wrongWaySec += dt;
          if (v.isDrifting) st.driftSec += dt;

          const wIdx = v.lastClosestWpIdx % wp.length;
          const n = wp[wIdx].normal;
          const dSigned = (v.position.x - wp[wIdx].point.x) * n.x + (v.position.z - wp[wIdx].point.z) * n.z;
          const edgeExcess = Math.abs(dSigned) - wp[wIdx].width * 0.5;
          if (edgeExcess > st.maxOffExcessM) st.maxOffExcessM = edgeExcess;

          if (v.justCrashed > 0) {
            if (!st.inCrash) {
              st.crashes++;
              st.inCrash = true;
            }
          } else {
            st.inCrash = false;
          }

          const curS = track.cumDist[wIdx];
          if (st.lastS === null) st.lastS = curS;
          let ds = curS - st.lastS;
          if (ds < -track.totalLength * 0.5) ds += track.totalLength;
          if (ds > track.totalLength * 0.5) ds -= track.totalLength;
          st.cumS += ds;
          st.lastS = curS;

          const lapNow = Math.floor(Math.max(0, st.cumS) / track.totalLength) + 1;
          v.currentLap = lapNow;
          if (lapNow > st.lap) {
            st.lapTimes.push(+(simT - st.lapStartT).toFixed(2));
            st.lapStartT = simT;
            st.lap = lapNow;
          }
          if (st.lapTimes.length < 2) allDone = false;
        }

        if (allDone) break;
      }

      gm.isPaused = false;
      return {
        p1Damage: +p.damage.bodyDamage.toFixed(4),
        p1Contacts,
        p1MinClearanceM: +p1MinDist.toFixed(2),
        bots: stats.map((st, idx) => ({
          name: st.name,
          laps: st.lapTimes,
          bestLap: st.lapTimes.length ? Math.min(...st.lapTimes) : null,
          crashes: st.crashes,
          damage: +bots[idx].vehicle.damage.bodyDamage.toFixed(4),
          offTrackSec: +st.offTrackSec.toFixed(2),
          wrongWaySec: +st.wrongWaySec.toFixed(2),
          maxOffExcessM: +st.maxOffExcessM.toFixed(2),
          maxSpeedKmh: Math.round(st.maxSpeedKmh),
          respawns: st.respawnCount,
        })),
      };
    });

    console.log('  2-Lap Race Result:', JSON.stringify(raceResult, null, 2));
    if (raceResult.p1Damage > 0 || raceResult.p1Contacts > 0) {
      throw new Error(`AI struck parked P1 over 2 laps: p1Damage=${raceResult.p1Damage}, p1Contacts=${raceResult.p1Contacts}`);
    }

    for (const bot of raceResult.bots) {
      if (bot.laps.length < 2) {
        throw new Error(`${bot.name} did not complete 2 full laps (laps=${JSON.stringify(bot.laps)})`);
      }
      if (bot.bestLap === null || bot.bestLap > 76.0) {
        throw new Error(`${bot.name} lap pace too slow: bestLap=${bot.bestLap}s (max 76.0s)`);
      }
      if (bot.crashes > 1 || bot.damage > 0.15) {
        throw new Error(`${bot.name} excessive crashes/damage: crashes=${bot.crashes}, damage=${bot.damage}`);
      }
      if (bot.offTrackSec > 2.0) {
        throw new Error(`${bot.name} spent ${bot.offTrackSec}s off-track (max 2.0s)`);
      }
      if (bot.wrongWaySec > 0.5) {
        throw new Error(`${bot.name} drove wrong way ${bot.wrongWaySec}s (max 0.5s)`);
      }
      if (bot.respawns > 0) {
        throw new Error(`${bot.name} needed ${bot.respawns} track respawns (expected 0)`);
      }
    }

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`Recorded ${consoleErrors.length} console errors and ${pageErrors.length} page errors`);
    }

    console.log('\n===================================================================');
    console.log('✓ ALL AI RACING, TRAJECTORY & OVERTAKE TESTS PASSED CLEANLY!');
    console.log('===================================================================');
  } finally {
    await browser.close();
  }
}

runAIRacingVerification().catch((err) => {
  console.error('[AI RACING TEST FAILED]', err);
  process.exit(1);
});
