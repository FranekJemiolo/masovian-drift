import * as THREE from 'three';
import { PRNG } from '../utils/PRNG';

export type AtmospherePreset = 'day' | 'sunset' | 'night';

export class Atmosphere {
  public skyMesh: THREE.Mesh;
  public cloudsGroup: THREE.Group;
  private skyMaterial: THREE.ShaderMaterial;
  private scene: THREE.Scene;
  private currentPreset: AtmospherePreset = 'day';

  constructor(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
    this.scene = scene;

    // 1. Procedural Gradient Skydome
    const skyGeo = new THREE.SphereGeometry(750, 32, 24);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x1d4ed8) },    // Deep royal cobalt zenith
        midColor: { value: new THREE.Color(0x60a5fa) },    // Bright Mazovian azure
        bottomColor: { value: new THREE.Color(0xfef3c7) }, // Warm golden afternoon horizon haze
        sunDir: { value: new THREE.Vector3(-100, 170, -90).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        uniform vec3 sunDir;
        varying vec3 vWorldPosition;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float h = max(0.0, dir.y);

          // Rich two-stage sky gradient
          vec3 sky = mix(bottomColor, midColor, smoothstep(0.0, 0.28, h));
          sky = mix(sky, topColor, smoothstep(0.28, 0.95, h));

          // Subtle sun corona glow in sky
          float sunDot = max(0.0, dot(dir, sunDir));
          sky += vec3(1.0, 0.92, 0.75) * pow(sunDot, 128.0) * 0.85;
          sky += vec3(1.0, 0.80, 0.50) * pow(sunDot, 16.0) * 0.35;

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    scene.add(this.skyMesh);

    // 2. Procedural Sky IBL Environment Map (G3: Lighting & Reflections)
    if (renderer) {
      this.generateSkyIBL(renderer);
    }

    // 3. Dual-Tone Voxel Cumulus Clouds (Deterministic PRNG)
    this.cloudsGroup = new THREE.Group();
    const cloudCount = 36;
    const cloudGeo = new THREE.BoxGeometry(32, 7, 44);

    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
    });

    const instancedClouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudCount);
    instancedClouds.castShadow = true;
    instancedClouds.receiveShadow = false;

    const dummy = new THREE.Object3D();
    const rng = new PRNG(4242);
    for (let i = 0; i < cloudCount; i++) {
      const radius = 180 + rng.next() * 520;
      const angle = rng.next() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 95 + rng.next() * 45;

      const sx = 0.9 + rng.next() * 1.5;
      const sy = 0.7 + rng.next() * 0.6;
      const sz = 0.9 + rng.next() * 1.6;

      dummy.position.set(x, y, z);
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.y = rng.next() * Math.PI * 2;
      dummy.updateMatrix();

      instancedClouds.setMatrixAt(i, dummy.matrix);
    }

    instancedClouds.instanceMatrix.needsUpdate = true;
    instancedClouds.computeBoundingSphere();
    this.cloudsGroup.add(instancedClouds);
    scene.add(this.cloudsGroup);
  }

  /**
   * Synthesizes an equirectangular environment texture from sky colors
   * and compiles it via PMREMGenerator for high-fidelity IBL reflections on cars and water
   */
  private generateSkyIBL(renderer: THREE.WebGLRenderer): void {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const grad = ctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, '#1d4ed8');   // Top
      grad.addColorStop(0.5, '#60a5fa'); // Mid
      grad.addColorStop(0.85, '#fef3c7'); // Bottom horizon
      grad.addColorStop(1.0, '#4d7c0f'); // Ground bounce
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 128);

      // Add sun specular hotspot
      const sunGrad = ctx.createRadialGradient(100, 35, 2, 100, 35, 30);
      sunGrad.addColorStop(0, '#ffffff');
      sunGrad.addColorStop(0.3, '#fef08a');
      sunGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, 256, 128);

      const tex = new THREE.CanvasTexture(canvas);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const envMap = pmrem.fromEquirectangular(tex).texture;
      this.scene.environment = envMap;
      tex.dispose();
      pmrem.dispose();
    } catch (_) {
      // Fallback silently if WebGL context doesn't support PMREM
    }
  }

  public setPreset(preset: AtmospherePreset): void {
    this.currentPreset = preset;
    const u = this.skyMaterial.uniforms;
    if (preset === 'sunset') {
      u.topColor.value.setHex(0x3b0764);   // Twilight indigo
      u.midColor.value.setHex(0xf97316);   // Golden orange
      u.bottomColor.value.setHex(0xfef08a);// Horizon glow
      u.sunDir.value.set(-160, 45, -70).normalize();
    } else if (preset === 'night') {
      u.topColor.value.setHex(0x020617);   // Pitch navy
      u.midColor.value.setHex(0x0f172a);   // Slate blue
      u.bottomColor.value.setHex(0x1e293b);// Distant dusk
      u.sunDir.value.set(0, -100, 0).normalize();
    } else {
      u.topColor.value.setHex(0x1d4ed8);
      u.midColor.value.setHex(0x60a5fa);
      u.bottomColor.value.setHex(0xfef3c7);
      u.sunDir.value.set(-100, 170, -90).normalize();
    }
  }

  public getPreset(): AtmospherePreset {
    return this.currentPreset;
  }

  public update(delta: number, carPos: THREE.Vector3): void {
    // Keep skydome centered on player for infinite parallax
    this.skyMesh.position.x = carPos.x;
    this.skyMesh.position.z = carPos.z;

    // Gentle cloud drift
    this.cloudsGroup.rotation.y += delta * 0.003;
  }
}

