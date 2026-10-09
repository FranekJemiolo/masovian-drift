# Voxel Boxer: Masovian Drift — Quality Improvement Plan

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done. Progress is logged in [JOURNAL.md](./JOURNAL.md).
Priority: **P0** correctness/blocking · **P1** high value · **P2** polish.
Effort: S (<½ day) · M (1–2 days) · L (3+ days).

Basis: static review of `src/` (~6.9k LOC) at commit `0d29cc8`. Items marked *(unverified)* are suspected from reading code and need profiling/repro before work starts.

---

## 0. Verification gaps (do first)

| ID | Item | Pri | Eff |
|----|------|-----|-----|
| V1 | Automated smoke tests (Playwright) per section: menu, garage, quick race, pause, split-screen, multiplayer lobby. Manual subagent runs hit 503/429 and are not reliable. | P0 | M |
| V2 | Console-error gate in CI (fail on any `console.error`/uncaught exception). | P0 | S |
| V3 | Physics regression tests (headless Rapier): 0–100 km/h time, skidpad lateral g, brake distance, restart leaves no state behind. | P1 | M |
| V4 | FPS/frame-time budget test (desktop + throttled mobile profile), record in CI artifact. | P1 | M |

## 1. Game mechanics

| ID | Item | Pri | Eff |
|----|------|-----|-----|
| M1 | **Real kerb/surface detection.** Curb audio/shake is currently a heuristic (speed + steer + roll + `Math.random() < 0.08`). Derive from waypoint lateral offset / surface type. Use same signal for grip modifiers (gravel/sand/grass), dust particles, and sound. | P0 | M |
| M2 | **Race-finish flow.** `handleRaceFinish` uses `alert()` with a hardcoded ordinal (`['st','nd','rd','th']` is wrong for rank 11+ and blocks the loop). Replace with a results screen (positions, best lap, drift score, PLN earned, retry/menu). | P0 | M |
| M3 | **Restart correctness.** `restartRace` resets position/laps but not damage, tyre heat, `brakeRotorHeat`, drift combo, AI integrator state, particles, skid marks. Add a single `reset()` on `VehiclePhysics`/AI/FX. | P0 | S |
| M4 | **Fixed-step determinism.** Remove `Math.random()` from physics (`damage.steeringAlignmentOffset`) and AI (sand drift roll); use seeded PRNG. Prerequisite for netcode reconciliation and replays. | P1 | S |
| M5 | **Network model.** Currently broadcasts state only; remote car is not simulated/interpolated against ghost collisions. Add snapshot interpolation with jitter buffer, lag compensation, and ghost-vs-solid option. | P1 | L |
| M6 | **AI quality.** Pure-pursuit only: add racing line (apex/late-brake from curvature), braking-zone lookahead, overtaking offsets, per-bot skill/mistakes, rubber-banding (opt-in), recovery when stuck/flipped. | P1 | L |
| M7 | **Reset/recovery.** Auto-respawn at last checkpoint when flipped or off-track >N s, with penalty. Current `R` key restarts the whole race. | P1 | S |
| M8 | **Game modes.** Time trial with ghost, drift challenge scoring, checkpoint sprint; difficulty levels. | P2 | L |
| M9 | **Drivetrain realism.** Torque curve per engine, clutch/launch control, rev-limiter cut, manual/auto shifting option, TCS/ABS aids toggle in settings. | P2 | M |
| M10 | **Damage model.** Visible deformation (voxel detach), performance loss tied to repair shop; align with `EvolutionStore` persistence. | P2 | L |
| M11 | **Progression/economy balance pass.** Tune prices/rewards; unlock tracks and eras; save settings and best laps. | P2 | M |
| M12 | **More tracks / weather / time of day.** Track data is one hardcoded waypoint loop (minimap bounds also hardcoded). | P2 | L |

## 2. Visuals

| ID | Item | Pri | Eff |
|----|------|-----|-----|
| G1 | **Split-screen bypasses post-processing** (`renderFrame` renders scene directly). Visuals differ between modes; render each viewport through the post pipeline with scissor. | P0 | M |
| G2 | **Bloom is a cheap 8×2-tap thresholded blur in the final pass** (no HDR buffer, thresholds on LDR values, visible noise on edges). Move to HalfFloat render target + proper downsample/upsample bloom chain, apply tonemapping after bloom. | P1 | M |
| G3 | **Lighting**: single directional + hemi + ambient. Add image-based lighting from the procedural sky (PMREM) for metals/glass, contact AO (SSAO/GTAO or baked blob shadows), soft cascaded shadows (2 cascades) instead of a fixed 75 m frustum. | P1 | L |
| G4 | **Car shading**: bodies are flat-shaded boxes. Add bevelled/rounded voxel meshing (greedy mesh + chamfer), clearcoat paint (`MeshPhysicalMaterial`), emissive lamps, window reflections, livery decals via procedural canvas texture, wheel blur at speed. | P1 | L |
| G5 | **Terrain**: vertex-colour 80×80 plane, flat shaded. Add splat shader (grass/dirt/sand/gravel), GPU wind-animated grass instances, shoreline foam, distance fade. | P1 | L |
| G6 | **Water**: CPU-displaced 2.4k-vertex plane each frame with stale normals. Move to a vertex shader (time uniform), add Fresnel, depth tint, shore foam, sun glitter. | P1 | M |
| G7 | **Sky/atmosphere**: add time-of-day, sun disc with bloom, height fog, volumetric god-rays (screen-space), animated cloud shadows. | P2 | M |
| G8 | **Particles**: smoke/dust are opaque-ish cubes; switch to soft billboarded sprites with texture atlas generated on canvas, additive sparks on scrapes, rain/mud splash, tyre-smoke tinted by surface. | P2 | M |
| G9 | **Motion feel**: speed lines, per-object motion blur (velocity buffer or radial blur), camera roll in drifts, FOV kick on nitro/launch. | P2 | M |
| G10 | **LOD & culling for props**: trees/villas/fans are always rendered; add distance LOD (billboards), frustum culling by chunk, shadow-caster distance limit. | P1 | M |
| G11 | **Trackside life**: animated spectators (instanced, vertex-animated), flags, drones/helicopter replay camera. | P2 | M |
| G12 | **Replay + photo mode** with free camera and DoF. | P2 | L |

## 3. UI / UX

| ID | Item | Pri | Eff |
|----|------|-----|-----|
| U1 | **Pause state coherence**: pausing does not pause audio (engine keeps droning), clocks (`clock.getDelta` accumulates), or lap timers visually; resuming can produce a big delta. Suspend `AudioContext`/ramp gains and clamp delta on resume. | P0 | S |
| U2 | **Volume slider vs mute**: slider sets only player synth `masterGain`, overrides mute, ignores P2/UI/SFX buses. Introduce a master/SFX/engine/UI bus graph with persistent settings. | P0 | S |
| U3 | **Settings persistence** (volume, camera, resolution scale, bloom, key bindings) in `localStorage`; apply on boot; expose from main menu too (currently only reachable while racing). | P1 | S |
| U4 | **Accessibility**: remappable controls, colour-blind-safe shift lights, reduced motion/shake/flash options (limiter strobe and chromatic aberration), scalable HUD, keyboard/gamepad menu navigation, ARIA labels/focus trapping in modals. | P1 | M |
| U5 | **Gamepad support** with rumble (`navigator.getGamepads`) and haptics on mobile. | P1 | M |
| U6 | **Mobile layout**: HUD is desktop-sized (controls pill hides nothing on narrow widths, telemetry card + cluster collide). Add responsive HUD, safe-area insets, orientation prompt, touch-control calibration. | P1 | M |
| U7 | **Loading experience**: no progress UI while WASM + track build runs; add loader with tips and error state if WebGL/WASM unsupported. | P1 | S |
| U8 | **Onboarding**: first-run tutorial (throttle, braking points, drift), ghost braking-line hint toggle. | P2 | M |
| U9 | **Minimap**: hardcoded world bounds; derive from waypoints, add heading arrow, sector colouring, rotating mode. | P2 | S |
| U10 | **Visual hierarchy of HUD**: demote 4-point suspension card by default (show on toggle), add delta-time vs best lap, sector times, gap to rival, wrong-way warning. | P2 | M |
| U11 | **Multiplayer lobby UX**: QR flow is manual (copy/paste SDP). Add status/timeout/retry states, connection quality indicator, clear error messages. | P1 | M |
| U12 | **Localisation** (PL/EN) with string table; HUD and menu strings are hardcoded. | P2 | M |

## 4. Audio

| ID | Item | Pri | Eff |
|----|------|-----|-----|
| A1 | **Bus architecture**: all SFX connect to `ctx.destination` or per-engine `masterGain`. Build `master → compressor/limiter → destination` with `engine`, `sfx`, `ui`, `ambience`, `music` sub-buses; dedicated ducking for countdown/UI. | P0 | M |
| A2 | **Engine model**: sawtooth+triangle stack through distortion is thin. Move to AudioWorklet (or additive/granular) synth with firing-order pulses, intake/exhaust resonators, load-dependent harmonics, and rev-limiter cut. Calibrate for a flat-six boxer (3rd/6th order emphasis). | P1 | L |
| A3 | **Buffer reuse**: BOV/backfire/curb allocate a new `AudioBuffer` and nodes per call, `Math.random()` filling at runtime. Pre-render noise buffers once and pool nodes. | P1 | S |
| A4 | **Spatial audio**: other cars, crowds and trackside objects via `PannerNode` (HRTF) with doppler; listener follows active camera; split-screen mixing per player. | P1 | M |
| A5 | **Surface/tyre audio**: layered screech by slip ratio and surface (asphalt/gravel/sand/grass), kerb thump tied to M1, wind noise vs speed, suspension bottoming, gear-shift clunk, brake squeal. | P1 | M |
| A6 | **Environmental ambience**: birds, wind through pines, crowd swell near grandstands, distant turbines, water near the river. | P2 | M |
| A7 | **Music**: procedural adaptive soundtrack (menu theme, race layers keyed to position/laps, results sting). Keep fully synthesised. | P2 | L |
| A8 | **Mix/QA**: loudness normalisation (−16 LUFS target), clipping detection, mute-on-blur / suspend on tab hidden, iOS unlock verification. | P1 | S |
| A9 | Player-selectable engine/exhaust profiles tied to Evolution garage eras. | P2 | M |

## 5. Performance & efficiency

| ID | Item | Pri | Eff |
|----|------|-----|-----|
| P1 | **Per-frame allocations**: `new THREE.Vector3/Quaternion` in `VehiclePhysics.updatePhysics`/`updateVisuals`, `ParticleFX`, `PurePursuitAI`, `HUD` (`getVehicleState` per vehicle per frame, array `.map`). Hoist scratch objects; avoid GC spikes on mobile. | P0 | M |
| P2 | **Water CPU animation** (2.4k verts every frame, 4 `Math.sin/cos`) → shader (see G6). | P1 | S |
| P3 | **Post-process cost**: 16 extra full-res texture taps + 4 depth taps + 4 colour taps per pixel at native DPR (up to 2×). Add dynamic resolution scaling driven by frame time, half-res bloom, optional "Low/Med/High/Ultra" presets. | P0 | M |
| P4 | **Shadows**: shadow map updated every frame at 2048² for ~2k instanced objects. Snap light to texel grid to stop shimmer, cull casters by distance, optionally 1024 on low preset. | P1 | S |
| P5 | **Draw calls/instancing**: gantry, fences' meshes, grandstand fans (`Mesh` per fan), hay/barriers use many individual `Mesh`es. Merge static geometry per material, use `InstancedMesh` for fans and posts. | P1 | M |
| P6 | **Startup cost**: terrain build is O(vertices × waypoints) (6.5k × 140 loop). Precompute with spatial grid; move heavy generation to a worker; seed placement with PRNG for reproducibility. | P1 | M |
| P7 | **Bundle size**: single 5.4 MB JS chunk (`@zxing/library`, `qrcode`, `pako`, Rapier WASM inline). Dynamic-import multiplayer/QR stack and garage; manual chunks; target <1.5 MB initial. | P0 | S |
| P8 | **Physics scheduling**: verify fixed-step accumulator with max substeps clamp to avoid spiral of death on slow frames; run AI at lower tick (e.g. 30 Hz). | P1 | S |
| P9 | **Mobile profile**: lower pixel ratio cap, disable shadows/bloom by default on low-end, detect via `navigator.hardwareConcurrency`/benchmark. | P1 | S |
| P10 | **Memory hygiene**: dispose geometries/materials/render targets on restart/quit (`PurePursuitAI.destroy` exists; extend to visuals and FX); verify no leaks across repeated runs (heap snapshots). | P1 | M |
| P11 | **HUD DOM updates**: ~10 `textContent`/style writes per frame; update only on change and throttle to 30 Hz. | P2 | S |
| P12 | **PWA/offline**: service worker with cache-first for assets, proper `base` handling for GitHub Pages. | P2 | S |

## 6. Code quality / maintainability

| ID | Item | Pri | Eff |
|----|------|-----|-----|
| C1 | Split `GameManager` (~840 lines): extract `RaceController`, `SceneSetup`, `InputRouter`, `NetSession`, `ModeManager`. | P1 | M |
| C2 | Replace `any` casts in audio setup, add strict lint (ESLint + `@typescript-eslint`) and Prettier; pre-commit via CI. | P1 | S |
| C3 | Move magic numbers (shift RPMs, grip, shake, thresholds) into typed config modules. | P1 | S |
| C4 | Unit tests for `StateSync`, `QWBPProtocol`, `EvolutionStore`, waypoint math. | P1 | M |
| C5 | Track data as JSON asset + editor script; remove hardcoded coordinates in `TrackMeshBuilder`, `EnvironmentGenerator`, `HUD`. | P2 | M |
| C6 | Error boundaries: WebGL context loss handling, WASM load failure fallback UI, IndexedDB unavailable fallback. | P1 | S |
| C7 | Docs: architecture overview, controls reference, contribution guide, ADRs. | P2 | S |

---

## Suggested execution order

1. **Stabilise (P0s):** V1–V2, M1–M3, U1–U2, A1, P1, P3, P7, G1.
2. **Feel & polish:** G2, G6, G10, A2–A5, M4, M6–M7, U3–U7, U11.
3. **Depth:** G3–G5, M5, M8–M12, A6–A9, U8–U12, G7–G12.

Each item should land as a small PR with: change description, before/after metric or screenshot, and a journal entry.
