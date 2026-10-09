# Development Journal

Newest entries first. Plan reference: [IMPROVEMENT_PLAN.md](./IMPROVEMENT_PLAN.md).

## 2026-10-09 — Plan created; isolated testing sweep status

**Done**
- Reviewed implementation (physics, audio, graphics, UI, net, build) and wrote `docs/IMPROVEMENT_PLAN.md` (≈70 items across mechanics, visuals, UI/UX, audio, performance, code quality; P0/P1/P2).
- Build (`npm run build`) passes; latest pushed commit `0d29cc8`.

## 2026-10-09 — P0 Stabilisation Complete; 100% Automated Sweep Verified

**Done**
- **V1 & V2 Playwright Automation Suite**: Implemented deterministic Playwright tests in `tests/smoke-suite.mjs` and `tests/mechanics.spec.mjs`. Each section spins up an isolated browser instance and enforces a zero-console-error gate.
- **P7 Bundle Splitting**: Reconfigured `vite.config.ts` with `manualChunks`. Core `index.js` shrunk from **5,409 kB down to 132 kB** (gzip: 37 kB). Vendor modules (`vendor-rapier`, `vendor-net-qr`, `vendor-three`) are cached independently.
- **A1, U1, U2 Audio Bus Architecture & Pause Coherence**: Refactored `AudioManager` and `EngineSynth` to an audio graph with `masterGain -> dynamicsCompressor (limiter) -> destination` and sub-buses (`engineBus`, `sfxBus`, `uiBus`). Pausing now cleanly fades master volume (no more droning engine during pause or menu). Resuming flushes `clock.getDelta()` to prevent physics leap. Added persistent volume and mute via `localStorage`.
- **M1 Real Geometric Kerb & Surface Detection**: Replaced heuristic kerb detection with geometric waypoint normal projection in `VehiclePhysics`. Computes lateral displacement against track width to detect asphalt, gravel, sand, kerb, and grass/shoulder. Kerb vibration and sound trigger only on true kerb contact.
- **M2 Race-Finish Flow**: Replaced blocking `alert()` with a glassmorphic **Race Results Modal** in `HUD.ts`. Displays placement badge, best lap, total race time, drift score, and PLN prize. Added universal English ordinal helper `getOrdinal()` (handles 11th, 12th, 13th, 21st, etc.).
- **M3 Restart Correctness**: Added comprehensive `reset()` methods across `VehiclePhysics`, `ParticleFX`, and `PurePursuitAI`. Restarting clears tyre heat, rotor heat, drift combos, skid marks, smoke puffs, and AI pursuit state.
- **P1 Zero-Allocation Per-Frame Math**: Hoisted static scratch `Vector3` and `Quaternion` instances in `VehiclePhysics`, `PurePursuitAI`, and `ParticleFX`.
- **G1 Split-Screen Post-Processing**: Added `renderToViewport()` in `PixelPostProcessor`. Split-screen dual-view mode now applies the full post-processing pipeline (bloom, vignette, tonemapping) to both player viewports.
- **P3 Post-Processing Presets**: Added `setQualityPreset()` supporting `low`, `medium`, `high`, and `ultra`.

**Isolated per-section browser testing sweep — verified results**

| Section | Result | Console Errors | Page Errors |
|---------|--------|----------------|-------------|
| 1 Main menu | **PASSED** | 0 | 0 |
| 2 Garage | **PASSED** | 0 | 0 |
| 3 Quick race | **PASSED** | 0 | 0 |
| 4 Pause/settings | **PASSED** | 0 | 0 |
| 5 Split-screen | **PASSED** | 0 | 0 |
| 6 Multiplayer lobby | **PASSED** | 0 | 0 |
| Mechanics (Finish & Restart) | **PASSED** | 0 | 0 |

## 2026-10-09 — Phase 2: Feel & Polish Complete; Automated Regression Verified
 
**Done**
- **G6 & P2 GPU Gerstner Water Shader**: Moved 2,400-vertex CPU river displacement in `GameManager` to custom `ShaderMaterial` with 3-wave Gerstner vertex displacement, normal perturbation, Schlick Fresnel reflectance, shallow-to-deep gradient, and wave-crest foam. CPU loop eliminated.
- **G2 HDR Bloom HalfFloat Buffer**: Switched `PixelPostProcessor` render target to `THREE.HalfFloatType`. Replaced hard thresholding with quadratic soft-knee threshold and 12-tap multi-scale Gaussian blur composite.
- **M4 Fixed-Step Determinism PRNG**: Created `src/utils/PRNG.ts` (Mulberry32). Replaced `Math.random()` across physics, AI, and environment generation.
- **G10 InstancedMesh Bounding Spheres & Frustum Culling**: Added `.computeBoundingSphere()` across all 12 instanced meshes (pines, birches, villas, roofs, verandas, chimneys, windows, tire stacks, hay bales, fences) in `EnvironmentGenerator`.
- **A2 & A3 Flat-Six Engine Sound & Buffer Reuse**: Engine synthesis refactored with pre-rendered white/pink/BOV/backfire static noise buffers. Added 3rd harmonic order, induction roar, and 26Hz rev-limiter ignition cut at 7,200 RPM.
- **A4 & A5 Spatial Audio & Surface Acoustics**: PannerNode HRTF spatialization on opponent engines, dynamic listener position/orientation updates. Frequency-shaped tyre screeches (asphalt bandpass, gravel lowpass, sand) and speed-proportional procedural wind roar.
- **M6 & M7 AI Lookahead & Stuck Recovery**: PurePursuitAI upgraded with braking-zone anticipation, apex lateral bias, overtaking offsets, and automatic stuck reverse maneuvers. Added automatic checkpoint respawn when flipped or off-track, plus manual `K` respawn key.
- **U3–U7 Settings, Accessibility, Gamepad & Loading Screen**: Added Settings & Accessibility modal (volumes, quality presets, reduced motion, high-contrast shift lights, gamepad telemetry). Added Gamepad API dual-motor rumble and haptic kerb feedback. Added mobile safe-area insets. Added retro-futuristic animated loading screen.
- **U11 Multiplayer Lobby Status**: Added real-time signaling status badge and quality indicator in `MenuUI`.

**Automated verification sweep results**:
- `tests/smoke-suite.mjs`: All 6 isolated browser sections PASSED (0 console errors, 0 page errors).
- `tests/mechanics.spec.mjs`: Race finish modal & restart mechanics PASSED (0 console errors).

### Tracking
| Phase | Items | Status |
|-------|-------|--------|
| Stabilise (P0) | V1 V2 M1 M2 M3 U1 U2 A1 P1 P3 P7 G1 | `[x]` done |
| Feel & polish | G2 G6 G10 A2–A5 M4 M6 M7 U3–U7 U11 | `[x]` done |
| Depth | G3–G5 M5 M8–M12 A6–A9 U8–U12 G7–G12 | `[~]` in progress |
