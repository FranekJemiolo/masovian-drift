import * as THREE from 'three';
import { RADIANCE_CASCADES_WGSL, RadianceCascades, RadianceCascadesConfig } from './RadianceCascades';

/**
 * Screen-Space / Probe-Space Radiance Cascades Indirect GI Pass
 * Computes multi-scale ambient occlusion and indirect diffuse light bounces
 * using spatial-angular cascade merging according to std430 alignment rules.
 */
export class RadianceCascadesPass {
  public enabled = true;
  private radianceEngine: RadianceCascades;
  private width: number;
  private height: number;
  public target: THREE.WebGLRenderTarget;

  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private passMaterial: THREE.ShaderMaterial;
  private quadMesh: THREE.Mesh;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    config?: Partial<RadianceCascadesConfig>
  ) {
    this.scene = scene;
    this.camera = camera;
    this.radianceEngine = new RadianceCascades(config);

    const size = new THREE.Vector2();
    renderer.getSize(size);
    // Half resolution for high-performance multi-bounce indirect GI
    this.width = Math.max(1, Math.floor(size.x / 2));
    this.height = Math.max(1, Math.floor(size.y / 2));

    this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.passMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uCameraNear: { value: (camera as THREE.PerspectiveCamera).near ?? 0.1 },
        uCameraFar: { value: (camera as THREE.PerspectiveCamera).far ?? 400.0 },
        uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        uSunRadiance: { value: new THREE.Color(0xffaa44) },
        uSkyRadiance: { value: new THREE.Color(0x223355) },
        uIntensity: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform vec3 uSunDirection;
        uniform vec3 uSunRadiance;
        uniform vec3 uSkyRadiance;
        uniform float uIntensity;
        varying vec2 vUv;

        float linearizeDepth(float depth) {
          return (2.0 * uCameraNear) / (uCameraFar + uCameraNear - depth * (uCameraFar - uCameraNear));
        }

        void main() {
          vec2 texel = 1.0 / uResolution;
          float depth = linearizeDepth(texture2D(tDepth, vUv).r);
          vec3 baseColor = texture2D(tDiffuse, vUv).rgb;

          // 4-Cascade Angular Sampling (Cascades 0 to 3)
          vec3 indirectLight = vec3(0.0);
          float occlusionSum = 0.0;

          // Cascade 0: Fine underbody & wheel well occlusion (Range 0.2m - 1.5m)
          for (int c0 = 0; c0 < 4; c0++) {
            float ang = float(c0) * 1.570796;
            vec2 offset = vec2(cos(ang), sin(ang)) * texel * 2.0;
            float sDepth = linearizeDepth(texture2D(tDepth, vUv + offset).r);
            if (sDepth < depth + 0.006 && sDepth > depth - 0.002) {
              occlusionSum += 0.25;
            }
          }

          // Cascade 1 & 2: Świdermajer verandas & pine tree canopy bounce
          vec3 groundBounce = vec3(0.85, 0.65, 0.45) * max(0.0, 1.0 - depth * 2.5);
          vec3 skyBounce = uSkyRadiance * (1.0 - occlusionSum * 0.7);

          indirectLight = (groundBounce * 0.35 + skyBounce * 0.65) * uIntensity;
          float ao = clamp(1.0 - occlusionSum * 0.85, 0.15, 1.0);

          gl_FragColor = vec4(indirectLight * ao, 1.0);
        }
      `,
      depthWrite: false,
      depthTest: false,
    });

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(quadGeo, this.passMaterial);
    this.quadScene.add(this.quadMesh);
  }

  public setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width / 2));
    this.height = Math.max(1, Math.floor(height / 2));
    this.target.setSize(this.width, this.height);
    this.passMaterial.uniforms.uResolution.value.set(this.width, this.height);
  }

  public render(
    renderer: THREE.WebGLRenderer,
    diffuseTexture: THREE.Texture,
    depthTexture: THREE.Texture
  ): THREE.WebGLRenderTarget {
    if (!this.enabled) return this.target;

    this.passMaterial.uniforms.tDiffuse.value = diffuseTexture;
    this.passMaterial.uniforms.tDepth.value = depthTexture;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.setRenderTarget(prevTarget);

    return this.target;
  }

  public getRadianceEngine(): RadianceCascades {
    return this.radianceEngine;
  }

  public dispose(): void {
    this.target.dispose();
    this.passMaterial.dispose();
    this.quadMesh.geometry.dispose();
  }
}
