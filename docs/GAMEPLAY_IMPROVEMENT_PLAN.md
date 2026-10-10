# "Masovian Drift" Gameplay Improvement Plan: AAA Mechanics & Drift Systems

## 1. Executive Summary & Gameplay Vision

While "Masovian Drift" currently features a responsive Rapier3D physics foundation and Pacejka '94 tire model, modern AAA drifting and competitive racing games deliver a significantly deeper, more nuanced driving experience. Achieving AAA-tier gameplay refinement requires layering tactile physics, authentic motorsport footwork, intelligent competitive AI, and engaging game modes.

To elevate our gameplay from an arcade prototype into a deeply satisfying, competitive driving experience, this plan benchmarks against the benchmark titles of the racing genre:
- **CarX Drift Racing Online & Assetto Corsa**: Advanced drift suspension geometry (Ackerman angle, caster, kingpin inclination), 3-zone tire thermodynamics, clutch-kick drivetrain impulses, and differential locking setups.
- **Initial D: Arcade Stage & Wangan Midnight**: Gutter-hooking (*Mizo Otoshi*) drainage suction, Scandinavian flick inertia transfers, Touge downhill sudden death battles, and dynamic music BPM acceleration synced to drift combos.
- **Formula Drift & D1GP**: Professional electronic tandem judging (Line, Angle, Speed, Proximity), Inner Clipping Points (ICP), Outer Clipping Zones (OCZ), and 2-heat tournament brackets.
- **Trackmania (Nadeo)**: Deterministic physics execution, 3-gate micro-sector split delta telemetry (`+/-` banners), Author/Gold/Silver/Bronze medal tiers, and instant zero-latency checkpoint respawns.
- **Forza Horizon 5**: 10-second temporal rewind ring buffer (`KeyR`), skill score combo chains (Drift + Near Miss + Wreckage), and live in-cockpit telemetry overlays.

---

## 2. Comparative Gameplay Analysis Matrix

| Gameplay Dimension | Current Engine Implementation | AAA Benchmark Titles | Target V2 Gameplay Upgrade |
|---|---|---|---|
| **Drift Initiation & Footwork** | Steer into turn + handbrake torque clamp. | **CarX / Assetto Corsa / Initial D**: Clutch-kick RPM drops, Scandinavian flick inertia transfers, Gutter-hooking (*Mizo Otoshi*) centripetal suction. | **Authentic Footwork & Curb Hooking**: Clutch-kick (`KeyC` / Gamepad LB) dumps flywheel momentum into locked rear wheels for instant torque-induced oversteer; dropping inside tires into roadside concrete drainage gutters generates $+35\%$ lateral suction, pulling the car through the apex. |
| **Tire Thermodynamics & Grip Curve** | Static grip coefficient determined solely by road surface type. | **Forza Horizon 5 / CarX**: 3-Zone thermal tire simulation (inner, center, outer tread); dynamic overheating penalty causing greasy slip. | **3-Zone Thermal Tire Simulation**: Real-time simulation of flash surface temperature ($T_{\text{surf}}$) and carcass core ($T_{\text{core}}$). Peak grip occurs in the $85^\circ\text{C} - 105^\circ\text{C}$ window; prolonged high-angle burnouts overheat tires ($> 125^\circ\text{C}$), degrading lateral grip by $35\%$ until cooled on straights. |
| **Chassis Tuning & Garage Customization** | Engine, tire, body, and gearbox upgrades with linear power/grip multipliers. | **CarX Drift Racing / Assetto Corsa**: Adjustable steering lock angle ($42^\circ - 68^\circ$), Ackerman steering geometry, differential locking (Open, 1.5-Way, Spool), and adjustable brake bias. | **Motorsport Chassis Geometry Tuning**: Full tuning panel in the garage: Steering Lock Angle ($42^\circ - 68^\circ$), Ackerman Percentage ($0\% - 100\%$), Differential Lock Mode (Open, 1.5-Way LSD, 100% Welded Spool), and Front/Rear Brake Bias ($70/30 \to 45/55$). |
| **Competitive Rules & Judging** | Linear drift score based on slip angle and speed with tandem multiplier ($1.75\times - 3.5\times$). | **Formula Drift / D1GP**: 100-point electronic judging (30 Line, 30 Angle, 20 Speed, 20 Proximity); clipping zones; two-heat lead/chase tournament. | **Formula Drift Judged Tandem Showdown**: Two-run tandem tournament against AI or P2P peer. Electronic judging evaluates Inner Clipping Points (ICP), Outer Clipping Zones (OCZ), angle stability, and chase proximity ($< 2.5\text{m}$). |
| **Mistake Recovery & Practice Flow** | Instant checkpoint respawn (`KeyK`) resetting vehicle at fixed position. | **Forza Horizon 5 / GRID**: 10-second temporal rewind circular ring buffer (`KeyR`) with smooth time reversal and instant driving resumption. | **Temporal Rewind Subsystem**: 600-frame circular ring buffer storing rigid-body transforms, inputs, and particle states. Holding `KeyR` reverses simulation at $2.5\times$ speed with a VHS tracking shader; releasing seamlessly restores Rapier states. |
| **Esports Telemetry & Time Attack** | Single time-trial ghost recording and replay. | **Trackmania (Nadeo)**: 3-gate micro-sector splits with live $+/-$ delta time banners; Author, Gold, Silver, Bronze medal ghosts; deterministic run verification. | **Trackmania-Style Split Telemetry & Medals**: Sector 1, 2, and 3 timing gates with real-time HUD delta banners (`-0.312s` green / `+0.145s` red); Author (Natan's Record), Gold, Silver, and Bronze target ghosts. |
| **Tactile Racing AI Behavior** | Pure pursuit path-following with basic slipstream drafting. | **Forza Motorsport / Gran Turismo 7**: Frenet frame multi-candidate trajectory planning, defensive line-blocking, trail-braking via Kamm's friction circle, and adaptive tandem chase. | **Adaptive SOTA Racing AI**: AI evaluates 3 Frenet candidate lines (racing line, defensive block, overtake switchback); modulates trail-braking via Kamm's friction circle; matches lead car's angle and throttle in tandem chase. |
| **Diegetic Audio & Synthwave Feedback** | Basic procedural synth oscillators (sawtooth, white noise filter sweeps). | **Gran Turismo 7 / Initial D**: Physical granular tire scrub synthesis; turbo wastegate compressor flutter; overrun pops; BPM scaling with drift combo. | **Granular Tire Scrub & Dynamic BPM Audio**: FM granular synthesis modulated by micro-slip velocity; turbo compressor surge flutter (*tsu-tsu-tsu*) on throttle lift; multi-stem synthwave tempo accelerating with drift combos ($120 \to 138\text{ BPM}$). |

---

## 3. Subsystem Gameplay Specifications

```
+---------------------------------------------------------------------------------------------------------+
|                                    MASOVIAN DRIFT GAMEPLAY SYSTEMS                                      |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   +------------------------------------+     +------------------------------------+                     |
|   |         ADVANCED VEHICLE DYNAMICS  |     |         COMPETITIVE GAME MODES     |                     |
|   |                                    |     |                                    |                     |
|   | - 3-Zone Thermal Tire Simulation   |====>| - Formula Drift Judged Tandem      |                     |
|   | - Clutch-Kick Instant Torque Shock |     | - Touge Downhill Sudden Death      |                     |
|   | - Gutter-Hooking Drainage Suction  |     | - Trackmania Micro-Sector Splits   |                     |
|   | - Ackerman & 2-Way Spool Tuning    |     | - Gymkhana Voxel Drift Park        |                     |
|   +------------------------------------+     +------------------------------------+                     |
|                     ||                                         ||                                       |
|                     \/                                         \/                                       |
|   +------------------------------------+     +------------------------------------+                     |
|   |       TACTILE DRIVER CONTROLS      |     |         AI OPPONENT RACING         |                     |
|   |                                    |     |                                    |                     |
|   | - 10-Second Temporal Rewind (KeyR) |     | - Frenet Multi-Candidate Trajectory|                     |
|   | - Dynamic Counter-Steer Assist     |====>| - Kamm's Circle Trail-Braking      |                     |
|   | - Dual-Motor Gamepad Haptic Rumble |     | - Adaptive Tandem Chase Matching   |                     |
|   | - Gyroscope Tilt Calibration       |     | - Tactical Draft Tunnel Slipstream |                     |
|   +------------------------------------+     +------------------------------------+                     |
|                     ||                                         ||                                       |
|                     \/                                         \/                                       |
|   +-------------------------------------------------------------------------------+                     |
|   |                         DIEGETIC AUDIO & SKILL PROGRESSION                    |                     |
|   |                                                                               |                     |
|   | - Granular Tire Acoustic Synthesis       - Turbo Blow-Off Valve Flutter       |                     |
|   | - Dynamic BPM Synthwave Stem Scaling     - Skill Chains (Drift + Near Miss)   |                     |
|   +-------------------------------------------------------------------------------+                     |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### 3.1 Advanced Vehicle Dynamics & Footwork

#### 3.1.1 3-Zone Thermal Tire Dynamics
- **Thermal Physical Model**:
  Each tire tracks surface flash temperature ($T_{\text{surf}}$) and carcass core temperature ($T_{\text{core}}$):
  $$\frac{dT_{\text{surf}}}{dt} = \frac{\mu \cdot F_z \cdot |v_{\text{slip}}|}{C_{\text{thermal}}} - h_{\text{air}}(v_{\text{car}}) \cdot (T_{\text{surf}} - T_{\text{ambient}}) - k_{\text{core}} \cdot (T_{\text{surf}} - T_{\text{core}})$$
- **Tire Performance Curve**:
  - $T < 50^\circ\text{C}$ (Cold): $\mu \approx 0.80 \cdot \mu_0$ (low traction, stiff response).
  - $75^\circ\text{C} \le T \le 105^\circ\text{C}$ (Optimal): $\mu = 1.00 \cdot \mu_0$ (maximum lateral adhesion and crisp steering bite).
  - $T > 120^\circ\text{C}$ (Overheated): $\mu \approx 0.65 \cdot \mu_0$ (greasy loss of grip, severe understeer/oversteer snap).
- **HUD Telemetry Widget**:
  Four-tire color display showing real-time temperatures: Blue (cold) $\to$ Green (optimal) $\to$ Orange/Red (overheating).

#### 3.1.2 Clutch-Kick Drivetrain Impulse
- **Mechanic**:
  - Pressing `KeyC` or Gamepad LB disengages the clutch, decoupling engine inertia from the driveshaft.
  - The driver revs the engine up to the limiter ($7500\text{ RPM}$).
  - Releasing the clutch dumps stored flywheel kinetic energy into the rear axle:
    $$\tau_{\text{kick}} = I_{\text{flywheel}} \cdot \frac{\omega_{\text{engine}} - \omega_{\text{driveshaft}}}{\Delta t_{\text{dump}}}$$
  - The resulting instantaneous torque spike breaks rear tire traction on demand, allowing instant drift initiation even at high speeds or on straightaways.

#### 3.1.3 Gutter-Hooking (*Mizo Otoshi*) Physics
- **Mechanic**:
  - Concrete rainwater drainage ditches and sunken shoulders run along the perimeter of the pine forest curves.
  - When the driver hooks the inside wheels into the gutter depression ($0.15\text{m} - 0.25\text{m}$ deep):
    $$F_{\text{gutter}} = m_{\text{veh}} \cdot \frac{v^2}{R_{\text{turn}}} \cdot \eta_{\text{lip}}$$
  - The gutter applies centripetal suction, locking the vehicle onto the apex and permitting $+35\%$ higher cornering speeds without sliding wide into the trees.

#### 3.1.4 Motorsport Chassis & Differential Tuning
- **Steering Lock**: Variable from $42^\circ$ (grip touring) up to $68^\circ$ (Formula Drift extreme reverse lock).
- **Ackerman Steering Geometry**:
  - $100\%$ Ackerman: Inside wheel turns sharper than outside wheel (ideal for tight parking/city driving).
  - $0\%$ Parallel Steering: Both wheels turn at identical angles (maximizes tire contact patch and lateral stability during sustained high-angle drifts).
- **Differential Locking Modes**:
  - *Open Differential*: 0% lock, clean touring behavior.
  - *1.5-Way Limited Slip*: 60% lock under acceleration, 30% under braking.
  - *2-Way Welded Spool*: 100% lock, mandatory for professional competition drifting.

---

### 3.2 Competitive Game Modes & Tournament Rules

#### 3.2.1 Formula Drift / D1GP Judged Tandem Showdown
- **Format**: Head-to-head 2-heat tournament against AI or P2P WebRTC opponent:
  - **Heat 1**: Player Leads, Opponent Chases.
  - **Heat 2**: Opponent Leads, Player Chases.
- **100-Point Electronic Judging System**:
  1. **Line (30 pts)**: Track adherence evaluated across designated Inner Clipping Points (ICPs) and Outer Clipping Zones (OCZs).
  2. **Angle (30 pts)**: Sustained slip angle magnitude; penalties applied for angle corrections, snaps, or straightening.
  3. **Speed (20 pts)**: Speed maintenance across the initiation mark and transitions.
  4. **Proximity (20 pts)**: Chase car proximity maintenance ($< 2.5\text{m}$ door-to-door for max score), matching the leader's angle and initiation points.

#### 3.2.2 Touge Downhill Sudden Death Battles
- Tight, winding downhill forest run between Józefów and the Świder River.
- **Cat-and-Mouse Rules**:
  - Lead car wins if they extend a gap $> 25\text{m}$.
  - Chase car wins if they overtake the leader or maintain a gap $< 3.0\text{m}$ across the finish line.

#### 3.2.3 Trackmania-Style Micro-Sector Splits & Medal Tiers
- Track split into 3 timing sectors:
  - Sector 1: Start grid through high-speed chicane.
  - Sector 2: Technical wooden bridge and Świdermajer villa curves.
  - Sector 3: Long sweeping riverbank dune drift into the final straight.
- **Live Delta HUD**: Instantaneous `+/-` delta comparison against personal best or target medal ghosts (`-0.245s` green / `+0.180s` red).
- **Medal Targets**:
  - **Bronze**: Clean lap completion ($1:12.00$).
  - **Silver**: Sustained high-speed drift lines ($1:04.50$).
  - **Gold**: Flawless clipping point execution ($0:58.20$).
  - **Author Medal (Natan's Record)**: World-class run ($0:54.10$).

---

### 3.3 Assists, Recovery & Tactile Controls

#### 3.3.1 10-Second Temporal Rewind (Forza-Style)
- **Ring Buffer**: 600-frame circular buffer storing vehicle rigid-body states, inputs, and telemetry at 60Hz.
- **Controls**:
  - Holding `KeyR` or Gamepad Y pauses the game clock and plays simulation backward at $2.5\times$ speed with a VHS tracking post-process effect.
  - Releasing `KeyR` restores vehicle rigid-body velocities, RPM, gear, and camera transforms, resuming the race smoothly.

#### 3.3.2 Dynamic Counter-Steer Assist
- User-selectable driving assistance modes:
  - **Sim / Direct (Assists Off)**: 1:1 steering input for wheel/sim drivers.
  - **Arcade Drift Assist**: Automatically applies high-speed counter-steering angle based on vehicle yaw velocity:
    $$\delta_{\text{assist}} = -k_{\text{yaw}} \cdot \omega_y \cdot \left( \frac{v_{\text{car}}}{v_{\text{ref}}} \right)$$
    Prevents instantaneous spinouts on keyboard/gamepad without eliminating driver control.

#### 3.3.3 Dual-Motor Gamepad Haptic Rumble
- Dual-motor frequency-modulated vibration:
  - **Low-Frequency Motor (Left)**: Chassis mass weight transfer, curb strikes, engine revs, and hard crash impacts.
  - **High-Frequency Motor (Right)**: Front tire slip angle scrubbing, ABS brake judder, and gutter-hooking lip resistance.

---

### 3.4 AI Racing & Tandem Chase Intelligence

#### 3.4.1 Frenet Multi-Candidate Trajectory Planner
- Generates 3 candidate paths evaluated via dynamic cost function:
  $$J(c) = w_{\text{curv}} \Delta d_{\text{look}} + w_{\text{coll}} P_{\text{coll}} + w_{\text{bubble}} P_{\text{bubble}} + w_{\text{bound}} P_{\text{bound}} + \text{bonus}_{\text{draft/pass}}$$
  - $c_{\text{racing}}$: Optimal apex-clipping racing line.
  - $c_{\text{defend}}$: Defensive inside line to block trailing cars.
  - $c_{\text{overtake}}$: Alternating lane switchback when blocked ahead.

#### 3.4.2 Kamm's Friction Circle Trail-Braking
- Computes maximum physical grip circle:
  $$\sqrt{F_x^2 + F_y^2} \le \mu \cdot F_z$$
- Smoothly modulates braking pressure during turn-in, preventing tire lockup and understeer plowing.

---

## 4. Gameplay Implementation Roadmap

```
+---------------------------------------------------------------------------------------------------------+
|                                     GAMEPLAY IMPLEMENTATION ROADMAP                                     |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   PHASE M1: Advanced Footwork & Tire Thermodynamics                                                     |
|   - Implement 3-zone thermal tire model with grip peak and overheat penalties                           |
|   - Implement clutch-kick instant flywheel torque shocks (`KeyC` / Gamepad LB)                         |
|   - Add gutter-hooking (*Mizo Otoshi*) drainage channel suction physics                                 |
|   - Expand garage chassis tuning (Ackerman geometry, steering lock, 2-way spool)                        |
|                                                                                                         |
|   PHASE M2: Competitive Modes & Esports Telemetry                                                       |
|   - Formula Drift 100-point electronic tandem judging (Line, Angle, Speed, Proximity)                   |
|   - 10-Second circular ring buffer temporal rewind (`KeyR` with VHS shader)                             |
|   - Trackmania-style micro-sector split delta HUD (`+/-` banners) and 4 medal tiers                     |
|                                                                                                         |
|   PHASE M3: Tactile Driver Assists & Controls                                                           |
|   - Dynamic counter-steer assist with user-selectable sensitivity                                      |
|   - Dual-motor gamepad haptic vibration profiles (curb, slip, crash, ABS)                              |
|   - Gyroscope tilt calibration and deadzone customization                                               |
|                                                                                                         |
|   PHASE M4: SOTA AI & Audio Synthesis Integration                                                       |
|   - AI Frenet multi-candidate trajectory planner and Kamm's trail-braking                               |
|   - Granular tire scrub acoustic synthesis modulated by micro-slip velocity                             |
|   - Turbo wastegate compressor flutter (*tsu-tsu-tsu*) and overrun exhaust pops                         |
|   - Multi-track dynamic synthwave stem mixing with BPM drift acceleration                               |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### Phase Details & Target Files

#### Phase M1 — Advanced Footwork & Tire Thermodynamics
- **Target Files**:
  - `src/physics/TireThermalModel.ts` (New): Thermal heating and grip curve algorithms.
  - `src/physics/VehiclePhysics.ts`: Integrate thermal model, clutch-kick torque impulse, gutter suction, and steering lock.
  - `src/controls/InputManager.ts`: Map clutch-kick to `KeyC` and Gamepad LB.
  - `src/economy/EvolutionStore.ts`: Add chassis tuning parameters (Ackerman, Lock, Spool Diff).
- **Acceptance Criteria**:
  - Clutch-kick breaks traction on demand; sustained drifts overheat tires into greasy slip; gutter hooking increases cornering speed by $+35\%$.

#### Phase M2 — Competitive Modes & Esports Telemetry
- **Target Files**:
  - `src/game/TandemJudgingSystem.ts` (New): D1GP / Formula Drift 100-point judging logic.
  - `src/game/RewindController.ts` (New): 600-frame circular ring buffer with time reversal.
  - `src/game/SectorSplitTracker.ts` (New): Micro-sector split delta tracker.
  - `src/ui/HUD.ts`: Render sector split +/- banners and judging scorecards.
- **Acceptance Criteria**:
  - Live split deltas render with green/red banners; rewind restores vehicle state seamlessly; judged tandem battles award accurate 100-point scores.

#### Phase M3 — Tactile Driver Assists & Controls
- **Target Files**:
  - `src/controls/SteeringAssist.ts` (New): Dynamic yaw-rate counter-steering assistance.
  - `src/controls/InputManager.ts`: Enhanced dual-motor rumble profiles for slip, ABS, and impact shocks.
- **Acceptance Criteria**:
  - Assists permit smooth keyboard/gamepad drift transitions; haptic feedback clearly signals grip loss.

#### Phase M4 — SOTA AI & Audio Synthesis Integration
- **Target Files**:
  - `src/ai/PurePursuitAI.ts`: Upgrade with Frenet multi-candidate planning and Kamm trail-braking.
  - `src/audio/GranularTireAudio.ts` (New): FM granular tire scrub synthesis.
  - `src/audio/TurboBlowOffSynth.ts` (New): Wastegate compressor surge flutter generator.
  - `src/audio/AudioManager.ts`: Dynamic synthwave stem BPM acceleration.
- **Acceptance Criteria**:
  - AI executes competitive tandem chase lines; granular tire audio provides clear audible feedback of slip angle; music tempo dynamically accelerates during high drift combos.
