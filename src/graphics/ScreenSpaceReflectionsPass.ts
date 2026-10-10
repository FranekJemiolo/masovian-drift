import * as THREE from 'three';

/**
 * ScreenSpaceReflectionsPass (SSR)
 * Implements hierarchical screen-space raymarching across wet road asphalt & puddle surfaces.
 * Raymarches reflection vectors in view space to capture reflections of vehicles, neon signs,
 * brake discs, and trackside grandstands.
 */
export class ScreenSpaceReflectionsPass {
  public enabled = true;
  private width: number;
  private height: number;
  public target: THREE.WebGLRenderTarget;

  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private passMaterial: THREE.ShaderMaterial;
  private quadMesh: THREE.Mesh;

  public wetness = 0.85; // 0.0 (dry) to 1.0 (torrential rain / deep puddles)
  public intensity = 1.0;

  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera
  ) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
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
        uWetness: { value: this.wetness },
        uIntensity: { value: this.intensity },
        uMaxSteps: { value: 16 },
        uStepSize: { value: 0.025 },
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
        uniform float uWetness;
        uniform float uIntensity;
        uniform int uMaxSteps;
        uniform float uStepSize;
        varying vec2 vUv;

        float linearizeDepth(float depth) {
          return (2.0 * uCameraNear) / (uCameraFar + uCameraNear - depth * (uCameraFar - uCameraNear));
        }

        void main() {
          vec2 texel = 1.0 / uResolution;
          float baseDepth = linearizeDepth(texture2D(tDepth, vUv).r);

          // Only compute reflections for lower road half of screen
          if (vUv.y > 0.65 || baseDepth < 0.001 || baseDepth > 0.90 || uWetness <= 0.05) {
            gl_FragColor = vec4(0.0);
            return;
          }

          // Road height mask: lower screen coordinates represent ground plane
          float groundFactor = clamp((0.65 - vUv.y) * 3.2, 0.0, 1.0);

          // Procedural puddle mask
          float puddleNoise = sin(vUv.x * 35.0) * cos(vUv.y * 42.0);
          float isPuddle = smoothstep(0.15, 0.55, puddleNoise * 0.5 + 0.5) * uWetness;

          vec3 ssrColor = vec3(0.0);
          float totalWeight = 0.0;

          // Raymarch reflection vector upwards across screen space
          vec2 rayStep = vec2(0.0, uStepSize);
          vec2 rayUv = vUv + rayStep;

          for (int i = 1; i <= 16; i++) {
            if (rayUv.y > 0.98 || rayUv.y < 0.02) break;

            float sampleDepth = linearizeDepth(texture2D(tDepth, rayUv).r);
            float depthDiff = baseDepth - sampleDepth;

            // Hit test: ray intersects an occluder
            if (depthDiff > 0.0005 && depthDiff < 0.045) {
              vec3 hitColor = texture2D(tDiffuse, rayUv).rgb;
              float stepWeight = 1.0 - (float(i) / 16.0);
              ssrColor += hitColor * stepWeight;
              totalWeight += stepWeight;
              break;
            }

            rayUv += rayStep * (1.0 + float(i) * 0.08);
          }

          if (totalWeight > 0.0) {
            ssrColor /= totalWeight;
            // Schlick Fresnel approximation
            float fresnel = pow(1.0 - vUv.y, 2.5) * 0.65;
            float reflectionAlpha = clamp((fresnel + isPuddle * 0.35) * groundFactor * uIntensity, 0.0, 1.0);
            gl_FragColor = vec4(ssrColor * reflectionAlpha, reflectionAlpha);
          } else {
            gl_FragColor = vec4(0.0);
          }
        }
      `,
      depthWrite: false,
      depthTest: false,
      transparent: true,
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
    this.passMaterial.uniforms.uWetness.value = this.wetness;
    this.passMaterial.uniforms.uIntensity.value = this.intensity;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.setRenderTarget(prevTarget);

    return this.target;
  }

  public dispose(): void {
    this.target.dispose();
    this.passMaterial.dispose();
    this.quadMesh.geometry.dispose();
  }
}
