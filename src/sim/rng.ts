/**
 * Deterministic PRNG (mulberry32). Its whole state is one 32-bit integer
 * stored in GameState, so saves and multiplayer lockstep stay in sync.
 * Never use Math.random() inside the simulation.
 */
export function nextRandom(state: { rngState: number }): number {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Standalone generator, used for map generation. */
export class Rng {
  rngState: number;
  constructor(seed: number) {
    this.rngState = seed | 0;
  }
  next(): number {
    return nextRandom(this);
  }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}
