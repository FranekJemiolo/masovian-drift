import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Waypoint } from './TrackWaypoints';
import { TrackMeshBuilder } from '../graphics/TrackMeshBuilder';
import { StaticObstacleRegistry } from './StaticObstacleRegistry';

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
    StaticObstacleRegistry.clearSource('world');

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

    // 3. Watertight 3D convex road + curbstone prism segments (shared rib vertices: zero V-notch gaps or crossings!)
    const wpCount = waypoints.length;
    const roadDepth = 3.2;
    const borderRadius = 0.06;

    for (let i = 0; i < wpCount; i++) {
      const wp0 = waypoints[i];
      const wp1 = waypoints[(i + 1) % wpCount];
      const midPoint = wp0.point.clone().lerp(wp1.point, 0.5);

      const segmentBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(midPoint.x, midPoint.y, midPoint.z)
      );

      let friction = 0.95;
      if (wp0.surface === 'gravel') friction = 0.75;
      if (wp0.surface === 'sand') friction = 0.45;

      const n0 = wp0.normal ?? new THREE.Vector3(1, 0, 0);
      const n1 = wp1.normal ?? new THREE.Vector3(1, 0, 0);
      const hw0 = wp0.width * 0.5 + 1.35 - borderRadius;
      const hw1 = wp1.width * 0.5 + 1.35 - borderRadius;

      const p0L = wp0.point.clone().addScaledVector(n0, -hw0).sub(midPoint);
      const p0R = wp0.point.clone().addScaledVector(n0, hw0).sub(midPoint);
      const p1R = wp1.point.clone().addScaledVector(n1, hw1).sub(midPoint);
      const p1L = wp1.point.clone().addScaledVector(n1, -hw1).sub(midPoint);

      const topY0 = (wp0.point.y - midPoint.y) + TrackMeshBuilder.ROAD_ELEVATION - borderRadius;
      const topY1 = (wp1.point.y - midPoint.y) + TrackMeshBuilder.ROAD_ELEVATION - borderRadius;
      const botY0 = topY0 - roadDepth;
      const botY1 = topY1 - roadDepth;

      const hullVerts = new Float32Array([
        p0L.x, topY0, p0L.z,
        p0R.x, topY0, p0R.z,
        p1R.x, topY1, p1R.z,
        p1L.x, topY1, p1L.z,
        p0L.x, botY0, p0L.z,
        p0R.x, botY0, p0R.z,
        p1R.x, botY1, p1R.z,
        p1L.x, botY1, p1L.z,
      ]);

      let surfaceColDesc = RAPIER.ColliderDesc.roundConvexHull(hullVerts, borderRadius);
      if (!surfaceColDesc) {
        // Fallback segment cuboid if degenerate
        const segmentLen = wp0.point.distanceTo(wp1.point);
        surfaceColDesc = RAPIER.ColliderDesc.roundCuboid(
          Math.min(hw0, hw1),
          1.0,
          segmentLen * 0.5 + 0.35,
          borderRadius
        ).setTranslation(0, TrackMeshBuilder.ROAD_ELEVATION - 1.0 - borderRadius, 0);
      }
      surfaceColDesc.setFriction(friction).setRestitution(0.0);
      this.world.createCollider(surfaceColDesc, segmentBody);

      // 3c. Solid Metal Armco guardrail collider matching exact visual placement in TrackMeshBuilder (i = 18..54 step 2)
      if (i >= 18 && i < 55 && i % 2 === 0) {
        const normal = wp0.normal ?? new THREE.Vector3(1, 0, 0);
        const railPos = wp0.point.clone().addScaledVector(normal, -(wp0.width * 0.5 + 6.5));

        // Verify barrier stays clear of every track loop segment (prevents blocking any return lane)
        let minEdgeClearance = Infinity;
        for (let k = 0; k < wpCount; k++) {
          const wa = waypoints[k];
          const wb = waypoints[(k + 1) % wpCount];
          const dx = wb.point.x - wa.point.x;
          const dz = wb.point.z - wa.point.z;
          const l2 = dx * dx + dz * dz;
          const t = l2 > 1e-4 ? Math.max(0, Math.min(1, ((railPos.x - wa.point.x) * dx + (railPos.z - wa.point.z) * dz) / l2)) : 0;
          const cx = wa.point.x + t * dx;
          const cz = wa.point.z + t * dz;
          const segHalfW = (wa.width * (1 - t) + wb.width * t) * 0.5;
          const edgeClearance = Math.hypot(railPos.x - cx, railPos.z - cz) - segHalfW;
          if (edgeClearance < minEdgeClearance) minEdgeClearance = edgeClearance;
        }

        if (minEdgeClearance > 3.5) {
          const railBody = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(
              railPos.x,
              wp0.point.y + TrackMeshBuilder.ROAD_ELEVATION + 0.45,
              railPos.z
            )
          );
          if (wp0.tangent) {
            const yaw = Math.atan2(wp0.tangent.x, wp0.tangent.z);
            const rQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            railBody.setRotation(new RAPIER.Quaternion(rQuat.x, rQuat.y, rQuat.z, rQuat.w), true);
          }
          // Solid metal Armco beam with low sliding friction & low restitution for clean glancing deflection
          const railColDesc = RAPIER.ColliderDesc.roundCuboid(0.14, 0.42, 2.05, 0.04)
            .setFriction(0.06)
            .setRestitution(0.14);
          this.world.createCollider(railColDesc, railBody);

          // Register panel footprint along tangent for AI hazard avoidance
          const tx = wp0.tangent ? wp0.tangent.x : 0;
          const tz = wp0.tangent ? wp0.tangent.z : 1;
          for (const span of [-1.35, 0, 1.35]) {
            StaticObstacleRegistry.add({
              x: railPos.x + tx * span,
              z: railPos.z + tz * span,
              radius: 0.45,
              kind: 'armco',
              source: 'world',
            });
          }
        }
      }
    }

    // 4. Start/Finish Motorsport Gantry Lattice Pillars (matched 1:1 with TrackMeshBuilder)
    if (wpCount > 0) {
      const startWp = waypoints[0];
      const tangent = startWp.tangent ?? new THREE.Vector3(0, 0, 1);
      const gantryPos = startWp.point.clone().addScaledVector(tangent, 38.0);
      const gantryQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

      for (const sideX of [-11.5, 11.5]) {
        const localPillar = new THREE.Vector3(sideX, 5.25, 0).applyQuaternion(gantryQuat).add(gantryPos);
        const pillarBody = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed()
            .setTranslation(localPillar.x, localPillar.y, localPillar.z)
            .setRotation(new RAPIER.Quaternion(gantryQuat.x, gantryQuat.y, gantryQuat.z, gantryQuat.w))
        );
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.34, 5.25, 0.34).setFriction(0.35).setRestitution(0.12),
          pillarBody
        );
        StaticObstacleRegistry.add({
          x: localPillar.x,
          z: localPillar.z,
          radius: 0.65,
          kind: 'gantry',
          source: 'world',
        });
      }

      // 5. Static Chicane Apex Yellow Hay Bales (matched 1:1 with TrackMeshBuilder section 10)
      const chicaneWps = [35, 36, 48, 49];
      for (const cIdx of chicaneWps) {
        if (cIdx >= wpCount) continue;
        const cWp = waypoints[cIdx];
        const cNorm = cWp.normal ?? new THREE.Vector3(1, 0, 0);
        const hPos = cWp.point.clone().addScaledVector(cNorm, cWp.width * 0.5 + 5.8);
        const hayGroundY = TrackMeshBuilder.getTerrainHeight(hPos.x, hPos.z, waypoints);
        const hayBody = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(hPos.x, hayGroundY + 0.52, hPos.z)
        );
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.7, 0.55, 0.7).setFriction(0.65).setRestitution(0.08),
          hayBody
        );
        StaticObstacleRegistry.add({
          x: hPos.x,
          z: hPos.z,
          radius: 1.0,
          kind: 'tire',
          source: 'world',
        });
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
