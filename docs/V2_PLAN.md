# "Masovian Drift" V2 Architectural Blueprint & AAA Modernization Plan

## 1. Executive Vision: The V2 Leap

**"Masovian Drift" V2** elevates our WebGPU voxel racing engine from a high-fidelity prototype into a premier, browser-based AAA racing showcase. Combining the rich automotive heritage of Polish drifting events (Wypożyczalnia Drift, Tor Żerań, and Masovian backroads) and the unique timber architecture of Michał Elwiro Andriolli’s **Świdermajer** style, V2 introduces cutting-edge graphics, physics, and gameplay mechanics adapted from the most revered titles in the racing and voxel simulation genres.

By analyzing the state of the art in **Teardown**, **Forza Horizon 5**, **Need for Speed: Unbound**, **Initial D: Arcade Stage**, **Trackmania**, and **CarX Drift Racing Online**, this document outlines the concrete architectural changes, mathematical models, and implementation steps required to execute the V2 transformation.

---

## 2. Comparative Matrix: Current Engine vs. AAA Benchmarks

The table below contrasts our current implementation against AAA industry benchmarks and identifies the technical upgrades required for V2.

| Dimension | Current Masovian Drift | Benchmark AAA Titles | V2 Target Upgrade |
|---|---|---|---|
| **Voxel Destruction & Deformation** | 64-block instanced debris on collision impact shocks ($>14\text{G}$). Static Świdermajer buildings and trees. | **Teardown (Tuxedo Labs)**: Stress-based structural connectivity graph; voxels collapse when load paths fail; dynamic debris interactions. | **Structural Graph Voxel Collapse**: Trackside wooden fences, veranda pillars, and signs collapse based on a connected-component union-find graph when struck; tire ruts dynamically displace sand on riverbanks. |
| **Tire Physics & Grip Thermodynamics** | Single Pacejka '94 lateral force curve. Flat grip coefficient based on static surface type. | **Forza Horizon 5 / CarX**: Multi-zone thermal tire model ($T_{\text{surf}}$, $T_{\text{core}}$); grip peak curve shifts with temperature; camber thrust and tire pressure deformation. | **3-Zone Thermal Tire Model**: Inner, middle, and outer tread temperatures calculate thermal degradation. Overheating beyond $115^\circ\text{C}$ induces greasy slip, requiring thermal management through transition lines. |
| **Drift Initiation & Footwork Mechanics** | Steering input + handbrake torque clamp. Linear throttle map. | **Initial D / Assetto Corsa**: Clutch-kick RPM drops, Scandinavian flick inertia transfer, Gutter Run (*Mizo Otoshi*) apex suction. | **Advanced Footwork & Curb Hooking**: Clutch-kick (`KeyC` / Gamepad LB) delivers instantaneous torque shocks to break rear traction; dropping inside wheels into concrete drainage gutters provides $+35\%$ lateral centripetal grip. |
| **Global Illumination & Reflections** | Directional sunlight with texel-snapped shadow cascade; Radiance Cascades WGSL compute prototype; ACES tone mapping. | **Teardown / Cyberpunk 2077**: Real-time screen-space indirect diffuse GI; wet surface screen-space reflections (SSR); dynamic volumetric fog with light scattering. | **Full Radiance Cascades GI & Wet SSR**: Integrate WGSL Radiance Cascades into the post-processing pipeline for multi-bounce ambient occlusion under car underbodies and pine canopies; Screen-Space Reflections on wet asphalt. |
| **Visual Effects (VFX)** | Instanced billboard tire smoke, glowing brake discs, volumetric headlight dust cones. | **NFS: Unbound**: Stylized street-art drift smoke plumes, anime speed lines, neon wing trails, dynamic backfire flame bursts with pop-and-bang lighting. | **Stylized Cyber-Retro VFX**: Customizable colored tire smoke plumes, high-G speed lines, dynamic exhaust flame sprites that cast instantaneous point-light flashes on downshifts and overrun. |
| **Error Recovery & Time Manipulation** | Instant checkpoint respawn (`KeyK`). | **Forza Horizon**: Circular ring-buffer temporal rewind allowing players to reverse time by 6–10 seconds and resume driving. | **Temporal Rewind Subsystem**: 600-frame circular ring buffer storing rigid-body transforms, inputs, and particle states. Holding `KeyR` smoothly rewinds time with a VHS tracking shader effect. |
| **Competitive Rules & Judging** | Continuous drift score accumulator based on slip angle and speed with tandem proximity multiplier ($1.75\times - 3.5\times$). | **D1GP / Formula Drift / Initial D**: Judged tandem battles (Lead vs. Chase) evaluating Line, Angle, Speed, and Proximity across two heats. | **Formula Drift Tandem Showdown Mode**: Two-run tournament format with AI/P2P opponent. Electronic judging evaluates clipping points, angle consistency, and chase car door-to-door proximity. |
| **Competitive Esports & Ghost Validation** | Single time-trial ghost recording and replay with 60-byte telemetry chunks. | **Trackmania (Nadeo)**: Deterministic physics verification, author/gold/silver/bronze medals, micro-sector split deltas with real-time +/- indicators. | **Trackmania-Style Split Telemetry & Medals**: Author, Gold, Silver, and Bronze target ghosts; 3 split sectors showing live delta-time banners (`-0.24s` green / `+0.18s` red); deterministic run verification hashes. |
| **Audio Synthesis & Dynamic Music** | Web Audio API procedural subtractive synth engine (sawtooth oscillators, filter sweeps) and dynamic synthwave stems. | **Gran Turismo 7 / Dirt Rally**: Physical granular synthesis of tire tread scrubbing, turbo blow-off flutter, exhaust pop acoustics, dynamic BPM synchronization. | **Granular Tire Acoustic Synthesis**: FM synthesis modulated by micro-slip velocity and surface grit; turbo wastegate blow-off flutter on throttle lift; exhaust overrun crackles; tempo-locked BPM scaling with drift combos. |
| **Garbage Collection & Compute Pipeline** | Main-thread Rapier3D physics + bitECS SoA + Three.js rendering. | **Modern AAA WebGPU Engines**: Web Worker multi-threading via SharedArrayBuffer; GPU frustum/occlusion culling; compute-driven particle systems. | **SharedArrayBuffer Physics Worker & GPU Particles**: Offload Rapier3D to a dedicated background Web Worker; WGSL compute shader updates 10,000 GPU-driven particles with zero CPU overhead. |

---

## 3. Subsystem Architectural Specifications

```
+---------------------------------------------------------------------------------------------------------+
|                                    MASOVIAN DRIFT V2 ARCHITECTURE                                       |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   +-----------------------+     +-----------------------+     +-------------------------------------+   |
|   |   RAPHIER3D WORKER    |     |    BITECS SOA CORE    |     |        WEBGPU RENDER PIPELINE       |   |
|   |                       |     |                       |     |                                     |   |
|   | - 60Hz Fixed Stepping |<===>| - Contiguous TypedArr |<===>| - Three.js WebGPURenderer / TSL     |   |
|   | - 4-Pt Suspension     | SAB | - Two-Sample Slerp    | CPU | - Full Radiance Cascades GI         |   |
|   | - 3-Zone Tire Heat    |     | - Rewind Ring Buffer  |     | - Screen-Space Reflections (SSR)    |   |
|   | - Curb Hooking Suction|     | - Telemetry / Judging |     | - WGSL Compute Particles (10k)      |   |
|   +-----------------------+     +-----------------------+     +-------------------------------------+   |
|                                                                                                         |
|   +-----------------------+     +-----------------------+     +-------------------------------------+   |
|   |     AUDIO ENGINE      |     |  VOXEL WORLD ENGINE   |     |         GAMEPLAY & JUDGING          |   |
|   |                       |     |                       |     |                                     |   |
|   | - Granular Tire Audio |     | - Stress Graph Decon  |     | - Formula Drift Tandem Rules        |   |
|   | - Turbo Flutter & Pop |     | - Sand Rutting Mesh   |     | - Temporal Rewind (VHS Shader)      |   |
|   | - Dynamic BPM Stems   |     | - Surface Nets Voxel  |     | - Trackmania Split Sector Telemetry |   |
|   +-----------------------+     +-----------------------+     +-------------------------------------+   |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### 3.1 Advanced Vehicle Dynamics & Powertrain

#### 3.1.1 Three-Zone Thermal Tire Simulation
Tire friction is not static; it depends heavily on thermal energy generated by sliding friction.
- **Thermal Layers**: Each wheel tracks three thermal states:
  1. $T_{\text{surf}}$: Flash surface temperature (rapid heating under slip, rapid cooling via air convection and ground conduction).
  2. $T_{\text{core}}$: Carcass core temperature (slow thermal accumulation).
  3. $T_{\text{tread}}$: Inner, center, and outer tread zones (influenced by dynamic camber).
- **Thermal Heat Equation**:
  $$\frac{dT_{\text{surf}}}{dt} = \frac{\mu \cdot F_z \cdot |v_{\text{slip}}|}{C_{\text{thermal}}} - h_{\text{air}}(v_{\text{car}}) \cdot (T_{\text{surf}} - T_{\text{ambient}}) - k_{\text{core}} \cdot (T_{\text{surf}} - T_{\text{core}})$$
- **Friction Coefficient Modulation**:
  $$\mu(T) = \mu_0 \cdot \exp\left( - \frac{(T_{\text{surf}} - T_{\text{opt}})^2}{2 \sigma_T^2} \right)$$
  - Optimal window $T_{\text{opt}} = 90^\circ\text{C} - 105^\circ\text{C}$.
  - Cold tires ($< 45^\circ\text{C}$): Stiff, low grip ($\mu \approx 0.78 \cdot \mu_0$).
  - Overheated tires ($> 125^\circ\text{C}$): "Greasy" degradation ($\mu \approx 0.65 \cdot \mu_0$), causing the car to slide out of control unless the driver straightens the wheel or transitions to fresh asphalt.

#### 3.1.2 Clutch-Kick & Drivetrain Inertia
- **Clutch Disengagement (`KeyC` / Gamepad LB)**: Decouples the engine flywheel from the gearbox. The engine revs freely up to the rev-limiter ($7500\text{ RPM}$).
- **Clutch Re-engagement**: Instantly dumps stored flywheel kinetic energy into the locked differential:
  $$\tau_{\text{kick}} = I_{\text{flywheel}} \cdot \frac{\omega_{\text{engine}} - \omega_{\text{driveshaft}}}{\Delta t_{\text{dump}}}$$
  This provides a sharp torque spike ($> 650\text{ Nm}$) at the rear axle, instantly exceeding peak static tire grip ($F_x > \mu_{\text{peak}} F_z$) to initiate oversteer at will without relying on the handbrake.

#### 3.1.3 Gutter-Hooking (*Mizo Otoshi*) Physics
Inspired by the touge racing techniques of *Initial D*, Masovian rally drivers utilize trackside concrete stormwater gutters and drainage ditches alongside pine forest roads:
- **Detection**: Raycasts from the vehicle's inside wheel hubs detect channel depressions ($0.15\text{m} - 0.25\text{m}$ below track surface with vertical concrete lip).
- **Physical Clamping**: When the inside tires drop into the gutter, a physical centripetal constraint is applied to the wheel hubs:
  $$F_{\text{gutter}} = m_{\text{veh}} \cdot \frac{v^2}{R_{\text{turn}}} \cdot \eta_{\text{lip}}$$
  This counters centrifugal inertia, permitting $+35\%$ higher cornering speeds without sliding off the road.

#### 3.1.4 Garage Differential & Steering Angle Tuning
Expand the existing [`EvolutionStore.ts`](file:///Users/franek/personal_workspace/masovian-drift/src/economy/EvolutionStore.ts) garage tuning options:
- **Steering Lock Angle**: Adjustable from $42^\circ$ (touring grip) up to $68^\circ$ (Formula Drift extreme reverse lock).
- **Differential Lock Setup**:
  - *Open Differential*: 0% lock, clean touring behavior.
  - *1.5-Way Limited Slip*: 60% lock under acceleration, 30% under braking.
  - *2-Way Welded Spool*: 100% lock, mandatory for professional competition drifting.
- **Brake Bias**: Variable front/rear split from $70/30$ down to $45/55$.

---

### 3.2 Real-Time Lighting, Wet Surfaces & WebGPU Graphics

#### 3.2.1 Full Radiance Cascades Screen-Space Indirect Diffuse GI
Upgrade our prototype in [`RadianceCascades.ts`](file:///Users/franek/personal_workspace/masovian-drift/src/graphics/RadianceCascades.ts) into an active render pass:
- **Spatial-Angular 4-Cascade Clipmaps**:
  - Cascade 0: 64 rays/probe, range $0.2\text{m} - 1.5\text{m}$ (fine vehicle underbody ambient occlusion, wheel well shading).
  - Cascade 1: 16 rays/probe, range $1.5\text{m} - 6.0\text{m}$ (Świdermajer veranda overhangs, roadside pine trunks).
  - Cascade 2: 4 rays/probe, range $6.0\text{m} - 24.0\text{m}$ (forest canopy occlusion).
  - Cascade 3: 1 ray/probe, range $24.0\text{m} - 96.0\text{m}$ (global sky/ground bounce).
- **Hierarchical WGSL Merge Pass**: Computes the radiance recurrence:
  $$L_i = L_i^{\text{local}} + T_i \cdot L_{i+1}^{\text{upper}}$$
  Resolves without stochastic Monte Carlo noise, eliminating temporal denoising ghosting during high-speed drifts.

#### 3.2.2 Screen-Space Reflections (SSR) & Dynamic Wet Track
- **Dynamic Weather Controller**: Smoothly interpolates weather states: `Clear Sunset` $\to$ `Overcast Drizzle` $\to$ `Masovian Thunderstorm`.
- **Wet Asphalt Surface**:
  - Modulates roughness down from $0.85$ to $0.12$.
  - Adds a normal-map ripple effect to puddle depressions.
- **Hierarchical Screen-Space Raymarching**: Computes specular reflections off wet road surfaces, capturing neon building signage, car tail lamps, and glowing brake discs.

#### 3.2.3 Stylized Cyber-Retro Drift VFX & Exhaust Flame Bursts
- **Volumetric Cel-Shaded Smoke**: Smoke particles receive multi-toned step shading (shadow, mid-tone, highlight) with customizable smoke dye colors (Mazovian Amber, Żerań Cyan, Synth Neon).
- **Dynamic Exhaust Backfire**:
  - When the throttle lifts after high boost or the engine bounces off the rev-limiter, an unburnt fuel ignition event fires.
  - Instantiates a flame particle sprite and a momentary point light ($r = 3.5\text{m}$, intensity $4.0$, orange-blue hue) casting dynamic shadows on the road and rear bumper.
- **G-Force Speed Lines**: Screen-space radial motion lines fade in during drifts above $110\text{ km/h}$ or when nitrous is engaged.

---

### 3.3 Interactive Voxel World & Deformable Sand Ruts

#### 3.3.1 Teardown-Style Structural Graph Voxel Collapse
Trackside objects in "Masovian Drift" are built from voxels. In V2, they become destructible through structural connectivity graphs:
- **Connectivity Graph**: Each Świdermajer wooden veranda, fence, and grandstand is divided into clusters of $16 \times 16 \times 16$ voxel blocks linked by adjacency edges.
- **Stress Propagation**:
  - Vertices anchored to the ground ($y = 0$) are marked as static roots.
  - When a car strikes a fence or porch post, impacted voxel nodes are destroyed.
  - A Breadth-First Search (BFS) / Union-Find algorithm runs across affected clusters. Any cluster disconnected from a ground root transitions into a Rapier3D dynamic rigid body, falling, tumbling, and fragmenting upon hitting the ground.

#### 3.3.2 Dynamic Sand Rutting & Soil Displacement
The Mazovian riverbanks along the Świder and pine forest paths consist of loose dune sand:
- **Dynamic Heightmap Modification**:
  - As spinning tires slide laterally across sand surfaces ($v_{\text{slip}} > 3.0\text{ m/s}$), the wheel contact patch carves trenches into the local heightfield (up to $0.18\text{m}$ deep).
  - Displaced sand accumulates on the outer edge of the slide, forming a loose berm that influences subsequent laps.

---

### 3.4 Game Modes, Competitive Systems & Esports

#### 3.4.1 Formula Drift / D1GP Judged Tandem Tournament Mode
Expand upon our real-time tandem evaluation in [`StateSync.ts`](file:///Users/franek/personal_workspace/masovian-drift/src/net/StateSync.ts):
- **Two-Run Bracket Format**:
  - **Heat 1**: Player leads, AI / P2P opponent chases.
  - **Heat 2**: Inverted roles (Player chases).
- **Electronic Judging Metrics (100 Point Scale)**:
  1. **Line (30 pts)**: Adherence to ideal track trajectory and clipping zones (Inner Clipping Points and Outer Clipping Zones).
  2. **Angle (30 pts)**: Sustained slip angle magnitude and smoothness; deductions for angle snaps or corrections.
  3. **Speed (20 pts)**: Entry speed through the initiation mark and speed maintenance through the transition.
  4. **Proximity & Chase Pressure (20 pts)**: Proximity maintenance in the chase position ($< 2.5\text{m}$ yielding max score), matching the leader's angle and initiation timing.

#### 3.4.2 Temporal Rewind Subsystem (Forza-Style)
Allows players to recover from catastrophic tree strikes during solo practice:
- **Circular State Buffer**: A pre-allocated ring buffer holding 600 ticks ($10.0\text{s}$ at 60Hz):
  ```ts
  interface RewindSnapshot {
    timestamp: number;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    linearVelocity: [number, number, number];
    angularVelocity: [number, number, number];
    rpm: number;
    gear: number;
    steeringAngle: number;
    driftScore: number;
  }
  ```
- **Rewind Control**:
  - Pressing `KeyR` or Gamepad Y pauses normal simulation.
  - Iterates backward through snapshots at $2.5\times$ speed.
  - Applies a full-screen VHS glitch/scanline post-processing effect.
  - Releasing `KeyR` restores Rapier rigid-body states and resumes simulation seamlessly.

#### 3.4.3 Trackmania-Style Micro-Sector Splits & Medal Ghost Validation
- **3 Sector Gates**: Divides the 140-waypoint Masovian track into Sectors 1, 2, and 3.
- **Live Delta HUD**: Compares real-time elapsed time against target ghosts down to the millisecond:
  - Green banner: `-0.312s` (ahead of target).
  - Red banner: `+0.145s` (behind target).
- **Medal Tiers & Telemetry Targets**:
  - **Bronze**: Clean lap completion ($1:12.00$).
  - **Silver**: Sustained high-speed drift lines ($1:04.50$).
  - **Gold**: Flawless clipping point execution ($0:58.20$).
  - **Author Medal (Natan's Record)**: World-class run ($0:54.10$).

#### 3.4.4 Cinematic Photo Mode
- Pause the game anytime to enter Freecam Photo Mode.
- Controls: 6-DOF camera movement, adjustable Focal Length ($18\text{mm} - 200\text{mm}$), Aperture Depth of Field (DoF Bokeh), Shutter Speed Motion Blur simulation, Exposure, and Film Grain.
- Instant 4K canvas screenshot export with custom Masovian Drift watermarks.

---

### 3.5 Audio Synthesis & Dynamic Synthwave Music

#### 3.5.1 Physical Granular Tire Acoustic Synthesizer
Replace static white noise filters in [`AudioManager.ts`](file:///Users/franek/personal_workspace/masovian-drift/src/audio/AudioManager.ts) with real-time granular physical synthesis:
- **Micro-Grain Generator**: Generates 25ms audio grains representing tire tread blocks snapping against asphalt aggregate.
- **Grain Pitch & Density**:
  - Modulated by slip velocity $v_{\text{slip}} = \sqrt{v_{\text{lat}}^2 + v_{\text{long}}^2}$.
  - Transition from low groaning scrub at low slip angles to piercing high-frequency tire squeal at high slip angles ($> 28^\circ$).
- **Surface Texture Modulation**: Grain frequency shifts lower and rougher when drifting over cobblestone, dirt, or gravel.

#### 3.5.2 Turbo Wastegate Blow-Off Flutter & Rev-Limiter Pop Synthesizer
- **Turbo Flutter (*Tsu-tsu-tsu*)**: On throttle lift under high RPM, simulates compressor surge via rapid amplitude-modulated bandpass filters ($18\text{Hz}$ flutter rate).
- **Exhaust Backfire Crackle**: Rapid square-wave impulses with randomized decay times triggered during gear downshifts.

#### 3.5.3 Interactive Synthwave Music Stems with BPM Scaling
- Multi-track procedural synthwave stems: Drums, Bassline, Arpeggio Synth, Lead Melody.
- As the player chains drift combos and proximity multipliers:
  - Low drift / straight driving: Muted drums and bass.
  - Drift Initiation: Arpeggio filters open.
  - Tandem Drift ($> 2.5\times$ multiplier): Lead synth drops in, tempo scales from $120\text{ BPM}$ to $138\text{ BPM}$ dynamically.

---

### 3.6 WebGPU Compute & Performance Pipeline

#### 3.6.1 SharedArrayBuffer Physics Web Worker
- Move Rapier3D WASM simulation into a dedicated background worker (`src/workers/PhysicsWorker.ts`).
- Communication via `SharedArrayBuffer` using our [`PhysicsBridge.ts`](file:///Users/franek/personal_workspace/masovian-drift/src/physics/PhysicsBridge.ts) architecture:
  - Worker writes position, quaternion, velocity, and wheel telemetry at 60Hz.
  - Main thread reads states with zero memory copying or serialization overhead.
  - Eliminates main-thread frame drops during heavy voxel collisions.

#### 3.6.2 WGSL Compute-Driven GPU Particles
- Move tire smoke, dust plumes, and voxel debris entirely to the GPU:
  - WGSL compute shader updates 10,000 particle positions, velocities, lifetimes, and rotations.
  - Storage buffer directly bound to indirect draw calls (`drawIndexedIndirect`).
  - Zero CPU-GPU roundtrips per frame.

---

## 4. Phased Implementation Roadmap

```
+---------------------------------------------------------------------------------------------------------+
|                                        V2 IMPLEMENTATION ROADMAP                                        |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   PHASE V2.1: Advanced Vehicle Dynamics & Footwork                                                      |
|   - 3-Zone Thermal Tire Dynamics (Inner/Center/Outer, cold/grip/grease curve)                           |
|   - Clutch-Kick instantaneous torque shock (`KeyC` / Gamepad LB)                                        |
|   - Gutter-Hooking (*Mizo Otoshi*) centripetal suction physics                                          |
|   - Steering angle tuning (up to 68 deg) and 2-way spool differential setup                             |
|                                                                                                         |
|   PHASE V2.2: Advanced WebGPU Lighting & Screen-Space Reflections                                       |
|   - Active WebGPU Radiance Cascades Screen-Space Indirect GI pass                                       |
|   - Screen-Space Reflections (SSR) with dynamic wet asphalt puddle maps                                 |
|   - Stylized cel-shaded drift smoke and dynamic exhaust flame burst point lights                        |
|                                                                                                         |
|   PHASE V2.3: Teardown-Style Voxel Collapse & World Physics                                             |
|   - Stress-graph structural connectivity for Świdermajer wooden fences and porches                      |
|   - Dynamic sand rutting and heightfield soil displacement                                              |
|                                                                                                         |
|   PHASE V2.4: Competitive Modes & Esports Telemetry                                                     |
|   - Formula Drift / D1GP Two-Run Judged Tandem Showdown                                                 |
|   - 10-Second Circular Ring Buffer Temporal Rewind (`KeyR` with VHS shader)                             |
|   - Trackmania-style micro-sector split telemetry (+/- banners) and 4 medal tiers                       |
|   - 6-DOF Cinematic Photo Mode with DoF Bokeh & Motion Blur                                             |
|                                                                                                         |
|   PHASE V2.5: Physical Audio & Granular Synthesis                                                       |
|   - Granular tire tread scrub synthesizer modulated by slip velocity                                    |
|   - Turbo wastegate blow-off flutter and overrun exhaust crackles                                       |
|   - Adaptive multi-stem synthwave music with BPM drift scaling                                          |
|                                                                                                         |
|   PHASE V2.6: Web Worker Physics & WebGPU Compute Particles                                             |
|   - Rapier3D physics offloaded to dedicated Web Worker via SharedArrayBuffer                            |
|   - 10,000-particle WGSL compute shader with indirect draw calls                                        |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### Detailed Phase Specifications

#### Phase V2.1 — Advanced Vehicle Dynamics & Footwork
- **Files to Modify/Create**:
  - `src/physics/TireThermalModel.ts` (New): Implements 3-zone thermal simulation and friction coefficient curve.
  - `src/physics/VehiclePhysics.ts`: Integrate `TireThermalModel`, clutch-kick impulse mechanics, gutter-hooking constraint detection, and adjustable steering lock geometry.
  - `src/controls/InputManager.ts`: Map clutch-kick to `KeyC` and Gamepad Left Bumper (`button[4]`).
  - `src/economy/EvolutionStore.ts`: Add garage tuning controls for steering lock ($42^\circ - 68^\circ$), differential type (Open, 1.5-Way, Spool), and brake bias.
- **Verification Tests**:
  - `tests/physics-regression.mjs`: Assert clutch-kick produces instantaneous torque shock $> 500\text{ Nm}$ and breaks static grip.
  - Assert tire thermal heating curve rises from ambient ($20^\circ\text{C}$) to $95^\circ\text{C}$ within 4.0s of continuous drift and degrades $\mu$ above $125^\circ\text{C}$.

#### Phase V2.2 — Advanced WebGPU Lighting & Screen-Space Reflections
- **Files to Modify/Create**:
  - `src/graphics/RadianceCascadesPass.ts` (New): WebGPU post-processing render pass integrating `RADIANCE_CASCADES_WGSL`.
  - `src/graphics/ScreenSpaceReflectionsPass.ts` (New): Hierarchical screen-space raymarching pass for wet asphalt reflections.
  - `src/graphics/ParticleFX.ts`: Add exhaust flame burst particle spawner with dynamic point light flashing.
  - `src/graphics/PixelPostProcessor.ts`: Integrate SSR and Radiance Cascades passes.
- **Verification Tests**:
  - `tests/ecs-and-webgpu-tests.mjs`: Validate Radiance Cascades buffer bindings and SSR uniform alignment.
  - Automated screenshot capture verifying wet reflection and exhaust flame illumination.

#### Phase V2.3 — Teardown-Style Voxel Collapse & World Physics
- **Files to Modify/Create**:
  - `src/voxel/VoxelStructuralGraph.ts` (New): Union-find connectivity graph for destructible voxel entities.
  - `src/world/EnvironmentGenerator.ts`: Tag wooden Świdermajer verandas and fences with structural graph metadata.
  - `src/physics/TerrainDeformation.ts` (New): Dynamic sand rutting heightmap displacement under sliding wheels.
- **Verification Tests**:
  - Collision test: Assert impact with wooden porch severs connectivity graph and instantiates dynamic falling voxel rigid bodies.

#### Phase V2.4 — Competitive Modes & Esports Telemetry
- **Files to Modify/Create**:
  - `src/game/TandemJudgingSystem.ts` (New): Implements D1GP / Formula Drift rules (Line, Angle, Speed, Proximity).
  - `src/game/RewindController.ts` (New): 600-frame circular ring buffer with time reversal and VHS post-process filter.
  - `src/game/SectorSplitTracker.ts` (New): Trackmania micro-sector split comparison and medal tier validation.
  - `src/ui/PhotoMode.ts` (New): 6-DOF freecam, focal length, aperture DoF, and 4K screenshot exporter.
  - `src/ui/HUD.ts`: Render split-sector +/- delta banners and D1GP electronic judging scorecards.
- **Verification Tests**:
  - `tests/smoke-suite.mjs`: Add test sections for Rewind, Photo Mode, and Tandem Judging.
  - Assert rewind preserves complete state continuity when rewinding and resuming.

#### Phase V2.5 — Physical Audio & Granular Synthesis
- **Files to Modify/Create**:
  - `src/audio/GranularTireAudio.ts` (New): Physical granular tire tread scrub synthesis.
  - `src/audio/TurboBlowOffSynth.ts` (New): Wastegate compressor flutter and overrun pop generator.
  - `src/audio/AudioManager.ts`: Integrate granular audio and dynamic BPM stem scaling.
- **Verification Tests**:
  - Audio context unit tests: Assert audio nodes construct cleanly and modulate frequency/gain in response to telemetry without clipping.

#### Phase V2.6 — Web Worker Physics & WebGPU Compute Particles
- **Files to Modify/Create**:
  - `src/workers/PhysicsWorker.ts` (New): Web Worker executing Rapier3D physics steps.
  - `src/physics/PhysicsBridge.ts`: Complete SharedArrayBuffer synchronization pipeline.
  - `src/graphics/ComputeParticlePipeline.ts` (New): 10,000-particle WGSL compute shader with indirect draw calls.
- **Verification Tests**:
  - Performance benchmark: Assert average frame times on main thread stay below $12.0\text{ms}$ under 100 simultaneous vehicle-obstacle collisions.

---

## 5. Verification & Acceptance Criteria

Every milestone within the V2 roadmap must satisfy our automated testing standards:
1. **Zero Browser Errors**: Zero uncaught exceptions, console errors, or WebGPU validation errors in Playwright tests.
2. **Performance Budget**: Stable 60 FPS ($< 16.6\text{ms}$ per frame) on modern desktop GPUs and $> 30\text{ FPS}$ under SwiftShader software emulation.
3. **Memory Stability**: Zero memory leaks over a 15-minute continuous race session; all WebGPU buffers, textures, and Rapier rigid bodies must be cleanly disposed on mode transitions.
4. **Deterministic Synchronization**: Zero state divergence across WebRTC P2P multiplayer sessions using QWBP binary state synchronization.
