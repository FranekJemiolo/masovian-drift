import * as THREE from 'three';

export class Atmosphere {
  public skyMesh: THREE.Mesh;
  public cloudsGroup: THREE.Group;

  constructor(scene: THREE.Scene) {
    // 1. Procedural Gradient Skydome
    const skyGeo = new THREE.SphereGeometry(750, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
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

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.skyMesh);

    // 2. Dual-Tone Voxel Cumulus Clouds (Sunlit tops, ambient shadow bases)
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
    for (let i = 0; i < cloudCount; i++) {
      const radius = 180 + Math.random() * 520;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 95 + Math.random() * 45;

      const sx = 0.9 + Math.random() * 1.5;
      const sy = 0.7 + Math.random() * 0.6;
      const sz = 0.9 + Math.random() * 1.6;

      dummy.position.set(x, y, z);
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();

      instancedClouds.setMatrixAt(i, dummy.matrix);
    }

    instancedClouds.instanceMatrix.needsUpdate = true;
    this.cloudsGroup.add(instancedClouds);
    scene.add(this.cloudsGroup);
  }

  public update(delta: number, carPos: THREE.Vector3): void {
    // Keep skydome centered on player for infinite parallax
    this.skyMesh.position.x = carPos.x;
    this.skyMesh.position.z = carPos.z;

    // Gentle cloud drift
    this.cloudsGroup.rotation.y += delta * 0.003;
  }
}
