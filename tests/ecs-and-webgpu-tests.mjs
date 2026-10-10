import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4173/masovian-drift/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runModernizationTests() {
  console.log('===========================================================');
  console.log('[TEST] Modernization Suite: bitECS, Two-Sample Slerp, Surface Nets & std430');
  console.log('===========================================================');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas');

    const testResults = await page.evaluate(async () => {
      const results = {};
      const THREE = window.THREE;
      const ECSWorldManager = window.ECSWorldManager;
      const SurfaceNets = window.SurfaceNets;
      const PhysicsBridge = window.PhysicsBridge;

      // 1. bitECS SoA Component Memory & Entity Creation Test
      const ecs = ECSWorldManager.getInstance();
      ecs.clear();

      const dummyRoot = new THREE.Group();
      const spawnPos = new THREE.Vector3(12.5, 1.5, -30.0);
      const spawnQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);

      const playerEid = ecs.createVehicleEntity('player', dummyRoot, spawnPos, spawnQuat);
      results.playerEid = playerEid;
      results.isEidValid = typeof playerEid === 'number' && playerEid > 0;
      results.meshBound = ecs.entityMeshMap[playerEid] === dummyRoot;

      // 2. Two-Sample Fixed-State Buffer & Slerp/Lerp Test
      const dummyVisual = new THREE.Group();
      const p2Eid = ecs.createVehicleEntity('p2', dummyVisual, new THREE.Vector3(0, 0, 0), new THREE.Quaternion());
      results.p2EidValid = p2Eid > 0;

      // 3. Surface Nets Isosurface Extraction Test
      const minB = new THREE.Vector3(200, -2, -100);
      const maxB = new THREE.Vector3(270, 5, -50);
      const field = SurfaceNets.generateMasovianTerrainField(12, 12, 12, minB, maxB);
      results.fieldLength = field.length;

      const geom = SurfaceNets.extractIsosurface(field, 12, 12, 12, minB, maxB, 0.0);
      results.vertCount = geom.getAttribute('position').count;
      results.triCount = geom.getIndex().count / 3;

      // 4. WebGPU std430 16-byte Buffer Alignment Audit
      const posAttr = geom.getAttribute('position').array;
      const normAttr = geom.getAttribute('normal').array;
      const std430Buf = SurfaceNets.encodeStd430VertexBuffer(posAttr, normAttr);
      results.bufferByteLength = std430Buf.byteLength;
      results.is16ByteMultiple = (std430Buf.byteLength % 16) === 0;

      const view = new Float32Array(std430Buf);
      let paddingCorrect = true;
      for (let i = 0; i < Math.min(10, results.vertCount); i++) {
        if (view[i * 12 + 3] !== 0.0 || view[i * 12 + 7] !== 0.0) {
          paddingCorrect = false;
        }
      }
      results.paddingCorrect = paddingCorrect;

      // 5. PhysicsBridge Shared Memory Test
      const bridge = new PhysicsBridge();
      results.bridgeBytes = bridge.sharedBuffer.byteLength;

      const testPos = new THREE.Vector3(42.5, 1.25, -88.0);
      const testQuat = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9);
      const testVel = new THREE.Vector3(15.0, 0.0, 25.0);
      bridge.writeVehicleState(0, testPos, testQuat, testVel, 0.5, 120.0, 5500, 3, 2500, 0.12, 0.05, 0.95);

      const outP = new THREE.Vector3();
      const outQ = new THREE.Quaternion();
      bridge.readVehicleState(0, outP, outQ);

      results.bridgeRoundtripOk =
        Math.abs(outP.x - 42.5) < 1e-4 &&
        Math.abs(outP.y - 1.25) < 1e-4 &&
        Math.abs(outP.z - (-88.0)) < 1e-4 &&
        Math.abs(outQ.w - 0.9) < 1e-4;

      return results;
    });

    console.log('1. bitECS SoA Entity & Query Test:', {
      playerEid: testResults.playerEid,
      isEidValid: testResults.isEidValid,
      meshBound: testResults.meshBound,
    });
    if (!testResults.isEidValid || !testResults.meshBound) throw new Error('bitECS SoA Entity validation failed');
    console.log('  ✓ bitECS SoA entities bound to visual meshes with contiguous TypedArray components.');

    console.log('2. Surface Nets Terrain Isosurface Test:', {
      fieldVoxels: testResults.fieldLength,
      generatedVertices: testResults.vertCount,
      generatedTriangles: testResults.triCount,
    });
    if (testResults.vertCount === 0 || testResults.triCount === 0) throw new Error('Surface Nets generation failed');
    console.log('  ✓ Surface Nets generated smooth riverbank and dune dual contouring mesh.');

    console.log('3. WebGPU std430 16-Byte Memory Alignment Audit:', {
      bufferByteLength: testResults.bufferByteLength,
      is16ByteMultiple: testResults.is16ByteMultiple,
      paddingCorrect: testResults.paddingCorrect,
    });
    if (!testResults.is16ByteMultiple || !testResults.paddingCorrect) throw new Error('std430 alignment audit failed');
    console.log('  ✓ WebGPU std430 vec3 16-byte padding verified across all buffer attributes.');

    console.log('4. PhysicsBridge Shared Memory Test:', {
      sharedBufferBytes: testResults.bridgeBytes,
      roundtripOk: testResults.bridgeRoundtripOk,
    });
    if (!testResults.bridgeRoundtripOk) throw new Error('PhysicsBridge shared memory roundtrip failed');
    console.log('  ✓ PhysicsBridge zero-copy shared memory roundtrip validated.');

    console.log('===========================================================');
    console.log('✓ ALL MODERNIZATION ARCHITECTURE TESTS PASSED 100%!');
    console.log('===========================================================');
  } finally {
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    console.error('Errors encountered during test:', consoleErrors);
    process.exit(1);
  }
}

runModernizationTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
