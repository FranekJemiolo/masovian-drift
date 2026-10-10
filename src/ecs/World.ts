import { createWorld, registerComponents, addEntity, removeEntity, addComponent, World, EntityId } from 'bitecs';
import * as THREE from 'three';
import {
  Position,
  Rotation,
  Velocity,
  VehicleInput,
  VehicleTelemetry,
  TwoSampleStateBuffer,
  VehicleRole,
  MAX_ENTITIES,
} from './Components';

export class ECSWorldManager {
  private static instance: ECSWorldManager | null = null;
  public world: World;

  // Dense integer Entity ID to visual Three.js Object3D map (zero-allocation lookup)
  public entityMeshMap: (THREE.Object3D | null)[] = new Array(MAX_ENTITIES).fill(null);

  // Registered entity IDs for rapid direct access
  public playerEntity: EntityId = 0;
  public p2Entity: EntityId = 0;
  public aiEntities: EntityId[] = [];

  private constructor() {
    this.world = createWorld();
    registerComponents(this.world, [
      Position,
      Rotation,
      Velocity,
      VehicleInput,
      VehicleTelemetry,
      TwoSampleStateBuffer,
      VehicleRole,
    ]);
  }

  public static getInstance(): ECSWorldManager {
    if (!this.instance) {
      this.instance = new ECSWorldManager();
    }
    return this.instance;
  }

  /**
   * Spawns an ECS vehicle entity with contiguous SoA components and binds its Three.js visual root.
   */
  public createVehicleEntity(
    role: 'player' | 'p2' | 'ai' | 'peer' | 'ghost',
    visualRoot: THREE.Object3D,
    spawnPos: THREE.Vector3,
    spawnQuat: THREE.Quaternion
  ): EntityId {
    const eid = addEntity(this.world);

    addComponent(this.world, eid, Position);
    addComponent(this.world, eid, Rotation);
    addComponent(this.world, eid, Velocity);
    addComponent(this.world, eid, VehicleInput);
    addComponent(this.world, eid, VehicleTelemetry);
    addComponent(this.world, eid, TwoSampleStateBuffer);
    addComponent(this.world, eid, VehicleRole);

    // Initial position & rotation
    Position.x[eid] = spawnPos.x;
    Position.y[eid] = spawnPos.y;
    Position.z[eid] = spawnPos.z;

    Rotation.x[eid] = spawnQuat.x;
    Rotation.y[eid] = spawnQuat.y;
    Rotation.z[eid] = spawnQuat.z;
    Rotation.w[eid] = spawnQuat.w;

    // Two-sample fixed state initialization
    TwoSampleStateBuffer.prevPosX[eid] = spawnPos.x;
    TwoSampleStateBuffer.prevPosY[eid] = spawnPos.y;
    TwoSampleStateBuffer.prevPosZ[eid] = spawnPos.z;
    TwoSampleStateBuffer.currPosX[eid] = spawnPos.x;
    TwoSampleStateBuffer.currPosY[eid] = spawnPos.y;
    TwoSampleStateBuffer.currPosZ[eid] = spawnPos.z;
    TwoSampleStateBuffer.renderPosX[eid] = spawnPos.x;
    TwoSampleStateBuffer.renderPosY[eid] = spawnPos.y;
    TwoSampleStateBuffer.renderPosZ[eid] = spawnPos.z;

    TwoSampleStateBuffer.prevRotX[eid] = spawnQuat.x;
    TwoSampleStateBuffer.prevRotY[eid] = spawnQuat.y;
    TwoSampleStateBuffer.prevRotZ[eid] = spawnQuat.z;
    TwoSampleStateBuffer.prevRotW[eid] = spawnQuat.w;
    TwoSampleStateBuffer.currRotX[eid] = spawnQuat.x;
    TwoSampleStateBuffer.currRotY[eid] = spawnQuat.y;
    TwoSampleStateBuffer.currRotZ[eid] = spawnQuat.z;
    TwoSampleStateBuffer.currRotW[eid] = spawnQuat.w;
    TwoSampleStateBuffer.renderRotX[eid] = spawnQuat.x;
    TwoSampleStateBuffer.renderRotY[eid] = spawnQuat.y;
    TwoSampleStateBuffer.renderRotZ[eid] = spawnQuat.z;
    TwoSampleStateBuffer.renderRotW[eid] = spawnQuat.w;

    // Default telemetry
    VehicleTelemetry.engineHealth[eid] = 1.0;
    VehicleTelemetry.lap[eid] = 1;
    VehicleTelemetry.gear[eid] = 1;

    // Set role tag
    VehicleRole.isPlayer[eid] = role === 'player' ? 1 : 0;
    VehicleRole.isAI[eid] = role === 'ai' ? 1 : 0;
    VehicleRole.isPeer[eid] = role === 'peer' || role === 'p2' ? 1 : 0;
    VehicleRole.isGhost[eid] = role === 'ghost' ? 1 : 0;

    // Bind visual mesh
    this.entityMeshMap[eid] = visualRoot;

    if (role === 'player') {
      this.playerEntity = eid;
    } else if (role === 'p2') {
      this.p2Entity = eid;
    } else if (role === 'ai') {
      this.aiEntities.push(eid);
    }

    return eid;
  }

  public destroyEntity(eid: EntityId): void {
    this.entityMeshMap[eid] = null;
    removeEntity(this.world, eid);
    this.aiEntities = this.aiEntities.filter((id) => id !== eid);
  }

  public clear(): void {
    for (let i = 0; i < MAX_ENTITIES; i++) {
      if (this.entityMeshMap[i]) {
        this.destroyEntity(i);
      }
    }
    this.playerEntity = 0;
    this.p2Entity = 0;
    this.aiEntities = [];
  }
}
