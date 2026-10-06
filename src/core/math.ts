// 2D math on the XZ ground plane. Facing angle convention:
// direction = (sin(a), cos(a))  <=>  a = atan2(dx, dz)  (matches three.js rotation.y)

export interface V2 {
  x: number;
  z: number;
}

export const v2 = (x = 0, z = 0): V2 => ({ x, z });
export const clone = (a: V2): V2 => ({ x: a.x, z: a.z });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.z * b.z;
export const len = (a: V2): number => Math.hypot(a.x, a.z);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a: V2, b: V2): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};
export const norm = (a: V2): V2 => {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
};
export const lerpV = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, rate: number, dt: number): number => lerp(a, b, 1 - Math.exp(-rate * dt));

export const angleOf = (d: V2): number => Math.atan2(d.x, d.z);
export const dirOf = (a: number): V2 => ({ x: Math.sin(a), z: Math.cos(a) });
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const angleDiff = (a: number, b: number): number => wrapAngle(b - a);
export const approachAngle = (a: number, b: number, maxStep: number): number => {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return wrapAngle(a + Math.sign(d) * maxStep);
};
export const dampAngle = (a: number, b: number, rate: number, dt: number): number =>
  wrapAngle(a + angleDiff(a, b) * (1 - Math.exp(-rate * dt)));

/** Closest point on segment ab to p. */
export function closestOnSegment(p: V2, a: V2, b: V2): V2 {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  if (l2 < 1e-12) return { x: a.x, z: a.z };
  const t = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1);
  return { x: a.x + abx * t, z: a.z + abz * t };
}

/** Deterministic PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed = 1234567) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export function fmtClock(seconds: number, startHour = 20): string {
  // 1 real second = 4 in-game seconds so a long run feels like an evening.
  const total = Math.floor(seconds * 4);
  const h = startHour + Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
