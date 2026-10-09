# Voxel Boxer: Masovian Drift — Quality Improvement Plan

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done. Progress is logged in [JOURNAL.md](./JOURNAL.md).
Priority: **P0** correctness/blocking · **P1** high value · **P2** polish.
Effort: S (<½ day) · M (1–2 days) · L (3+ days).

Basis: static review of `src/` (~6.9k LOC) at commit `0d29cc8`. Items marked *(unverified)* are suspected from reading code and need profiling/repro before work starts.

---

## 0. Verification gaps (do first)

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| V1 | Automated smoke tests (Playwright) per section: menu, garage, quick race, pause, split-screen, multiplayer lobby. | P0 | M | `[x]` done (`tests/smoke-suite.mjs`) |
| V2 | Console-error gate in CI (fail on any `console.error`/uncaught exception). | P0 | S | `[x]` done (enforced in Playwright sweep) |
| V3 | Physics regression tests (headless Rapier): 0–100 km/h time, skidpad lateral g, brake distance, restart leaves no state behind. | P1 | M | `[ ]` |
| V4 | FPS/frame-time budget test (desktop + throttled mobile profile), record in CI artifact. | P1 | M | `[ ]` |

## 1. Game mechanics

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| M1 | **Real kerb/surface detection.** Derived from waypoint lateral offset and track width. Signals grip modifiers, dust, and kerb audio/vibration without random heuristics. | P0 | M | `[x]` done |
| M2 | **Race-finish flow.** Replaced `alert()` with a glassmorphic results screen (positions, best lap, drift score, PLN earned, retry/garage/menu) and universal English ordinals (`getOrdinal`). | P0 | M | `[x]` done |
| M3 | **Restart correctness.** Comprehensive `reset()` on `VehiclePhysics`, `PurePursuitAI`, and `ParticleFX` clearing tyre/rotor heat, drift combos, skidmarks, and smoke. | P0 | S | `[x]` done |
| M4 | **Fixed-step determinism.** Remove `Math.random()` from physics and AI; use seeded PRNG. | P1 | S | `[ ]` |
| M5 | **Network model.** Snapshot interpolation with jitter buffer, lag compensation. | P1 | L | `[ ]` |
| M6 | **AI quality.** Racing line, braking-zone lookahead, overtaking offsets, recovery when stuck. | P1 | L | `[ ]` |
| M7 | **Reset/recovery.** Auto-respawn at last checkpoint when flipped or off-track. | P1 | S | `[ ]` |
| M8 | **Game modes.** Time trial with ghost, drift challenge scoring. | P2 | L | `[ ]` |
| M9 | **Drivetrain realism.** Torque curve per engine, clutch/launch control, rev-limiter cut. | P2 | M | `[ ]` |
| M10 | **Damage model.** Visible deformation, performance loss tied to repair shop. | P2 | L | `[ ]` |
| M11 | **Progression/economy balance pass.** Tune prices/rewards; unlock tracks and eras. | P2 | M | `[ ]` |
| M12 | **More tracks / weather / time of day.** Track data procedural variation. | P2 | L | `[ ]` |

## 2. Visuals

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| G1 | **Split-screen post-processing.** Render both viewports through post-processing pipeline with scissor (`renderToViewport`). | P0 | M | `[x]` done |
| G2 | **Bloom HDR buffer.** Move to HalfFloat render target + proper downsample/upsample bloom chain. | P1 | M | `[ ]` |
| G3 | **Lighting & Shadows.** Procedural sky IBL, contact AO, soft cascaded shadows. | P1 | L | `[ ]` |
| G4 | **Car shading.** Bevelled/rounded voxel meshing, clearcoat paint, window reflections. | P1 | L | `[ ]` |
| G5 | **Terrain.** Splat shader, GPU wind-animated grass instances. | P1 | L | `[ ]` |
| G6 | **Water.** Vertex shader wave displacement with Fresnel and foam. | P1 | M | `[ ]` |
| G7 | **Sky/atmosphere.** Sun disc bloom, height fog, cloud shadows. | P2 | M | `[ ]` |
| G8 | **Particles.** Soft billboarded sprites, additive sparks, surface-tinted smoke. | P2 | M | `[ ]` |
| G9 | **Motion feel.** Speed lines, radial motion blur, camera roll in drifts. | P2 | M | `[ ]` |
| G10 | **LOD & culling.** Billboards and frustum culling for trackside props. | P1 | M | `[ ]` |
| G11 | **Trackside life.** Animated spectators, flags, replay helicopter camera. | P2 | M | `[ ]` |
| G12 | **Replay + photo mode.** Free camera and DoF. | P2 | L | `[ ]` |

## 3. UI / UX

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| U1 | **Pause state coherence.** Pausing smoothly ramps master gain to zero; resuming flushes clock delta to avoid physics leap. | P0 | S | `[x]` done |
| U2 | **Volume slider vs mute.** Dedicated master/SFX/engine/UI audio bus graph with persistent settings in `localStorage`. | P0 | S | `[x]` done |
| U3 | **Settings persistence.** Volume, mute, graphics scale saved and applied on boot. | P1 | S | `[~]` |
| U4 | **Accessibility.** Remappable controls, colour-blind-safe shift lights, reduced motion. | P1 | M | `[ ]` |
| U5 | **Gamepad support.** Gamepad API with rumble and mobile haptics. | P1 | M | `[ ]` |
| U6 | **Mobile layout.** Responsive HUD, safe-area insets, touch-control calibration. | P1 | M | `[ ]` |
| U7 | **Loading experience.** Asset/WASM progress loader. | P1 | S | `[ ]` |
| U8 | **Onboarding.** First-run driving tutorial. | P2 | M | `[ ]` |
| U9 | **Minimap.** Dynamic bounds, heading arrow, sector colouring. | P2 | S | `[ ]` |
| U10 | **Visual hierarchy of HUD.** Delta-time vs best lap, wrong-way warning. | P2 | M | `[ ]` |
| U11 | **Multiplayer lobby UX.** QR flow status/timeout/retry states, connection quality indicator. | P1 | M | `[ ]` |
| U12 | **Localisation.** Polish / English language toggle. | P2 | M | `[ ]` |

## 4. Audio

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| A1 | **Bus architecture.** Master bus + compressor limiter (`DynamicsCompressorNode`) + engine/sfx/ui sub-buses. | P0 | M | `[x]` done |
| A2 | **Engine model.** Additive flat-six boxer firing-order pulses and load harmonics. | P1 | L | `[ ]` |
| A3 | **Buffer reuse.** Pre-rendered noise buffers and pooled nodes. | P1 | S | `[ ]` |
| A4 | **Spatial audio.** PannerNode (HRTF) with doppler for opponent cars. | P1 | M | `[ ]` |
| A5 | **Surface/tyre audio.** Layered screech by slip ratio and surface, kerb thump tied to M1. | P1 | M | `[ ]` |
| A6 | **Environmental ambience.** Birds, wind through pines, crowd swells. | P2 | M | `[ ]` |
| A7 | **Music.** Procedural adaptive synth soundtrack. | P2 | L | `[ ]` |
| A8 | **Mix/QA.** Loudness normalisation (-16 LUFS), clipping protection. | P1 | S | `[ ]` |
| A9 | Player-selectable exhaust profiles tied to Evolution garage eras. | P2 | M | `[ ]` |

## 5. Performance & efficiency

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| P1 | **Per-frame allocations.** Hoisted static scratch `Vector3`/`Quaternion` across physics, AI, FX. | P0 | M | `[x]` done |
| P2 | **Water CPU animation.** Move river mesh displacement to vertex shader. | P1 | S | `[ ]` |
| P3 | **Post-process cost.** Added quality presets (`low`, `medium`, `high`, `ultra`). | P0 | M | `[x]` done |
| P4 | **Shadows.** Texel grid snapping, caster distance limit. | P1 | S | `[ ]` |
| P5 | **Draw calls/instancing.** Merge static fences, instanced grandstand spectators. | P1 | M | `[ ]` |
| P6 | **Startup cost.** Spatial grid precomputation for terrain. | P1 | M | `[ ]` |
| P7 | **Bundle size.** Split 5.4MB chunk into modular vendor chunks (`index.js` = 132 KB). | P0 | S | `[x]` done |
| P8 | **Physics scheduling.** Fixed-step accumulator with max substeps clamp. | P1 | S | `[ ]` |
| P9 | **Mobile profile.** Dynamic resolution scaling. | P1 | S | `[ ]` |
| P10 | **Memory hygiene.** Proper disposal across restarts. | P1 | M | `[ ]` |
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
