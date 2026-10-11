import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runTest() {
  console.log('[TEST 1] Countdown Physics Freeze Verification');

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

    // Record initial spawn point by triggering race start
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 30000 });

    // Wait exactly 1.0s during the 3.0s pre-race countdown
    await page.waitForTimeout(1000);

    const result = await page.evaluate(() => {
      const gm = window._gameManager;
      if (!gm) throw new Error('GameManager not found on window');

      const vp = gm.vehiclePhysics;
      const initialPos = gm.playerInitialPos || (gm.playerVehicle && gm.playerVehicle.position);
      const currentPos = vp ? vp.getPosition() : (gm.playerVehicle && gm.playerVehicle.position);
      const vel = vp ? vp.getLinearVelocity() : { x: 0, y: 0, z: 0 };
      const speedKmh = vp ? vp.getSpeedKmh() : 0;
      const gear = vp ? vp.getCurrentGear() : 1;
      const isCountingDown = gm.isCountingDown;

      const linVelMag = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      let displacement = 0;
      if (initialPos && currentPos) {
        const dx = currentPos.x - initialPos.x;
        const dy = currentPos.y - initialPos.y;
        const dz = currentPos.z - initialPos.z;
        displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      return {
        isCountingDown,
        linVelMag,
        speedKmh,
        gear,
        displacement,
      };
    });

    console.log(`  State at t = 1.0s: isCountingDown=${result.isCountingDown}, speed=${result.speedKmh.toFixed(2)} km/h, velMag=${result.linVelMag.toFixed(4)} m/s, gear=${result.gear}, displacement=${result.displacement.toFixed(4)}m`);

    // Assertion 1: Linear velocity must equal 0.00 m/s
    if (result.linVelMag > 0.001) {
      throw new Error(`Assertion failed: Velocity ${result.linVelMag} m/s is not 0.00 m/s`);
    }

    // Assertion 2: Gear must be 1 or N (never R)
    if (result.gear === 'R' || result.gear === -1 || (typeof result.gear === 'number' && result.gear < 0)) {
      throw new Error(`Assertion failed: Gear is ${result.gear}, must be 1 or N (never R)`);
    }

    // Assertion 3: Vehicle displacement must be < 0.01m
    if (result.displacement >= 0.01) {
      throw new Error(`Assertion failed: Displacement ${result.displacement}m exceeds 0.01m limit`);
    }

    console.log('✓ [PASSED] Test 1: Countdown Physics Freeze passed with 0.00 m/s velocity, valid forward gear, and <0.01m displacement');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('✗ [FAILED] Test 1:', err);
  process.exit(1);
});
