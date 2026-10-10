# "Masovian Drift" Graphics Improvement Plan: WebGPU AAA Visual Blueprint

## 1. Executive Summary & Aesthetic Benchmark

The visual identity of **"Masovian Drift"** blends retro-cyber aesthetics, voxel precision, and the authentic timber architectural heritage of the Masovian landscape (Michał Elwiro Andriolli's **Świdermajer** villas in Otwock and Józefów, pine dune ridges along the Świder River, and the Warsaw skyline on the twilight horizon).

To achieve the visual fidelity, atmosphere, and polish of modern AAA productions while preserving our voxel soul, this document benchmarks our engine against leading industry titles:
- **Teardown (Tuxedo Labs)**: Sparse voxel octree raytracing, voxel radiance caching, emissive light propagation, and micro-voxel debris.
- **Need for Speed: Unbound (Criterion Games)**: Stylized cel-shaded drift smoke plumes, vibrant color dyes, high-G speed lines, and anime-inspired visual flair.
- **Forza Horizon 5 (Playground Games)**: Physically based sky dome atmospheric scattering (Rayleigh/Mie), dynamic weather transitions, wet asphalt with puddle screen-space reflections (SSR), and contact ambient occlusion.
- **The Touryst & Cloudpunk**: High-density voxel scene composition, warm golden-hour bloom, neon sign luminescence, and rich depth of field.
- **Gran Turismo 7 (Polyphony Digital)**: Thermal brake rotor incandescence following Planck's blackbody curve, volumetric headlight dust scattering, and anisotropic tire tread highlights.

---

## 2. Comparative Graphics Analysis Matrix

| Visual Dimension | Current Engine Implementation | AAA Benchmark Titles | Target V2 Graphic Upgrade |
|---|---|---|---|
| **Global Illumination (GI)** | Prototype WGSL Radiance Cascades compute shader; static directional sun + ambient. | **Teardown / Cyberpunk 2077**: Dynamic multi-bounce diffuse GI; screen-space irradiance caching; zero light leakage under overhangs. | **Hierarchical Screen-Space Radiance Cascades**: 4-level clipmap cascade ($0.2\text{m} \to 96\text{m}$) computing multi-bounce indirect GI, deep underbody ambient occlusion, and pine canopy light bounces in real time without Monte Carlo noise. |
| **Wet Road & Surface Reflections** | Uniform roughness; static river ripple shader without reflections. | **Forza Horizon 5 / Gran Turismo 7**: Dynamic puddles in asphalt depressions; screen-space raymarched reflections (SSR); wet albedo darkening; fresnel specular falloff. | **PBR Wet Surface & SSR Pass**: Dynamic puddle accumulation masks; normal-mapped water ripples; hierarchical screen-space raymarching reflecting car neon underglow, brake lights, and trackside streetlamps. |
| **Drift Smoke & Exhaust VFX** | Billboard particle sprites with linear opacity fade; glowing wheel hubs. | **NFS: Unbound**: Multi-tone cel-shaded comic smoke plumes; customizable smoke dyes; volumetric backfire flames with dynamic point-light casting. | **Stylized Cel-Shaded Voxel Smoke & Flame Bursts**: 3-tone stepped cel-shaded smoke puffs; customizable dye colors (Amber, Cyan, Magenta); dynamic exhaust flame sprites that cast instantaneous point-light flashes ($r = 3.5\text{m}$) on overruns and downshifts. |
| **Atmospheric Lighting & Sky** | Three.js basic sky shader with directional sun and hemisphere light. | **Forza Horizon 5 / Red Dead Redemption 2**: Rayleigh & Mie atmospheric scattering; volumetric fog with participating media; sun god rays (light shafts). | **Physically Based Sky & Volumetric Fog**: Precomputed atmospheric Rayleigh/Mie scattering model; heightfield exponential fog; volumetric light shafts filtering through dense pine canopies. |
| **Vehicle Lighting & Lens FX** | Round headlight emissive mesh + forward volumetric cone cylinders. | **Gran Turismo 7**: Mie phase function volumetric beam scattering; lens flare bokeh; dynamic high-beam toggle; physical thermal rotor glow ($800\text{K} \to 1400\text{K}$). | **Volumetric Dust Beams & Thermal Planck Glow**: Forward headlight cones with Mie phase angular scattering; brake rotor emissive shifts across Planck's blackbody curve ($0xff2200 \to 0xffaa00 \to 0xffffdd$); customizable LED underglow neon strips. |
| **Post-Processing Pipeline** | CRT scanline shader, basic bloom, vignette, chromatic aberration, Dynamic Resolution Scaling (DRS). | **Doom Eternal / Cyberpunk 2077**: Dual-pass Kawase bloom, ACES filmic tone mapping with color grading LUTs, velocity buffer motion blur, bokeh depth of field. | **Cinematic Post-Processing Suite**: ACEScg tone mapping with 3D LUT color grading (Mazovian Golden Hour, Warsaw Cyberpunk Night, Vintage Polish Kodachrome); Dual-pass Kawase bloom; camera velocity vector motion blur; circular bokeh DoF. |

---

## 3. Subsystem Graphics Specifications

```
+---------------------------------------------------------------------------------------------------------+
|                                    MASOVIAN DRIFT GRAPHICS PIPELINE                                     |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   +------------------------------------+     +------------------------------------+                     |
|   |          GEOMETRY PASS             |     |           LIGHTING PASS            |                     |
|   |                                    |     |                                    |                     |
|   | - Instanced Voxel Cars (PBR)       |====>| - Direct Sun + Snapped Shadow Map  |                     |
|   | - Surface Nets Voxel Terrain       |     | - Radiance Cascades Indirect GI    |                     |
|   | - Instanced Pine Forest & Villas   |     | - Point Lights (Exhaust & Street)  |                     |
|   +------------------------------------+     +------------------------------------+                     |
|                     ||                                         ||                                       |
|                     \/                                         \/                                       |
|   +------------------------------------+     +------------------------------------+                     |
|   |       SCREEN-SPACE EFFECTS         |     |        VOLUMETRIC & SKY PASS       |                     |
|   |                                    |     |                                    |                     |
|   | - Screen-Space Reflections (SSR)   |     | - Rayleigh & Mie Sky Scattering    |                     |
|   | - Ground-Truth Ambient Occlusion   |====>| - Heightfield Volumetric Fog       |                     |
|   | - Dynamic Puddle Normal Ripples    |     | - Volumetric Headlight Dust Beams  |                     |
|   +------------------------------------+     +------------------------------------+                     |
|                     ||                                         ||                                       |
|                     \/                                         \/                                       |
|   +-------------------------------------------------------------------------------+                     |
|   |                           CINEMATIC POST-PROCESSING                           |                     |
|   |                                                                               |                     |
|   | - Dual-Pass Kawase Bloom  - Velocity Motion Blur  - Bokeh Depth of Field      |                     |
|   | - ACES Filmic Tone Map    - Color Grading LUTs    - Dynamic Resolution (DRS)  |                     |
|   +-------------------------------------------------------------------------------+                     |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### 3.1 Hierarchical Screen-Space Radiance Cascades (GI)
- **Concept**: WebGPU WGSL compute shader resolving multi-bounce indirect diffuse illumination without stochastic noise.
- **Hierarchical Cascade Clipmaps**:
  - **Cascade 0**: 64 rays/probe, range $0.2\text{m} - 1.5\text{m}$ (fine vehicle underbody ambient occlusion, wheel well shading).
  - **Cascade 1**: 16 rays/probe, range $1.5\text{m} - 6.0\text{m}$ (Świdermajer veranda overhangs, roadside pine trunks).
  - **Cascade 2**: 4 rays/probe, range $6.0\text{m} - 24.0\text{m}$ (forest canopy occlusion).
  - **Cascade 3**: 1 ray/probe, range $24.0\text{m} - 96.0\text{m}$ (global sky/ground bounce).
- **WGSL Merging Recurrence**:
  $$L_i = L_i^{\text{local}} + T_i \cdot L_{i+1}^{\text{upper}}$$
  Provides rich natural lighting in shadowed veranda corridors and dense forest turns without ray-traced noise.

### 3.2 Dynamic Wet Surface System & Screen-Space Reflections (SSR)
- **Dynamic Weather Cycle**: Clear Sunset $\to$ Twilight Overcast $\to$ Masovian Summer Rainstorm $\to$ Midnight Mist.
- **Puddle Accumulation Mask**:
  - Sampled from a multi-octave simplex noise map multiplied by track surface micro-curvature depressions.
  - Wet regions scale surface roughness down: $R_{\text{wet}} = R_{\text{base}} \cdot (1.0 - w) + 0.05 \cdot w$, where $w \in [0, 1]$ is surface wetness.
  - Albedo darkening: Diffuse reflectance decreases by $30\%$ when wet due to internal light trapping.
- **Hierarchical Screen-Space Raymarching**:
  - Raymarches across depth buffer mipmaps (Hi-Z buffer) to find intersection points.
  - Generates crisp specular reflections of car brake lights, neon underglow, and trackside lights on wet asphalt.

### 3.3 Stylized Cel-Shaded Drift Smoke & Exhaust Flame Bursts
- **Tire Smoke**:
  - Instanced billboard quads with custom fragment shader applying 3-tone quantized cel-shading:
    $$C_{\text{smoke}} = \begin{cases} C_{\text{highlight}} & \text{if } N \cdot L > 0.6 \\ C_{\text{mid}} & \text{if } 0.2 < N \cdot L \le 0.6 \\ C_{\text{shadow}} & \text{if } N \cdot L \le 0.2 \end{cases}$$
  - Customizable smoke dye color presets:
    - *Mazovian Sunset*: Warm amber and goldenrod.
    - *Żerań Midnight*: Electric cyan and deep indigo.
    - *Warsaw Cyberpunk*: Hot neon magenta and violet.
- **Exhaust Backfire Bursts**:
  - Triggered during throttle lift at $> 5500\text{ RPM}$ or rev-limiter bounces.
  - Dual animated sprite cones erupting from twin tailpipes.
  - Dynamic transient point light ($r = 3.5\text{m}$, intensity $4.5$) casting orange-blue light across the rear bumper, spoiler, and asphalt.

### 3.4 Physically Based Atmosphere, Sky & Volumetric Fog
- **Rayleigh & Mie Sky Model**:
  - Rayleigh scattering simulates atmospheric blue sky and sunset orange gradients:
    $$\beta_R(\lambda) = \frac{8\pi^3(n^2-1)^2}{3N\lambda^4}$$
  - Mie scattering models haze, solar glow, and dust forward-scattering around the sun disc.
- **Heightfield Volumetric Fog**:
  - Density decays exponentially with altitude:
    $$\rho(y) = \rho_0 \cdot \exp(-k_{\text{fog}} \cdot (y - y_0))$$
  - Dense ground mist gathers in low-lying riverbanks along the Świder River, illuminated by vehicle headlights.

### 3.5 Thermal Planck Radiation & Headlight Beam Cones
- **Brake Rotor Thermal Blackbody Radiation**:
  - Brake discs model heat dissipation from kinetic energy conversion:
    $$\frac{dT_{\text{disc}}}{dt} = \frac{F_{\text{brake}} \cdot v}{m_{\text{rotor}} C_p} - h_{\text{cooling}} \cdot (T_{\text{disc}} - T_{\text{ambient}})$$
  - Emissive color transitions smoothly along Planck's blackbody curve:
    - $T < 450^\circ\text{C}$: Dark steel (no glow).
    - $T \approx 650^\circ\text{C}$: Deep cherry red (`#b21807`).
    - $T \approx 850^\circ\text{C}$: Glowing orange-red (`#ff4500`).
    - $T > 1050^\circ\text{C}$: Incandescent blazing golden-yellow (`#ffcc00`).
- **Volumetric Headlight Dust Cones**:
  - Dual forward cones projecting $22\text{m}$ with Mie phase angular scattering function:
    $$p(\theta) = \frac{1 - g^2}{4\pi (1 + g^2 - 2g \cos\theta)^{3/2}}$$
  - Soft edge fading and particle dust speckles floating through the beam.

### 3.6 Cinematic Post-Processing Suite
- **ACEScg Filmic Tone Mapping**: Preserves highlight detail on glowing brake discs and sun flares without color clipping.
- **Dual-Pass Kawase Bloom**:
  - 5-pass downsample/upsample Kawase blur filter providing wide, soft cinematic bloom without rectangular box artifacts.
- **3D Color Grading LUTs**:
  - *Mazovian Golden Hour*: Warm amber tones, deep pine greens, nostalgic contrast.
  - *Żerań Cyber Night*: High contrast, cyan shadows, neon highlights.
  - *Vintage 1980s Polish Kodachrome*: Muted saturation, warm filmic grain, subtle halation.
- **Camera Velocity Vector Motion Blur**:
  - Renders screen-space 2D velocity vectors into an offscreen target; blurs pixels along the motion vector to deliver a visceral sense of speed.

---

## 4. Graphics Implementation Roadmap

```
+---------------------------------------------------------------------------------------------------------+
|                                    GRAPHICS IMPLEMENTATION ROADMAP                                      |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|   PHASE G1: Lighting & Surface Realism                                                                  |
|   - Integrate WGSL Radiance Cascades Screen-Space Indirect GI pass                                      |
|   - Implement Screen-Space Reflections (SSR) with dynamic wet asphalt puddle maps                       |
|   - Add brake rotor Planck blackbody thermal emissive shader                                            |
|                                                                                                         |
|   PHASE G2: Atmospheric Volumetrics & Sky                                                               |
|   - Precomputed Rayleigh/Mie atmospheric sky dome shader                                                |
|   - Heightfield exponential ground fog with low-altitude riverbank accumulation                         |
|   - Volumetric headlight dust cones with Mie phase scattering                                           |
|                                                                                                         |
|   PHASE G3: Stylized & Photorealistic VFX                                                               |
|   - 3-Tone cel-shaded drift smoke with customizable dye color presets                                   |
|   - Dynamic exhaust flame bursts with transient point light illumination                                |
|   - Screen-space radial motion speed lines at high G-forces                                             |
|                                                                                                         |
|   PHASE G4: Post-Processing & Camera Polish                                                             |
|   - ACEScg tone mapping with 3D color grading LUTs                                                      |
|   - Dual-Pass Kawase bloom filter                                                                       |
|   - Camera velocity vector motion blur pass                                                             |
|   - Dynamic Resolution Scaling (DRS) frame-budget auto-tuning                                           |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### Phase Details & Target Files

#### Phase G1 — Lighting & Surface Realism
- **Target Files**:
  - `src/graphics/RadianceCascadesPass.ts` (New): WebGPU post-processing pass executing hierarchical radiance merging.
  - `src/graphics/ScreenSpaceReflectionsPass.ts` (New): Hierarchical depth raymarching for wet surfaces.
  - `src/graphics/VoxelCarBuilder.ts`: Upgrade brake rotor materials with Planck blackbody color curve.
- **Acceptance Criteria**:
  - Smooth multi-bounce ambient shading under vehicles; wet puddles reflect overhead streetlamps and car taillights.

#### Phase G2 — Atmospheric Volumetrics & Sky
- **Target Files**:
  - `src/world/AtmosphericSky.ts` (New): Rayleigh & Mie scattering shader with dynamic sun position.
  - `src/world/VolumetricFogPass.ts` (New): Heightfield exponential fog pass with light scattering.
  - `src/graphics/VoxelCarBuilder.ts`: Enhance forward headlight beam geometry with Mie phase scattering.
- **Acceptance Criteria**:
  - Natural sky color progression from golden sunset to dark twilight; dense ground mist pools in low-elevation riverbanks.

#### Phase G3 — Stylized & Photorealistic VFX
- **Target Files**:
  - `src/graphics/ParticleFX.ts`: Add cel-shaded quantized smoke shader and customizable smoke dye colors.
  - `src/graphics/ExhaustFlameSystem.ts` (New): Dual tailpipe flame sprites with dynamic point-light flashing.
  - `src/graphics/SpeedLineOverlay.ts` (New): Screen-space radial speed line shader.
- **Acceptance Criteria**:
  - Smoke plumes render crisp cel-shaded tones; exhaust bursts illuminate rear bumper and track surface.

#### Phase G4 — Post-Processing & Camera Polish
- **Target Files**:
  - `src/graphics/PixelPostProcessor.ts`: Upgrade tone mapping to ACEScg and add 3D LUT grading.
  - `src/graphics/KawaseBloomPass.ts` (New): Multi-pass downsample/upsample Kawase bloom.
  - `src/graphics/MotionBlurPass.ts` (New): Camera velocity vector screen-space motion blur.
- **Acceptance Criteria**:
  - Flawless 60 FPS rendering within $16.6\text{ms}$ budget; zero blown-out white highlights on glowing elements.
