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
  public buildWorldColliders(waypoints: Waypoint[], terrainMesh?: THREE.Mesh): void {
    if (!this.initialized) return;

    // 1. 3D Terrain Heightfield Trimesh Collider (Exact match to visual topography & dunes)
    if (terrainMesh && terrainMesh.geometry) {
      const geo = terrainMesh.geometry;
      const posAttr = geo.getAttribute('position');
      const idxAttr = geo.getIndex();
      if (posAttr && idxAttr) {
        const vertices = new Float32Array(posAttr.array);
        const indices = new Uint32Array(idxAttr.array);
        const terrainBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
        const terrainBody = this.world.createRigidBody(terrainBodyDesc);
        const terrainCol = RAPIER.ColliderDesc.trimesh(vertices, indices)
          .setFriction(0.70)
          .setRestitution(0.02);
        this.world.createCollider(terrainCol, terrainBody);
      }
    } else {
      // Fallback base ground collider
      const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
      const groundBody = this.world.createRigidBody(groundBodyDesc);
      const groundCollider = RAPIER.ColliderDesc.cuboid(850, 0.5, 850)
        .setFriction(0.85)
        .setRestitution(0.05);
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

    // 3. Road & Shoulder surface collider segments along waypoints (Synchronized with visual ROAD_ELEVATION)
    const wpCount = waypoints.length;
    // Deep foundation (5.0m) ensures road and shoulder embankments extend all the way
    // down through any elevated dunes into bedrock, eliminating underside cavities or drop-off cliffs!
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
      const dir = nextWp.point.clone().sub(wp.point).normalize();
      const worldUp = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right).normalize();
      const matrix = new THREE.Matrix4().makeBasis(right, up, dir);
      const quat = new THREE.Quaternion().setFromRotationMatrix(matrix);
      if (wp.banking) {
        quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), wp.banking));
      }
      segmentBody.setRotation(new RAPIER.Quaternion(quat.x, quat.y, quat.z, quat.w), true);

      // Friction depends on surface type
      let friction = 0.95; // Tarmac
      if (wp.surface === 'gravel') friction = 0.75;
      if (wp.surface === 'sand') friction = 0.45; // Slippery Mazovian sand!

      // 3a. Primary road & kerb collider with rounded edges to prevent seam catching
      const roadHalfWidth = wp.width * 0.5 + 1.8;
      const roadColDesc = RAPIER.ColliderDesc.roundCuboid(
        roadHalfWidth,
        halfDepth - 0.04,
        segmentLen * 0.5 + 0.35,
        0.04
      )
        .setFriction(friction)
        .setRestitution(0.02);
      this.world.createCollider(roadColDesc, segmentBody);

      // 3b. Wide runoff shoulder & embankment (adaptively clamped to prevent overlapping adjacent parallel track corridors)
      let minOtherDist = Infinity;
      for (let j = 0; j < wpCount; j++) {
        const diff = Math.min(Math.abs(i - j), wpCount - Math.abs(i - j));
        if (diff > 8) {
          const d = wp.point.distanceTo(waypoints[j].point);
          if (d < minOtherDist) minOtherDist = d;
        }
      }
      const shoulderHalfWidth = Math.max(
        roadHalfWidth + 1.0,
        Math.min(wp.width * 0.5 + 32.0, minOtherDist * 0.46)
      );

      const shoulderColDesc = RAPIER.ColliderDesc.roundCuboid(
        shoulderHalfWidth,
        halfDepth - 0.07,
        segmentLen * 0.5 + 0.35,
        0.04
      )
        .setTranslation(0, -0.03, 0)
        .setFriction(0.60)
        .setRestitution(0.02);
      this.world.createCollider(shoulderColDesc, segmentBody);
    }
    // Note: Environment obstacles (pine & birch trees, tire stacks, hay bales, fences,
    // grandstands, shrines, and Świdermajer villas) are generated with exact matching transforms
    // by EnvironmentGenerator.generateEnvironment(scene, waypoints, physicsWorld).
  }

  /**
   * Deterministic fixed timestep update loop with strict max substep clamping (P8)
   */
  public step(delta: number = 1 / 60, onFixedStep?: (dt: number) => void): void {
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
