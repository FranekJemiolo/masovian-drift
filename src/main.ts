import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import { GameManager } from './game/GameManager';
import { ECSWorldManager } from './ecs/World';
import { SurfaceNets } from './voxel/SurfaceNets';
import { PhysicsBridge } from './physics/PhysicsBridge';
import { StateSync } from './net/StateSync';
import { VoxelStructuralGraph } from './voxel/VoxelStructuralGraph';
import { TerrainDeformation } from './physics/TerrainDeformation';
import { TandemJudgingSystem } from './game/TandemJudgingSystem';
import { ComputeParticlePipeline } from './graphics/ComputeParticlePipeline';
import { GranularTireAudio } from './audio/GranularTireAudio';
import { TurboBlowOffSynth } from './audio/TurboBlowOffSynth';
import { RadianceCascadesPass } from './graphics/RadianceCascadesPass';
import { ScreenSpaceReflectionsPass } from './graphics/ScreenSpaceReflectionsPass';
import { PhotoMode } from './ui/PhotoMode';

function bootstrap(): void {
  (window as any).THREE = THREE;
  (window as any).RAPIER = RAPIER;
  (window as any).ECSWorldManager = ECSWorldManager;
  (window as any).SurfaceNets = SurfaceNets;
  (window as any).PhysicsBridge = PhysicsBridge;
  (window as any).StateSync = StateSync;
  (window as any).VoxelStructuralGraph = VoxelStructuralGraph;
  (window as any).TerrainDeformation = TerrainDeformation;
  (window as any).TandemJudgingSystem = TandemJudgingSystem;
  (window as any).ComputeParticlePipeline = ComputeParticlePipeline;
  (window as any).GranularTireAudio = GranularTireAudio;
  (window as any).TurboBlowOffSynth = TurboBlowOffSynth;
  (window as any).RadianceCascadesPass = RadianceCascadesPass;
  (window as any).ScreenSpaceReflectionsPass = ScreenSpaceReflectionsPass;
  (window as any).PhotoMode = PhotoMode;
  if (!(window as any)._gameManager) {
    (window as any)._gameManager = new GameManager();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

