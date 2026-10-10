import * as THREE from 'three';

export interface VoxelNode {
  id: number;
  position: THREE.Vector3;
  clusterId: number;
  isGrounded: boolean; // Ground anchor (y <= 0.2m)
  intact: boolean;
  color: number;
}

export interface CollapsedDebrisChunk {
  clusterId: number;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

/**
 * Teardown-Style Structural Graph for Destructible Voxel Architecture
 * Models timber Świdermajer villas, fences, and roadside signs as a connected-component graph.
 * When collision impacts sever load-bearing roots, unsupported components collapse into dynamic tumbling debris chunks.
 */
export class VoxelStructuralGraph {
  public nodes: Map<number, VoxelNode> = new Map();
  public adjacency: Map<number, Set<number>> = new Map();
  public debrisChunks: CollapsedDebrisChunk[] = [];

  private parent: Map<number, number> = new Map();

  constructor() {}

  /**
   * Registers a voxel block in the structural connectivity graph
   */
  public addVoxel(id: number, pos: THREE.Vector3, color: number = 0x8b5a2b): void {
    const isGrounded = pos.y <= 0.35;
    this.nodes.set(id, {
      id,
      position: pos.clone(),
      clusterId: id,
      isGrounded,
      intact: true,
      color,
    });
    this.adjacency.set(id, new Set());
    this.parent.set(id, id);
  }

  /**
   * Connects two adjacent voxel blocks (load path transmission)
   */
  public addEdge(idA: number, idB: number): void {
    if (!this.nodes.has(idA) || !this.nodes.has(idB)) return;
    this.adjacency.get(idA)!.add(idB);
    this.adjacency.get(idB)!.add(idA);
    this.union(idA, idB);
  }

  private find(i: number): number {
    let root = i;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let curr = i;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  private union(i: number, j: number): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      // Prioritize grounded root
      const groundedI = this.nodes.get(rootI)?.isGrounded;
      const groundedJ = this.nodes.get(rootJ)?.isGrounded;
      if (groundedJ && !groundedI) {
        this.parent.set(rootI, rootJ);
      } else {
        this.parent.set(rootJ, rootI);
      }
    }
  }

  /**
   * Simulates high-energy vehicle impact shock breaking voxels within blast radius
   * Evaluates structural stability and returns severed disconnected chunks
   */
  public applyImpact(
    impactPoint: THREE.Vector3,
    radius: number,
    shockVelocity: THREE.Vector3
  ): number[] {
    const severedNodeIds: number[] = [];

    // 1. Destroy voxels directly in contact with impact sphere
    for (const [id, node] of this.nodes) {
      if (!node.intact) continue;
      if (node.position.distanceTo(impactPoint) <= radius) {
        node.intact = false;
        severedNodeIds.push(id);
        // Remove from adjacency
        const neighbors = this.adjacency.get(id);
        if (neighbors) {
          for (const n of neighbors) {
            this.adjacency.get(n)?.delete(id);
          }
          neighbors.clear();
        }
      }
    }

    if (severedNodeIds.length === 0) return [];

    // 2. Re-evaluate connectivity via BFS from intact ground anchors
    const visited = new Set<number>();
    const groundedRoots = new Set<number>();

    for (const [id, node] of this.nodes) {
      if (node.intact && node.isGrounded) {
        groundedRoots.add(id);
      }
    }

    // BFS queue seeded with grounded nodes
    const queue: number[] = Array.from(groundedRoots);
    for (const gId of queue) {
      visited.add(gId);
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = this.adjacency.get(curr);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n) && this.nodes.get(n)?.intact) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }

    // 3. Any intact node not reachable from ground has collapsed!
    const collapsedIds: number[] = [];
    for (const [id, node] of this.nodes) {
      if (node.intact && !visited.has(id)) {
        node.intact = false;
        collapsedIds.push(id);
      }
    }

    return collapsedIds;
  }

  /**
   * Instantiates a dynamic tumbling debris cluster from collapsed nodes
   */
  public spawnDebrisMesh(
    collapsedIds: number[],
    scene: THREE.Scene,
    originVel: THREE.Vector3
  ): CollapsedDebrisChunk | null {
    if (collapsedIds.length === 0) return null;

    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b, // Świdermajer pine timber
      roughness: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Compute center of mass
    const com = new THREE.Vector3();
    for (const id of collapsedIds) {
      const node = this.nodes.get(id);
      if (node) com.add(node.position);
    }
    com.divideScalar(collapsedIds.length);
    mesh.position.copy(com);
    scene.add(mesh);

    const chunk: CollapsedDebrisChunk = {
      clusterId: collapsedIds[0],
      mesh,
      position: com,
      velocity: originVel.clone().multiplyScalar(0.4).add(new THREE.Vector3(0, 3.5, 0)),
      angularVelocity: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
      life: 0,
      maxLife: 3.5,
    };
    this.debrisChunks.push(chunk);
    return chunk;
  }

  public updateDebris(delta: number): void {
    for (let i = this.debrisChunks.length - 1; i >= 0; i--) {
      const chunk = this.debrisChunks[i];
      chunk.life += delta;
      if (chunk.life >= chunk.maxLife) {
        chunk.mesh.parent?.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        this.debrisChunks.splice(i, 1);
        continue;
      }

      chunk.velocity.y -= 12.0 * delta; // Gravity
      chunk.position.addScaledVector(chunk.velocity, delta);

      // Floor collision bounce
      if (chunk.position.y < 0.2) {
        chunk.position.y = 0.2;
        chunk.velocity.y = -chunk.velocity.y * 0.35;
        chunk.velocity.x *= 0.8;
        chunk.velocity.z *= 0.8;
      }

      chunk.mesh.position.copy(chunk.position);
      chunk.mesh.rotation.x += chunk.angularVelocity.x * delta;
      chunk.mesh.rotation.y += chunk.angularVelocity.y * delta;
      chunk.mesh.rotation.z += chunk.angularVelocity.z * delta;
    }
  }

  public dispose(): void {
    for (const chunk of this.debrisChunks) {
      chunk.mesh.parent?.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.debrisChunks = [];
    this.nodes.clear();
    this.adjacency.clear();
    this.parent.clear();
  }
}
