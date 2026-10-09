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
      uniform float uSpeedFactor;
      uniform float uTime;
      uniform float uBloomIntensity;
      varying vec2 vUv;

      float linearizeDepth(float depth) {
        return (2.0 * uCameraNear) / (uCameraFar + uCameraNear - depth * (uCameraFar - uCameraNear));
      }

      // ACES Filmic Tone Mapping Curve (Industry standard for AAA cinematic games)
      vec3 ACESFilm(vec3 x) {
        float a = 2.51;
        float b = 0.03;
        float c = 2.43;
        float d = 0.59;
        float e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }

      void main() {
        vec2 texel = 1.0 / uResolution;

        // Dynamic High-Speed Radial Lens Aberration
        vec2 uvCenter = vUv - 0.5;
        float distSq = dot(uvCenter, uvCenter);
        float speedAb = 0.008 + uSpeedFactor * 0.016;
        vec2 caOffset = uvCenter * (distSq * speedAb);

        // Chromatic aberration color sampling
        float colR = texture2D(tDiffuse, vUv + caOffset).r;
        float colG = texture2D(tDiffuse, vUv).g;
        float colB = texture2D(tDiffuse, vUv - caOffset).b;
        vec3 color = vec3(colR, colG, colB);

        // High-Quality Multi-Tap Photographic Bloom (Glowing brake lights, sun specular, exhaust fire)
        vec3 bloom = vec3(0.0);
        float bloomThresh = 0.72;
        
        // 8-Tap Radial Bloom Kernel
        vec2 bOffsets[8];
        bOffsets[0] = vec2(-2.2, -2.2);
        bOffsets[1] = vec2( 2.2, -2.2);
        bOffsets[2] = vec2(-2.2,  2.2);
        bOffsets[3] = vec2( 2.2,  2.2);
        bOffsets[4] = vec2(-4.5,  0.0);
        bOffsets[5] = vec2( 4.5,  0.0);
        bOffsets[6] = vec2( 0.0, -4.5);
        bOffsets[7] = vec2( 0.0,  4.5);

        for (int i = 0; i < 8; i++) {
          vec3 bSample = texture2D(tDiffuse, vUv + bOffsets[i] * texel * 1.5).rgb;
          float bLum = dot(bSample, vec3(0.2126, 0.7152, 0.0722));
          if (bLum > bloomThresh) {
            bloom += (bSample - bloomThresh) * 0.14;
          }
          // Wide halo tap
          vec3 bWide = texture2D(tDiffuse, vUv + bOffsets[i] * texel * 3.8).rgb;
          float bLumW = dot(bWide, vec3(0.2126, 0.7152, 0.0722));
          if (bLumW > bloomThresh) {
            bloom += (bWide - bloomThresh) * 0.08;
          }
        }
        color += bloom * uBloomIntensity;

        // Crisp Geometric Voxel Edge Detection
        float d00 = linearizeDepth(texture2D(tDepth, vUv + vec2(-texel.x, -texel.y)).r);
        float d20 = linearizeDepth(texture2D(tDepth, vUv + vec2(texel.x, -texel.y)).r);
        float d02 = linearizeDepth(texture2D(tDepth, vUv + vec2(-texel.x, texel.y)).r);
        float d22 = linearizeDepth(texture2D(tDepth, vUv + vec2(texel.x, texel.y)).r);

        float edge = length(vec2(d20 - d02, d22 - d00)) * 7.5;

        // Color difference for crisp silhouette outlines
        vec3 cLeft = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
        vec3 cRight = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 cUp = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
        vec3 cDown = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        float colorEdge = length(cRight - cLeft) + length(cUp - cDown);

        float edgeFactor = clamp((edge * 0.45 + colorEdge * 0.20) * uEdgeStrength, 0.0, 1.0);

        // Warm Golden-Hour Color Grading (Mazovian sunset palette)
        vec3 graded = color * vec3(1.05, 1.02, 0.97); // Warm sunlight spectrum
        graded = ACESFilm(graded * 1.14);

        // Saturation boost for punchy arcade look
        float lum = dot(graded, vec3(0.299, 0.587, 0.114));
        vec3 satColor = mix(vec3(lum), graded, 1.25);

        // Silhouette edge shading
        vec3 finalColor = mix(satColor, satColor * 0.54, edgeFactor * 0.35);

        // High-Speed Speed Lines & Vignette
        float speedVignette = 0.35 + uSpeedFactor * 0.25;
        float vignette = clamp(1.0 - distSq * speedVignette, 0.0, 1.0);
        finalColor *= vignette;

        // Subtle film grain
        float noise = fract(sin(dot(vUv * uResolution, vec2(12.9898, 78.233)) + uTime) * 43758.5453);
        finalColor += (noise - 0.5) * 0.012;

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
        uEdgeStrength: { value: options.edgeStrength ?? 0.45 },
        uSpeedFactor: { value: 0.0 },
        uTime: { value: 0.0 },
        uBloomIntensity: { value: 1.25 },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    this.postScene.add(this.quad);
  }

  public update(time: number, speedKmh: number = 0): void {
    this.postMaterial.uniforms.uTime.value = time;
    const speedFactor = THREE.MathUtils.clamp((speedKmh - 40.0) / 140.0, 0.0, 1.0);
    this.postMaterial.uniforms.uSpeedFactor.value = speedFactor;
  }

  public setBloomIntensity(val: number): void {
    this.postMaterial.uniforms.uBloomIntensity.value = val;
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
