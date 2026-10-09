import * as THREE from 'three';

export interface Waypoint {
  point: THREE.Vector3;
  width: number;
  surface: 'asphalt' | 'gravel' | 'sand';
  banking: number; // in radians
  targetSpeedKmh: number; // For AI
  normal?: THREE.Vector3;
  tangent?: THREE.Vector3;
}

export class TrackWaypoints {
  public static readonly CIRCUIT_LENGTH = 1400; // ~1.4 km circuit

  /**
   * Generates a flowing Masovian circuit looping through Warsaw suburbs,
   * pine forests, Świder river bends, and Świdermajer villas.
   */
  public static getCircuitWaypoints(): Waypoint[] {
    // Key control nodes of the circuit
    const rawNodes = [
      // 1. Start / Finish straight in front of Gurewicz Sanatorium
      { x: 0, z: -80, y: 0.0, s: 'asphalt', w: 14, speed: 170 },
      { x: 0, z: 0, y: 0.0, s: 'asphalt', w: 14, speed: 190 },
      { x: 0, z: 80, y: 0.2, s: 'asphalt', w: 14, speed: 180 },

      // 2. Turn 1 (Józefów Forest Right sweeper)
      { x: 35, z: 150, y: 0.5, s: 'asphalt', w: 13, speed: 130 },
      { x: 90, z: 200, y: 0.8, s: 'asphalt', w: 12, speed: 110 },
      { x: 155, z: 215, y: 1.2, s: 'gravel', w: 12, speed: 95 },

      // 3. Sandy chicane through pine woods (Świdermajer villas)
      { x: 220, z: 180, y: 1.5, s: 'gravel', w: 11, speed: 85 },
      { x: 260, z: 120, y: 1.8, s: 'gravel', w: 10, speed: 75 },
      { x: 285, z: 50, y: 1.2, s: 'sand', w: 12, speed: 70 }, // Sandy river dune!

      // 4. Świder Riverbank hairpin (deep sand drift zone!)
      { x: 270, z: -30, y: 0.4, s: 'sand', w: 14, speed: 60 },
      { x: 230, z: -90, y: 0.2, s: 'sand', w: 13, speed: 65 },
      { x: 180, z: -130, y: 0.5, s: 'gravel', w: 12, speed: 85 },

      // 5. Back straight through Otwock pine alley
      { x: 140, z: -200, y: 1.0, s: 'asphalt', w: 13, speed: 150 },
      { x: 100, z: -270, y: 1.5, s: 'asphalt', w: 14, speed: 180 },
      { x: 40, z: -320, y: 1.8, s: 'asphalt', w: 13, speed: 160 },

      // 6. Western Chicane & Bridge descent
      { x: -30, z: -330, y: 1.2, s: 'asphalt', w: 12, speed: 110 },
      { x: -95, z: -290, y: 0.6, s: 'gravel', w: 11, speed: 90 },
      { x: -140, z: -220, y: 0.2, s: 'gravel', w: 12, speed: 95 },

      // 7. Villa Veranda S-Bends (technical section)
      { x: -160, z: -140, y: 0.1, s: 'asphalt', w: 11, speed: 85 },
      { x: -130, z: -70, y: 0.2, s: 'asphalt', w: 12, speed: 90 },
      { x: -150, z: 10, y: 0.5, s: 'asphalt', w: 12, speed: 85 },
      { x: -120, z: 80, y: 0.8, s: 'asphalt', w: 12, speed: 95 },

      // 8. Final hairpin onto the Main Straight
      { x: -70, z: 120, y: 0.6, s: 'asphalt', w: 13, speed: 80 },
      { x: -25, z: 90, y: 0.3, s: 'asphalt', w: 14, speed: 105 },
      { x: -10, z: 0, y: 0.0, s: 'asphalt', w: 14, speed: 150 },
    ];

    // Build Catmull-Rom spline for super smooth high-density path
    const points = rawNodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');

    const totalSamples = 120;
    const waypoints: Waypoint[] = [];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / totalSamples;
      const pt = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      // Find closest node to interpolate surface and target speed
      let closestNode = rawNodes[0];
      let minDist = Infinity;
      for (const node of rawNodes) {
        const d = pt.distanceTo(new THREE.Vector3(node.x, node.y, node.z));
        if (d < minDist) {
          minDist = d;
          closestNode = node;
        }
      }

      waypoints.push({
        point: pt,
        width: closestNode.w,
        surface: closestNode.s as 'asphalt' | 'gravel' | 'sand',
        banking: 0,
        targetSpeedKmh: closestNode.speed,
        normal,
        tangent,
      });
    }

    return waypoints;
  }
}
