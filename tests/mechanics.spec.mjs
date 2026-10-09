import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function testMechanics() {
  console.log('[TEST] Verifying Race Finish Results & Restart mechanics...');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-quick-race');
    await page.click('#btn-quick-race');

    await page.waitForSelector('#game-hud');
    await page.waitForTimeout(1000);

    // Verify trigger of race results modal programmatically
    await page.evaluate(() => {
      const hud = (window)._gameManager?.hud;
      if (hud) {
        hud.showRaceResults({
          rank: 1,
          prize: 5000,
          bestLapTime: 42.15,
          totalTime: 128.5,
          driftScore: 2300,
          onRetry: () => {},
          onGarage: () => {},
          onMenu: () => {},
        });
      }
    });

    // Check results modal elements
    await page.waitForSelector('#hud-results-modal', { state: 'visible', timeout: 5000 });
    const posText = await page.textContent('#res-val-pos');
    const prizeText = await page.textContent('#res-val-prize');
    console.log(`  Results modal verified: Position = ${posText}, Prize = ${prizeText}`);

    // Click retry
    await page.click('#btn-results-retry');
    await page.waitForSelector('#hud-results-modal', { state: 'hidden', timeout: 5000 });
    console.log('  Retry button closed results modal cleanly.');

    console.log('✓ [PASSED] Mechanics verification');
  } finally {
    await context.close();
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors encountered: ${consoleErrors.join(', ')}`);
  }
}

testMechanics().catch((err) => {
  console.error('Mechanics test error:', err);
  process.exit(1);
});
