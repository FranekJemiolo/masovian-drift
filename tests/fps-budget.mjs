import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runFpsBudgetType(profileName, viewport, deviceScaleFactor, throttleCpu = false) {
  console.log(`\n--- Profiling Frame Times: ${profileName} ---`);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
  });

  const page = await context.newPage();
  if (throttleCpu) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.click('#btn-quick-race');
    await page.waitForSelector('#game-hud');

    // Skip countdown
    await page.evaluate(() => {
      window._gameManager.countdownRemaining = 0;
    });
    await page.waitForTimeout(500);

    // Measure frame times across 120 consecutive frames in the active race
    const metrics = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const frameDeltas = [];
        let lastTime = performance.now();
        let frameCount = 0;

        function recordFrame() {
          const now = performance.now();
          const dt = now - lastTime;
          lastTime = now;
          frameDeltas.push(dt);
          frameCount++;

          if (frameCount >= 120) {
            frameDeltas.sort((a, b) => a - b);
            const sum = frameDeltas.reduce((a, b) => a + b, 0);
            const avg = sum / frameDeltas.length;
            const p50 = frameDeltas[Math.floor(frameDeltas.length * 0.50)];
            const p95 = frameDeltas[Math.floor(frameDeltas.length * 0.95)];
            const p99 = frameDeltas[Math.floor(frameDeltas.length * 0.99)];
            const fps = 1000 / avg;

            resolve({
              totalFrames: frameCount,
              avgMs: +avg.toFixed(2),
              p50Ms: +p50.toFixed(2),
              p95Ms: +p95.toFixed(2),
              p99Ms: +p99.toFixed(2),
              effectiveFps: +fps.toFixed(1),
            });
          } else {
            requestAnimationFrame(recordFrame);
          }
        }

        requestAnimationFrame(recordFrame);
      });
    });

    console.log(`Results for ${profileName}:`, metrics);
    return { profile: profileName, ...metrics };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runFpsBudgetSuite() {
  console.log('===========================================================');
  console.log('[TEST] V4: FPS / Frame-Time Budget Benchmark');
  console.log('===========================================================');

  const desktop = await runFpsBudgetType('Desktop (1080p Standard)', { width: 1280, height: 720 }, 1.0, false);
  const mobile = await runFpsBudgetType('Mobile (Throttled 4x CPU)', { width: 390, height: 844 }, 2.0, true);

  const report = {
    timestamp: new Date().toISOString(),
    profiles: [desktop, mobile],
    budgetThresholds: {
      desktopMaxP99Ms: 45.0,
      mobileMaxP99Ms: 65.0,
    },
    passed: desktop.p99Ms <= 45.0 && mobile.p99Ms <= 65.0,
  };

  const artifactDir = path.resolve(process.cwd(), 'docs');
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'fps-budget-report.json'), JSON.stringify(report, null, 2));

  console.log('\n✓ Saved CI benchmark artifact to docs/fps-budget-report.json');
  console.log('===========================================================');
  console.log(`Desktop Effective FPS: ${desktop.effectiveFps} (p99: ${desktop.p99Ms}ms)`);
  console.log(`Mobile Effective FPS:  ${mobile.effectiveFps} (p99: ${mobile.p99Ms}ms)`);
  console.log('===========================================================');
}

runFpsBudgetSuite().catch((err) => {
  console.error('FPS budget test failed:', err);
  process.exit(1);
});
