import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Waypoint } from './TrackWaypoints';

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
  public buildWorldColliders(waypoints: Waypoint[]): void {
    if (!this.initialized) return;

    // 1. Flat base ground collider
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0);
    const groundBody = this.world.createRigidBody(groundBodyDesc);
    const groundCollider = RAPIER.ColliderDesc.cuboid(800, 0.2, 800)
      .setFriction(0.85)
      .setRestitution(0.05);
    this.world.createCollider(groundCollider, groundBody);

    // 2. Road surface collider segments along waypoints
    const wpCount = waypoints.length;
    for (let i = 0; i < wpCount; i++) {
      const wp = waypoints[i];
      const nextWp = waypoints[(i + 1) % wpCount];
      const midPoint = wp.point.clone().lerp(nextWp.point, 0.5);
      const segmentLen = wp.point.distanceTo(nextWp.point);

      const segmentDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
        midPoint.x,
        midPoint.y + 0.25,
        midPoint.z
      );
      const segmentBody = this.world.createRigidBody(segmentDesc);

      // Orient segment towards next waypoint
      const dir = nextWp.point.clone().sub(wp.point).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      segmentBody.setRotation(new RAPIER.Quaternion(quat.x, quat.y, quat.z, quat.w), true);

      // Friction depends on surface type
      let friction = 0.95; // Tarmac
      if (wp.surface === 'gravel') friction = 0.75;
      if (wp.surface === 'sand') friction = 0.45; // Slippery Mazovian sand!

      const colDesc = RAPIER.ColliderDesc.cuboid(wp.width * 0.5, 0.15, segmentLen * 0.5 + 0.5)
        .setFriction(friction)
        .setRestitution(0.02);
      this.world.createCollider(colDesc, segmentBody);
    }

    // 3. Świdermajer Villa Colliders (solid obstacles)
    const villaLocations = [
      { wpIdx: 4, dist: 28, side: 1 },
      { wpIdx: 12, dist: 32, side: -1 },
      { wpIdx: 24, dist: 26, side: 1 },
      { wpIdx: 36, dist: 30, side: -1 },
      { wpIdx: 48, dist: 34, side: 1 },
      { wpIdx: 60, dist: 28, side: 1 },
      { wpIdx: 72, dist: 32, side: -1 },
      { wpIdx: 84, dist: 36, side: 1 },
      { wpIdx: 96, dist: 28, side: -1 },
      { wpIdx: 108, dist: 25, side: 1 },
    ];

    for (const loc of villaLocations) {
      const wp = waypoints[loc.wpIdx % wpCount];
      const normal = wp.normal ?? new THREE.Vector3(1, 0, 0);
      const posX = wp.point.x + normal.x * loc.dist * loc.side;
      const posZ = wp.point.z + normal.z * loc.dist * loc.side;

      const villaDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(posX, 4.0, posZ);
      const villaBody = this.world.createRigidBody(villaDesc);
      const villaCol = RAPIER.ColliderDesc.cuboid(8.0, 4.0, 6.0)
        .setRestitution(0.1)
        .setFriction(0.6);
      this.world.createCollider(villaCol, villaBody);
    }
  }

  /**
   * Deterministic fixed timestep update loop
   */
  public step(delta: number, onFixedStep?: (dt: number) => void): void {
    if (!this.initialized) return;

    this.accumulator += Math.min(delta, 0.1); // Prevent spiral of death
    while (this.accumulator >= this.fixedTimeStep) {
      if (onFixedStep) {
        onFixedStep(this.fixedTimeStep);
      }
      this.world.step();
      this.accumulator -= this.fixedTimeStep;
    }
  }
}
