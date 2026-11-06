// Deterministic hashing + noise. Every device computes the exact same market
// from the clock alone, so all online players trade the same candles with no
// game server.

export function hash32(a: number, b = 0, c = 0): number {
  let h = 0x811c9dc5 ^ a;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ b ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ c ^ (h >>> 16), 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Deterministic float in [0, 1). */
export function rand(a: number, b = 0, c = 0): number {
  return hash32(a, b, c) / 4294967296;
}

export function strSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 1D value noise in [-1, 1], smooth (quintic fade). x can be large; split into int + frac. */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = rand(seed, i | 0, (i / 4294967296) | 0) * 2 - 1;
  const b = rand(seed, (i + 1) | 0, ((i + 1) / 4294967296) | 0) * 2 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return a + (b - a) * u;
}
