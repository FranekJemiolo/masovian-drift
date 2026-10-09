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

### Tracking
| Phase | Items | Status |
|-------|-------|--------|
| Stabilise (P0) | V1 V2 M1 M2 M3 U1 U2 A1 P1 P3 P7 G1 | `[x]` done |
| Feel & polish | G2 G6 G10 A2–A5 M4 M6 M7 U3–U7 U11 | `[ ]` not started |
| Depth | G3–G5 M5 M8–M12 A6–A9 U8–U12 G7–G12 | `[ ]` not started |
