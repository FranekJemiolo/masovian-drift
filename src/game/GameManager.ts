import * as THREE from 'three';
import { AudioManager } from '../audio/AudioManager';
import { FollowCamera } from '../camera/FollowCamera';
import { InputManager } from '../controls/InputManager';
import { EvolutionStore } from '../economy/EvolutionStore';
import { Atmosphere } from '../graphics/Atmosphere';
import { EnvironmentGenerator } from '../graphics/EnvironmentGenerator';
import { ParticleFX } from '../graphics/ParticleFX';
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
import { PRNG } from '../utils/PRNG';

export class GameManager {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private postProcessor!: PixelPostProcessor;
  private atmosphere!: Atmosphere;
  private particleFX!: ParticleFX;
  private sunLight!: THREE.DirectionalLight;

  // Cameras
  private p1Camera!: FollowCamera;
  private p2Camera!: FollowCamera;

  // Physics & World
  private physicsWorld!: PhysicsWorld;
  private waypoints!: Waypoint[];
  private checkpoints: { position: THREE.Vector3; index: number; radius: number }[] = [];
  private riverMesh: THREE.Mesh | null = null;

  // Vehicles
  private playerVehicle!: VehiclePhysics;
  private p2Vehicle: VehiclePhysics | null = null;
  private aiBots: PurePursuitAI[] = [];
  private allVehicles: VehiclePhysics[] = [];

  // Subsystems
  private audioManager!: AudioManager;
  private inputManager!: InputManager;
  private evolutionStore!: EvolutionStore;
  public hud!: HUD;
  public menuUI!: MenuUI;
  private webRTCManager!: WebRTCManager;

  // Game state
  public currentMode: GameMode = 'quick-race';
  public isRacing = false;
  public isPaused = false;
  private countdownRemaining = 3.2;
  private totalRaceTime = 0;
  private networkSequence = 0;
  private lastNetworkSendTime = 0;
  private clock = new THREE.Clock();

  constructor() {
    this.init();
  }

  private updateLoadingProgress(pct: number, text: string): void {
    const fill = document.getElementById('loading-bar-fill');
    const txt = document.getElementById('loading-status-text');
    if (fill) fill.style.width = `${pct}%`;
    if (txt) txt.textContent = text;
    if (pct >= 100) {
      setTimeout(() => {
        const screen = document.getElementById('loading-screen');
        if (screen) {
          screen.classList.add('loading-fade-out');
          setTimeout(() => screen.remove(), 420);
        }
      }, 250);
    }
  }

  private async init(): Promise<void> {
    this.updateLoadingProgress(20, 'INITIALIZING THREE.JS WEBGL ENGINE...');
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

    this.sunLight = new THREE.DirectionalLight(0xfff1cc, 2.5);
    // Dynamic tracking sun light with focused shadow frustum
    this.sunLight.position.set(-65, 115, -55);
    this.sunLight.target.position.set(0, 0, 0);
    this.scene.add(this.sunLight.target);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 15;
    this.sunLight.shadow.camera.far = 260;
    const d = 75; // Focused 75m radius around player for razor-sharp voxel shadows
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.normalBias = 0.02; // Eliminates shadow acne on voxel steps
    this.scene.add(this.sunLight);

    // Procedural atmospheric skydome, golden haze, and dual-tone voxel clouds
    this.atmosphere = new Atmosphere(this.scene);
    this.particleFX = new ParticleFX(this.scene);

    this.updateLoadingProgress(50, 'COMPILING RAPIER3D PHYSICS WASM...');

    // 3. Initialize Physics World (Rapier3D WASM)
    this.physicsWorld = new PhysicsWorld();
    await this.physicsWorld.init();

    this.updateLoadingProgress(75, 'SYNTHESIZING TRACK & PINE FORESTS...');

    // 4. Build Track Waypoints, Road Mesh & Instanced Pine Forests + Świdermajer Villas
    this.waypoints = TrackWaypoints.getCircuitWaypoints();
    const trackData = TrackMeshBuilder.buildTrack(this.waypoints);
    this.scene.add(trackData.trackGroup);
    this.checkpoints = trackData.checkpoints;
    this.riverMesh = trackData.riverMesh;

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

    // Restore saved graphics settings on boot (U3)
    const savedPreset = (localStorage.getItem('masovian_quality_preset') as any) || 'high';
    this.postProcessor.setQualityPreset(savedPreset);
    const savedBloom = localStorage.getItem('masovian_bloom_intensity');
    if (savedBloom !== null) {
      this.postProcessor.setBloomIntensity(parseFloat(savedBloom));
    }

    // 7. Initialize Economy & Audio & Input
    this.evolutionStore = new EvolutionStore();
    await this.evolutionStore.init();

    this.audioManager = AudioManager.getInstance();
    this.inputManager = InputManager.getInstance();
    this.hud = new HUD();
    this.hud.callbacks = {
      onResume: () => {
        this.isPaused = false;
        this.clock.getDelta(); // flush accumulated pause delta
        this.audioManager.resume();
      },
      onRestart: () => {
        this.isPaused = false;
        this.clock.getDelta(); // flush accumulated pause delta
        this.audioManager.resume();
        this.restartRace();
      },
      onQuit: () => {
        this.isPaused = false;
        this.hud.hide();
        this.audioManager.stopEngines();
        this.menuUI.renderMainMenu();
        this.isRacing = false;
      },
      onVolumeChange: (vol) => {
        this.audioManager.setMasterVolume(vol);
      },
      onCameraChange: (mode) => {
        this.p1Camera.mode = mode;
      },
      onPixelScaleChange: (scale) => {
        this.postProcessor.setPixelScale(scale);
      },
      onBloomChange: (val) => {
        this.postProcessor.setBloomIntensity(val);
        localStorage.setItem('masovian_bloom_intensity', val.toString());
      },
    };

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
      onSetQualityPreset: (preset) => {
        this.postProcessor.setQualityPreset(preset);
      },
    });

    // 10. Spawn Initial Showcase Car at Start Line
    this.spawnShowcaseCar();

    this.updateLoadingProgress(100, 'READY TO RACE');

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());

    // In-game controls: Camera, Mute, Quick Reset, Pause
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') {
        this.p1Camera.cycleMode();
      } else if (e.code === 'KeyM') {
        this.audioManager.toggleMute();
      } else if (e.code === 'KeyR') {
        if (this.isRacing && !this.isPaused) this.restartRace();
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.isRacing) {
          this.isPaused = this.hud.togglePause();
          if (this.isPaused) {
            this.audioManager.pause();
          } else {
            this.clock.getDelta(); // flush accumulated pause delta
            this.audioManager.resume();
          }
        }
      }
    });

    // Start Main Render & Simulation Loop
    this.animate();
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
    spawnPos.y += 0.45;

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

    // Clean up previous vehicles and their Rapier physics bodies
    for (const v of this.allVehicles) {
      this.scene.remove(v.visual.root);
      v.destroy(this.physicsWorld.world);
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
    spawnPos.y += 0.45;

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
        const distBack = 12.0 + i * 8.0;
        const sideOffset = isRight ? 2.8 : -2.8;

        const aiSpawn = spawnWp.point.clone()
          .addScaledVector(tangent, -distBack)
          .addScaledVector(normal, sideOffset);
        aiSpawn.y += 0.45;

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
        // Sync AI bot to the nearest waypoint along the starting grid
        let closestWpIdx = 0;
        let minWpDist = Infinity;
        for (let w = 0; w < this.waypoints.length; w++) {
          const d = aiSpawn.distanceTo(this.waypoints[w].point);
          if (d < minWpDist) {
            minWpDist = d;
            closestWpIdx = w;
          }
        }
        aiController.setTargetIndex(closestWpIdx);
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
      if (this.isPaused) {
        // While paused, still render current frame
        this.renderFrame();
        return;
      }

      let isCountingDown = false;
      const prevStep = Math.ceil(this.countdownRemaining);

      if (this.countdownRemaining > 0) {
        isCountingDown = true;
        this.countdownRemaining -= delta;
        const currentStep = Math.ceil(this.countdownRemaining);

        // Procedural Audio Starting Beeps (3, 2, 1)
        if (currentStep !== prevStep && currentStep >= 1 && currentStep <= 3) {
          this.audioManager.playCountdownBeep(false);
        }

        if (this.countdownRemaining > 2.0) {
          this.hud.showCountdown('3');
        } else if (this.countdownRemaining > 1.0) {
          this.hud.showCountdown('2');
        } else {
          this.hud.showCountdown('1');
        }
      } else if (this.countdownRemaining > -1.0) {
        this.countdownRemaining -= delta;
        // GO! Chord
        if (prevStep >= 1 && Math.ceil(this.countdownRemaining) <= 0) {
          this.audioManager.playCountdownBeep(true);
        }
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

        // Track checkpoints & lap progression (M7 auto-recovery)
        if (!isCountingDown) {
          this.updateRaceProgression(dt);
          for (const v of this.allVehicles) {
            this.checkVehicleRecovery(v, dt);
          }
          if (this.inputManager.isKeyJustPressed('KeyK')) {
            this.respawnVehicleAtCheckpoint(this.playerVehicle);
          }
        }
      });

      // 2. Audio Synthesizer Update & 3D Spatial Listener Tracking (A4, A5)
      this.audioManager.updatePlayerEngine(
        this.playerVehicle.rpm,
        this.inputManager.getPlayerInputs().throttle,
        this.playerVehicle.slipAngle,
        this.playerVehicle.speedKmh,
        this.playerVehicle.currentSurface
      );
      this.audioManager.updateListener(this.p1Camera.camera.position);

      if (this.currentMode === 'split-screen' && this.p2Vehicle) {
        this.audioManager.updateP2Engine(
          this.p2Vehicle.rpm,
          this.inputManager.getPlayer2Inputs().throttle,
          this.p2Vehicle.slipAngle,
          this.p2Vehicle.speedKmh,
          this.p2Vehicle.currentSurface
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

      // 4. Update Atmosphere, Shadows & Particle FX
      this.atmosphere.update(delta, this.playerVehicle.position);
      this.particleFX.update(delta, this.allVehicles);

      // Dynamic Focused Directional Shadow following the player
      const p = this.playerVehicle.position;
      this.sunLight.target.position.set(p.x, p.y, p.z);
      this.sunLight.position.set(p.x - 65, p.y + 115, p.z - 55);
      this.sunLight.target.updateMatrixWorld();

      // Dynamic Environment animation (rotating wind turbines)
      EnvironmentGenerator.update(delta);

      // Dynamic River wave ripple animation (GPU ShaderMaterial, G6/P2)
      if (this.riverMesh) {
        const mat = this.riverMesh.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uTime) {
          mat.uniforms.uTime.value = this.clock.getElapsedTime();
        }
      }

      // Post-Processing uniforms (time, high-speed lens warp, photographic bloom)
      this.postProcessor.update(
        this.clock.getElapsedTime(),
        this.playerVehicle.speedKmh
      );

      // Exhaust backfire pop on high RPM throttle lift-off (M4 deterministic PRNG)
      if (this.playerVehicle.rpm > 6200 && this.inputManager.getPlayerInputs().throttle < 0.1) {
        if (PRNG.global.chance(0.25)) {
          this.particleFX.triggerBackfire(this.playerVehicle.visual.exhaustPipes, this.playerVehicle.visual.root);
          this.audioManager.playBackfire();
        }
      }

      // High-G crash collision response (audio, camera shake, gamepad rumble, U5)
      if (this.playerVehicle.justCrashed > 0) {
        this.audioManager.playCrash(this.playerVehicle.justCrashed);
        this.p1Camera.addTrauma(this.playerVehicle.justCrashed * 0.45);
        this.inputManager.playRumble(this.playerVehicle.justCrashed, 220);
      }

      // M1: Geometric curb strike tactile vibration and sound
      if (this.playerVehicle.isOnKerb && this.playerVehicle.speedKmh > 20) {
        this.audioManager.playCurb();
        this.p1Camera.addTrauma(0.04);
        this.inputManager.playRumble(0.35, 75);
      }

      // 5. Update HUD (with real-time circuit Minimap & Drift Combo Banner)
      const p1State = this.playerVehicle.getVehicleState();
      const p2State = this.p2Vehicle?.getVehicleState();
      const allStates = this.allVehicles.map((v) => v.getVehicleState());
      this.hud.update(p1State, p2State, allStates, this.waypoints);

      // 6. P2P WebRTC State Broadcast (with backpressure throttling)
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
        this.atmosphere.update(delta, this.playerVehicle.position);
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

    // 7. RENDER FRAME (Split-Screen Scissor / Viewport or Fullscreen)
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
      // Split Screen Duel Mode (G1: full post-processing pipeline for both viewports)
      const halfWidth = Math.floor(width * 0.5);

      this.renderer.setScissorTest(true);

      // View 1: Left Screen (Player 1)
      this.p1Camera.setAspect(halfWidth / height);
      this.postProcessor.renderToViewport(this.p1Camera.camera, 0, 0, halfWidth, height);

      // View 2: Right Screen (Player 2)
      this.p2Camera.setAspect(halfWidth / height);
      this.postProcessor.renderToViewport(this.p2Camera.camera, halfWidth, 0, halfWidth, height);

      this.renderer.setScissorTest(false);

    } else {
      // Single Screen Mode (with Pixel-Art Post-Processor)
      this.renderer.setViewport(0, 0, width, height);
      this.postProcessor.render(this.p1Camera.camera);
    }
  }

  private updateRaceProgression(dt: number): void {
    this.totalRaceTime += dt;
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

  /**
   * M7: Auto-recovery for vehicles flipped upside down or stranded far off track
   */
  private checkVehicleRecovery(veh: VehiclePhysics, dt: number): void {
    if (this.checkpoints.length === 0) return;
    const up = veh.upVector;
    if (up.y < 0.25) {
      veh.flipTimer += dt;
    } else {
      veh.flipTimer = 0;
    }

    if (veh.isOffTrack) {
      veh.offTrackTimer += dt;
    } else {
      veh.offTrackTimer = 0;
    }

    if (veh.flipTimer > 2.0 || veh.offTrackTimer > 3.8) {
      this.respawnVehicleAtCheckpoint(veh);
    }
  }

  public respawnVehicleAtCheckpoint(veh: VehiclePhysics): void {
    if (this.checkpoints.length === 0) return;
    veh.flipTimer = 0;
    veh.offTrackTimer = 0;
    const cpCount = this.checkpoints.length;
    const prevCpIdx = (veh.currentCheckpointIndex - 1 + cpCount) % cpCount;
    const cp = this.checkpoints[prevCpIdx];

    const wpIdx = Math.min(
      prevCpIdx * Math.floor(this.waypoints.length / cpCount),
      this.waypoints.length - 1
    );
    const wp = this.waypoints[wpIdx];
    const spawnQuat = new THREE.Quaternion();
    if (wp && wp.tangent) {
      spawnQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wp.tangent);
    }
    veh.resetPosition(cp.position, spawnQuat);
  }

  private handleRaceFinish(): void {
    const rank = this.playerVehicle.raceRank;
    const prize = this.evolutionStore.rewardRaceFinish(rank, this.playerVehicle.driftScore);

    // Save persistent damage to IndexedDB
    this.evolutionStore.updateDamage(this.evolutionStore.getCurrentCar().id, this.playerVehicle.damage);

    this.audioManager.pause();
    this.hud.showRaceResults({
      rank,
      prize,
      bestLapTime: this.playerVehicle.bestLapTime,
      totalTime: this.totalRaceTime,
      driftScore: this.playerVehicle.driftScore,
      onRetry: () => {
        this.restartRace();
      },
      onGarage: () => {
        this.hud.hide();
        this.audioManager.stopEngines();
        this.isRacing = false;
        this.menuUI.renderMainMenu();
        this.menuUI.renderGarageModal();
      },
      onMenu: () => {
        this.hud.hide();
        this.audioManager.stopEngines();
        this.isRacing = false;
        this.menuUI.renderMainMenu();
      },
    });
  }

  public restartRace(): void {
    if (!this.isRacing || !this.playerVehicle) return;
    this.countdownRemaining = 3.2;
    this.isPaused = false;
    this.totalRaceTime = 0;
    this.hud.hidePauseModal();
    this.hud.hideRaceResults();
    this.particleFX.reset();

    const spawnWp = this.waypoints[0];
    const tangent = spawnWp.tangent ?? new THREE.Vector3(0, 0, 1);
    const normal = spawnWp.normal ?? new THREE.Vector3(1, 0, 0);
    const spawnQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    const p1Spawn = spawnWp.point.clone()
      .addScaledVector(tangent, -6.0)
      .addScaledVector(normal, 2.8);
    p1Spawn.y += 0.45;
    this.playerVehicle.reset(p1Spawn, spawnQuat);
    this.p1Camera.snapToTarget(this.playerVehicle.position, this.playerVehicle.quaternion);

    if (this.p2Vehicle) {
      const p2Spawn = spawnWp.point.clone()
        .addScaledVector(tangent, -6.0)
        .addScaledVector(normal, -2.8);
      p2Spawn.y += 0.45;
      this.p2Vehicle.reset(p2Spawn, spawnQuat);
      this.p2Camera.snapToTarget(this.p2Vehicle.position, this.p2Vehicle.quaternion);
    }

    for (let i = 0; i < this.aiBots.length; i++) {
      const isRight = (i % 2 !== 0);
      const distBack = 12.0 + i * 8.0;
      const sideOffset = isRight ? 2.8 : -2.8;
      const aiSpawn = spawnWp.point.clone()
        .addScaledVector(tangent, -distBack)
        .addScaledVector(normal, sideOffset);
      aiSpawn.y += 0.45;
      this.aiBots[i].vehicle.reset(aiSpawn, spawnQuat);

      let closestWpIdx = 0;
      let minWpDist = Infinity;
      for (let w = 0; w < this.waypoints.length; w++) {
        const d = aiSpawn.distanceTo(this.waypoints[w].point);
        if (d < minWpDist) {
          minWpDist = d;
          closestWpIdx = w;
        }
      }
      this.aiBots[i].setTargetIndex(closestWpIdx);
    }

    this.audioManager.startEngines();
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
