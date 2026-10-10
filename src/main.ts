import * as THREE from 'three';
import './style.css';
import { GameManager } from './game/GameManager';

window.addEventListener('DOMContentLoaded', () => {
  (window as any).THREE = THREE;
  (window as any)._gameManager = new GameManager();
});
