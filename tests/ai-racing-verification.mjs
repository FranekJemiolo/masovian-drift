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
          driftSec: +st.driftSec.toFixed(2),
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
    if (raceResult.p1MinClearanceM < 1.90) {
      throw new Error(`Overtake clearance around parked P1 too tight: ${raceResult.p1MinClearanceM}m (expected >= 1.90m)`);
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

    const tomek = raceResult.bots.find((b) => b.name.includes('Tomek'));
    const kuba = raceResult.bots.find((b) => b.name.includes('Kuba'));
    const ania = raceResult.bots.find((b) => b.name.includes('Ania'));
    const marek = raceResult.bots.find((b) => b.name.includes('Marek'));
    const zofia = raceResult.bots.find((b) => b.name.includes('Zofia'));
    if (!tomek || !kuba || !ania || !marek || !zofia) {
      throw new Error('Missing expected AI personalities in race result');
    }
    if (Math.min(tomek.bestLap, kuba.bestLap) >= marek.bestLap || ania.bestLap >= marek.bestLap) {
      throw new Error(`Personality pace hierarchy inverted: Tomek=${tomek.bestLap}s, Kuba=${kuba.bestLap}s, Ania=${ania.bestLap}s vs Marek=${marek.bestLap}s`);
    }
    if (zofia.driftSec < 0.5 || zofia.crashes > 0 || zofia.damage > 0) {
      throw new Error(`Zofia Drift failed clean controlled hairpin drift invariant: ${JSON.stringify(zofia)}`);
    }
    console.log(`  ✓ Personality hierarchy (${tomek.bestLap}s / ${kuba.bestLap}s / Ania ${ania.bestLap}s vs Marek ${marek.bestLap}s) & Zofia drift (${zofia.driftSec}s, 0 crashes) verified`);

    // -------------------------------------------------------------------------
    // TEST 5: Moving Slow-Traffic Mid-Corner Overtake & Brake-Check Avoidance
    // -------------------------------------------------------------------------
    console.log('\n5. Verifying moving slow-traffic corner overtake & brake-check avoidance...');
    const trafficCheck = await page.evaluate(() => {
      const gm = window._gameManager;
      gm.restartRace();
      gm.countdownRemaining = -1.2;
      gm.isPaused = true;
      gm.allVehicles.forEach((v) => v.clearInputOverride());

      const THREE = window.THREE;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const dt = 1 / 60;
      const p1 = gm.playerVehicle;
      const tomek = gm.aiBots[2]; // Tomek Turbo
      const kuba = gm.aiBots[0];  // Kuba
      const track = tomek.getRacingLineProfile();

      const placeAt = (veh, wpIdx, signedD, speedMs) => {
        const ref = wp[wpIdx];
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ref.tangent);
        const pos = ref.point.clone().addScaledVector(ref.normal, signedD).add(new THREE.Vector3(0, 0.45, 0));
        veh.reset(pos, q);
        veh.rigidBody.setLinvel({ x: ref.tangent.x * speedMs, y: 0, z: ref.tangent.z * speedMs }, true);
        veh.lastVelocity.set(ref.tangent.x * speedMs, 0, ref.tangent.z * speedMs);
        veh.spawnGraceTimer = 0.05;
        veh.damage.bodyDamage = 0;
      };

      // Place P1 ahead near Turn 1 entry (wp[4]) and fast bots directly behind in lane
      placeAt(p1, 4, 0.0, 13.5);
      placeAt(tomek.vehicle, 3, 0.0, 18.0);
      tomek.reset();
      tomek.setTargetIndex(3);
      placeAt(kuba.vehicle, 2, 0.4, 18.5);
      kuba.reset();
      kuba.setTargetIndex(2);

      // Park remaining bots cleanly back at start straight so only P1 + Tomek + Kuba interact here
      [1, 3, 4].forEach((idx, j) => {
        placeAt(gm.aiBots[idx].vehicle, 125 + j * 2, 0, 0);
        gm.aiBots[idx].reset();
      });

      const activeSet = [p1, tomek.vehicle, kuba.vehicle];
      const projP1 = { idx: 0, closestIdx: 0, t: 0, s: 0, d: 0, halfWidth: 6.5, surface: 'asphalt', sinGrade: 0, centerX: 0, centerY: 0, centerZ: 0, normX: 1, normZ: 0, tangX: 0, tangZ: 1 };
      const projT = { ...projP1 };
      const projK = { ...projP1 };

      let p1Contacts = 0;
      let tomekMaxDelta = -Infinity;
      let kubaMaxDelta = -Infinity;

      const totalFrames = 60 * 14;
      for (let f = 0; f < totalFrames; f++) {
        const tSec = f * dt;
        // P1 drives slowly down centerline (~46 km/h) and executes sudden brake-check from 3.0s to 4.8s
        track.projectToTrack(p1.position.x, p1.position.z, p1.lastClosestWpIdx || 4, projP1);
        const lookP1 = { ...track.waypoints[projP1.idx] };
        const pFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(p1.quaternion);
        const nextIdx = (projP1.idx + 1) % wp.length;
        const aimPt = wp[nextIdx].point;
        const localAim = aimPt.clone().sub(p1.position).applyQuaternion(p1.quaternion.clone().invert());
        const steerP1 = THREE.MathUtils.clamp(Math.atan2(localAim.x, Math.max(0.5, localAim.z)) * 1.4, -0.8, 0.8);
        const isBrakeCheck = tSec >= 3.0 && tSec <= 4.8 && p1.speedKmh > 16.0;
        const p1Input = isBrakeCheck
          ? { throttle: 0, brake: 0.9, steer: steerP1, handbrake: false }
          : { throttle: p1.speedKmh < 46 ? 0.55 : 0.12, brake: 0, steer: steerP1, handbrake: false };

        p1.updatePhysics(p1Input, dt, wp);
        tomek.vehicle.updatePhysics(tomek.update(dt, activeSet), dt, wp);
        kuba.vehicle.updatePhysics(kuba.update(dt, activeSet), dt, wp);
        world.step();

        p1.syncFromRigidBody(dt);
        tomek.vehicle.syncFromRigidBody(dt);
        kuba.vehicle.syncFromRigidBody(dt);
        if (p1.justCrashed > 0) p1Contacts++;

        track.projectToTrack(p1.position.x, p1.position.z, projP1.closestIdx, projP1);
        track.projectToTrack(tomek.vehicle.position.x, tomek.vehicle.position.z, tomek.currentTargetIndex, projT);
        track.projectToTrack(kuba.vehicle.position.x, kuba.vehicle.position.z, kuba.currentTargetIndex, projK);

        const dT = track.signedArcDelta(projP1.s, projT.s);
        const dK = track.signedArcDelta(projP1.s, projK.s);
        if (dT > tomekMaxDelta) tomekMaxDelta = dT;
        if (dK > kubaMaxDelta) kubaMaxDelta = dK;
      }

      gm.isPaused = false;
      return {
        p1Damage: +p1.damage.bodyDamage.toFixed(4),
        p1Contacts,
        tomekMaxDeltaM: +tomekMaxDelta.toFixed(1),
        kubaMaxDeltaM: +kubaMaxDelta.toFixed(1),
        tomekDamage: +tomek.vehicle.damage.bodyDamage.toFixed(4),
        kubaDamage: +kuba.vehicle.damage.bodyDamage.toFixed(4),
      };
    });

    console.log('  Moving traffic & brake-check result:', trafficCheck);
    if (trafficCheck.p1Damage > 0 || trafficCheck.p1Contacts > 0 || trafficCheck.tomekDamage > 0 || trafficCheck.kubaDamage > 0) {
      throw new Error(`AI rear-ended moving/braking traffic: ${JSON.stringify(trafficCheck)}`);
    }
    if (trafficCheck.tomekMaxDeltaM < 8.0 || trafficCheck.kubaMaxDeltaM < 8.0) {
      throw new Error(`Fast bots failed to cleanly overtake slow moving P1: ${JSON.stringify(trafficCheck)}`);
    }
    console.log(`  ✓ Clean mid-corner traffic overtakes & brake-check avoidance (Tomek +${trafficCheck.tomekMaxDeltaM}m, Kuba +${trafficCheck.kubaMaxDeltaM}m, 0 damage)`);

    // -------------------------------------------------------------------------
    // TEST 6: Off-Track Static Hazard Avoidance (Roadside Tree/Tire Rejoin)
    // -------------------------------------------------------------------------
    console.log('\n6. Verifying off-track roadside static obstacle avoidance during rejoin...');
    const hazardAvoidCheck = await page.evaluate(() => {
      const gm = window._gameManager;
      gm.restartRace();
      gm.countdownRemaining = -1.2;
      gm.isPaused = true;
      gm.allVehicles.forEach((v) => v.clearInputOverride());

      const THREE = window.THREE;
      const StaticReg = window.StaticObstacleRegistry;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const bot = gm.aiBots[1]; // Ania Mazur
      const track = bot.getRacingLineProfile();
      const dt = 1 / 60;

      // Find an isolated off-track roadside tree/tire obstacle along the perimeter to spawn directly behind
      const out = Array.from({ length: 48 }, () => ({ deltaS: 0, d: 0, radius: 0, kind: 'tree' }));
      let selectedScenario = null;
      for (let w = 10; w < 120 && !selectedScenario; w += 2) {
        const sW = track.cumDist[w];
        const n = track.queryStaticHazardsNear(sW, w, 6.0, 16.0, track.halfWidth[w] + 14.0, out);
        for (let i = 0; i < n; i++) {
          const h = out[i];
          if ((h.kind === 'tree' || h.kind === 'tire') && Math.abs(h.d) > track.halfWidth[w] + 2.6 && Math.abs(h.d) < track.halfWidth[w] + 11.0) {
            // Ensure spawn spot at (sW, d = h.d) isn't colliding with another static hazard
            const spawnCheckN = track.queryStaticHazardsNear(sW, w, -3.5, 4.5, track.halfWidth[w] + 12.0, out);
            let spawnClear = true;
            for (let j = 0; j < spawnCheckN; j++) {
              if (Math.hypot(out[j].deltaS, out[j].d - h.d) < out[j].radius + 2.6) {
                spawnClear = false;
                break;
              }
            }
            if (spawnClear) {
              selectedScenario = { wpIdx: w, hazardD: h.d, hazardKind: h.kind, hazardDeltaS: h.deltaS, halfWidth: track.halfWidth[w] };
              break;
            }
          }
        }
      }

      if (!selectedScenario || !StaticReg || StaticReg.obstacles.length < 20) {
        throw new Error('Could not find valid off-track static obstacle scenario for Test 6');
      }

      const refWp = wp[selectedScenario.wpIdx];
      const spawnYaw = Math.atan2(refWp.tangent.x, refWp.tangent.z);
      const spawnQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawnYaw);
      const spawnPos = refWp.point.clone().addScaledVector(refWp.normal, selectedScenario.hazardD);
      spawnPos.y += 0.45;

      bot.reset();
      bot.vehicle.reset(spawnPos, spawnQuat);
      bot.vehicle.rigidBody.setLinvel({ x: refWp.tangent.x * 13.0, y: 0, z: refWp.tangent.z * 13.0 }, true);
      bot.vehicle.lastVelocity.set(refWp.tangent.x * 13.0, 0, refWp.tangent.z * 13.0);
      bot.vehicle.spawnGraceTimer = 0.05;
      bot.vehicle.damage.bodyDamage = 0;
      bot.setTargetIndex(selectedScenario.wpIdx);

      let crashes = 0;
      let onTrackReached = false;
      const proj = { idx: 0, closestIdx: 0, t: 0, s: 0, d: 0, halfWidth: 6.5, surface: 'asphalt', sinGrade: 0, centerX: 0, centerY: 0, centerZ: 0, normX: 1, normZ: 0, tangX: 0, tangZ: 1 };

      for (let f = 0; f < 60 * 5; f++) {
        const inp = bot.update(dt, []);
        bot.vehicle.updatePhysics(inp, dt, wp);
        world.step();
        bot.vehicle.syncFromRigidBody(dt);
        if (bot.vehicle.justCrashed > 0) crashes++;
        track.projectToTrack(bot.vehicle.position.x, bot.vehicle.position.z, bot.currentTargetIndex, proj);
        if (Math.abs(proj.d) <= proj.halfWidth + 0.5) onTrackReached = true;
      }

      gm.isPaused = false;
      return {
        scenario: selectedScenario,
        crashes,
        damage: +bot.vehicle.damage.bodyDamage.toFixed(4),
        onTrackReached,
        finalAbsD: +Math.abs(proj.d).toFixed(2),
        finalHalfWidth: +proj.halfWidth.toFixed(2),
        finalSpeedKmh: +bot.vehicle.speedKmh.toFixed(1),
      };
    });

    console.log('  Off-track hazard avoidance result:', JSON.stringify(hazardAvoidCheck, null, 2));
    if (hazardAvoidCheck.crashes > 0 || hazardAvoidCheck.damage > 0) {
      throw new Error(`Bot hit trackside obstacle during off-track rejoin: ${JSON.stringify(hazardAvoidCheck)}`);
    }
    if (!hazardAvoidCheck.onTrackReached) {
      throw new Error(`Bot failed to rejoin road cleanly within 5s: ${JSON.stringify(hazardAvoidCheck)}`);
    }
    console.log(`  ✓ Off-track rejoin skirted real ${hazardAvoidCheck.scenario.hazardKind} hazard cleanly with 0 crashes & 0 damage`);

    // -------------------------------------------------------------------------
    // TEST 7: 2-Wide Pack Gap Split, Respawn State Hygiene & Near-Edge Save
    // -------------------------------------------------------------------------
    console.log('\n7. Verifying 2-wide pack split overtake, respawn AI state hygiene & near-edge save...');
    const advancedAICheck = await page.evaluate(() => {
      const gm = window._gameManager;
      gm.restartRace();
      gm.countdownRemaining = -1.2;
      gm.isPaused = true;

      const THREE = window.THREE;
      const dt = 1 / 60;
      const wp = gm.waypoints;
      const world = gm.physicsWorld.world;
      const botA = gm.aiBots[2]; // Tomek
      const track = botA.getRacingLineProfile();
      const parkOutOfWay = (v, idx) => {
        const farWp = wp[100];
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), farWp.tangent);
        v.reset(farWp.point.clone().addScaledVector(farWp.normal, idx * 4.0).add(new THREE.Vector3(0, 0.45, 0)), q);
      };
      parkOutOfWay(gm.aiBots[0].vehicle, 1);
      parkOutOfWay(gm.aiBots[3].vehicle, 2);

      // 7A: 2-wide slow pack ahead of Tomek on straightaway (wp[3]..wp[8])
      const wp3 = wp[3];
      const q3 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp3.tangent);
      const blk1 = gm.aiBots[4].vehicle; // left lane (-4.1m)
      const blk2 = gm.playerVehicle;     // right lane (+4.1m)
      const p3Center = wp3.point.clone().add(new THREE.Vector3(0, 0.45, 0));
      blk1.reset(p3Center.clone().addScaledVector(wp3.tangent, 24.0).addScaledVector(wp3.normal, -4.1), q3);
      blk2.reset(p3Center.clone().addScaledVector(wp3.tangent, 27.0).addScaledVector(wp3.normal, 4.1), q3);
      blk1.rigidBody.setLinvel({ x: wp3.tangent.x * 14.0, y: 0, z: wp3.tangent.z * 14.0 }, true);
      blk2.rigidBody.setLinvel({ x: wp3.tangent.x * 14.0, y: 0, z: wp3.tangent.z * 14.0 }, true);

      botA.reset();
      botA.vehicle.reset(p3Center.clone().addScaledVector(wp3.tangent, 0.0), q3);
      botA.vehicle.rigidBody.setLinvel({ x: wp3.tangent.x * 32.0, y: 0, z: wp3.tangent.z * 32.0 }, true);
      botA.vehicle.lastVelocity.set(wp3.tangent.x * 32.0, 0, wp3.tangent.z * 32.0);
      botA.vehicle.spawnGraceTimer = 0.05;
      botA.setTargetIndex(3);

      let twoWideCrashes = 0;
      const projOut = { idx: 0, closestIdx: 0, t: 0, s: 0, d: 0, halfWidth: 6.5, surface: 'asphalt', sinGrade: 0, centerX: 0, centerY: 0, centerZ: 0, normX: 1, normZ: 0, tangX: 0, tangZ: 1 };
      const projB1 = { ...projOut };
      const projB2 = { ...projOut };
      for (let f = 0; f < 60 * 3.0; f++) {
        blk1.updatePhysics({ throttle: 0.30, brake: 0, steer: 0, handbrake: false }, dt, wp);
        blk2.updatePhysics({ throttle: 0.30, brake: 0, steer: 0, handbrake: false }, dt, wp);
        const inp = botA.update(dt, [botA.vehicle, blk1, blk2]);
        botA.vehicle.updatePhysics(inp, dt, wp);
        world.step();
        blk1.syncFromRigidBody(dt);
        blk2.syncFromRigidBody(dt);
        botA.vehicle.syncFromRigidBody(dt);
        if (botA.vehicle.justCrashed > 0 || blk1.justCrashed > 0 || blk2.justCrashed > 0) twoWideCrashes++;
      }
      track.projectToTrack(botA.vehicle.position.x, botA.vehicle.position.z, botA.currentTargetIndex, projOut);
      track.projectToTrack(blk1.position.x, blk1.position.z, blk1.lastClosestWpIdx, projB1);
      track.projectToTrack(blk2.position.x, blk2.position.z, blk2.lastClosestWpIdx, projB2);
      const passedBoth = track.signedArcDelta(projB1.s, projOut.s) > 4.0 && track.signedArcDelta(projB2.s, projOut.s) > 4.0;

      // 7B: Respawn AI state hygiene check on Ania (bots[1])
      const aniaBot = gm.aiBots[1];
      aniaBot.vehicle.currentCheckpointIndex = 2;
      // Put Ania in reverse facing backwards off-line before checkpoint respawn
      const wp20 = wp[20];
      const backQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp20.tangent.clone().negate());
      aniaBot.vehicle.reset(wp20.point.clone().addScaledVector(wp20.normal, -12.0).add(new THREE.Vector3(0, 0.45, 0)), backQ);
      aniaBot.setTargetIndex(20);
      for (let f = 0; f < 25; f++) {
        aniaBot.update(dt, []);
      }
      gm.respawnVehicleAtCheckpoint(aniaBot.vehicle);
      const afterRespawnInp = aniaBot.update(dt, []);

      // 7C: Proactive near-edge outward-heading save check (85% width, angled ~26 deg explicitly outward at 72 km/h)
      const edgeWp = wp[10];
      const edgeVelDir = edgeWp.tangent.clone().multiplyScalar(Math.cos(0.45)).addScaledVector(edgeWp.normal, Math.sin(0.45)).normalize();
      const edgeQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), edgeVelDir);
      const edgeSpawn = edgeWp.point.clone().addScaledVector(edgeWp.normal, edgeWp.width * 0.425).add(new THREE.Vector3(0, 0.45, 0));
      botA.reset();
      botA.vehicle.reset(edgeSpawn, edgeQ);
      botA.vehicle.rigidBody.setLinvel({ x: edgeVelDir.x * 20.0, y: 0, z: edgeVelDir.z * 20.0 }, true);
      botA.vehicle.lastVelocity.set(edgeVelDir.x * 20.0, 0, edgeVelDir.z * 20.0);
      botA.vehicle.spawnGraceTimer = 0.05;
      botA.vehicle.damage.bodyDamage = 0;
      botA.setTargetIndex(10);
      let edgeCrashes = 0;
      let edgeMaxAbsD = 0;
      for (let f = 0; f < 240; f++) {
        const inp = botA.update(dt, []);
        botA.vehicle.updatePhysics(inp, dt, wp);
        world.step();
        botA.vehicle.syncFromRigidBody(dt);
        if (botA.vehicle.justCrashed > 0) edgeCrashes++;
        track.projectToTrack(botA.vehicle.position.x, botA.vehicle.position.z, botA.currentTargetIndex, projOut);
        if (Math.abs(projOut.d) > edgeMaxAbsD) edgeMaxAbsD = Math.abs(projOut.d);
      }

      gm.isPaused = false;
      return {
        passedBoth,
        twoWideCrashes,
        tomekDamage: +botA.vehicle.damage.bodyDamage.toFixed(4),
        afterRespawnThrottle: +afterRespawnInp.throttle.toFixed(2),
        afterRespawnBrake: +afterRespawnInp.brake.toFixed(2),
        afterRespawnAbsSteer: +Math.abs(afterRespawnInp.steer).toFixed(2),
        edgeCrashes,
        edgeMaxAbsD: +edgeMaxAbsD.toFixed(2),
        edgeFinalAbsD: +Math.abs(projOut.d).toFixed(2),
        edgeHalfWidth: +projOut.halfWidth.toFixed(2),
      };
    });

    console.log('  Advanced AI guidance checks:', advancedAICheck);
    if (!advancedAICheck.passedBoth || advancedAICheck.twoWideCrashes > 0 || advancedAICheck.tomekDamage > 0) {
      throw new Error(`2-wide pack split overtake failed: ${JSON.stringify(advancedAICheck)}`);
    }
    if (advancedAICheck.afterRespawnThrottle < 0.7 || advancedAICheck.afterRespawnBrake > 0.1 || advancedAICheck.afterRespawnAbsSteer > 0.35) {
      throw new Error(`Respawn AI state hygiene failed (stale steering/reverse): ${JSON.stringify(advancedAICheck)}`);
    }
    if (advancedAICheck.edgeCrashes > 0 || advancedAICheck.edgeFinalAbsD >= advancedAICheck.edgeHalfWidth) {
      throw new Error(`Near-edge barrier-heading save failed: ${JSON.stringify(advancedAICheck)}`);
    }
    console.log('  ✓ 2-wide pack split overtake, clean checkpoint respawn state & near-edge save verified');

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
