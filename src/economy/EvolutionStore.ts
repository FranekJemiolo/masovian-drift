import { EconomyState, PlayerCarProfile, VehicleDamage, VehicleSpecs } from '../game/Types';

export const DEFAULT_CARS: PlayerCarProfile[] = [
  {
    id: 'boxer-classic-73',
    modelName: '1973 Boxer 2.7 RS Carrera',
    era: 'Classic',
    specs: {
      name: '1973 Boxer 2.7 RS',
      era: 'Classic',
      mass: 1075,
      enginePowerKw: 154,
      maxRpm: 7300,
      idleRpm: 900,
      flywheelInertia: 0.28,
      gearRatios: [-3.4, 3.15, 1.83, 1.26, 0.97, 0.76],
      finalDrive: 3.88,
      dragCoefficient: 0.36,
      bodyColor: 0xd92b2b, // Guards Red
      accentColor: 0x111111,
    },
    damage: {
      bodyDamage: 0.0,
      aerodynamicDragPenalty: 1.0,
      steeringAlignmentOffset: 0.0,
      engineWear: 0.0,
    },
    upgrades: {
      lightweightFlywheel: false,
      sportSuspension: false,
      openExhaust: false,
      sandTires: false,
    },
    valuePln: 25000,
  },
  {
    id: 'boxer-golden-86',
    modelName: '1986 Boxer 3.3 Turbo',
    era: 'Golden',
    specs: {
      name: '1986 Boxer 3.3 Turbo',
      era: 'Golden',
      mass: 1280,
      enginePowerKw: 221,
      maxRpm: 7000,
      idleRpm: 950,
      flywheelInertia: 0.32,
      gearRatios: [-3.2, 3.0, 1.75, 1.21, 0.93, 0.72],
      finalDrive: 3.65,
      dragCoefficient: 0.38,
      bodyColor: 0x2563eb, // Cobalt Blue
      accentColor: 0xffffff,
    },
    damage: {
      bodyDamage: 0.0,
      aerodynamicDragPenalty: 1.0,
      steeringAlignmentOffset: 0.0,
      engineWear: 0.0,
    },
    upgrades: {
      lightweightFlywheel: false,
      sportSuspension: false,
      openExhaust: false,
      sandTires: false,
    },
    valuePln: 55000,
  },
  {
    id: 'boxer-modern-97',
    modelName: '1997 Boxer 3.6 GT2 Twin-Turbo',
    era: 'Modern',
    specs: {
      name: '1997 Boxer 3.6 GT2',
      era: 'Modern',
      mass: 1290,
      enginePowerKw: 330,
      maxRpm: 7600,
      idleRpm: 1000,
      flywheelInertia: 0.24,
      gearRatios: [-3.3, 3.15, 1.89, 1.33, 1.03, 0.81],
      finalDrive: 3.44,
      dragCoefficient: 0.34,
      bodyColor: 0xf59e0b, // Speed Yellow
      accentColor: 0x18181b,
    },
    damage: {
      bodyDamage: 0.0,
      aerodynamicDragPenalty: 1.0,
      steeringAlignmentOffset: 0.0,
      engineWear: 0.0,
    },
    upgrades: {
      lightweightFlywheel: false,
      sportSuspension: false,
      openExhaust: false,
      sandTires: false,
    },
    valuePln: 95000,
  },
];

export class EvolutionStore {
  private static readonly DB_NAME = 'MasovianDriftDB';
  private static readonly DB_VERSION = 1;
  private static readonly STORE_NAME = 'gameState';

  private db: IDBDatabase | null = null;
  public state: EconomyState = {
    currencyPln: 18500, // Starting budget
    currentCarId: 'boxer-classic-73',
    garage: JSON.parse(JSON.stringify(DEFAULT_CARS)),
    unlockedEras: ['Classic', 'Golden', 'Modern'],
  };

  public async init(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }

      const request = indexedDB.open(EvolutionStore.DB_NAME, EvolutionStore.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(EvolutionStore.STORE_NAME)) {
          db.createObjectStore(EvolutionStore.STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        await this.loadState();
        resolve();
      };

      request.onerror = () => {
        console.warn('IndexedDB unavailable, falling back to in-memory state');
        resolve();
      };
    });
  }

  public async loadState(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(EvolutionStore.STORE_NAME, 'readonly');
        const store = tx.objectStore(EvolutionStore.STORE_NAME);
        const req = store.get('economyState');

        req.onsuccess = () => {
          if (req.result && req.result.data) {
            this.state = req.result.data;
          }
          resolve();
        };

        req.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  }

  public async saveState(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(EvolutionStore.STORE_NAME, 'readwrite');
        const store = tx.objectStore(EvolutionStore.STORE_NAME);
        store.put({ key: 'economyState', data: this.state });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  }

  public getCurrentCar(): PlayerCarProfile {
    const car = this.state.garage.find((c) => c.id === this.state.currentCarId);
    return car || this.state.garage[0];
  }

  public selectCar(carId: string): void {
    if (this.state.garage.some((c) => c.id === carId)) {
      this.state.currentCarId = carId;
      this.saveState();
    }
  }

  /**
   * Updates persistent damage incurred during a race
   */
  public updateDamage(carId: string, damage: VehicleDamage): void {
    const car = this.state.garage.find((c) => c.id === carId);
    if (car) {
      car.damage = { ...damage };
      this.saveState();
    }
  }

  /**
   * Fully repairs bodywork aerodynamic drag and aligns steering
   */
  public repairCar(carId: string): { success: boolean; cost: number; message: string } {
    const car = this.state.garage.find((c) => c.id === carId);
    if (!car) return { success: false, cost: 0, message: 'Car not found' };

    const damageScore = car.damage.bodyDamage + Math.abs(car.damage.steeringAlignmentOffset) * 20;
    if (damageScore <= 0.01) {
      return { success: false, cost: 0, message: 'Vehicle is already in mint condition!' };
    }

    const cost = Math.floor(damageScore * 2800) + 250;
    if (this.state.currencyPln < cost) {
      return { success: false, cost, message: `Insufficient funds! Repair costs ${cost} PLN.` };
    }

    this.state.currencyPln -= cost;
    car.damage.bodyDamage = 0.0;
    car.damage.aerodynamicDragPenalty = 1.0;
    car.damage.steeringAlignmentOffset = 0.0;
    this.saveState();

    return { success: true, cost, message: `Vehicle repaired for ${cost} PLN!` };
  }

  /**
   * Purchases and applies a performance upgrade
   */
  public buyUpgrade(
    carId: string,
    upgradeType: 'lightweightFlywheel' | 'sportSuspension' | 'openExhaust' | 'sandTires'
  ): { success: boolean; cost: number; message: string } {
    const car = this.state.garage.find((c) => c.id === carId);
    if (!car) return { success: false, cost: 0, message: 'Car not found' };

    if (car.upgrades[upgradeType]) {
      return { success: false, cost: 0, message: 'Upgrade already installed!' };
    }

    const prices: Record<string, number> = {
      lightweightFlywheel: 3500,
      sportSuspension: 4200,
      openExhaust: 2800,
      sandTires: 3200,
    };
    const cost = prices[upgradeType];

    if (this.state.currencyPln < cost) {
      return { success: false, cost, message: `Insufficient funds! Costs ${cost} PLN.` };
    }

    this.state.currencyPln -= cost;
    car.upgrades[upgradeType] = true;

    // Apply upgrade to specs
    if (upgradeType === 'lightweightFlywheel') {
      car.specs.flywheelInertia = Math.max(0.12, car.specs.flywheelInertia * 0.55);
    } else if (upgradeType === 'openExhaust') {
      car.specs.enginePowerKw += 18;
    }

    this.saveState();
    return { success: true, cost, message: `Upgrade installed for ${cost} PLN!` };
  }

  /**
   * Rewards player after completing race
   */
  public rewardRaceFinish(rank: number, driftScore: number): number {
    let baseReward = 0;
    if (rank === 1) baseReward = 6000;
    else if (rank === 2) baseReward = 3800;
    else if (rank === 3) baseReward = 2200;
    else baseReward = 1000;

    const driftBonus = Math.floor(driftScore * 0.15);
    const totalPrize = baseReward + driftBonus;

    this.state.currencyPln += totalPrize;
    this.saveState();
    return totalPrize;
  }
}
