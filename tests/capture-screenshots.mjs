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
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2000); // Build up speed
    
    // Initiate drift flick with steer + handbrake
    await page.keyboard.down('KeyA');
    await page.keyboard.down('Space');
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');
    // Counter-steer into drift
    await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(800);

    const driftPath = path.join(SCREENSHOT_DIR, 'gameplay_drift.png');
    await page.screenshot({ path: driftPath });
    console.log(`✓ Saved gameplay drift screenshot to ${driftPath}`);

    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyD');
    console.log('✓ All screenshots updated successfully!');
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
