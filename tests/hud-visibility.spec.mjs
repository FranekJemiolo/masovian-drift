import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runTest() {
  console.log('[TEST 4] HUD Responsiveness & Telemetry Panel Toggle Verification');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#menu-root', { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.click('#btn-quick-race', { force: true });
    await page.waitForSelector('#game-hud', { timeout: 30000 });
    await page.waitForSelector('#telemetry-suspension-panel', { timeout: 5000 });

    // Step 1: Query initial state of #telemetry-suspension-panel
    const initialDisplay = await page.$eval('#telemetry-suspension-panel', (el) => {
      return window.getComputedStyle(el).display;
    });
    console.log(`  Initial Telemetry Panel display: '${initialDisplay}'`);

    // Step 2: Press KeyT to toggle off
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(300);

    const afterFirstToggle = await page.$eval('#telemetry-suspension-panel', (el) => {
      return el.style.display;
    });
    console.log(`  After first KeyT press: display = '${afterFirstToggle}'`);

    if (afterFirstToggle !== 'none') {
      throw new Error(`Assertion failed: Telemetry panel display is '${afterFirstToggle}', expected 'none'`);
    }

    // Step 3: Press KeyT again to toggle back on
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(300);

    const afterSecondToggle = await page.$eval('#telemetry-suspension-panel', (el) => {
      return el.style.display;
    });
    console.log(`  After second KeyT press: display = '${afterSecondToggle}'`);

    if (afterSecondToggle !== 'block') {
      throw new Error(`Assertion failed: Telemetry panel display is '${afterSecondToggle}', expected 'block'`);
    }

    // Step 4: Verify controls overlay auto-fade after 5.0s elapsed race time
    const initialControlsOpacity = await page.$eval('#hud-controls-pill', (el) => {
      return window.getComputedStyle(el).opacity;
    });
    console.log(`  Initial Controls Strip opacity: ${initialControlsOpacity}`);

    // Simulate 5.5s race time
    await page.evaluate(() => {
      const hud = window._gameManager?.hud;
      if (hud) {
        hud.setRaceTimer(5.5);
      }
    });
    await page.waitForTimeout(100);

    const finalControlsOpacity = await page.$eval('#hud-controls-pill', (el) => {
      return el.style.opacity;
    });
    console.log(`  Controls Strip opacity at t = 5.5s: ${finalControlsOpacity}`);

    if (finalControlsOpacity !== '0') {
      throw new Error(`Assertion failed: Controls strip opacity is '${finalControlsOpacity}', expected '0'`);
    }

    // Step 5: Verify CMR Pacenote HUD, non-overlap layout, 3D TrackGuidance & KeyG toggle
    const guidanceCheck = await page.evaluate(() => {
      const gm = window._gameManager;
      const pacenote = document.getElementById('hud-pacenote');
      const topLeft = document.querySelector('.hud-top-left');
      const minimap = document.querySelector('.minimap-wrap');
      if (!gm || !pacenote || !topLeft || !minimap) {
        return { error: 'Missing required HUD or GameManager elements' };
      }
      const pr = pacenote.getBoundingClientRect();
      const lr = topLeft.getBoundingClientRect();
      const mr = minimap.getBoundingClientRect();
      return {
        chevronBoardsCount: gm.trackGuidance?.chevronBoardsCount ?? 0,
        racingLineVisible: gm.trackGuidance?.racingLineMesh?.visible ?? false,
        cornerWallsVisible: gm.trackGuidance?.cornerWallsMesh?.visible ?? false,
        guideEnabled: gm.trackGuidance?.isGuideEnabled() ?? false,
        pacenoteRect: { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom },
        overlapLeft: pr.left < lr.right - 1,
        overlapRight: pr.right > mr.left + 1,
      };
    });
    console.log('  Track Guidance & Pacenote Layout:', guidanceCheck);

    if (
      guidanceCheck.error ||
      guidanceCheck.chevronBoardsCount < 10 ||
      !guidanceCheck.racingLineVisible ||
      !guidanceCheck.cornerWallsVisible ||
      !guidanceCheck.guideEnabled ||
      guidanceCheck.overlapLeft ||
      guidanceCheck.overlapRight
    ) {
      throw new Error(`Assertion failed: Invalid TrackGuidance or HUD layout: ${JSON.stringify(guidanceCheck)}`);
    }

    // Toggle Racing Guide off & back on via KeyG
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(150);
    const guideOff = await page.evaluate(() => ({
      enabled: window._gameManager.trackGuidance.isGuideEnabled(),
      ribbonVis: window._gameManager.trackGuidance.racingLineMesh.visible,
      badge: document.getElementById('hud-guide-badge')?.textContent,
    }));
    if (guideOff.enabled || guideOff.ribbonVis || guideOff.badge !== 'GUIDE OFF [G]') {
      throw new Error(`Assertion failed: KeyG did not disable racing guide: ${JSON.stringify(guideOff)}`);
    }

    await page.keyboard.press('KeyG');
    await page.waitForTimeout(150);
    const guideOn = await page.evaluate(() => ({
      enabled: window._gameManager.trackGuidance.isGuideEnabled(),
      ribbonVis: window._gameManager.trackGuidance.racingLineMesh.visible,
      badge: document.getElementById('hud-guide-badge')?.textContent,
    }));
    if (!guideOn.enabled || !guideOn.ribbonVis || guideOn.badge !== 'GUIDE [G]') {
      throw new Error(`Assertion failed: KeyG did not re-enable racing guide: ${JSON.stringify(guideOn)}`);
    }

    // Step 6: Teleport player approaching Turn 1 at high speed and verify live Pacenote & BRAKE callout
    await page.evaluate(() => {
      const gm = window._gameManager;
      const wp = gm.waypoints[15];
      const tang = wp.tangent;
      gm.countdownRemaining = -2.0;
      gm.playerVehicle.rigidBody.setTranslation({ x: wp.point.x, y: wp.point.y + 0.9, z: wp.point.z }, true);
      gm.playerVehicle.rigidBody.setLinvel({ x: tang.x * 42, y: 0, z: tang.z * 42 }, true);
      gm.playerVehicle.speedKmh = 151.2;
      gm.hud.update(gm.playerVehicle.getVehicleState(), undefined, gm.allVehicles.map((v) => v.getVehicleState()), gm.waypoints);
    });
    await page.waitForTimeout(200);

    const turn1Note = await page.evaluate(() => ({
      grade: document.getElementById('hud-pacenote-grade')?.textContent,
      dir: document.getElementById('hud-pacenote-dir')?.textContent,
      dist: document.getElementById('hud-pacenote-dist')?.textContent,
      alertDisp: document.getElementById('hud-pacenote-alert')?.style.display,
      alertText: document.getElementById('hud-pacenote-alert')?.textContent,
    }));
    console.log('  Turn 1 High-Speed Pacenote:', turn1Note);
    if (!turn1Note.grade || turn1Note.grade === 'GO' || turn1Note.alertDisp === 'none') {
      throw new Error(`Assertion failed: Turn 1 pacenote or BRAKE alert did not trigger: ${JSON.stringify(turn1Note)}`);
    }

    console.log('✓ [PASSED] Test 4: HUD Responsiveness, Pacenotes, 3D Guidance & KeyG toggle verified');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('✗ [FAILED] Test 4:', err);
  process.exit(1);
});
