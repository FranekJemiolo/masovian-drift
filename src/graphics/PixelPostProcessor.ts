import * as THREE from 'three';

export interface PixelPostProcessorOptions {
  pixelScale?: number; // Downscale factor (e.g., 2, 3, or 4 for chunky pixel-art)
  edgeThreshold?: number;
  edgeColor?: THREE.Color;
}

export class PixelPostProcessor {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private pixelScale: number;

  private renderTarget: THREE.WebGLRenderTarget;
  private depthTexture: THREE.DepthTexture;
  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postMaterial: THREE.ShaderMaterial;
  private quad: THREE.Mesh;

  private width = 1;
  private height = 1;
  public enabled = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    options: PixelPostProcessorOptions = {}
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.pixelScale = options.pixelScale ?? 2.5;

    const size = new THREE.Vector2();
    renderer.getSize(size);
    this.width = Math.max(1, Math.floor(size.x / this.pixelScale));
    this.height = Math.max(1, Math.floor(size.y / this.pixelScale));

    this.depthTexture = new THREE.DepthTexture(this.width, this.height);
    this.depthTexture.type = THREE.UnsignedShortType;

    this.renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthTexture: this.depthTexture,
      depthBuffer: true,
    });

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform vec2 uResolution;
      uniform float uCameraNear;
      uniform float uCameraFar;
      uniform float uEdgeStrength;
      varying vec2 vUv;

      float linearizeDepth(float depth) {
        return (2.0 * uCameraNear) / (uCameraFar + uCameraNear - depth * (uCameraFar - uCameraNear));
      }

      void main() {
        vec2 texel = 1.0 / uResolution;
        vec4 color = texture2D(tDiffuse, vUv);

        // Sobel Edge Detection on depth & luminance
        float d00 = linearizeDepth(texture2D(tDepth, vUv + vec2(-texel.x, -texel.y)).r);
        float d10 = linearizeDepth(texture2D(tDepth, vUv + vec2(0.0, -texel.y)).r);
        float d20 = linearizeDepth(texture2D(tDepth, vUv + vec2(texel.x, -texel.y)).r);
        float d01 = linearizeDepth(texture2D(tDepth, vUv + vec2(-texel.x, 0.0)).r);
        float d21 = linearizeDepth(texture2D(tDepth, vUv + vec2(texel.x, 0.0)).r);
        float d02 = linearizeDepth(texture2D(tDepth, vUv + vec2(-texel.x, texel.y)).r);
        float d12 = linearizeDepth(texture2D(tDepth, vUv + vec2(0.0, texel.y)).r);
        float d22 = linearizeDepth(texture2D(tDepth, vUv + vec2(texel.x, texel.y)).r);

        float gx = (d20 + 2.0 * d21 + d22) - (d00 + 2.0 * d01 + d02);
        float gy = (d02 + 2.0 * d12 + d22) - (d00 + 2.0 * d10 + d20);
        float edge = sqrt(gx * gx + gy * gy);

        // Color edge detection for contrast
        vec3 cLeft = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
        vec3 cRight = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 cUp = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
        vec3 cDown = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        float colorDiff = length(cRight - cLeft) + length(cUp - cDown);

        float edgeFactor = clamp((edge * 45.0 + colorDiff * 0.4) * uEdgeStrength, 0.0, 1.0);

        // Subtle retro color quantization for authentic pixel-art palette
        vec3 quantized = floor(color.rgb * 32.0 + 0.5) / 32.0;

        // Dark retro outline
        vec3 finalColor = mix(quantized, vec3(0.06, 0.06, 0.09), edgeFactor * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    this.postMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        tDepth: { value: this.renderTarget.depthTexture },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1000.0 },
        uEdgeStrength: { value: 0.75 },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    this.postScene.add(this.quad);
  }

  public setPixelScale(scale: number): void {
    this.pixelScale = Math.max(1, scale);
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.setSize(size.x, size.y);
  }

  public setSize(displayWidth: number, displayHeight: number): void {
    this.width = Math.max(1, Math.floor(displayWidth / this.pixelScale));
    this.height = Math.max(1, Math.floor(displayHeight / this.pixelScale));

    this.renderTarget.setSize(this.width, this.height);
    this.postMaterial.uniforms.uResolution.value.set(this.width, this.height);
  }

  public render(customCamera?: THREE.Camera): void {
    const cam = customCamera || this.camera;
    if (cam instanceof THREE.PerspectiveCamera) {
      this.postMaterial.uniforms.uCameraNear.value = cam.near;
      this.postMaterial.uniforms.uCameraFar.value = cam.far;
    }

    if (!this.enabled) {
      this.renderer.render(this.scene, cam);
      return;
    }

    // Step 1: Render scene to low-res target with nearest-neighbor sampling
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, cam);

    // Step 2: Render full-screen quad to screen using nearest-neighbor scaling
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  public dispose(): void {
    this.renderTarget.dispose();
    this.depthTexture.dispose();
    this.postMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
