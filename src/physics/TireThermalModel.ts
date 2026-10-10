/**
 * 3-Zone Thermal Tire Simulation (Pacejka '94 Thermodynamic Enhancement)
 * Models flash surface temperature (T_surf), carcass core temperature (T_core),
 * and thermal degradation curve across cold, optimal, and greasy overheated states.
 */

export interface WheelThermalState {
  surfaceTemp: number; // Flash surface temperature in Celsius
  coreTemp: number;    // Carcass core temperature in Celsius
  gripMultiplier: number; // Thermal grip scaling factor [0.65 .. 1.0]
  isOverheated: boolean;
  isCold: boolean;
}

export class TireThermalModel {
  public surfaceTemp = 24.0; // Ambient starting temperature (24°C)
  public coreTemp = 24.0;

  public readonly ambientTemp = 22.0;
  public readonly optimalTemp = 95.0; // Peak lateral grip temperature
  public readonly coldThreshold = 55.0;
  public readonly overheatThreshold = 118.0;

  // Thermal capacity and dissipation constants
  private readonly thermalMass = 0.00032;   // Specific heat transfer factor
  private readonly airCoolingCoeff = 0.055;  // Convection rate vs airspeed
  private readonly groundConductCoeff = 0.08;// Road contact conduction
  private readonly coreConductCoeff = 0.025; // Internal core heat transfer

  public update(
    verticalLoadN: number,
    slipSpeedMs: number,
    carSpeedMs: number,
    isSliding: boolean,
    dt: number
  ): WheelThermalState {
    const clampedDt = Math.min(0.1, Math.max(0.001, dt));

    // 1. Heat Generation from Friction Power: P = F_z * v_slip * friction
    // High vertical load + high slip velocity produces rapid surface heating
    if (isSliding && slipSpeedMs > 0.5) {
      const heatInput = verticalLoadN * slipSpeedMs * this.thermalMass * clampedDt;
      this.surfaceTemp += heatInput * 12.0;
    }

    // 2. Convection Cooling from Air Speed
    const airspeedFactor = 1.0 + carSpeedMs * 0.08;
    const airCooling = (this.surfaceTemp - this.ambientTemp) * this.airCoolingCoeff * airspeedFactor * clampedDt;
    this.surfaceTemp = Math.max(this.ambientTemp, this.surfaceTemp - airCooling);

    // 3. Conduction between Surface and Carcass Core
    const coreTransfer = (this.surfaceTemp - this.coreTemp) * this.coreConductCoeff * clampedDt;
    this.coreTemp = Math.max(this.ambientTemp, this.coreTemp + coreTransfer * 0.4);
    this.surfaceTemp -= coreTransfer * 0.6;

    // Slow core cooling toward ambient
    this.coreTemp -= (this.coreTemp - this.ambientTemp) * 0.008 * clampedDt;

    // 4. Grip Factor Modulation Curve
    // Cold (<55°C): Grip is stiff and reduced (~0.82)
    // Optimal (75°C - 108°C): Grip is peak (1.00)
    // Overheated (>118°C): Greasy slip, grip degrades down to 0.65
    let gripMultiplier = 1.0;

    if (this.surfaceTemp < this.coldThreshold) {
      const coldRatio = Math.max(0, (this.surfaceTemp - this.ambientTemp) / (this.coldThreshold - this.ambientTemp));
      gripMultiplier = 0.82 + 0.18 * coldRatio;
    } else if (this.surfaceTemp > this.overheatThreshold) {
      const overheatExcess = this.surfaceTemp - this.overheatThreshold;
      // Gaussian thermal decay curve
      gripMultiplier = Math.max(0.65, 1.0 - (overheatExcess / 45.0) * 0.35);
    }

    return {
      surfaceTemp: Math.round(this.surfaceTemp * 10) / 10,
      coreTemp: Math.round(this.coreTemp * 10) / 10,
      gripMultiplier,
      isOverheated: this.surfaceTemp >= this.overheatThreshold,
      isCold: this.surfaceTemp < this.coldThreshold,
    };
  }

  public reset(): void {
    this.surfaceTemp = 24.0;
    this.coreTemp = 24.0;
  }
}
