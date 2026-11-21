/** Small math / formatting helpers shared by the game modules. */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Daniel Fenner's exponential easing, used for hill heights. */
export function easeIn(a: number, b: number, percent: number): number {
  return a + (b - a) * Math.pow(percent, 2);
}

export function easeOut(a: number, b: number, percent: number): number {
  return a + (b - a) * (1 - Math.pow(1 - percent, 2));
}

export function easeInOut(a: number, b: number, percent: number): number {
  return a + (b - a) * (-Math.cos(percent * Math.PI) / 2 + 0.5);
}

export function interpolate(a: number, b: number, percent: number): number {
  return a + (b - a) * percent;
}

/** Exponential fog: 1 = clear, 0 = fully fogged. */
export function exponentialFog(distance: number, density: number): number {
  return 1 / Math.pow(Math.E, distance * distance * density);
}

/** Increase `start` by `amount`, wrapping at `max`. */
export function increase(start: number, amount: number, max: number): number {
  let result = start + amount;
  while (result >= max) result -= max;
  while (result < 0) result += max;
  return result;
}

/** Acceleration helper: v + a*dt, clamped between min and max. */
export function accelerate(v: number, accel: number, dt: number, min = 0, max = Infinity): number {
  const next = v + accel * dt;
  return clamp(next, min, max);
}

/** Fractional position within a segment of length `segLen`. */
export function percentRemaining(n: number, total: number): number {
  return (n % total) / total;
}

/** overlap test between two centered intervals with an extra tolerance. */
export function overlap(x1: number, w1: number, x2: number, w2: number, percent = 1): boolean {
  const half = percent / 2;
  const min1 = x1 - w1 * half;
  const max1 = x1 + w1 * half;
  const min2 = x2 - w2 * half;
  const max2 = x2 + w2 * half;
  return !(max1 < min2 || min1 > max2);
}

/** Deterministic PRNG (mulberry32) so the track layout is identical for everyone. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Signed shortest delta between two positions on a looping track. */
export function wrapDelta(a: number, b: number, trackLength: number): number {
  let d = a - b;
  if (d > trackLength / 2) d -= trackLength;
  if (d < -trackLength / 2) d += trackLength;
  return d;
}

/** Format milliseconds as m:ss.SS */
export function formatTime(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '--:--.--';
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec - m * 60);
  const cs = Math.floor((totalSec - Math.floor(totalSec)) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Pick among items with a seeded RNG. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}
