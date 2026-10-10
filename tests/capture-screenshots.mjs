import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCREENSHOT_DIR = path.resolve('docs/screenshots');

async function captureScreenshots() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('[SCREENSHOTS] Launching browser for AAA screenshots capture...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  try {
    // 1. Menu Screenshot
    console.log('[SCREENSHOTS] Navigating to Main Menu...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#menu-root', { timeout: 30000 });
    await page.waitForTimeout(2500); // Wait for showroom rotation & voxel lighting
    
    const menuPath = path.join(SCREENSHOT_DIR, 'menu.png');
    await page.screenshot({ path: menuPath });
    console.log(`✓ Saved menu screenshot to ${menuPath}`);

    // 2. Track Start Screenshot
    console.log('[SCREENSHOTS] Launching Quick Race for Start Line shot...');
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 30000 });
    await page.waitForTimeout(1000); // Car at starting grid with 4-point stance & grandstands
    
    const startPath = path.join(SCREENSHOT_DIR, 'track_start.png');
    await page.screenshot({ path: startPath });
    console.log(`✓ Saved track start screenshot to ${startPath}`);

    // 3. Gameplay Drift Screenshot
    console.log('[SCREENSHOTS] Driving & drifting for gameplay screenshot...');
    await page.evaluate(() => {
      window._gameManager.countdownRemaining = 0;
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2800); // Accelerate up to speed
    
    // Initiate power drift flick with steer + handbrake
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');
    // Counter-steer into drift
    await page.keyboard.up('KeyD');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(900);

    const driftPath = path.join(SCREENSHOT_DIR, 'gameplay_drift.png');
    await page.screenshot({ path: driftPath });
    console.log(`✓ Saved gameplay drift screenshot to ${driftPath}`);

    // 4. Sector Splits & Tire Thermals Telemetry Screenshot
    console.log('[SCREENSHOTS] Triggering sector split and clutch kick telemetry shot...');
    await page.evaluate(() => {
      window._gameManager.hud.showSectorSplit('⏱️ SECTOR 1: -0.245s (PB PACE)', true);
    });
    await page.waitForTimeout(500);

    const telemetryPath = path.join(SCREENSHOT_DIR, 'telemetry_thermals.png');
    await page.screenshot({ path: telemetryPath });
    console.log(`✓ Saved telemetry & thermals screenshot to ${telemetryPath}`);

    // 5. Formula Drift Tandem Judging Scorecard Screenshot
    console.log('[SCREENSHOTS] Displaying Formula Drift electronic judging scorecard...');
    await page.evaluate(() => {
      window._gameManager.hud.showTandemScorecard({
        run: 1,
        role: 'lead',
        lineScore: 28,
        angleScore: 27,
        speedScore: 19,
        proximityScore: 18,
        deductions: 0,
        totalScore: 92,
      });
    });
    await page.waitForTimeout(600);

    const tandemScorecardPath = path.join(SCREENSHOT_DIR, 'tandem_judging.png');
    await page.screenshot({ path: tandemScorecardPath });
    console.log(`✓ Saved tandem judging scorecard screenshot to ${tandemScorecardPath}`);

    await page.evaluate(() => {
      window._gameManager.hud.hideTandemScorecard();
    });

    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyD');
    console.log('✓ All 5 screenshots updated successfully!');
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
}

captureScreenshots().catch((err) => {
  console.error(err);
  process.exit(1);
});
