export type StaticObstacleKind = 'armco' | 'gantry' | 'tire' | 'tree' | 'structure';

export interface StaticObstacle {
  x: number;
  z: number;
  radius: number;
  kind: StaticObstacleKind;
  source: 'world' | 'env';
}

/**
 * Lightweight static collider spatial registry populated by PhysicsWorld and EnvironmentGenerator
 * so AI path-planning & off-track recovery can steer around solid trackside hazards.
 */
export class StaticObstacleRegistry {
  private static _obstacles: StaticObstacle[] = [];
  private static _version = 0;

  public static clearSource(source: 'world' | 'env'): void {
    let writeIdx = 0;
    for (let i = 0; i < this._obstacles.length; i++) {
      if (this._obstacles[i].source !== source) {
        this._obstacles[writeIdx++] = this._obstacles[i];
      }
    }
    if (writeIdx !== this._obstacles.length) {
      this._obstacles.length = writeIdx;
      this._version++;
    }
  }

  public static add(obs: StaticObstacle): void {
    this._obstacles.push(obs);
    this._version++;
  }

  public static get obstacles(): readonly StaticObstacle[] {
    return this._obstacles;
  }

  public static get version(): number {
    return this._version;
  }
}

