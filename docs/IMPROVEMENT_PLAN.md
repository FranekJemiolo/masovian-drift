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
| M4 | **Fixed-step determinism.** Seeded PRNG (`src/utils/PRNG.ts`) replacing Math.random in physics, AI, and environment. | P1 | S | `[x]` done |
| M5 | **Network model.** Snapshot interpolation with jitter buffer, lag compensation. | P1 | L | `[ ]` |
| M6 | **AI quality.** Racing line, braking-zone lookahead, overtaking offsets, recovery when stuck. | P1 | L | `[x]` done |
| M7 | **Reset/recovery.** Auto-respawn at last checkpoint when flipped or off-track, manual K key. | P1 | S | `[x]` done |
| M8 | **Game modes.** Time trial with ghost, drift challenge scoring. | P2 | L | `[x]` done |
| M9 | **Drivetrain realism.** Boxer torque curve plateau, clutch launch control, rev-limiter cut. | P2 | M | `[x]` done |
| M10 | **Damage model.** Visible deformation, performance loss tied to repair shop. | P2 | L | `[ ]` |
| M11 | **Progression/economy balance pass.** Tune prices/rewards; unlock tracks and eras. | P2 | M | `[ ]` |
| M12 | **Weather & Time of day.** Procedural sky variations (Day Azure, Golden Sunset, Night Rally). | P2 | L | `[x]` done |

## 2. Visuals

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| G1 | **Split-screen post-processing.** Render both viewports through post-processing pipeline with scissor (`renderToViewport`). | P0 | M | `[x]` done |
| G2 | **Bloom HDR buffer.** HalfFloat render target + quadratic soft-knee threshold and 12-tap multi-scale Gaussian blur. | P1 | M | `[x]` done |
| G3 | **Lighting & Shadows.** Procedural sky IBL, contact AO, soft cascaded shadows. | P1 | L | `[x]` done |
| G4 | **Car shading.** MeshPhysicalMaterial clearcoat paint, tinted glass reflections, contact shadow. | P1 | L | `[x]` done |
| G5 | **Terrain & Shoulder Foliage.** Splat shader, 1400 wind-animated shoulder grass instances (GPU ShaderMaterial). | P1 | L | `[x]` done |
| G6 | **Water.** Vertex shader wave displacement with Fresnel and foam. | P1 | M | `[x]` done |
| G7 | **Sky/atmosphere.** Day/Sunset/Night presets, sun disc bloom, skydome IBL. | P2 | M | `[x]` done |
| G8 | **Particles.** Surface-tinted smoke (asphalt/gravel/sand/grass), additive kerb sparks. | P2 | M | `[x]` done |
| G9 | **Motion feel.** Dynamic drift Dutch tilt roll, speed-proportional FOV expansion. | P2 | M | `[x]` done |
| G10 | **LOD & culling.** Bounding spheres and frustum culling for instanced trackside props. | P1 | M | `[x]` done |
| G11 | **Trackside life.** Animated jumping spectators, swaying Polish/Mazovian racing flags. | P2 | M | `[x]` done |
| G12 | **Replay + photo mode.** Free camera and DoF. | P2 | L | `[ ]` |

## 3. UI / UX

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| U1 | **Pause state coherence.** Pausing smoothly ramps master gain to zero; resuming flushes clock delta to avoid physics leap. | P0 | S | `[x]` done |
| U2 | **Volume slider vs mute.** Dedicated master/SFX/engine/UI audio bus graph with persistent settings in `localStorage`. | P0 | S | `[x]` done |
| U3 | **Settings persistence.** Volume, mute, graphics scale, accessibility saved and applied on boot. | P1 | S | `[x]` done |
| U4 | **Accessibility.** Remappable controls, colour-blind-safe shift lights, reduced motion, gamepad telemetry. | P1 | M | `[x]` done |
| U5 | **Gamepad support.** Gamepad API with dual-motor rumble and mobile haptics. | P1 | M | `[x]` done |
| U6 | **Mobile layout.** Responsive HUD, safe-area insets, touch-control calibration. | P1 | M | `[x]` done |
| U7 | **Loading experience.** Retro-futuristic WASM/asset progress loader. | P1 | S | `[x]` done |
| U8 | **Onboarding.** First-run driving tutorial. | P2 | M | `[ ]` |
| U9 | **Minimap.** 3 colored track sectors, player directional chevron arrow, opponent rank dots. | P2 | S | `[x]` done |
| U10 | **Visual hierarchy of HUD.** Delta-time split (+/-) against best lap, flashing wrong-way warning. | P2 | M | `[x]` done |
| U11 | **Multiplayer lobby UX.** Real-time signaling status badge, connection quality indicator. | P1 | M | `[x]` done |
| U12 | **Localisation.** Polish / English language toggle in Settings & HUD. | P2 | M | `[x]` done |

## 4. Audio

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| A1 | **Bus architecture.** Master bus + compressor limiter (`DynamicsCompressorNode`) + engine/sfx/ui sub-buses. | P0 | M | `[x]` done |
| A2 | **Engine model.** Flat-six boxer firing-order pulses, 3rd harmonic order, rev-limiter cut. | P1 | L | `[x]` done |
| A3 | **Buffer reuse.** Pre-rendered static noise buffers (white, pink, BOV, backfire) with zero allocations. | P1 | S | `[x]` done |
| A4 | **Spatial audio.** PannerNode (HRTF) with dynamic listener position and orientation. | P1 | M | `[x]` done |
| A5 | **Surface/tyre audio.** Layered screech by slip ratio and surface, speed-proportional wind roar. | P1 | M | `[x]` done |
| A6 | **Environmental ambience.** Procedural Mazovian pine forest breeze & wind noise. | P2 | M | `[x]` done |
| A7 | **Music.** Procedural adaptive synthwave soundtrack (100% Web Audio synthesized). | P2 | L | `[x]` done |
| A8 | **Mix/QA.** Loudness normalisation (-16 LUFS), clipping protection. | P1 | S | `[x]` done |
| A9 | **Exhaust profiles.** Era-specific acoustic profiles (Classic 2.7L, Golden 3.3 Turbo, Modern GT3) + open exhaust toggle. | P2 | M | `[x]` done |

## 5. Performance & efficiency

| ID | Item | Pri | Eff | Status |
|----|------|-----|-----|--------|
| P1 | **Per-frame allocations.** Hoisted static scratch `Vector3`/`Quaternion` across physics, AI, FX. | P0 | M | `[x]` done |
| P2 | **Water CPU animation.** Moved river mesh displacement to vertex shader. | P1 | S | `[x]` done |
| P3 | **Post-process cost.** Added quality presets (`low`, `medium`, `high`, `ultra`). | P0 | M | `[x]` done |
| P4 | **Shadows.** Texel grid snapping, caster distance limit. | P1 | S | `[ ]` |
| P5 | **Draw calls/instancing.** Merge static fences, instanced grandstand spectators. | P1 | M | `[ ]` |
| P6 | **Startup cost.** Spatial grid precomputation for terrain. | P1 | M | `[ ]` |
| P7 | **Bundle size.** Split 5.4MB chunk into modular vendor chunks (`index.js` = 132 KB). | P0 | S | `[x]` done |
| P8 | **Physics scheduling.** Fixed-step accumulator with max 4 substeps clamp and backlog discard. | P1 | S | `[x]` done |
| P9 | **Mobile profile.** Dynamic resolution scaling. | P1 | S | `[ ]` |
| P10 | **Memory hygiene.** Proper disposal across restarts. | P1 | M | `[ ]` |
| P11 | **HUD DOM updates**: Dirty-checking caches on all DOM strings and styles; minimap throttled to 30 Hz. | P2 | S | `[x]` done |
| P12 | **PWA/offline**: service worker with cache-first for assets, proper `base` handling for GitHub Pages. | P2 | S | `[ ]` |

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

1. **Stabilise (P0s):** V1–V2, M1–M3, U1–U2, A1, P1, P3, P7, G1. `[x]` done
2. **Feel & polish:** G2, G6, G10, A2–A5, M4, M6–M7, U3–U7, U11. `[x]` done
3. **Depth:** G3–G5, M5, M8–M12, A6–A9, U8–U12, G7–G12. `[~]` in progress

Each item should land as a small PR with: change description, before/after metric or screenshot, and a journal entry.
