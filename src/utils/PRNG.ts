/**
 * Deterministic Pseudo-Random Number Generator (Mulberry32)
 * Ensures 100% reproducible physics, track decoration, and AI behaviors.
 */
export class PRNG {
  private static defaultSeed = 0x9e3779b9;
  private s: number;

  constructor(seed: number = PRNG.defaultSeed) {
    this.s = seed >>> 0;
  }

  public static readonly global = new PRNG(424242);

  public seed(seed: number): void {
    this.s = seed >>> 0;
  }

  /**
   * Returns a float in [0, 1)
   */
  public next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a float in [min, max)
   */
  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Pick random item from array deterministically
   */
  public choice<T>(items: readonly T[]): T {
    const idx = Math.floor(this.next() * items.length);
    return items[Math.min(idx, items.length - 1)];
  }

  /**
   * Returns a boolean with given probability
   */
  public chance(probability: number): boolean {
    return this.next() < probability;
  }
}
