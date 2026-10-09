import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runSectionTest(sectionName, testFn) {
  console.log(`\n========================================`);
  console.log(`[TEST] Starting Section: ${sectionName}`);
  console.log(`========================================`);

  // Launch isolated fresh browser instance for every section
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: []
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const uncaughtErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`  [Console Error in ${sectionName}]: ${msg.text()}`);
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    console.error(`  [Uncaught Page Error in ${sectionName}]: ${err.message}`);
    uncaughtErrors.push(err.message);
  });

  let passed = false;
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Wait for main canvas or menu
    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.waitForSelector('#menu-root', { timeout: 10000 });

    await testFn(page);
    passed = true;
    console.log(`✓ [PASSED] Section: ${sectionName}`);
  } catch (err) {
    console.error(`✗ [FAILED] Section: ${sectionName}:`, err);
  } finally {
    await context.close();
    await browser.close();
  }

  if (consoleErrors.length > 0 || uncaughtErrors.length > 0) {
    console.error(`✗ [GATE FAIL] Section ${sectionName} recorded errors:`);
    if (consoleErrors.length > 0) console.error(`  Console errors:`, consoleErrors);
    if (uncaughtErrors.length > 0) console.error(`  Page errors:`, uncaughtErrors);
    return { passed: false, errors: [...consoleErrors, ...uncaughtErrors] };
  }

  return { passed, errors: [] };
}

async function main() {
  const results = {};

  // SECTION 1: Main Menu
  results['1 Main menu'] = await runSectionTest('1 Main menu', async (page) => {
    const title = await page.textContent('.game-title');
    if (!title?.includes('VOXEL BOXER')) throw new Error(`Unexpected title: ${title}`);

    const quickRaceBtn = await page.$('#btn-quick-race');
    const garageBtn = await page.$('#btn-garage');
    const splitBtn = await page.$('#btn-split-screen');
    const multiBtn = await page.$('#btn-multiplayer');

    if (!quickRaceBtn || !garageBtn || !splitBtn || !multiBtn) {
      throw new Error('Missing primary menu action buttons');
    }

    // Let showcase car render for 1 second
    await page.waitForTimeout(1000);
  });

  // SECTION 2: Garage
  results['2 Garage'] = await runSectionTest('2 Garage', async (page) => {
    await page.click('#btn-garage');
    await page.waitForSelector('.modal-dialog', { timeout: 5000 });
    const header = await page.textContent('.modal-header h2');
    if (!header?.includes('GARAGE')) throw new Error(`Unexpected garage header: ${header}`);

    // Verify car items and repair buttons
    const carItems = await page.$$('.garage-car-item');
    if (carItems.length === 0) throw new Error('No garage cars listed');

    // Click Close
    await page.click('#btn-close-modal');
    await page.waitForSelector('#menu-root .game-title', { timeout: 5000 });
  });

  // SECTION 3: Quick Race
  results['3 Quick race'] = await runSectionTest('3 Quick race', async (page) => {
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 5000 });
    
    // Check countdown overlay appears
    await page.waitForSelector('#hud-countdown', { timeout: 5000 });
    
    // Check speedometer, minimap
    const speed = await page.$('#hud-speed');
    const minimap = await page.$('#hud-minimap');
    if (!speed || !minimap) throw new Error('Missing HUD elements in quick race');

    // Simulate key presses to drive
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
  });

  // SECTION 4: Pause/Settings
  results['4 Pause/settings'] = await runSectionTest('4 Pause/settings', async (page) => {
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 5000 });
    await page.waitForTimeout(1000);

    // Open Pause
    await page.keyboard.press('Escape');
    await page.waitForSelector('#hud-pause-modal', { state: 'visible', timeout: 5000 });

    const sliderVol = await page.$('#slider-volume');
    const btnCam = await page.$('#btn-cam-chase');
    if (!sliderVol || !btnCam) throw new Error('Missing settings inputs in pause modal');

    // Test Resume
    await page.click('#btn-pause-resume');
    await page.waitForSelector('#hud-pause-modal', { state: 'hidden', timeout: 5000 });
  });

  // SECTION 5: Split-Screen
  results['5 Split-screen'] = await runSectionTest('5 Split-screen', async (page) => {
    await page.click('#btn-split-screen');
    await page.waitForSelector('#game-hud', { timeout: 5000 });
    await page.waitForSelector('#hud-p2', { state: 'visible', timeout: 5000 });
    
    // Let both players simulate for 1.5 seconds
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ArrowUp');
  });

  // SECTION 6: Multiplayer Lobby
  results['6 Multiplayer lobby'] = await runSectionTest('6 Multiplayer lobby', async (page) => {
    await page.click('#btn-multiplayer');
    await page.waitForSelector('.modal-dialog', { timeout: 5000 });
    
    // Switch tabs
    await page.click('#tab-join');
    await page.waitForSelector('#view-join', { state: 'visible', timeout: 5000 });
    
    await page.click('#tab-host');
    await page.waitForSelector('#view-host', { state: 'visible', timeout: 5000 });

    // Test Host QR Code generation
    await page.click('#btn-generate-host');
    await page.waitForSelector('#host-qr-wrap', { state: 'visible', timeout: 10000 });
    
    const qrImg = await page.$('#host-qr-img');
    const codeInput = await page.$('#host-code-input');
    if (!qrImg || !codeInput) throw new Error('Failed to generate host QR code elements');

    // Close modal
    await page.click('#btn-close-mp');
  });

  console.log('\n========================================');
  console.log('SUMMARY OF ISOLATED SECTION TESTS');
  console.log('========================================');
  let allPassed = true;
  for (const [sec, res] of Object.entries(results)) {
    const status = res.passed && res.errors.length === 0 ? 'PASSED' : 'FAILED';
    if (status === 'FAILED') allPassed = false;
    console.log(`${sec.padEnd(25)}: ${status} (Errors: ${res.errors.length})`);
  }

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
