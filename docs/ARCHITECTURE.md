# Architectural Blueprint: Next-Generation "Masovian Drift" WebGPU Voxel Racing Engine

## 1. Executive Summary & Vision

The transformation of **"Masovian Drift"** into an AAA-quality voxel racing engine represents a complete paradigm shift in browser-based software architecture. Rooted in Polish automotive culture and the unique aesthetic of the Masovian landscape, the engine draws direct architectural inspiration from the intricate wooden **"Świdermajer"** villas of Otwock and Józefów—a style pioneered by Michał Elwiro Andriolli in the 1880s blending traditional Mazovian, Russian dacha, and Alpine timber fretwork.

To achieve continuous **144Hz rendering and 60Hz deterministic physics simulation** directly inside modern desktop and mobile browsers, the engine abandons traditional single-threaded Object-Oriented Three.js prototypes in favor of:
- **Data-Oriented Design (DOD)** via a contiguous Entity Component System (`bitECS`),
- **WebGPU compute rendering** and Three.js Shading Language (`TSL`),
- **SSVDAG and HashDAG** volumetric compression with lock-free real-time destructibility,
- **Surface Nets** dual contouring with WGSL compute shaders,
- **Radiance Cascades** real-time global illumination without stochastic Monte Carlo noise,
- **Rapier3D WASM physics** with 4-point raycast suspension and full Pacejka '94 Magic Formula dynamics,
- **SharedArrayBuffer & Transferable ArrayBuffer** WebWorker synchronization,
- **Procedural Web Audio** exponential synthesis with zero external audio assets,
- **Serverless QR-WebRTC Bootstrap Protocol (QWBP)** enabling sub-50ms peer-to-peer multiplayer without cloud signaling servers.

---

## 2. Foundational Architecture: Data-Oriented Design (ECS)

Traditional Three.js applications scatter state across heap-allocated `THREE.Object3D` hierarchies, leading to pointer chasing, cache thrashing, and destructive Garbage Collection (GC) pauses. "Masovian Drift" employs a Data-Oriented Entity Component System (`bitECS`), formatting simulation state as a **Structure of Arrays (SoA)** using contiguous `Float32Array` buffers.

```
+---------------------------------------------------------------------------------------+
|                               STRICT EXECUTION PIPELINE                              |
+---------------------------------------------------------------------------------------+
|  1. Input Parsing          (InputSystem maps analog/gyro/touch to VehicleInput SoA)  |
|  2. Fixed Physics Step     (PhysicsWorld fixed 60Hz tick with Rapier3D WASM)          |
|  3. ECS Transforms Sync    (PhysicsSyncSystem writes into TwoSampleStateBuffer SoA)   |
|  4. Visual Slerp/Lerp      (InterpolationSystem applies fractional alpha to meshes)   |
|  5. GPU Scene & Render     (RendererFactory WebGPU/WebGL pipeline with PostProcessor) |
+---------------------------------------------------------------------------------------+
```

### SoA Component Memory Layout

Entities are lightweight global integer identifiers (`EntityId = 1, 2, ...`). All component data is indexed directly by `eid`:

| Component | Storage | Fields | Purpose |
|---|---|---|---|
| `Position` | `Float32Array[MAX]` | `x, y, z` | World coordinates |
| `Rotation` | `Float32Array[MAX]` | `x, y, z, w` | Orientation quaternion |
| `Velocity` | `Float32Array[MAX]` | `vx, vy, vz, angularY` | Linear & angular momentum |
| `VehicleInput` | `Float32Array[MAX]` | `throttle, brake, steer, handbrake` | Normalized player inputs |
| `VehicleTelemetry` | `Float32Array[MAX]` | `speedKmh, rpm, gear, driftScore, slipAngle, damage, engineHealth` | Powertrain and progression data |
| `TwoSampleStateBuffer`| `Float32Array[MAX]` | `prev[7], curr[7], render[7]` | Fixed-step temporal interpolation |
| `VehicleRole` | `Uint8Array[MAX]` | `isPlayer, isAI, isPeer, isGhost` | Fast bitmask classification |

---

## 3. WebGPU Integration & Three.js Shading Language (TSL)

WebGPU transitions browser rendering from WebGL's sequential immediate-mode state machine to a multi-threaded, pre-compiled pipeline architecture (`GPURenderPipeline`). The engine utilizes the Three.js Shading Language (TSL) for cross-compilation between WGSL and GLSL, maintaining complete backward compatibility with older devices.

### WGSL std430 Memory Alignment Rules

WGSL enforces strict std430 memory layout constraints in storage buffers. Because `vec3<f32>` requires 16-byte alignment, mapping contiguous 3D coordinate arrays directly induces memory misalignment. The engine strictly pads host buffers:

| WGSL Type | Size (Bytes) | Alignment (Bytes) | Host ArrayBuffer Padding Requirement |
|---|:---:|:---:|---|
| `f32` / `u32` | 4 | 4 | Tightly packed scalar values |
| `vec2<f32>` | 8 | 8 | Tightly packed 8-byte boundary |
| `vec3<f32>` | 12 | **16** | **Must add 4 bytes of padding (`_pad: 0.0`)** |
| `vec4<f32>` | 16 | 16 | Optimal standard alignment |
| `mat4x4<f32>` | 64 | 16 | Formatted as four independent `vec4` columns |

---

## 4. Volumetric Geometry: SSVDAG & HashDAG Architecture

The dense pine forests and elaborate wooden verandas of Mazovia cannot be represented through dense 3D grids due to excessive memory consumption. The engine synthesizes:

1. **Symmetry-Aware Sparse Voxel DAG (SSVDAG)**:
   - Merges isomorphic subtrees across 8 reflective symmetry planes ($T_x, T_y, T_z$).
   - Encodes reflections in a 3-bit header alongside 32-bit child pointers.
   - Micro-blocks (4x4x4 voxels) are packed into a single 64-bit integer mask (`BigInt`), yielding compression ratios up to $98.5\%$.
2. **HashDAG Dynamic Editing**:
   - Nodes are managed in a lock-free GPU hash table.
   - When collision damage shatters a wooden fence or villa veranda, affected subtrees are cloned into an uncompressed Sparse Voxel Octree (SVO), modified via Copy-on-Write (CoW), and re-merged bottom-up into the HashDAG in real-time.

---

## 5. Voxel Meshing: Surface Nets Dual Contouring

Instead of Marching Cubes (which generates aliased, blocky stair-stepping on binary grids), the engine implements **Surface Nets**:
- Computes edge crossings along a 3D scalar density field $f(x, y, z)$ modeling the Świder river trench, sand shoals, and dune bluffs.
- Solves dual vertex placement at edge centroids with gradient-derived normals.
- Offloaded to WebGPU compute shaders (`SURFACE_NETS_WGSL`) with std430 16-byte alignment.

---

## 6. Real-Time Global Illumination: Radiance Cascades

To replace noisy stochastic path tracing and static baked lightmaps in a fully destructible voxel world, the engine implements **Radiance Cascades**:
- Divides spatial-angular radiance into 4 hierarchical 3D clipmaps:
  - **Cascade 0**: Radius 1.5m, high-frequency local bounces (asphalt, sandy shoals).
  - **Cascade 1**: Radius 6.0m, veranda timber fretwork and vehicle underbody occlusion.
  - **Cascade 2**: Radius 24.0m, forest canopy shadows and building silhouettes.
  - **Cascade 3**: Radius 96.0m, global sunset ambient twilight.
- Merges cascades iteratively from $N \to 0$ using transmittance recurrence:
  $$L_i = L_i^{\text{local}} + (1 - \text{occlusion}_i) \cdot L_{i+1}^{\text{upper}}$$
- Generates instant, noise-free bounced light under drifting tire smoke without temporal smearing.

---

## 7. Physically-Based Vehicle Dynamics & Pacejka '94

### 4-Point Raycast Suspension Controller
Chassis dynamics are evaluated using Rapier3D (WASM). Rather than unstable spherical colliders or primitive built-in wheel colliders, the suspension uses downward-firing raycasts applying Hooke's Law:
$$F = k(L_{\text{rest}} - L_{\text{current}}) - c(\Delta v)$$
Independent bump and rebound damping coefficients modulate forward dive under braking and rear squat under acceleration, dynamically shifting the center of gravity and altering tire normal loads ($F_z$).

### Pacejka '94 Magic Formula
Lateral tire forces ($F_y$) during drifting are evaluated via the full non-linear Magic Formula:
$$F_y = D \cdot \sin\left(C \cdot \arctan\left(B\alpha - E(B\alpha - \arctan(B\alpha))\right)\right)$$

| Parameter | Coefficient | Value | Tuning Impact |
|---|---|:---:|---|
| **D** | Peak Factor | $1.25 \dots 1.55$ | Maximum lateral adhesion; scales down on sand and gravel |
| **C** | Shape Factor | $1.32$ | Controls the sharpness of the curve peak |
| **B** | Stiffness Factor | $8.5 \dots 10.0$ | Responsiveness at small slip angles $\alpha$ |
| **E** | Curvature Factor | $-0.95$ | Sustains controllable drift force past peak adhesion |

Combined longitudinal and lateral slip follows the friction circle:
$$F_{y,\text{combined}} = F_y \cdot \sqrt{1 - \left(\frac{F_x}{F_{x,\text{max}}}\right)^2}$$

---

## 8. WebWorker Concurrency & Two-Sample Slerp Interpolation

To ensure rendering at 144Hz while maintaining 60Hz deterministic physics:
- Physics is evaluated on a fixed 16.6ms timestep.
- The main rendering thread maintains a **Two-Sample State Buffer** ($S_{t-1}, S_t$).
- Fractional progress $\alpha = \frac{\text{accumulator}}{\Delta t_{\text{physics}}}$ drives linear position interpolation ($\text{lerp}$) and spherical orientation interpolation ($\text{slerp}$):
  $$P_{\text{render}} = \text{lerp}(P_{t-1}, P_t, \alpha), \quad Q_{\text{render}} = \text{slerp}(Q_{t-1}, Q_t, \alpha)$$
- `PhysicsBridge` coordinates shared memory using `SharedArrayBuffer` with Atomics when cross-origin isolated (`COOP/COEP`), with automatic fallback to transferable ArrayBuffers.

---

## 9. Web Audio API Procedural Synthesis

- Engine sound synthesis is 100% procedural—zero audio files are loaded over the network.
- Pitch scales exponentially via twelfth root of two ($k = 2^{1/12} \approx 1.05946$):
  $$\text{playbackRate} = 2^{(RPM - RPM_{\text{base}}) / 1200}$$
- Wave-shaping non-linear distortion creates authentic flat-six boxer exhaust howl, while lowpass dynamic filtering simulates off-throttle overrun backfires.
- Synchronously unlocked on the first user gesture (`touchstart` / `click`) to bypass iOS Safari autoplay restrictions.

---

## 10. Serverless WebRTC & QR-WebRTC Bootstrap Protocol (QWBP)

- **Air-Gapped Handshake (QWBP)**: WebRTC SDP offers/answers are stripped of unnecessary codecs, filtered for redundant host candidates, and compressed via DEFLATE into a ~55-byte string displayed as a QR code, enabling instant local P2P pairing without an internet-facing signaling server.
- **Backpressure Regulation**: Monitors `RTCDataChannel.bufferedAmount` against a 64 KiB threshold (`bufferedAmountLowThreshold`), throttling transmission rates during cellular congestion to prevent SCTP socket crashes.
- **Client-Side Prediction & Reconciliation**: Local physics updates immediately on input, storing an input ring buffer. Authoritative state frames from the host reconcile discrepancies by rolling back and re-simulating unacknowledged inputs in a single frame.
- **Mobile Gyroscope Steering**: Native `DeviceOrientationEvent` gamma axis mapped to Pacejka steering angles through low-pass filtering, requested via `DeviceOrientationEvent.requestPermission()` on iOS 13+.
