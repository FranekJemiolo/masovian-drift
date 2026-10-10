import { InputManager } from '../controls/InputManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { VehiclePhysics } from '../physics/VehiclePhysics';
import { InputSystem } from './systems/InputSystem';
import { PhysicsSyncSystem } from './systems/PhysicsSyncSystem';
import { InterpolationSystem } from './systems/InterpolationSystem';
import { ECSWorldManager } from './World';

export class ECSPipeline {
  /**
   * Executes the strict decoupled game loop pipeline:
   * 1. Input Parsing: maps physical and digital inputs to bitECS SoA
   * 2. Fixed Physics Stepping: executes fixed 60Hz physics ticks with backlog clamping
   * 3. ECS Transforms & Two-Sample Buffer: stores previous and current physical transforms
   * 4. Visual Interpolation: evaluates fractional alpha and applies lerp/slerp to Three.js meshes
   */
  public static executeFrame(
    inputManager: InputManager,
    physicsWorld: PhysicsWorld,
    allVehicles: VehiclePhysics[],
    isCountingDown: boolean,
    delta: number,
    onPhysicsSubstep: (dt: number) => void
  ): void {
    const ecs = ECSWorldManager.getInstance();

    // Stage 1: Input Parsing
    InputSystem.update(inputManager, isCountingDown);

    // Stage 2: Fixed Timestep Physics with Two-Sample Buffer Synchronization
    physicsWorld.step(delta, (dt) => {
      onPhysicsSubstep(dt);

      // Sync physics transforms into bitECS components and advance two-sample buffer
      if (ecs.playerEntity > 0 && allVehicles[0]) {
        PhysicsSyncSystem.syncVehiclePhysics(ecs.playerEntity, allVehicles[0]);
      }
      if (ecs.p2Entity > 0 && allVehicles[1]) {
        PhysicsSyncSystem.syncVehiclePhysics(ecs.p2Entity, allVehicles[1]);
      }
      for (let i = 0; i < ecs.aiEntities.length; i++) {
        const aiEid = ecs.aiEntities[i];
        const v = allVehicles[i + (ecs.p2Entity > 0 ? 2 : 1)];
        if (v) {
          PhysicsSyncSystem.syncVehiclePhysics(aiEid, v);
        }
      }
    });

    // Stage 3 & 4: Fractional Physics Alpha & Visual Mesh Interpolation (lerp & slerp)
    const alpha = physicsWorld.getInterpolationAlpha();
    InterpolationSystem.update(alpha);
  }
}
