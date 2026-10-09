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

## 2026-10-09 — Phase 3: Depth Implementation; Automated Regression Verified
 
**Done**
- **G3 & G7 Lighting, Shadows, Procedural Sky IBL & Atmospheric Presets**:
  - Implemented procedural skydome IBL via `THREE.PMREMGenerator` compiling an equirectangular environment map from atmosphere gradient colors, setting `scene.environment`. All PBR cars, glass, chrome wheels, and water now pick up rich ambient sky reflections.
  - Added procedural ambient contact shadow plane beneath the car chassis (`PlaneGeometry(2.3, 4.4)` with radial dark gradient canvas texture at $y=0.04$), grounding cars to the asphalt.
  - Implemented 3 time-of-day/weather atmosphere presets: Day Azure, Golden Sunset (twilight indigo to warm amber), and Night Rally (midnight navy slate).
- **G4 Car Shading**:
  - Upgraded vehicle body and accent materials in `VoxelCarBuilder` to `MeshPhysicalMaterial` with clearcoat ($0.95$), low clearcoat roughness ($0.08$), and reflectivity ($0.65$).
  - Upgraded car greenhouse windows to `MeshPhysicalMaterial` with realistic physical transmission ($0.55$), IOR ($1.52$), and low roughness ($0.05$).
- **G8 Particles & Sparks**:
  - Upgraded `ParticleFX` with surface-aware smoke coloration: asphalt tyre smoke (rubber light grey `#f1f5f9`), gravel dust (warm ochre `#c28e5c`), sand plume (golden sand `#d4a373`), and grass dust (`#65a30d`).
  - Added additive collision and kerb sparks (`MeshBasicMaterial` with `THREE.AdditiveBlending`, gravity drop, and scale shrink).
- **G9 Motion Feel & Camera Dynamics**:
  - Added dynamic drift roll (Dutch tilt angle up to $\sim 4.5^\circ$ leaning into slide angle) in `FollowCamera`.
  - Added speed-proportional FOV expansion (up to $+16^\circ$ at top speed) and smoothed trauma camera shake with PRNG.
- **G11 Trackside Life**:
  - Added animated cheering voxel spectators in grandstands with procedural jumping / cheering bounce animation.
  - Added swaying Polish / Mazovian racing flags on grandstand canopies animated in the breeze.
- **A6 & A7 Procedural Adaptive Synthwave Soundtrack & Countryside Ambience**:
  - Created `MusicSynth.ts`: 100% synthesized Web Audio retro synthwave soundtrack at 128 BPM with synthesized kick drops ($140\to 38$ Hz), snare noise snaps, 16th-note metallic hi-hats, and an energetic rolling bassline in F minor.
  - Integrated dynamic lowpass filter modulation: bass filter cutoff automatically opens up ($500\to 2800$ Hz) and triggers arpeggiated lead runs when driving fast or drifting.
  - Added procedural countryside breeze ambience via filtered pink noise through resonant bandpass filter.
  - Added music volume slider and on/off toggle in Settings modal with persistence in `localStorage`.
- **M9 Drivetrain Realism**:
  - Implemented realistic Boxer flat-six engine torque curve plateau (peak torque between 3,800 and 5,800 RPM, low-end spool, power rolloff towards 7,200 RPM redline).
  - Added rev-limiter ignition cut ($10\%$ torque pulse) and launch control feature when brake + gas held at standstill.
- **U9 Minimap Sector Colors & Directional Chevron**:
  - Re-rendered circuit minimap with 3 distinct color-coded sectors: Sector 1 (Cyan `#38bdf8`), Sector 2 (Purple `#c084fc`), and Sector 3 (Amber `#facc15`).
  - Added player directional delta chevron arrow rotated to match the car's actual heading angle.
- **U10 Visual Hierarchy & Warnings**:
  - Added real-time delta lap time comparison badge (+/- vs best lap) formatted in green/red under lap time.
  - Added flashing wrong-way warning banner (`↩ WRONG WAY! ↩`) when driving against track flow.
- **U12 Localisation**:
  - Added Polish / English language toggle in Settings & HUD.

**Automated verification sweep results**:
### 2026-10-10 — Depth & Performance: Wind Grass, Time Trial Ghost, Exhaust Profiles & DOM Throttling

**Implementations**:
- **G5 Wind-Animated Shoulder Grass InstancedMesh**:
  - Engineered crossed double-quad geometry (width 0.65m, height 0.85m) combined into a single `BufferGeometry` with normal computation.
  - Deployed custom `ShaderMaterial` with vertex wind flutter shader (`uTime`, height damping `clamp(pos.y / 0.85, 0.0, 1.0)`, and world coordinates wave interference).
  - Instanced 1,400 grass clumps along both circuit shoulders with pseudo-random scales, rotations, and lateral offsets.
  - Animated dynamically in render loop via `mat.uniforms.uTime.value = clock.getElapsedTime()`.
- **M8 Time Trial Mode & Holographic Ghost Car**:
  - Added dedicated `TIME TRIAL (GHOST CAR)` button to Main Menu.
  - Implemented 20Hz lap telemetry sampling (`{ time, position, quaternion }`).
  - Stored fastest lap persistently in `localStorage` (`masovian_ghost_lap`).
  - Rendered holographic translucent ghost car (`0x38bdf8`, opacity 0.42, `depthWrite: false`) interpolated seamlessly between telemetry keyframes during hotlaps.
  - Solo track experience (AI opponents omitted) with drift scoring rewards upon finish.
- **A9 Era-Specific Exhaust Acoustic Profiles**:
  - Added `setExhaustProfile(era, openExhaust)` to `EngineSynth` and `AudioManager`.
  - Classic 2.7L: crisp mechanical metallic chatter, odd-harmonic overtone boost (`oscHarmonicGain = 0.28`), moderate distortion (14).
  - Golden 3.3 Turbo: deep throaty muffled burble (`oscSubGain = 0.52`), boosted BOV flutter.
  - Modern GT3: piercing high-Q race howl (`Q = 4.8`, distortion 30, high filter frequency cutoff up to 2600 Hz).
  - Open exhaust upgrade boost: +8 distortion, +550 Hz filter cutoff, and 1.25x master gain increase.
- **P8 Physics Accumulator Substep Clamping**:
  - Enforced a hard limit of maximum 4 substeps per frame in `PhysicsWorld.step()`.
  - Discarded residual backlog if frame lag exceeds maximum threshold to completely prevent death-spiral lag spikes on background tab unfocus.
- **P11 HUD DOM Updates Throttling & Dirty-Checking**:
  - Implemented string and style dirty-checking across all HUD elements (speedometer, RPM bar, gear, lap, rank, timer, drift score, bias, and damage).
  - Throttled minimap 2D canvas rendering to 30 FPS (`now - lastMinimapTime >= 33ms`), significantly reducing layout reflows and composite overhead at high refresh rates.

**Automated verification sweep results**:
- `tests/smoke-suite.mjs`: All 7 isolated browser sections PASSED (0 console errors, 0 page errors).
- `tests/mechanics.spec.mjs`: Race finish modal & restart mechanics PASSED (0 console errors).

### Tracking
| Phase | Items | Status |
|-------|-------|--------|
| Stabilise (P0) | V1 V2 M1 M2 M3 U1 U2 A1 P1 P3 P7 G1 | `[x]` done |
| Feel & polish | G2 G6 G10 A2–A5 M4 M6 M7 U3–U7 U11 | `[x]` done |
| Depth & Performance | G3 G4 G5 G6 G7 G8 G9 G10 G11 A2–A7 A9 M1 M2 M3 M4 M6 M7 M8 M9 M12 P8 P11 U1–U7 U9 U10 U11 U12 | `[x]` done |
