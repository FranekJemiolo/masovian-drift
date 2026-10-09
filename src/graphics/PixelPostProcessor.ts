import * as THREE from 'three';

export interface PixelPostProcessorOptions {
  pixelScale?: number;
  edgeStrength?: number;
}

export class PixelPostProcessor {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  public pixelScale: number;

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
    // Native crisp resolution (1.0) by default for sharp modern screens
    this.pixelScale = options.pixelScale ?? 1.0;

    const size = new THREE.Vector2();
    renderer.getSize(size);
    this.width = Math.max(1, Math.floor(size.x / this.pixelScale));
    this.height = Math.max(1, Math.floor(size.y / this.pixelScale));

    this.depthTexture = new THREE.DepthTexture(this.width, this.height);
    this.depthTexture.type = THREE.UnsignedShortType;

    this.renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
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

        // Crisp Geometric Voxel Edge Detection
        float d00 = linearizeDepth(texture2D(tDepth, vUv + vec2(-texel.x, -texel.y)).r);
        float d20 = linearizeDepth(texture2D(tDepth, vUv + vec2(texel.x, -texel.y)).r);
        float d02 = linearizeDepth(texture2D(tDepth, vUv + vec2(-texel.x, texel.y)).r);
        float d22 = linearizeDepth(texture2D(tDepth, vUv + vec2(texel.x, texel.y)).r);

        float edge = length(vec2(d20 - d02, d22 - d00)) * 8.0;

        // Color difference for crisp outline
        vec3 cLeft = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
        vec3 cRight = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 cUp = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
        vec3 cDown = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        float colorEdge = length(cRight - cLeft) + length(cUp - cDown);

        float edgeFactor = clamp((edge * 0.6 + colorEdge * 0.25) * uEdgeStrength, 0.0, 1.0);

        // Filmic tone curve & vibrant arcade richness
        vec3 rgb = color.rgb;
        // Mild tone curve preserving highlights and opening shadow details
        vec3 lifted = pow(rgb, vec3(0.92)); 
        float lum = dot(lifted, vec3(0.299, 0.587, 0.114));
        vec3 satColor = mix(vec3(lum), lifted, 1.20); // +20% rich saturation

        // Clean subtle silhouette enhancement
        vec3 finalColor = mix(satColor, satColor * 0.55, edgeFactor * 0.4);

        // Soft arcade lens vignette
        vec2 uvCenter = vUv - 0.5;
        float vignette = clamp(1.0 - dot(uvCenter, uvCenter) * 0.35, 0.0, 1.0);
        finalColor *= vignette;

        gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
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
        uCameraFar: { value: 1200.0 },
        uEdgeStrength: { value: options.edgeStrength ?? 0.5 },
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

    // Step 1: Render scene to offscreen buffer
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, cam);

    // Step 2: Render crisp post-processed frame to canvas
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
