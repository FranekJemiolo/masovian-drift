import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Waypoint } from './TrackWaypoints';
import { TrackMeshBuilder } from '../graphics/TrackMeshBuilder';

export class PhysicsWorld {
  public world!: RAPIER.World;
  public initialized = false;

  private accumulator = 0;
  private readonly fixedTimeStep = 1 / 60;

  public async init(): Promise<void> {
    await RAPIER.init();
    const gravity = new RAPIER.Vector3(0, -9.81, 0);
    this.world = new RAPIER.World(gravity);
    this.initialized = true;
  }

  /**
   * Builds track terrain, sand dunes, road, and villa obstacle colliders
   */
  public buildWorldColliders(
    waypoints: Waypoint[],
    terrainMesh?: THREE.Mesh,
    roadMesh?: THREE.Mesh,
    curbsMesh?: THREE.Mesh
  ): void {
    if (!this.initialized) return;

    const addMeshTrimeshCollider = (mesh: THREE.Mesh | undefined, friction: number) => {
      if (!mesh || !mesh.geometry) return false;
      const geo = mesh.geometry;
      const posAttr = geo.getAttribute('position');
      const idxAttr = geo.getIndex();
      if (!posAttr || !idxAttr) return false;
      const vertices = new Float32Array(posAttr.array);
      const indices = new Uint32Array(idxAttr.array);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      );
      const col = RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setFriction(friction)
        .setRestitution(0.0);
      this.world.createCollider(col, body);
      return true;
    };

    // 1. 3D Terrain Heightfield Trimesh Collider (Exact match to visual topography & embankments)
    const hasTerrain = addMeshTrimeshCollider(terrainMesh, 0.70);

    if (!hasTerrain) {
      // Fallback base ground collider
      const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
      const groundBody = this.world.createRigidBody(groundBodyDesc);
      const groundCollider = RAPIER.ColliderDesc.cuboid(850, 0.5, 850)
        .setFriction(0.85)
        .setRestitution(0.0);
      this.world.createCollider(groundCollider, groundBody);
    }

    // 2. Perimeter Boundary Barriers (prevent car from ever falling off the world)
    const wallH = 40.0;
    const mapBounds = 780.0;
    const northWall = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, wallH * 0.5, mapBounds));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(850, wallH * 0.5, 10), northWall);

    const southWall = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, wallH * 0.5, -mapBounds));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(850, wallH * 0.5, 10), southWall);

    const eastWall = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(mapBounds, wallH * 0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(10, wallH * 0.5, 850), eastWall);

    const westWall = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-mapBounds, wallH * 0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(10, wallH * 0.5, 850), westWall);

    // 3. Smooth convex road & shoulder support segments + exact visual-matched Armco guardrails
    const wpCount = waypoints.length;
    const roadDepth = 5.0;
    const halfDepth = roadDepth * 0.5;

    for (let i = 0; i < wpCount; i++) {
      const wp = waypoints[i];
      const nextWp = waypoints[(i + 1) % wpCount];
      const midPoint = wp.point.clone().lerp(nextWp.point, 0.5);
      const segmentLen = wp.point.distanceTo(nextWp.point);

      const segmentDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
        midPoint.x,
        midPoint.y + TrackMeshBuilder.ROAD_ELEVATION - halfDepth + 0.02,
        midPoint.z
      );
      const segmentBody = this.world.createRigidBody(segmentDesc);

      // Orient segment towards next waypoint with guaranteed upright orthonormal basis (right, up, dir)
      // Note: Do NOT apply banking roll to wide ground/shoulder cuboids, as rolling a 22m-wide cuboid
      // raises its outer wing by +1.6m on S-bends and creates sawtooth wall steps between segments!
      const dir = nextWp.point.clone().sub(wp.point).normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right).normalize();
      const matrix = new THREE.Matrix4().makeBasis(right, up, dir);
      const quat = new THREE.Quaternion().setFromRotationMatrix(matrix);
      segmentBody.setRotation(new RAPIER.Quaternion(quat.x, quat.y, quat.z, quat.w), true);

      let friction = 0.95;
      if (wp.surface === 'gravel') friction = 0.75;
      if (wp.surface === 'sand') friction = 0.45;

      let minOtherDist = Infinity;
      for (let j = 0; j < wpCount; j++) {
        const diff = Math.min(Math.abs(i - j), wpCount - Math.abs(i - j));
        if (diff > 8) {
          const d = wp.point.distanceTo(waypoints[j].point);
          if (d < minOtherDist) minOtherDist = d;
        }
      }
      const roadHalfWidth = wp.width * 0.5 + 1.8;
      // Keep segment cuboid width strictly below minimum turn radius (18.89m) so segments never fold or cross!
      const shoulderHalfWidth = Math.max(
        roadHalfWidth + 1.0,
        Math.min(wp.width * 0.5 + 8.5, minOtherDist * 0.42)
      );

      // Single unified flush surface cuboid per segment (zero step between road and shoulder!)
      const surfaceColDesc = RAPIER.ColliderDesc.roundCuboid(
        shoulderHalfWidth,
        halfDepth - 0.04,
        segmentLen * 0.5 + 0.45,
        0.04
      )
        .setFriction(friction)
        .setRestitution(0.0);
      this.world.createCollider(surfaceColDesc, segmentBody);

      // 3c. Armco guardrail collider matching exact visual placement in TrackMeshBuilder (i = 18..54 step 2)
      if (i >= 18 && i < 55 && i % 2 === 0) {
        const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);
        const railPos = wp.point.clone().addScaledVector(normal, -(wp.width * 0.5 + 6.5));
        const railBody = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(
            railPos.x,
            wp.point.y + TrackMeshBuilder.ROAD_ELEVATION + 0.45,
            railPos.z
          )
        );
        if (wp.tangent) {
          const yaw = Math.atan2(wp.tangent.x, wp.tangent.z);
          const rQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
          railBody.setRotation(new RAPIER.Quaternion(rQuat.x, rQuat.y, rQuat.z, rQuat.w), true);
        }
        const railColDesc = RAPIER.ColliderDesc.roundCuboid(0.14, 0.42, 2.05, 0.04)
          .setSensor(true)
          .setFriction(0.08)
          .setRestitution(0.12);
        this.world.createCollider(railColDesc, railBody);
      }
    }
    // Note: Environment obstacles (pine & birch trees, tire stacks, hay bales, fences,
    // grandstands, shrines, and Świdermajer villas) are generated with exact matching transforms
    // by EnvironmentGenerator.generateEnvironment(scene, waypoints, physicsWorld).
  }

  /**
   * Deterministic fixed timestep update loop with strict max substep clamping (P8)
   */
  public step(
    delta: number = 1 / 60,
    onFixedStep?: (dt: number) => void,
    onPostStep?: (dt: number) => void
  ): void {
    if (!this.initialized) return;

    const safeDelta = Number.isFinite(delta) && delta > 0 ? Math.min(delta, 0.1) : this.fixedTimeStep;
    this.accumulator += safeDelta;
    let steps = 0;
    const maxSubSteps = 4; // Prevent spiral of death on tab unfocus or GPU spikes

    while (this.accumulator >= this.fixedTimeStep && steps < maxSubSteps) {
      if (onFixedStep) {
        onFixedStep(this.fixedTimeStep);
      }
      this.world.step();
      if (onPostStep) {
        onPostStep(this.fixedTimeStep);
      }
      this.accumulator -= this.fixedTimeStep;
      steps++;
    }

    // Discard any excess backlog if frame lag exceeded max substeps
    if (this.accumulator >= this.fixedTimeStep) {
      this.accumulator = 0;
    }
  }

  /**
   * Returns fractional interpolation alpha in [0.0, 1.0] representing
   * progress between previous and current physics ticks.
   */
  public getInterpolationAlpha(): number {
    return Math.max(0.0, Math.min(1.0, this.accumulator / this.fixedTimeStep));
  }
}
