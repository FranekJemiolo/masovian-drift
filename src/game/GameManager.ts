import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FollowCamera } from '../camera/FollowCamera';
import { InputManager } from '../controls/InputManager';
import { EvolutionStore } from '../economy/EvolutionStore';
import { EnvironmentGenerator } from '../graphics/EnvironmentGenerator';
import { PixelPostProcessor } from '../graphics/PixelPostProcessor';
import { TrackMeshBuilder } from '../graphics/TrackMeshBuilder';
import { VoxelCarBuilder } from '../graphics/VoxelCarBuilder';
import { NetworkVehicleFrame, StateSync } from '../net/StateSync';
import { WebRTCManager } from '../net/WebRTCManager';
import { AI_BOT_PROFILES, PurePursuitAI } from '../ai/PurePursuitAI';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { TrackWaypoints, Waypoint } from '../physics/TrackWaypoints';
import { VehiclePhysics } from '../physics/VehiclePhysics';
import { HUD } from '../ui/HUD';
import { MenuUI } from '../ui/MenuUI';
import { GameMode, VehicleState } from './Types';

export class GameManager {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private postProcessor!: PixelPostProcessor;

  // Cameras
  private p1Camera!: FollowCamera;
  private p2Camera!: FollowCamera;

  // Physics & World
  private physicsWorld!: PhysicsWorld;
  private waypoints!: Waypoint[];
  private checkpoints: { position: THREE.Vector3; index: number; radius: number }[] = [];

  // Vehicles
  private playerVehicle!: VehiclePhysics;
  private p2Vehicle: VehiclePhysics | null = null;
  private aiBots: PurePursuitAI[] = [];
  private allVehicles: VehiclePhysics[] = [];

  // Subsystems
  private audioManager!: AudioManager;
  private inputManager!: InputManager;
  private evolutionStore!: EvolutionStore;
  private hud!: HUD;
  private menuUI!: MenuUI;
  private webRTCManager!: WebRTCManager;

  // Game state
  public currentMode: GameMode = 'quick-race';
  public isRacing = false;
  private countdownRemaining = 3.2;
  private networkSequence = 0;
  private lastNetworkSendTime = 0;
  private clock = new THREE.Clock();

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    // 1. Setup Three.js WebGL Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x60a5fa); // Vibrant azure blue sky
    this.scene.fog = new THREE.FogExp2(0x93c5fd, 0.0016); // Atmospheric Mazovian pine mist

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.renderer.domElement);

    // 2. Setup Lighting & Atmosphere (Warm golden sun, rich bounce light)
    const hemiLight = new THREE.HemisphereLight(0xbfdbfe, 0x4d7c0f, 0.85);
    this.scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xfff7ed, 0.65);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff1cc, 2.4);
    // Sun shines from rear-left towards the start straight and cars
    sunLight.position.set(-100, 170, -90);
    sunLight.target.position.set(0, 0, 20);
    this.scene.add(sunLight.target);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 480;
    const d = 180;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0004;
    this.scene.add(sunLight);

    // Add floating voxel clouds
    this.generateVoxelClouds();

    // 3. Initialize Physics World (Rapier3D WASM)
    this.physicsWorld = new PhysicsWorld();
    await this.physicsWorld.init();

    // 4. Build Track Waypoints, Road Mesh & Instanced Pine Forests + Świdermajer Villas
    this.waypoints = TrackWaypoints.getCircuitWaypoints();
    const trackData = TrackMeshBuilder.buildTrack(this.waypoints);
    this.scene.add(trackData.trackGroup);
    this.checkpoints = trackData.checkpoints;

    // Build World Physics Colliders
    this.physicsWorld.buildWorldColliders(this.waypoints);

    // Generate Forests & Villas with InstancedMesh (Milestone 2 single draw call)
    EnvironmentGenerator.generateEnvironment(this.scene, this.waypoints);

    // 5. Cameras
    this.p1Camera = new FollowCamera(64, window.innerWidth / window.innerHeight);
    this.p2Camera = new FollowCamera(64, (window.innerWidth * 0.5) / window.innerHeight);

    // 6. High-Fidelity Post-Processor (Native 1.0 resolution)
    this.postProcessor = new PixelPostProcessor(
      this.renderer,
      this.scene,
      this.p1Camera.camera,
      { pixelScale: 1.0, edgeStrength: 0.45 }
    );

    // 7. Initialize Economy & Audio & Input
    this.evolutionStore = new EvolutionStore();
    await this.evolutionStore.init();

    this.audioManager = AudioManager.getInstance();
    this.inputManager = InputManager.getInstance();
    this.hud = new HUD();

    // 8. Setup WebRTC Multiplayer Manager (Milestone 5)
    this.webRTCManager = new WebRTCManager(
      (frame) => this.onRemoteNetworkFrame(frame),
      (state) => console.log('WebRTC connection state:', state)
    );

    // 9. Setup Menu UI
    this.menuUI = new MenuUI(this.evolutionStore, {
      onStartGame: (mode) => this.startGame(mode),
      onOpenMultiplayer: () => this.openMultiplayerModal(),
      onOpenGarage: () => this.menuUI.renderGarageModal(),
      onTogglePixelShader: () => {
        this.postProcessor.enabled = !this.postProcessor.enabled;
      },
    });

    // 10. Spawn Initial Showcase Car at Start Line
    this.spawnShowcaseCar();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Cycle camera with 'C'
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') {
        this.p1Camera.cycleMode();
      } else if (e.code === 'KeyM') {
        this.audioManager.toggleMute();
      } else if (e.code === 'KeyR') {
        this.resetPlayerVehicle();
      }
    });

    // Start Main Render & Simulation Loop
    this.animate();
  }

  private generateVoxelClouds(): void {
    const cloudCount = 28;
    const cloudGroup = new THREE.Group();
    const cloudGeo = new THREE.BoxGeometry(24, 6, 36);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      flatShading: true,
    });
    const instancedClouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudCount);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < cloudCount; i++) {
      const x = (Math.random() - 0.5) * 1200;
      const y = 80 + Math.random() * 35;
      const z = (Math.random() - 0.5) * 1200;
      const s = 0.8 + Math.random() * 1.4;
      dummy.position.set(x, y, z);
      dummy.scale.set(s * (1 + Math.random() * 0.6), s * 0.6, s * (1 + Math.random() * 0.6));
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      instancedClouds.setMatrixAt(i, dummy.matrix);
    }
    instancedClouds.instanceMatrix.needsUpdate = true;
    cloudGroup.add(instancedClouds);
    this.scene.add(cloudGroup);
  }

  private spawnShowcaseCar(): void {
    const currentCar = this.evolutionStore.getCurrentCar();
    const p1Visual = VoxelCarBuilder.createVoxelBoxer(
      currentCar.specs.bodyColor,
      currentCar.specs.accentColor,
      true
    );
    this.scene.add(p1Visual.root);

    const spawnWp = this.waypoints[0];
    const normal = spawnWp.normal ?? new THREE.Vector3(1, 0, 0);
    const tangent = spawnWp.tangent ?? new THREE.Vector3(0, 0, 1);

    // Pole Position (right lane, facing down the open straightaway)
    const spawnPos = spawnWp.point.clone()
      .addScaledVector(tangent, -6.0)
      .addScaledVector(normal, 2.8);
    spawnPos.y += 0.85;

    const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    this.playerVehicle = new VehiclePhysics(
      'player-1',
      currentCar.modelName,
      currentCar.specs,
      p1Visual,
      this.physicsWorld.world,
      spawnPos,
      spawnQuat,
      true,
      false,
      currentCar.damage
    );
    this.allVehicles.push(this.playerVehicle);

    // Initial camera position overlooking the starting straight, car and gantry arch
    this.p1Camera.camera.position.set(spawnPos.x + 4.5, spawnPos.y + 1.6, spawnPos.z - 5.5);
    this.p1Camera.camera.lookAt(spawnPos.x, spawnPos.y + 0.6, spawnPos.z);
  }

  public startGame(mode: GameMode): void {
    this.currentMode = mode;
    this.isRacing = true;
    this.countdownRemaining = 3.2;
    this.hud.show();
    this.hud.setSplitScreen(mode === 'split-screen');

    // Clean up previous vehicles
    for (const v of this.allVehicles) {
      this.scene.remove(v.visual.root);
    }
    this.allVehicles = [];
    this.aiBots = [];
    this.p2Vehicle = null;

    // 1. Spawn Player 1 Boxer on Pole Position
    const currentCar = this.evolutionStore.getCurrentCar();
    const p1Visual = VoxelCarBuilder.createVoxelBoxer(
      currentCar.specs.bodyColor,
      currentCar.specs.accentColor,
      true
    );
    this.scene.add(p1Visual.root);

    const spawnWp = this.waypoints[0];
    const normal = spawnWp.normal ?? new THREE.Vector3(1, 0, 0);
    const tangent = spawnWp.tangent ?? new THREE.Vector3(0, 0, 1);

    const spawnPos = spawnWp.point.clone()
      .addScaledVector(tangent, -6.0)
      .addScaledVector(normal, 2.8);
    spawnPos.y += 0.85;

    const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    this.playerVehicle = new VehiclePhysics(
      'player-1',
      currentCar.modelName,
      currentCar.specs,
      p1Visual,
      this.physicsWorld.world,
      spawnPos,
      spawnQuat,
      true,
      false,
      currentCar.damage
    );
    this.allVehicles.push(this.playerVehicle);
    this.p1Camera.snapToTarget(this.playerVehicle.position, this.playerVehicle.quaternion);

    // 2. Handle Game Modes
    if (mode === 'quick-race') {
      // Spawn 5 Pure Pursuit AI bots in staggered motorsport grid positions
      for (let i = 0; i < AI_BOT_PROFILES.length; i++) {
        const profile = AI_BOT_PROFILES[i];
        const aiVisual = VoxelCarBuilder.createVoxelBoxer(profile.color, profile.accent, false);
        this.scene.add(aiVisual.root);

        // Staggered grid (P2 left, P3 right, P4 left, P5 right, P6 left)
        const isRight = (i % 2 !== 0);
        const distBack = 14.5 + i * 8.5;
        const sideOffset = isRight ? 2.8 : -2.8;

        const aiSpawn = spawnWp.point.clone()
          .addScaledVector(tangent, -distBack)
          .addScaledVector(normal, sideOffset);
        aiSpawn.y += 0.85;

        const aiVehicle = new VehiclePhysics(
          `ai-${i}`,
          profile.name,
          { ...currentCar.specs, bodyColor: profile.color, accentColor: profile.accent },
          aiVisual,
          this.physicsWorld.world,
          aiSpawn,
          spawnQuat,
          false,
          true
        );

        const aiController = new PurePursuitAI(aiVehicle, profile, this.waypoints);
        this.aiBots.push(aiController);
        this.allVehicles.push(aiVehicle);
      }
      this.audioManager.startEngines();

    } else if (mode === 'split-screen') {
      // Spawn Player 2 vehicle in P2 slot (left lane)
      const p2Visual = VoxelCarBuilder.createVoxelBoxer(0x2563eb, 0xffffff, false);
      this.scene.add(p2Visual.root);

      const p2Spawn = spawnWp.point.clone()
        .addScaledVector(tangent, -6.0)
        .addScaledVector(normal, -2.8);
      p2Spawn.y += 0.85;

      this.p2Vehicle = new VehiclePhysics(
        'player-2',
        'Player 2 (Cobalt Boxer)',
        { ...currentCar.specs, bodyColor: 0x2563eb },
        p2Visual,
        this.physicsWorld.world,
        p2Spawn,
        spawnQuat,
        true,
        false
      );
      this.allVehicles.push(this.p2Vehicle);
      this.p2Camera.snapToTarget(this.p2Vehicle.position, this.p2Vehicle.quaternion);
      this.audioManager.startSplitScreenEngines();

    } else if (mode === 'multiplayer-host' || mode === 'multiplayer-join') {
      // Spawn Remote Peer Vehicle
      const remoteVisual = VoxelCarBuilder.createVoxelBoxer(0xeab308, 0x111111, false);
      this.scene.add(remoteVisual.root);

      const remoteSpawn = spawnWp.point.clone()
        .addScaledVector(tangent, -6.0)
        .addScaledVector(normal, -2.8);
      remoteSpawn.y += 0.85;

      this.p2Vehicle = new VehiclePhysics(
        'peer-remote',
        'Opponent (P2P)',
        { ...currentCar.specs, bodyColor: 0xeab308 },
        remoteVisual,
        this.physicsWorld.world,
        remoteSpawn,
        spawnQuat,
        false,
        false
      );
      this.allVehicles.push(this.p2Vehicle);
      this.audioManager.startEngines();
    }
  }

  private openMultiplayerModal(): void {
    this.menuUI.renderMultiplayerModal(
      async () => {
        return await this.webRTCManager.createHostOffer();
      },
      async (answer) => {
        await this.webRTCManager.acceptHostAnswer(answer);
      },
      async (offer) => {
        return await this.webRTCManager.handleOfferAndCreateAnswer(offer);
      }
    );
  }

  private onRemoteNetworkFrame(frame: NetworkVehicleFrame): void {
    if (!this.p2Vehicle) return;

    // Apply Client-Side Prediction & Server Reconciliation (Milestone 5)
    StateSync.reconcileRemoteVehicle(
      this.p2Vehicle.position,
      this.p2Vehicle.quaternion,
      frame.position,
      frame.quaternion,
      frame.velocity,
      0.016
    );

    this.p2Vehicle.velocity.copy(frame.velocity);
    this.p2Vehicle.angularVelocity.copy(frame.angularVelocity);
    this.p2Vehicle.rpm = frame.rpm;
    this.p2Vehicle.steerAngle = frame.steer;
    this.p2Vehicle.currentGear = frame.gear;
    this.p2Vehicle.isDrifting = frame.isDrifting;

    // Update remote visual brake lights
    if (frame.brakeLight) {
      this.p2Vehicle.visual.brakeLightMaterial.emissive.setHex(0xdc2626);
      this.p2Vehicle.visual.brakeLightMaterial.emissiveIntensity = 2.4;
    } else {
      this.p2Vehicle.visual.brakeLightMaterial.emissive.setHex(0x450a0a);
      this.p2Vehicle.visual.brakeLightMaterial.emissiveIntensity = 0.2;
    }
  }

  private resetPlayerVehicle(): void {
    if (!this.playerVehicle) return;
    const wp = this.waypoints[this.playerVehicle.currentCheckpointIndex];
    const quat = new THREE.Quaternion();
    if (wp.tangent) {
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
    }
    this.playerVehicle.resetPosition(wp.point.clone().add(new THREE.Vector3(0, 0.85, 0)), quat);
  }

  /**
   * Main game animation loop (runs at 60 FPS)
   */
  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.05);

    if (this.isRacing) {
      let isCountingDown = false;
      if (this.countdownRemaining > 0) {
        isCountingDown = true;
        this.countdownRemaining -= delta;
        if (this.countdownRemaining > 2.0) {
          this.hud.showCountdown('3');
        } else if (this.countdownRemaining > 1.0) {
          this.hud.showCountdown('2');
        } else {
          this.hud.showCountdown('1');
        }
      } else if (this.countdownRemaining > -1.0) {
        this.countdownRemaining -= delta;
        this.hud.showCountdown('GO!');
      } else {
        this.hud.hideCountdown();
      }

      // 1. Step Deterministic Rapier3D Physics
      this.physicsWorld.step(delta, (dt) => {
        // Player 1 inputs
        let p1Inputs = this.inputManager.getPlayerInputs();
        if (isCountingDown) {
          p1Inputs = { throttle: 0.35, brake: 1.0, steer: 0, handbrake: true };
        }
        this.playerVehicle.updatePhysics(p1Inputs, dt, this.waypoints);

        // Player 2 inputs (if in Split-Screen)
        if (this.currentMode === 'split-screen' && this.p2Vehicle) {
          let p2Inputs = this.inputManager.getPlayer2Inputs();
          if (isCountingDown) {
            p2Inputs = { throttle: 0.35, brake: 1.0, steer: 0, handbrake: true };
          }
          this.p2Vehicle.updatePhysics(p2Inputs, dt, this.waypoints);
        }

        // AI Opponents (Pure Pursuit)
        for (const bot of this.aiBots) {
          let botInputs = bot.update(dt, this.allVehicles);
          if (isCountingDown) {
            botInputs = { throttle: 0.25, brake: 1.0, steer: 0, handbrake: true };
          }
          bot.vehicle.updatePhysics(botInputs, dt, this.waypoints);
        }

        // Track checkpoints & lap progression
        if (!isCountingDown) {
          this.updateRaceProgression(dt);
        }
      });

      // 2. Audio Synthesizer Update
      this.audioManager.updatePlayerEngine(
        this.playerVehicle.rpm,
        this.inputManager.getPlayerInputs().throttle,
        this.playerVehicle.slipAngle,
        this.playerVehicle.speedKmh
      );

      if (this.currentMode === 'split-screen' && this.p2Vehicle) {
        this.audioManager.updateP2Engine(
          this.p2Vehicle.rpm,
          this.inputManager.getPlayer2Inputs().throttle,
          this.p2Vehicle.slipAngle,
          this.p2Vehicle.speedKmh
        );
      }

      // 3. Update Cameras
      this.p1Camera.update(
        this.playerVehicle.position,
        this.playerVehicle.quaternion,
        this.playerVehicle.velocity,
        this.playerVehicle.speedKmh,
        delta
      );

      if (this.currentMode === 'split-screen' && this.p2Vehicle) {
        this.p2Camera.update(
          this.p2Vehicle.position,
          this.p2Vehicle.quaternion,
          this.p2Vehicle.velocity,
          this.p2Vehicle.speedKmh,
          delta
        );
      }

      // 4. Update HUD
      const p1State = this.playerVehicle.getVehicleState();
      const p2State = this.p2Vehicle?.getVehicleState();
      this.hud.update(p1State, p2State);

      // 5. P2P WebRTC State Broadcast (with backpressure throttling)
      if (
        (this.currentMode === 'multiplayer-host' || this.currentMode === 'multiplayer-join') &&
        this.webRTCManager.isConnected
      ) {
        const now = performance.now();
        const sendIntervalMs = 1000 / this.webRTCManager.targetSendFps;

        if (now - this.lastNetworkSendTime >= sendIntervalMs) {
          this.lastNetworkSendTime = now;
          const p1Inputs = this.inputManager.getPlayerInputs();
          const buffer = StateSync.serializeState(
            this.networkSequence++,
            p1State,
            p1Inputs.brake
          );
          this.webRTCManager.sendState(buffer);
        }
      }
    } else {
      // Menu showcase mode: slow cinematic orbit camera around the player's voxel car!
      if (this.playerVehicle) {
        const t = this.clock.getElapsedTime() * 0.22;
        const carPos = this.playerVehicle.position;
        const camDist = 6.8;
        this.p1Camera.camera.position.set(
          carPos.x + Math.sin(t) * camDist,
          carPos.y + 1.8,
          carPos.z + Math.cos(t) * camDist
        );
        this.p1Camera.camera.lookAt(carPos.x, carPos.y + 0.6, carPos.z);
      }
    }

    // 6. RENDER FRAME (Split-Screen Scissor / Viewport or Fullscreen)
    this.renderFrame();
  };

  /**
   * Milestone 2 & Split-Screen multi-view rendering:
   * Uses renderer.setScissor() and renderer.setViewport() without duplicating scene graph memory!
   */
  private renderFrame(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (this.currentMode === 'split-screen' && this.p2Vehicle) {
      // Split Screen Duel Mode
      this.renderer.setScissorTest(true);

      const halfWidth = Math.floor(width * 0.5);

      // View 1: Left Screen (Player 1)
      this.renderer.setViewport(0, 0, halfWidth, height);
      this.renderer.setScissor(0, 0, halfWidth, height);
      this.p1Camera.setAspect(halfWidth / height);
      this.renderer.render(this.scene, this.p1Camera.camera);

      // View 2: Right Screen (Player 2)
      this.renderer.setViewport(halfWidth, 0, halfWidth, height);
      this.renderer.setScissor(halfWidth, 0, halfWidth, height);
      this.p2Camera.setAspect(halfWidth / height);
      this.renderer.render(this.scene, this.p2Camera.camera);

      this.renderer.setScissorTest(false);

    } else {
      // Single Screen Mode (with Pixel-Art Post-Processor)
      this.renderer.setViewport(0, 0, width, height);
      this.postProcessor.render(this.p1Camera.camera);
    }
  }

  private updateRaceProgression(dt: number): void {
    const cpCount = this.checkpoints.length;

    for (const v of this.allVehicles) {
      if (v.raceFinished) continue;

      v.currentLapTime += dt;
      const nextCp = this.checkpoints[v.currentCheckpointIndex];

      if (v.position.distanceTo(nextCp.position) < nextCp.radius) {
        v.currentCheckpointIndex = (v.currentCheckpointIndex + 1) % cpCount;

        // Completed a full lap
        if (v.currentCheckpointIndex === 0) {
          if (v.currentLapTime < v.bestLapTime) {
            v.bestLapTime = v.currentLapTime;
          }

          v.currentLap++;
          v.currentLapTime = 0;

          // 3-Lap race finish check
          if (v.currentLap > 3) {
            v.raceFinished = true;
            if (v.isPlayer && v.id === 'player-1') {
              this.handleRaceFinish();
            }
          }
        }
      }
    }

    // Calculate real-time rank
    const sorted = [...this.allVehicles].sort((a, b) => {
      if (a.currentLap !== b.currentLap) return b.currentLap - a.currentLap;
      return b.currentCheckpointIndex - a.currentCheckpointIndex;
    });

    sorted.forEach((veh, idx) => {
      veh.raceRank = idx + 1;
    });
  }

  private handleRaceFinish(): void {
    const rank = this.playerVehicle.raceRank;
    const prize = this.evolutionStore.rewardRaceFinish(rank, this.playerVehicle.driftScore);

    // Save persistent damage to IndexedDB
    this.evolutionStore.updateDamage(this.evolutionStore.getCurrentCar().id, this.playerVehicle.damage);

    setTimeout(() => {
      alert(`🏁 RACE FINISHED! You placed ${rank}${['st', 'nd', 'rd', 'th'][Math.min(3, rank - 1)]}!\nEarned ${prize} PLN! Persistent damage saved to Evolution garage.`);
      this.hud.hide();
      this.audioManager.stopEngines();
      this.menuUI.renderMainMenu();
      this.isRacing = false;
    }, 800);
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer.setSize(width, height);
    this.postProcessor.setSize(width, height);
    this.p1Camera.setAspect(width / height);
    this.p2Camera.setAspect((width * 0.5) / height);
  }
}
