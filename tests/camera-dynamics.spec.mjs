import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runTest() {
  console.log('[TEST 3] Camera & Visual Projection FOV Expansion Verification');

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

    const result = await page.evaluate(() => {
      const gm = window._gameManager;
      if (!gm || !gm.followCamera) throw new Error('FollowCamera not found on GameManager');

      const followCam = gm.followCamera;
      const initialFov = followCam.camera.fov;

      // Simulate acceleration from 0 to 160 km/h over 3 seconds (60 FPS = 180 frames)
      const duration = 3.0;
      const fps = 60;
      const totalFrames = duration * fps;
      const dt = 1.0 / fps;

      const dummyPos = new (window).THREE.Vector3(0, 0, 0);
      const dummyQuat = new (window).THREE.Quaternion();
      const dummyVel = new (window).THREE.Vector3(0, 0, 0);

      const fovLog = [];

      for (let f = 1; f <= totalFrames; f++) {
        const t = f / totalFrames;
        const currentSpeedKmh = t * 160.0;
        dummyVel.set(0, 0, currentSpeedKmh / 3.6);

        followCam.update(dummyPos, dummyQuat, dummyVel, currentSpeedKmh, dt);
        const currFov = followCam.camera.fov;

        if (f % 30 === 0) {
          fovLog.push({ speed: currentSpeedKmh.toFixed(1), fov: currFov.toFixed(2) });
        }
      }

      const finalFov = followCam.camera.fov;

      return {
        initialFov,
        finalFov,
        fovLog,
      };
    });

    console.log(`  Initial Camera FOV: ${result.initialFov.toFixed(2)}°`);
    console.log(`  Progression: ${JSON.stringify(result.fovLog)}`);
    console.log(`  Final Camera FOV at 160 km/h: ${result.finalFov.toFixed(2)}°`);

    if (Math.abs(result.initialFov - 60.0) > 0.5) {
      throw new Error(`Assertion failed: Initial FOV ${result.initialFov}° is not within 60.0° ± 0.5°`);
    }

    if (result.finalFov < 74.0) {
      throw new Error(`Assertion failed: Final FOV at 160 km/h is ${result.finalFov.toFixed(2)}°, expected >= 74.0°`);
    }

    console.log('✓ [PASSED] Test 3: Camera & Visual Projection smoothly expanded from 60.0° to >= 74.0°');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('✗ [FAILED] Test 3:', err);
  process.exit(1);
});
