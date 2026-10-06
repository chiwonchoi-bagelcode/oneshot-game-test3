// Camera language for the trailer: eased keyframe moves, damped follow, handheld drift.
import * as THREE from 'three';
import type { V2 } from '../../src/core/math';

export type Ease = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => t * t * (3 - 2 * t),
  inOut5: (t: number) => t * t * t * (t * (t * 6 - 15) + 10),
  out: (t: number) => 1 - (1 - t) * (1 - t) * (1 - t),
  in: (t: number) => t * t * t,
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const remap = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Camera described by a target point and spherical offset (yaw around Y from +Z/south, pitch down, distance). */
export interface Orbit {
  target: THREE.Vector3;
  yaw: number; // 0 = camera south of target looking north (the game's view direction)
  pitch: number; // radians above the horizon
  dist: number;
  fov: number;
}

export function orbitToCam(o: Orbit) {
  const cp = Math.cos(o.pitch);
  const pos = new THREE.Vector3(
    o.target.x + Math.sin(o.yaw) * cp * o.dist,
    o.target.y + Math.sin(o.pitch) * o.dist,
    o.target.z + Math.cos(o.yaw) * cp * o.dist,
  );
  return { pos, look: o.target.clone(), fov: o.fov };
}

export function lerpOrbit(a: Orbit, b: Orbit, t: number): Orbit {
  return {
    target: a.target.clone().lerp(b.target, t),
    yaw: lerp(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), t)),
    fov: lerp(a.fov, b.fov, t),
  };
}

export const orb = (tx: number, ty: number, tz: number, yawDeg: number, pitchDeg: number, dist: number, fov = 30): Orbit => ({
  target: new THREE.Vector3(tx, ty, tz),
  yaw: (yawDeg * Math.PI) / 180,
  pitch: (pitchDeg * Math.PI) / 180,
  dist,
  fov,
});

/** Piecewise orbit keyframes: [time, orbit, easeIntoThisKey]. */
export function keyed(keys: [number, Orbit, Ease?][], t: number): Orbit {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, o1, e] = keys[i];
    const [t0, o0] = keys[i - 1];
    if (t <= t1) return lerpOrbit(o0, o1, (e ?? ease.inOut)((t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

/** Critically-damped follow of a point, framerate independent. */
export class Follow {
  p: THREE.Vector3 | null = null;
  constructor(public k = 3) {}
  update(target: THREE.Vector3, dt: number): THREE.Vector3 {
    if (!this.p) this.p = target.clone();
    else this.p.lerp(target, 1 - Math.exp(-this.k * dt));
    return this.p.clone();
  }
}

/** Gentle handheld drift (deterministic). */
export function drift(t: number, amt = 0.05): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(t * 0.9 + 1.3) * amt + Math.sin(t * 2.3) * amt * 0.3,
    Math.sin(t * 1.1 + 0.4) * amt * 0.6,
    Math.sin(t * 0.7 + 2.1) * amt * 0.8,
  );
}

export const at = (p: V2, y = 0.9) => new THREE.Vector3(p.x, y, p.z);
