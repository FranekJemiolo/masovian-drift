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
  public static readonly CIRCUIT_LENGTH = 1600; // ~1.6 km circuit

  /**
   * Generates a flowing Masovian circuit looping through Warsaw suburbs,
   * pine forests, Świder river bends, and Świdermajer villas.
   */
  public static getCircuitWaypoints(): Waypoint[] {
    // Key control nodes of the circuit
    const rawNodes = [
      // 1. Start / Finish Main Straight (Sanatorium Gurewicz Straight, wide asphalt)
      // Perfectly centered along X=0 heading in +Z direction (flat for clean launch and sprint)
      { x: 0, z: -40, y: 0.0, s: 'asphalt', w: 15, speed: 210 },
      { x: 0, z: 20, y: 0.0, s: 'asphalt', w: 15, speed: 220 },
      { x: 0, z: 80, y: 0.0, s: 'asphalt', w: 15, speed: 215 },
      { x: 0, z: 130, y: 0.1, s: 'asphalt', w: 14, speed: 190 },

      // 2. Turn 1 (Józefów Forest Right sweeper, climbing inland dune bluff)
      { x: 35, z: 190, y: 0.6, s: 'asphalt', w: 13, speed: 140 },
      { x: 90, z: 240, y: 1.4, s: 'asphalt', w: 13, speed: 120 },
      { x: 155, z: 255, y: 2.2, s: 'gravel', w: 12, speed: 100 },

      // 3. Sandy chicane through pine woods (Świdermajer villas & dune crest)
      { x: 215, z: 220, y: 2.6, s: 'gravel', w: 12, speed: 85 },
      { x: 255, z: 155, y: 2.0, s: 'gravel', w: 11, speed: 80 },
      { x: 275, z: 75, y: 1.2, s: 'sand', w: 12, speed: 75 },

      // 4. Świder Riverbank hairpin (descending to river valley & sandy shoals!)
      { x: 260, z: -10, y: 0.3, s: 'sand', w: 13, speed: 65 },
      { x: 215, z: -70, y: 0.1, s: 'sand', w: 13, speed: 70 },
      { x: 165, z: -125, y: 0.4, s: 'gravel', w: 12, speed: 90 },

      // 5. Back straight through Otwock pine alley (rolling dune terrace)
      { x: 125, z: -195, y: 1.2, s: 'asphalt', w: 13, speed: 160 },
      { x: 80, z: -265, y: 2.0, s: 'asphalt', w: 14, speed: 185 },
      { x: 20, z: -320, y: 2.4, s: 'asphalt', w: 13, speed: 170 },

      // 6. Western Chicane & River bridge descent
      { x: -50, z: -330, y: 1.8, s: 'asphalt', w: 12, speed: 115 },
      { x: -115, z: -280, y: 0.9, s: 'gravel', w: 11, speed: 90 },
      { x: -155, z: -210, y: 0.3, s: 'gravel', w: 12, speed: 95 },

      // 7. Villa Veranda S-Bends (technical section through resort quarter)
      { x: -165, z: -130, y: 0.2, s: 'asphalt', w: 11, speed: 85 },
      { x: -130, z: -50, y: 0.3, s: 'asphalt', w: 12, speed: 90 },
      { x: -140, z: 20, y: 0.5, s: 'asphalt', w: 12, speed: 85 },
      { x: -110, z: 80, y: 0.6, s: 'asphalt', w: 12, speed: 95 },

      // 8. Hairpin looping back south to enter Main Straight smoothly
      { x: -60, z: 100, y: 0.4, s: 'asphalt', w: 13, speed: 85 },
      { x: -25, z: 60, y: 0.2, s: 'asphalt', w: 13, speed: 105 },
      { x: -20, z: -20, y: 0.1, s: 'asphalt', w: 13, speed: 135 },
      { x: -15, z: -80, y: 0.0, s: 'asphalt', w: 14, speed: 160 },
      { x: -5, z: -130, y: 0.0, s: 'asphalt', w: 15, speed: 180 },
      { x: 0, z: -100, y: 0.0, s: 'asphalt', w: 15, speed: 195 },
    ];

    // Build Catmull-Rom spline for super smooth high-density path
    const points = rawNodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');

    const totalSamples = 140;
    const waypoints: Waypoint[] = [];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / totalSamples;
      const pt = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      // Sample upcoming tangent to determine corner curvature and calculate authentic banking
      const nextT = ((i + 1) % totalSamples) / totalSamples;
      const nextTangent = curve.getTangentAt(nextT).normalize();
      const dCurv = tangent.x * nextTangent.z - tangent.z * nextTangent.x;

      // Maintain completely flat banking on main straight (start grid & sprint zone)
      let banking = 0;
      if (i >= 12 && i <= totalSamples - 12) {
        // Bank into the corner (up to ~4.2 degrees / 0.075 rad)
        banking = THREE.MathUtils.clamp(-dCurv * 2.6, -0.075, 0.075);
      }

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
        banking,
        targetSpeedKmh: closestNode.speed,
        normal,
        tangent,
      });
    }

    return waypoints;
  }
}
