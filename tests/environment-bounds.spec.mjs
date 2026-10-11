import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runTest() {
  console.log('[TEST 2] Geometry & Glitch Scan Verification');

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
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud', { timeout: 30000 });
    await page.waitForTimeout(1000);

    const scanResult = await page.evaluate(() => {
      const gm = window._gameManager;
      if (!gm || !gm.scene) throw new Error('Scene not found on GameManager');

      const scene = gm.scene;
      let totalTraversed = 0;
      let inBoundsCount = 0;
      const glitches = [];

      scene.traverse((obj) => {
        totalTraversed++;
        if (!obj.isMesh) return;

        const worldPos = new (window).THREE.Vector3();
        obj.getWorldPosition(worldPos);

        // Check if within bounds: x in [0, 80], z in [-50, 50]
        if (worldPos.x >= 0 && worldPos.x <= 80 && worldPos.z >= -50 && worldPos.z <= 50) {
          inBoundsCount++;

          const mat = obj.material;
          if (mat) {
            const mats = Array.isArray(mat) ? mat : [mat];
            for (const m of mats) {
              if (m.emissive) {
                const hex = m.emissive.getHexString().toUpperCase();
                // Check if pure red emissive #FF0000 and unparented translation > 3.0m
                const isPureRedEmissive = hex === 'FF0000';
                const hasHighUnparentedTranslation = obj.parent === scene && obj.position.y > 3.0;

                if (isPureRedEmissive && hasHighUnparentedTranslation) {
                  glitches.push({
                    name: obj.name || 'UnnamedMesh',
                    worldPos: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                    emissive: hex,
                    parent: obj.parent ? obj.parent.type : null,
                  });
                }
              }
            }
          }
        }
      });

      return {
        totalTraversed,
        inBoundsCount,
        glitches,
      };
    });

    console.log(`  Scanned ${scanResult.totalTraversed} objects (${scanResult.inBoundsCount} in bounds x:[0,80], z:[-50,50]). Found ${scanResult.glitches.length} glitch meshes.`);

    if (scanResult.glitches.length > 0) {
      throw new Error(`Assertion failed: Found ${scanResult.glitches.length} unparented pure red emissive glitch meshes: ${JSON.stringify(scanResult.glitches)}`);
    }

    console.log('✓ [PASSED] Test 2: Geometry & Glitch Scan confirmed 0 unparented pure red emissive floating blocks');
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('✗ [FAILED] Test 2:', err);
  process.exit(1);
});
