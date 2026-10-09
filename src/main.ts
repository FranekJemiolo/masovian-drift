import './style.css';
import { GameManager } from './game/GameManager';

window.addEventListener('DOMContentLoaded', () => {
  (window as any)._gameManager = new GameManager();
});
