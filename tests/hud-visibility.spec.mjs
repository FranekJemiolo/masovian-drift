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

    console.log('✓ [PASSED] Test 4: HUD Responsiveness verified KeyT toggle and controls strip auto-fade');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('✗ [FAILED] Test 4:', err);
  process.exit(1);
});
