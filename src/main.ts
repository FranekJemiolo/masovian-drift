import * as THREE from 'three';
import './style.css';
import { GameManager } from './game/GameManager';
import { ECSWorldManager } from './ecs/World';
import { SurfaceNets } from './voxel/SurfaceNets';
import { PhysicsBridge } from './physics/PhysicsBridge';

window.addEventListener('DOMContentLoaded', () => {
  (window as any).THREE = THREE;
  (window as any).ECSWorldManager = ECSWorldManager;
  (window as any).SurfaceNets = SurfaceNets;
  (window as any).PhysicsBridge = PhysicsBridge;
  (window as any)._gameManager = new GameManager();
});
