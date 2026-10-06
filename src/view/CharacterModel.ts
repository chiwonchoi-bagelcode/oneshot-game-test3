/**
 * CharacterModel — procedural, animated, expressive low-poly human for "완벽한 불청객".
 *
 * Untitled-Goose-Game-ish look: chunky pastel primitives, flat colours, big head, readable from a
 * high top-down camera. Everything is built from three.js primitives; geometries are cached at
 * module level and shared by every character, materials come from the injected factory.
 *
 * Conventions: metres, feet at y = 0, facing +Z when root.rotation.y = 0. The character's right
 * hand is on the -X side (that is the "primary" hand: flashlight, tray, pointing, waving ...).
 */
import * as THREE from 'three';

export type HairStyle = 'short' | 'bald' | 'bun' | 'long' | 'ponytail' | 'curly' | 'bob' | 'slick' | 'spiky';
export type OutfitStyle =
  | 'suit' | 'tux' | 'dress' | 'waiter' | 'chef' | 'guard' | 'maid' | 'butler' | 'electrician' | 'gardener'
  | 'host' | 'casual' | 'bartender' | 'musician';
export type HatStyle =
  | 'none' | 'guard_cap' | 'chef_toque' | 'top_hat' | 'cap' | 'beanie' | 'maid_band' | 'straw' | 'hard_hat' | 'fascinator';

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  bottom: string;
  accent?: string;
  outfit: OutfitStyle;
  hat?: HatStyle;
  facial?: 'none' | 'mustache' | 'beard';
  glasses?: boolean;
  monocle?: boolean;
  height?: number;
  girth?: number;
}

export type Pose = 'stand' | 'walk' | 'run' | 'sneak' | 'sit' | 'sleep_floor' | 'sleep_chair' | 'cower' | 'hidden';
export type Action =
  | 'none' | 'talk' | 'drink' | 'cook' | 'clean' | 'piano' | 'smoke' | 'radio' | 'point' | 'clap' | 'wave'
  | 'dance' | 'type' | 'read' | 'work' | 'search' | 'reach' | 'shrug' | 'panic' | 'flashlight' | 'serve'
  | 'stretch' | 'eat' | 'paint' | 'lockpick' | 'grab' | 'knock' | 'think' | 'facepalm';
export type Carry = 'none' | 'tray' | 'box' | 'duck' | 'fake_duck' | 'bottle' | 'generic' | 'vase' | 'wrench';
export type Expression =
  | 'neutral' | 'happy' | 'suspicious' | 'surprised' | 'angry' | 'scared' | 'sleepy' | 'sick' | 'sad' | 'smug' | 'focused';

export interface AnimState {
  pose: Pose;
  speed: number;
  action: Action;
  carry: Carry;
  expression: Expression;
  headYaw: number;
  headPitch?: number;
  hop?: boolean;
  shake?: number;
  flashlight?: boolean;
  tint?: number;
}

export type MatFactory = (hex: string) => THREE.Material;

// ---------------------------------------------------------------------------------------------
// small math helpers
// ---------------------------------------------------------------------------------------------
type V3 = [number, number, number];
const TAU = Math.PI * 2;
const PI = Math.PI;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const fin = (v: number | undefined, fb = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** frame-rate independent exponential approach factor */
const kf = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
/** 0..1 pulse that is 1 during [a,b] of a 0..1 cycle with soft edges */
const pulse = (u: number, a: number, b: number, soft = 0.08): number => sstep(a - soft, a, u) * (1 - sstep(b, b + soft, u));
const frac = (x: number): number => x - Math.floor(x);

const _col1 = new THREE.Color();
const _col2 = new THREE.Color();
function mixHex(a: string, b: string, t: number): string {
  _col1.set(a);
  _col2.set(b);
  return '#' + _col1.lerp(_col2, t).getHexString();
}
function validHex(h: string | undefined, fb: string): string {
  return typeof h === 'string' && /^#?[0-9a-fA-F]{6}$/.test(h) ? (h.startsWith('#') ? h : '#' + h) : fb;
}

// ---------------------------------------------------------------------------------------------
// geometry cache + builders (module level, shared by all characters)
// ---------------------------------------------------------------------------------------------
const GEO = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEO.get(key);
  if (!g) {
    g = make();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    GEO.set(key, g);
  }
  return g;
}

interface TF { p?: V3; r?: V3; s?: V3 }
const _tm = new THREE.Matrix4();
const _tq = new THREE.Quaternion();
const _te = new THREE.Euler();
const _tp = new THREE.Vector3();
const _ts = new THREE.Vector3();
/** transform a geometry in place (scale, then rotate XYZ, then translate) */
function tf(g: THREE.BufferGeometry, t: TF): THREE.BufferGeometry {
  const r = t.r ?? [0, 0, 0];
  const p = t.p ?? [0, 0, 0];
  const s = t.s ?? [1, 1, 1];
  _te.set(r[0], r[1], r[2], 'XYZ');
  _tq.setFromEuler(_te);
  _tp.set(p[0], p[1], p[2]);
  _ts.set(s[0], s[1], s[2]);
  _tm.compose(_tp, _tq, _ts);
  g.applyMatrix4(_tm);
  return g;
}

const sph = (r: number, w = 14, h = 10): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);
const sphPart = (r: number, w: number, h: number, ps: number, pl: number, ts: number, tl: number): THREE.BufferGeometry =>
  new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);
const capg = (r: number, len: number, cs = 4, rs = 12): THREE.BufferGeometry => new THREE.CapsuleGeometry(r, len, cs, rs, 1);
const cyl = (rt: number, rb: number, h: number, seg = 14): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);
const cylPart = (rt: number, rb: number, h: number, seg: number, ts: number, tl: number): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, false, ts, tl);
const boxg = (x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(x, y, z);
const coneg = (r: number, h: number, seg = 10): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);
const tor = (r: number, tube: number, rs = 6, ts = 16, arc = TAU): THREE.BufferGeometry => new THREE.TorusGeometry(r, tube, rs, ts, arc);
const lathe = (pts: Array<[number, number]>, seg = 16): THREE.BufferGeometry =>
  new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

/** merge geometries (position/normal/uv, non-indexed). Consumes the inputs. */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    return ng;
  });
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position');
    const na = p.getAttribute('normal');
    const ua = p.getAttribute('uv');
    for (let i = 0; i < pa.count; i++, o++) {
      pos[o * 3] = pa.getX(i);
      pos[o * 3 + 1] = pa.getY(i);
      pos[o * 3 + 2] = pa.getZ(i);
      nor[o * 3] = na.getX(i);
      nor[o * 3 + 1] = na.getY(i);
      nor[o * 3 + 2] = na.getZ(i);
      if (ua) {
        uv[o * 2] = ua.getX(i);
        uv[o * 2 + 1] = ua.getY(i);
      }
    }
  }
  for (const g of list) g.dispose();
  for (const p of parts) p.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// ---------------------------------------------------------------------------------------------
// body dimensions (unscaled; height scale is applied on a group)
// ---------------------------------------------------------------------------------------------
const HIP_Y = 0.655; // standing hip-joint height
const HIP_X = 0.1;
const THIGH = 0.3;
const SHIN = 0.29;
const ANKLE_Y = 0.075;
const UARM = 0.225;
const FARM = 0.235; // elbow -> hand centre
const SH_X = 0.235;
const SH_Y = 0.465;
const NECK_Y = 0.55;
const HEAD_CY = 0.19; // head centre above neck pivot
const HEAD_R = 0.22;
const EYE_Y = 0.06;
const EYE_X = 0.08;
const BROW_Y = 0.13;
const MOUTH_Y = -0.062;
const FACE_R = 0.212; // surface radius used to place facial features

const C_WHITE = '#f7f4ec';
const C_SHOE = '#3a3236';
const C_FACE = '#2a2023';
const C_MOUTH = '#5a2a2c';
const C_GOLD = '#e8b923';

/** point on the face sphere: returns [x,y,z] and rotation (YXZ) that faces the surface normal */
function onFace(x: number, y: number, r = FACE_R): { p: V3; rx: number; ry: number } {
  const zz = Math.sqrt(Math.max(1e-4, r * r - x * x - y * y));
  return { p: [x, y, zz], rx: -Math.asin(clamp(y / r, -1, 1)), ry: Math.atan2(x, zz) };
}
/** transform geometry so it sits flat on the face at (x,y) (geometry authored facing +Z) */
function placeOnFace(g: THREE.BufferGeometry, x: number, y: number, r = FACE_R, extraZ = 0): THREE.BufferGeometry {
  const f = onFace(x, y, r);
  _te.set(f.rx, f.ry, 0, 'YXZ');
  _tq.setFromEuler(_te);
  _tp.set(f.p[0], f.p[1], f.p[2]).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(_tq), extraZ);
  _ts.set(1, 1, 1);
  _tm.compose(_tp, _tq, _ts);
  g.applyMatrix4(_tm);
  return g;
}

// ---------------------------------------------------------------------------------------------
// body part geometries
// ---------------------------------------------------------------------------------------------
/** torso profile [radius, y] in spine space (y = 0 at hip joint) */
const TORSO_PROFILE: Array<[number, number]> = [
  [0.001, -0.05], [0.12, -0.045], [0.185, -0.012], [0.212, 0.06], [0.219, 0.16], [0.212, 0.28],
  [0.2, 0.38], [0.18, 0.46], [0.142, 0.53], [0.08, 0.575], [0.001, 0.592],
];
const TORSO_DEPTH = 0.84;
/** z of the torso front surface at height y (spine space, girth 1) */
function frontZ(y: number): number {
  const p = TORSO_PROFILE;
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][1]) {
      const t = clamp((y - p[i - 1][1]) / (p[i][1] - p[i - 1][1]), 0, 1);
      return lerp(p[i - 1][0], p[i][0], t) * TORSO_DEPTH;
    }
  }
  return 0;
}
/** tilt (rotation.x) that lays a flat detail on the torso front between y0 (bottom) and y1 (top) */
function frontTilt(y0: number, y1: number): number {
  return -Math.atan2(frontZ(y0) - frontZ(y1), y1 - y0);
}
/** place a geometry authored facing +Z onto the torso front at height y */
function onChest(g: THREE.BufferGeometry, x: number, y: number, h = 0.1, out = 0.006): THREE.BufferGeometry {
  const tilt = frontTilt(y - h / 2, y + h / 2);
  const zx = Math.sqrt(Math.max(0, 1 - (x / 0.2) ** 2));
  return tf(g, { r: [tilt, Math.atan2(x, 0.2) * 0.8, 0], p: [x, y, frontZ(y) * (0.35 + 0.65 * zx) + out] });
}

function torsoGeo(tails: boolean): THREE.BufferGeometry {
  return geo('torso' + (tails ? '_tails' : ''), () => {
    const body = tf(lathe(TORSO_PROFILE, 18), { s: [1, 1, TORSO_DEPTH] });
    if (!tails) return body;
    const parts = [body];
    for (const sx of [-1, 1]) {
      parts.push(tf(boxg(0.12, 0.36, 0.035), { r: [0.22, 0, sx * 0.06], p: [sx * 0.07, -0.12, -0.155] }));
    }
    return merge(parts);
  });
}
function skirtGeo(kind: 'dress' | 'maid'): THREE.BufferGeometry {
  return geo('skirt_' + kind, () => {
    const pts: Array<[number, number]> =
      kind === 'dress'
        ? [[0.001, 0.1], [0.17, 0.1], [0.215, 0.02], [0.255, -0.12], [0.32, -0.32], [0.365, -0.49], [0.35, -0.525], [0.001, -0.525]]
        : [[0.001, 0.1], [0.18, 0.1], [0.24, 0.0], [0.31, -0.14], [0.345, -0.26], [0.33, -0.3], [0.001, -0.3]];
    return tf(lathe(pts.slice().reverse(), 18), { s: [1, 1, 0.9] });
  });
}
const thighGeo = (): THREE.BufferGeometry => geo('thigh', () => tf(capg(0.09, 0.2, 4, 10), { p: [0, -0.15, 0] }));
const shinGeo = (): THREE.BufferGeometry => geo('shin', () => tf(capg(0.078, 0.2, 4, 10), { p: [0, -0.14, 0] }));
function shoeGeo(boot: boolean): THREE.BufferGeometry {
  return geo(boot ? 'boot' : 'shoe', () => {
    const shoe = tf(sph(0.088, 12, 8), { s: [0.95, 0.62, 1.42], p: [0, -0.028, 0.045] });
    if (!boot) return shoe;
    return merge([shoe, tf(cyl(0.083, 0.088, 0.12, 12), { p: [0, 0.02, 0.0] })]);
  });
}
const upperArmGeo = (): THREE.BufferGeometry => geo('uarm', () => tf(capg(0.068, 0.16, 4, 10), { p: [0, -0.105, 0] }));
const handOnly = (): THREE.BufferGeometry => tf(sph(0.066, 10, 8), { s: [0.92, 1.05, 0.9] });
const foreArmGeo = (withHand: boolean): THREE.BufferGeometry =>
  geo(withHand ? 'farm_h' : 'farm', () => {
    const f = tf(capg(0.06, 0.15, 4, 10), { p: [0, -0.095, 0] });
    return withHand ? merge([f, tf(handOnly(), { p: [0, -FARM, 0] })]) : f;
  });
const handGeo = (): THREE.BufferGeometry => geo('hand', handOnly);
const headGeo = (): THREE.BufferGeometry =>
  geo('head', () =>
    merge([
      tf(sph(HEAD_R, 20, 16), { s: [1, 0.97, 0.97] }),
      tf(sph(0.034, 10, 8), { s: [1, 0.85, 1], p: [0, 0.008, 0.212] }),
      tf(sph(0.05, 8, 6), { s: [0.45, 0.9, 0.75], p: [0.212, -0.01, -0.005] }),
      tf(sph(0.05, 8, 6), { s: [0.45, 0.9, 0.75], p: [-0.212, -0.01, -0.005] }),
    ]),
  );

// ---------------------------------------------------------------------------------------------
// outfit detail geometries (spine space unless noted)
// ---------------------------------------------------------------------------------------------
function vShape(w: number, h: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, -h);
  s.closePath();
  return tf(new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }), { p: [0, h / 2, -0.012] });
}
const shirtV = (w: number, h: number, yTop: number): THREE.BufferGeometry => onChest(vShape(w, h), 0, yTop - h / 2, h, 0.004);
const pocketSquare = (): THREE.BufferGeometry => onChest(tf(boxg(0.05, 0.03, 0.02), { r: [0, 0, 0.15] }), 0.115, 0.37, 0.05, 0.006);
function bowtie(): THREE.BufferGeometry {
  const parts = [
    tf(coneg(0.042, 0.075, 4), { r: [0, 0, -PI / 2], p: [-0.036, 0, 0] }),
    tf(coneg(0.042, 0.075, 4), { r: [0, 0, PI / 2], p: [0.036, 0, 0] }),
    sph(0.02, 6, 5),
  ];
  return onChest(merge(parts), 0, 0.49, 0.06, 0.03);
}
function necktie(): THREE.BufferGeometry {
  const knot = onChest(boxg(0.045, 0.04, 0.03), 0, 0.5, 0.05, 0.014);
  const blade = onChest(tf(cyl(0.026, 0.038, 0.2, 4), { r: [0, PI / 4, 0], s: [1, 1, 0.35] }), 0, 0.37, 0.2, 0.012);
  return merge([knot, blade]);
}
const buttonsAt = (pts: Array<[number, number]>): THREE.BufferGeometry[] => pts.map(([x, y]) => onChest(sph(0.017, 6, 5), x, y, 0.04, 0.008));
const belt = (y: number, r = 0.217): THREE.BufferGeometry => tf(cyl(r, r, 0.055, 18), { s: [1, 1, TORSO_DEPTH + 0.02], p: [0, y, 0] });
/** diagonal sash across the chest (left shoulder -> right hip) + cummerbund */
function sash(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [tf(cyl(0.224, 0.222, 0.09, 18), { s: [1, 1, TORSO_DEPTH + 0.03], p: [0, 0.1, 0] })];
  for (const x of [-0.13, -0.065, 0, 0.065, 0.13]) {
    parts.push(onChest(tf(boxg(0.1, 0.075, 0.025), { r: [0, 0, 0.72] }), x, 0.3 + x * 0.88, 0.08, 0.004));
  }
  return merge(parts);
}
function bibAndStraps(): THREE.BufferGeometry {
  const parts = [onChest(boxg(0.25, 0.22, 0.03), 0, 0.27, 0.22, 0.006)];
  for (const sx of [-1, 1]) {
    parts.push(onChest(boxg(0.045, 0.22, 0.02), sx * 0.1, 0.45, 0.16, 0.004));
    parts.push(tf(boxg(0.045, 0.03, 0.26), { p: [sx * 0.12, 0.535, -0.01], r: [0, 0, sx * -0.25] }));
    parts.push(tf(boxg(0.045, 0.4, 0.02), { p: [sx * 0.1, 0.33, -frontZ(0.33) - 0.004], r: [-0.12, 0, 0] }));
  }
  parts.push(onChest(boxg(0.11, 0.08, 0.02), 0, 0.27, 0.08, 0.026));
  return merge(parts);
}
function toolBelt(): THREE.BufferGeometry {
  return merge([
    belt(0.06, 0.222),
    tf(boxg(0.09, 0.12, 0.07), { p: [0.19, 0.0, 0.08], r: [0, 0.6, 0] }),
    tf(boxg(0.08, 0.1, 0.07), { p: [-0.2, 0.01, 0.06], r: [0, -0.6, 0] }),
    tf(cyl(0.012, 0.012, 0.16, 5), { p: [-0.22, 0.08, 0.1], r: [0.2, 0, 0.3] }),
  ]);
}
function collar(r = 0.11, tube = 0.03): THREE.BufferGeometry {
  return tf(tor(r, tube, 5, 16), { r: [PI / 2 - 0.25, 0, 0], p: [0, 0.535, 0.015], s: [1, 1, 1] });
}
function waistBow(): THREE.BufferGeometry {
  return merge([
    belt(0.07, 0.218),
    tf(sph(0.06, 8, 6), { s: [1.3, 0.8, 0.5], p: [-0.055, 0.08, -0.19], r: [0, 0, 0.3] }),
    tf(sph(0.06, 8, 6), { s: [1.3, 0.8, 0.5], p: [0.055, 0.08, -0.19], r: [0, 0, -0.3] }),
    tf(sph(0.03, 6, 5), { p: [0, 0.075, -0.2] }),
  ]);
}

// ---------------------------------------------------------------------------------------------
// hair (head space: origin at head centre)
// ---------------------------------------------------------------------------------------------
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
function alignY(g: THREE.BufferGeometry, dir: V3, pos: V3): THREE.BufferGeometry {
  _dir.set(dir[0], dir[1], dir[2]).normalize();
  _tq.setFromUnitVectors(_up, _dir);
  _tp.set(pos[0], pos[1], pos[2]);
  _ts.set(1, 1, 1);
  _tm.compose(_tp, _tq, _ts);
  g.applyMatrix4(_tm);
  return g;
}
const hairCap = (r: number, thetaLen: number, tilt: number, sy = 1): THREE.BufferGeometry =>
  tf(sphPart(r, 18, 10, 0, TAU, 0, thetaLen), { s: [1, sy, 1], r: [-tilt, 0, 0] });
/** top cap + side/back band that leaves the face open */
function hairHelmet(r: number, bottomTheta: number): THREE.BufferGeometry[] {
  const open = 0.95;
  return [
    sphPart(r, 18, 6, 0, TAU, 0, 0.86),
    sphPart(r, 18, 8, PI / 2 + open, TAU - 2 * open, 0.86, bottomTheta - 0.86),
  ];
}
type HairKey = HairStyle | 'under';
function hairGeo(style: HairKey): THREE.BufferGeometry | null {
  if (style === 'bald') return null;
  return geo('hair_' + style, () => {
    switch (style) {
      case 'short':
        return merge([
          hairCap(0.234, 0.56 * PI, 0.88),
          tf(sph(0.1, 10, 8), { s: [1.35, 0.55, 1], r: [-0.35, 0, 0], p: [0.02, 0.2, 0.065] }),
        ]);
      case 'slick':
        return merge([hairCap(0.229, 0.55 * PI, 0.84, 0.95), tf(capg(0.03, 0.16, 3, 6), { r: [PI / 2 - 0.3, 0, 0], p: [-0.07, 0.19, 0.04], s: [1, 1, 0.6] })]);
      case 'under':
        return hairCap(0.231, 0.55 * PI, 0.84);
      case 'bun':
        return merge([hairCap(0.232, 0.55 * PI, 0.84), tf(sph(0.105, 12, 10), { p: [0, 0.17, -0.155] })]);
      case 'ponytail':
        return merge([hairCap(0.232, 0.55 * PI, 0.84), tf(sph(0.042, 8, 6), { p: [0, 0.11, -0.225] })]);
      case 'bob':
        return tf(merge(hairHelmet(0.25, 2.2)), { s: [1.04, 1, 1.02], p: [0, 0.008, -0.004] });
      case 'long':
        return merge([
          ...hairHelmet(0.245, 2.35),
          tf(sph(0.2, 14, 10), { s: [1.18, 1.55, 0.6], p: [0, -0.2, -0.125] }),
        ]);
      case 'curly': {
        const parts = [hairCap(0.222, 0.5 * PI, 0.75)];
        const N = 18;
        for (let i = 0; i < N; i++) {
          const yy = 1 - ((i + 0.5) / N) * 1.12;
          const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
          const az = i * 2.39996;
          const x = rr * Math.sin(az);
          const z = rr * Math.cos(az);
          if (z > 0.25 && yy < 0.78) continue;
          if (yy < -0.05 && z > -0.2) continue;
          parts.push(tf(sph(0.082 + (i % 3) * 0.008, 8, 6), { p: [x * 0.215, yy * 0.215 + 0.01, z * 0.215] }));
        }
        return merge(parts);
      }
      case 'spiky': {
        const parts = [hairCap(0.232, 0.55 * PI, 0.84)];
        const spikes: Array<[number, number]> = [
          [0.1, 0], [0.55, 0.35], [0.55, -0.35], [0.6, 1.5], [0.6, -1.5], [0.7, 2.5], [0.7, -2.5], [0.75, PI], [1.0, 2.0], [1.0, -2.0],
        ];
        for (const [pol, az] of spikes) {
          const d: V3 = [Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)];
          parts.push(alignY(coneg(0.058, 0.18, 6), d, [d[0] * 0.24, d[1] * 0.24, d[2] * 0.24]));
        }
        return merge(parts);
      }
    }
    return hairCap(0.234, 0.56 * PI, 0.78);
  });
}
const ponytailGeo = (): THREE.BufferGeometry =>
  geo('ponytail_tail', () =>
    merge([tf(capg(0.068, 0.12, 4, 8), { p: [0, -0.1, 0], s: [1, 1, 0.85] }), tf(sph(0.055, 8, 6), { p: [0, -0.22, 0] })]),
  );

// ---------------------------------------------------------------------------------------------
// hats (head space). Each returns [geometry, colourRole] list; role resolved by the model.
// ---------------------------------------------------------------------------------------------
type HatPart = { key: string; color: string; make: () => THREE.BufferGeometry };
interface HatDef { parts: HatPart[]; tilt: V3; extra: number; covers: boolean }
function hatDef(h: HatStyle, a: Appearance): HatDef | null {
  const acc = validHex(a.accent, '#c0392b');
  switch (h) {
    case 'guard_cap': {
      const crown = a.outfit === 'guard' ? validHex(a.top, '#2c3e6b') : '#2c3e6b';
      return {
        tilt: [-0.17, 0, 0], extra: 0.1, covers: true,
        parts: [
          { key: 'gcap_crown', color: crown, make: () => tf(cyl(0.248, 0.222, 0.1, 18), { p: [0, 0.23, 0] }) },
          {
            key: 'gcap_band', color: '#1c1e29',
            make: () => merge([
              tf(cyl(0.226, 0.226, 0.055, 18), { p: [0, 0.175, 0] }),
              tf(cylPart(0.2, 0.2, 0.018, 12, -PI / 2, PI), { s: [1.0, 1, 0.55], r: [0.32, 0, 0], p: [0, 0.16, 0.15] }),
            ]),
          },
          { key: 'gcap_badge', color: C_GOLD, make: () => tf(cyl(0.04, 0.04, 0.014, 6), { r: [PI / 2 - 0.1, 0, 0], p: [0, 0.235, 0.24] }) },
        ],
      };
    }
    case 'chef_toque':
      return {
        tilt: [-0.06, 0, 0.04], extra: 0.38, covers: true,
        parts: [{
          key: 'toque', color: '#fbfaf6',
          make: () => {
            const parts = [tf(cyl(0.222, 0.215, 0.12, 18), { p: [0, 0.19, 0] }), tf(cyl(0.24, 0.22, 0.16, 18), { p: [0, 0.3, 0] })];
            for (let i = 0; i < 5; i++) {
              const az = (i / 5) * TAU;
              parts.push(tf(sph(0.12, 10, 8), { p: [Math.sin(az) * 0.115, 0.42, Math.cos(az) * 0.115] }));
            }
            parts.push(tf(sph(0.13, 10, 8), { p: [0, 0.47, 0] }));
            return merge(parts);
          },
        }],
      };
    case 'top_hat':
      return {
        tilt: [-0.06, 0, -0.1], extra: 0.3, covers: true,
        parts: [
          { key: 'tophat', color: '#27252c', make: () => merge([tf(cyl(0.28, 0.28, 0.025, 22), { p: [0, 0.2, 0] }), tf(cyl(0.168, 0.158, 0.31, 18), { p: [0, 0.365, 0] })]) },
          { key: 'tophat_band', color: validHex(a.accent, '#b8323a'), make: () => tf(cyl(0.172, 0.168, 0.06, 18), { p: [0, 0.245, 0] }) },
        ],
      };
    case 'cap':
      return {
        tilt: [-0.2, 0, 0], extra: 0.07, covers: true,
        parts: [{
          key: 'cap', color: acc,
          make: () => merge([
            tf(sphPart(0.238, 18, 8, 0, TAU, 0, PI / 2), { s: [1, 0.78, 1], p: [0, 0.075, 0] }),
            tf(cylPart(0.15, 0.15, 0.02, 12, -PI / 2, PI), { s: [1, 1, 1.1], r: [0.05, 0, 0], p: [0, 0.1, 0.17] }),
            tf(sph(0.025, 6, 5), { p: [0, 0.26, 0] }),
          ]),
        }],
      };
    case 'beanie':
      return {
        tilt: [-0.3, 0, 0], extra: 0.14, covers: true,
        parts: [{
          key: 'beanie', color: validHex(a.accent, '#4a7bd0'),
          make: () => merge([
            tf(sphPart(0.243, 18, 8, 0, TAU, 0, PI / 2), { s: [1, 1.0, 1], p: [0, 0.08, 0] }),
            tf(cyl(0.25, 0.25, 0.08, 18), { p: [0, 0.1, 0] }),
            tf(sph(0.075, 8, 6), { p: [0, 0.33, 0] }),
          ]),
        }],
      };
    case 'maid_band':
      return {
        tilt: [0, 0, 0], extra: 0.04, covers: false,
        parts: [{
          key: 'maidband', color: '#fdfcf8',
          make: () => {
            const parts = [tor(0.232, 0.022, 5, 18, PI)];
            for (let i = 0; i < 7; i++) {
              const ang = 0.35 + (i / 6) * (PI - 0.7);
              parts.push(tf(sph(0.045, 8, 6), { s: [1, 0.8, 0.5], p: [Math.cos(ang) * 0.245, Math.sin(ang) * 0.245, 0.0] }));
            }
            return tf(merge(parts), { r: [0.5, 0, 0] });
          },
        }],
      };
    case 'straw':
      return {
        tilt: [-0.24, 0, 0.05], extra: 0.12, covers: true,
        parts: [
          {
            key: 'straw', color: '#ecd28c',
            make: () => merge([
              tf(cyl(0.4, 0.41, 0.024, 24), { p: [0, 0.135, 0] }),
              tf(cyl(0.188, 0.218, 0.13, 18), { p: [0, 0.205, 0] }),
              tf(sphPart(0.188, 18, 6, 0, TAU, 0, PI / 2), { s: [1, 0.4, 1], p: [0, 0.27, 0] }),
            ]),
          },
          { key: 'straw_band', color: validHex(a.accent, '#c0573f'), make: () => tf(cyl(0.222, 0.222, 0.045, 18), { p: [0, 0.172, 0] }) },
        ],
      };
    case 'hard_hat':
      return {
        tilt: [-0.18, 0, 0], extra: 0.14, covers: true,
        parts: [{
          key: 'hardhat', color: '#f5c431',
          make: () => merge([
            tf(sphPart(0.25, 18, 9, 0, TAU, 0, PI / 2), { s: [1, 0.9, 1], p: [0, 0.11, 0] }),
            tf(cyl(0.275, 0.275, 0.022, 20), { s: [1, 1, 1.05], p: [0, 0.115, 0.015] }),
            tf(capg(0.032, 0.25, 3, 8), { r: [PI / 2, 0, 0], s: [1, 1, 0.7], p: [0, 0.32, 0] }),
          ]),
        }],
      };
    case 'fascinator':
      return {
        tilt: [0, 0, 0], extra: 0.06, covers: false,
        parts: [{
          key: 'fascinator', color: validHex(a.accent, '#d14b8f'),
          make: () => tf(merge([
            cyl(0.075, 0.075, 0.02, 12),
            tf(sph(0.05, 8, 6), { s: [0.35, 2.4, 0.25], r: [0, 0, -0.35], p: [0.03, 0.1, 0] }),
            tf(sph(0.05, 8, 6), { s: [0.35, 2.0, 0.25], r: [0.2, 0, -0.85], p: [0.07, 0.07, -0.02] }),
            tf(sph(0.028, 6, 5), { p: [0, 0.02, 0.03] }),
          ]), { r: [0, 0, -0.65], p: [0.13, 0.17, 0.03] }),
        }],
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// face geometries (head space)
// ---------------------------------------------------------------------------------------------
type EyeKind = 'dot' | 'big' | 'arc';
function eyesGeo(k: EyeKind): THREE.BufferGeometry {
  return geo('eyes_' + k, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      let g: THREE.BufferGeometry;
      if (k === 'arc') g = tf(tor(0.03, 0.01, 5, 10, PI), { p: [0, -0.012, 0] });
      else if (k === 'big') g = tf(sph(0.041, 10, 8), { s: [1, 1.15, 0.5] });
      else g = tf(sph(0.031, 10, 8), { s: [1, 1.2, 0.5] });
      parts.push(tf(placeOnFace(g, sx * EYE_X, EYE_Y), { p: [0, -EYE_Y, 0] }));
    }
    return merge(parts);
  });
}
const browGeo = (): THREE.BufferGeometry => geo('brow', () => boxg(0.088, 0.026, 0.024));
type MouthKind = 'line' | 'smile' | 'frown' | 'o' | 'small_o' | 'smirk' | 'wavy' | 'flat';
function mouthGeo(k: MouthKind): THREE.BufferGeometry {
  return geo('mouth_' + k, () => {
    switch (k) {
      case 'smile':
        return tf(tor(0.054, 0.014, 5, 12, PI), { r: [0, 0, PI], p: [0, 0.026, 0] });
      case 'frown':
        return tf(tor(0.046, 0.014, 5, 12, PI), { p: [0, -0.024, 0] });
      case 'o':
        return tf(sph(0.038, 10, 8), { s: [0.85, 1.15, 0.35] });
      case 'small_o':
        return tf(sph(0.022, 8, 6), { s: [1, 1.1, 0.4] });
      case 'smirk':
        return tf(tor(0.046, 0.013, 5, 10, PI * 0.6), { r: [0, 0, PI + 0.55], p: [0.04, 0.026, 0] });
      case 'wavy': {
        const pts = [[-0.055, 0], [-0.028, 0.014], [0, -0.009], [0.028, 0.014], [0.055, -0.004]].map(([x, y]) => new THREE.Vector3(x, y, 0));
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.011, 5, false);
      }
      case 'flat':
        return boxg(0.058, 0.017, 0.018);
      default:
        return boxg(0.085, 0.02, 0.018);
    }
  });
}
const glassesGeo = (): THREE.BufferGeometry =>
  geo('glasses', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      parts.push(placeOnFace(tor(0.046, 0.009, 5, 14), sx * EYE_X, EYE_Y, FACE_R, 0.014));
      parts.push(tf(boxg(0.012, 0.012, 0.17), { r: [0, sx * -0.37, 0], p: [sx * 0.196, EYE_Y + 0.012, 0.07] }));
    }
    parts.push(placeOnFace(boxg(0.05, 0.012, 0.012), 0, EYE_Y + 0.012, FACE_R, 0.022));
    return merge(parts);
  });
const monocleGeo = (): THREE.BufferGeometry =>
  geo('monocle', () =>
    merge([
      placeOnFace(tor(0.05, 0.009, 5, 14), -EYE_X, EYE_Y, FACE_R, 0.016),
      tf(capg(0.004, 0.16, 2, 4), { r: [0.25, 0, -0.35], p: [-0.12, -0.1, 0.17] }),
    ]),
  );
function facialGeo(kind: 'mustache' | 'beard'): THREE.BufferGeometry {
  return geo('facial_' + kind, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      parts.push(placeOnFace(tf(sph(0.045, 10, 6), { s: [1.45, 0.55, 0.7], r: [0, 0, sx * 0.32] }), sx * 0.044, -0.034, FACE_R, 0.008));
      parts.push(placeOnFace(sph(0.022, 6, 5), sx * 0.098, -0.016, FACE_R, 0.0));
    }
    if (kind === 'beard') {
      parts.push(tf(sphPart(0.235, 16, 8, PI / 2 - 1.75, 3.5, 1.95, 0.9), { s: [1.06, 1.1, 1.06], r: [0.1, 0, 0] }));
    }
    return merge(parts);
  });
}

// ---------------------------------------------------------------------------------------------
// hand props (single colour each; grip at origin) and carried items
// ---------------------------------------------------------------------------------------------
type PropKind = 'none' | 'glass' | 'cigarette' | 'spoon' | 'duster' | 'walkie' | 'hammer' | 'brush' | 'drumstick' | 'lockpick';
const PROPS: Record<Exclude<PropKind, 'none'>, { color: string; make: () => THREE.BufferGeometry }> = {
  glass: {
    color: '#f3dc8a',
    make: () => merge([tf(cyl(0.03, 0.03, 0.008, 10), { p: [0, -0.045, 0] }), tf(cyl(0.007, 0.007, 0.07, 6), { p: [0, -0.01, 0] }), tf(cyl(0.042, 0.022, 0.075, 10), { p: [0, 0.06, 0] })]),
  },
  cigarette: { color: '#f4f1ea', make: () => tf(cyl(0.009, 0.009, 0.09, 6), { r: [PI / 2, 0, 0], p: [0, 0, 0.04] }) },
  spoon: { color: '#c99a5b', make: () => merge([tf(cyl(0.011, 0.013, 0.32, 6), { p: [0, -0.12, 0] }), tf(sph(0.036, 8, 6), { s: [1, 0.5, 1.3], p: [0, -0.29, 0] })]) },
  duster: { color: '#ee93b6', make: () => merge([tf(cyl(0.012, 0.012, 0.22, 6), { p: [0, 0.08, 0] }), tf(sph(0.075, 8, 6), { s: [1.1, 1.4, 1.1], p: [0, 0.24, 0] })]) },
  walkie: { color: '#2e3138', make: () => merge([tf(boxg(0.055, 0.12, 0.035), { p: [0, 0.03, 0] }), tf(cyl(0.006, 0.006, 0.09, 5), { p: [0.015, 0.13, 0] })]) },
  hammer: { color: '#6f6a66', make: () => merge([tf(cyl(0.014, 0.014, 0.26, 6), { p: [0, 0.08, 0] }), tf(boxg(0.13, 0.05, 0.05), { p: [0, 0.21, 0] })]) },
  brush: { color: '#c4613a', make: () => merge([tf(cyl(0.009, 0.011, 0.22, 6), { p: [0, 0.06, 0] }), tf(coneg(0.02, 0.06, 6), { p: [0, 0.2, 0] })]) },
  drumstick: {
    color: '#c2783a',
    make: () => merge([tf(sph(0.052, 8, 6), { s: [1, 1.3, 1], p: [0, 0.08, 0] }), tf(cyl(0.013, 0.013, 0.08, 6), { p: [0, -0.01, 0] }), tf(sph(0.022, 6, 5), { p: [0, -0.055, 0] })]),
  },
  lockpick: { color: '#a5aab2', make: () => merge([tf(boxg(0.008, 0.008, 0.12), { p: [0, 0, 0.06] }), tf(boxg(0.022, 0.022, 0.05), { p: [0, 0, -0.02] })]) },
};
const propGeo = (k: Exclude<PropKind, 'none'>): THREE.BufferGeometry => geo('prop_' + k, PROPS[k].make);
const flashlightGeo = (): THREE.BufferGeometry =>
  geo('flashlight', () =>
    merge([tf(cyl(0.027, 0.027, 0.2, 10), { r: [PI / 2, 0, 0], p: [0, 0, 0.03] }), tf(cyl(0.048, 0.03, 0.07, 12), { r: [PI / 2, 0, 0], p: [0, 0, 0.16] })]),
  );
const bookGeo = (): THREE.BufferGeometry =>
  geo('book', () => merge([tf(boxg(0.12, 0.17, 0.018), { r: [0, 0.38, 0], p: [-0.056, 0, 0.02] }), tf(boxg(0.12, 0.17, 0.018), { r: [0, -0.38, 0], p: [0.056, 0, 0.02] })]));

interface ItemPart { key: string; color: string; make: () => THREE.BufferGeometry }
function duckParts(fake: boolean): ItemPart[] {
  return [
    {
      key: 'duck_body', color: fake ? '#f2c230' : C_GOLD,
      make: () => merge([
        tf(sph(0.14, 14, 10), { s: [0.95, 0.78, 1.2], p: [0, 0, -0.01] }),
        tf(coneg(0.07, 0.13, 8), { r: [-1.05, 0, 0], p: [0, 0.06, -0.18] }),
        tf(sph(0.088, 12, 9), { p: [0, 0.145, 0.11] }),
        tf(sph(0.09, 8, 6), { s: [0.35, 0.6, 1.1], p: [0.12, 0.025, -0.02] }),
        tf(sph(0.09, 8, 6), { s: [0.35, 0.6, 1.1], p: [-0.12, 0.025, -0.02] }),
      ]),
    },
    { key: 'duck_beak', color: fake ? '#ef9a2a' : '#cf8a17', make: () => tf(sph(0.045, 8, 6), { s: [1, 0.45, 1.5], p: [0, 0.128, 0.2] }) },
    { key: 'duck_eyes', color: '#2a2420', make: () => merge([tf(sph(0.016, 6, 5), { p: [0.052, 0.17, 0.17] }), tf(sph(0.016, 6, 5), { p: [-0.052, 0.17, 0.17] })]) },
  ];
}
function itemParts(c: Carry): ItemPart[] {
  switch (c) {
    case 'tray':
      return [{
        key: 'tray', color: '#d6dae1',
        make: () => merge([
          cyl(0.2, 0.2, 0.016, 20),
          tf(tor(0.2, 0.012, 4, 24), { r: [PI / 2, 0, 0], p: [0, 0.008, 0] }),
          tf(sphPart(0.12, 14, 7, 0, TAU, 0, PI / 2), { p: [0, 0.008, 0] }),
          tf(sph(0.022, 6, 5), { p: [0, 0.135, 0] }),
        ]),
      }];
    case 'box':
      return [
        { key: 'gift_box', color: '#e0525b', make: () => boxg(0.3, 0.26, 0.26) },
        {
          key: 'gift_ribbon', color: '#f6d04d',
          make: () => merge([
            boxg(0.312, 0.272, 0.06), boxg(0.06, 0.272, 0.272),
            tf(tor(0.045, 0.016, 5, 10), { r: [0, 0.6, 0], p: [-0.04, 0.165, 0], s: [1, 1, 1] }),
            tf(tor(0.045, 0.016, 5, 10), { r: [0, -0.6, 0], p: [0.04, 0.165, 0] }),
          ]),
        },
      ];
    case 'duck':
      return duckParts(false);
    case 'fake_duck':
      return duckParts(true);
    case 'vase':
      return [
        {
          key: 'vase', color: '#3f6fc4',
          make: () => lathe([[0.001, -0.17], [0.08, -0.17], [0.12, -0.1], [0.13, 0.0], [0.1, 0.08], [0.055, 0.12], [0.05, 0.16], [0.072, 0.19], [0.06, 0.2], [0.001, 0.2]], 16),
        },
        { key: 'vase_bands', color: '#f4f4f0', make: () => merge([tf(tor(0.129, 0.013, 4, 18), { r: [PI / 2, 0, 0], p: [0, -0.02, 0] }), tf(tor(0.088, 0.011, 4, 16), { r: [PI / 2, 0, 0], p: [0, 0.085, 0] })]) },
      ];
    case 'bottle':
      return [{
        key: 'bottle', color: '#2f6b3a',
        make: () => merge([tf(cyl(0.043, 0.043, 0.19, 12), { p: [0, -0.2, 0] }), tf(sph(0.043, 12, 6), { s: [1, 0.7, 1], p: [0, -0.105, 0] }), tf(cyl(0.016, 0.019, 0.1, 8), { p: [0, -0.03, 0] })]),
      }];
    case 'wrench':
      return [{
        key: 'wrench', color: '#8d939c',
        make: () => merge([tf(boxg(0.032, 0.24, 0.016), { p: [0, -0.04, 0] }), tf(tor(0.036, 0.014, 4, 10, PI * 1.4), { r: [0, 0, -0.2 * PI], p: [0, 0.11, 0] }), tf(tor(0.025, 0.012, 4, 10), { p: [0, -0.17, 0] })]),
      }];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------------------------
// outfits
// ---------------------------------------------------------------------------------------------
interface Detail { key: string; color: string; make: () => THREE.BufferGeometry; pelvis?: boolean; shadow?: boolean }
interface DressSpec {
  tails: boolean;
  torso: string; upper: string; fore: string; hand: string;
  thigh: string | null; shin: string; shoe: string; boot: boolean;
  skirt: 'dress' | 'maid' | null; skirtColor: string;
  details: Detail[];
  defaultHat: HatStyle;
}
function dressSpec(a: Appearance): DressSpec {
  const skin = validHex(a.skin, '#f1c7a5');
  const top = validHex(a.top, '#3b4a6b');
  const bottom = validHex(a.bottom, '#33384a');
  const acc = (fb: string): string => validHex(a.accent, fb);
  const s: DressSpec = {
    tails: false, torso: top, upper: top, fore: top, hand: skin,
    thigh: bottom, shin: bottom, shoe: C_SHOE, boot: false,
    skirt: null, skirtColor: bottom, details: [], defaultHat: 'none',
  };
  const white = (key: string, make: () => THREE.BufferGeometry): Detail => ({ key, color: C_WHITE, make, shadow: false });
  const formal = (bow: boolean, accFb: string, deep = false): void => {
    s.details.push(white(deep ? 'd_white_deep' : 'd_white_v', () => merge([shirtV(deep ? 0.21 : 0.165, deep ? 0.3 : 0.24, 0.535), pocketSquare()])));
    s.details.push({ key: bow ? 'd_bowtie' : 'd_tie', color: acc(accFb), make: bow ? bowtie : necktie, shadow: false });
  };
  switch (a.outfit) {
    case 'suit':
      formal(false, '#b03a48');
      break;
    case 'tux':
      formal(true, '#26242b');
      break;
    case 'host':
      s.details.push(white('d_white_v', () => merge([shirtV(0.165, 0.24, 0.535), pocketSquare()])));
      s.details.push({ key: 'd_host_sash', color: acc('#c43b45'), make: () => merge([sash(), bowtie()]) });
      break;
    case 'musician':
      s.tails = true;
      formal(true, '#26242b');
      break;
    case 'butler':
      s.tails = true;
      s.hand = '#fbfbf7';
      formal(true, '#26242b');
      break;
    case 'waiter':
      s.upper = C_WHITE;
      s.fore = C_WHITE;
      s.details.push(white('d_waiter_shirt', () => shirtV(0.22, 0.32, 0.545)));
      s.details.push({ key: 'd_bowtie', color: acc('#26242b'), make: bowtie, shadow: false });
      break;
    case 'bartender':
      s.upper = C_WHITE;
      s.fore = skin;
      s.details.push(white('d_waiter_shirt', () => shirtV(0.22, 0.32, 0.545)));
      s.details.push({ key: 'd_bowtie', color: acc('#8e2b3a'), make: bowtie, shadow: false });
      break;
    case 'chef':
      s.defaultHat = 'chef_toque';
      s.details.push({ key: 'd_chef_buttons', color: '#3a3236', make: () => merge(buttonsAt([[-0.065, 0.18], [-0.07, 0.29], [-0.065, 0.4], [0.065, 0.18], [0.07, 0.29], [0.065, 0.4]])), shadow: false });
      s.details.push({ key: 'd_neckerchief', color: acc('#d64545'), make: () => merge([collar(0.115, 0.032), onChest(sph(0.04, 8, 6), 0, 0.5, 0.05, 0.02)]) });
      break;
    case 'guard':
      s.defaultHat = 'guard_cap';
      s.boot = true;
      s.shoe = '#1f1d22';
      s.details.push({ key: 'd_guard_collar', color: '#a8cbe8', make: () => shirtV(0.15, 0.17, 0.545), shadow: false });
      s.details.push({ key: 'd_guard_dark', color: '#1c1e29', make: () => merge([necktie(), belt(0.06)]) });
      s.details.push({
        key: 'd_guard_gold', color: C_GOLD,
        make: () => merge([
          onChest(tf(cyl(0.035, 0.035, 0.014, 6), { r: [PI / 2, 0, 0] }), 0.095, 0.38, 0.05, 0.008),
          onChest(boxg(0.05, 0.04, 0.02), 0, 0.06, 0.04, 0.025),
          tf(boxg(0.1, 0.022, 0.08), { p: [0.165, 0.505, 0], r: [0, 0, -0.45] }),
          tf(boxg(0.1, 0.022, 0.08), { p: [-0.165, 0.505, 0], r: [0, 0, 0.45] }),
        ]),
        shadow: false,
      });
      break;
    case 'maid':
      s.defaultHat = 'maid_band';
      s.skirt = 'maid';
      s.thigh = null;
      s.shin = '#3b3540';
      s.details.push(white('d_maid_bib', () => merge([onChest(boxg(0.18, 0.17, 0.02), 0, 0.31, 0.17, 0.006), collar(0.105, 0.03)])));
      s.details.push({
        key: 'd_maid_apron', color: C_WHITE, pelvis: true,
        make: () => merge([
          tf(cylPart(0.252, 0.36, 0.3, 10, -0.75, 1.5), { s: [1, 1, 0.92], p: [0, -0.125, 0] }),
          tf(cyl(0.25, 0.25, 0.04, 16), { s: [1, 1, 0.92], p: [0, 0.02, 0] }),
          tf(sph(0.05, 8, 6), { s: [1.4, 0.8, 0.5], p: [-0.05, 0.03, -0.24], r: [0, 0, 0.3] }),
          tf(sph(0.05, 8, 6), { s: [1.4, 0.8, 0.5], p: [0.05, 0.03, -0.24], r: [0, 0, -0.3] }),
        ]),
      });
      break;
    case 'dress':
      s.skirt = 'dress';
      s.thigh = null;
      s.upper = skin;
      s.fore = skin;
      s.shin = skin;
      s.shoe = mixHex(bottom, '#000000', 0.35);
      s.details.push({ key: 'd_dress_bow', color: acc(mixHex(top, '#ffffff', 0.55)), make: waistBow });
      break;
    case 'electrician':
      s.defaultHat = 'hard_hat';
      s.fore = skin;
      s.boot = true;
      s.shoe = '#4a3b30';
      s.details.push({ key: 'd_bib', color: bottom, make: bibAndStraps });
      s.details.push({ key: 'd_toolbelt', color: '#8a5a35', make: toolBelt });
      break;
    case 'gardener':
      s.defaultHat = 'straw';
      s.fore = skin;
      s.boot = true;
      s.shoe = '#5a4632';
      s.details.push({ key: 'd_bib', color: bottom, make: bibAndStraps });
      break;
    case 'casual':
    default:
      s.fore = skin;
      s.shoe = '#f2f0ea';
      s.details.push({ key: 'd_logo', color: acc(mixHex(top, '#ffffff', 0.6)), make: () => onChest(tf(cyl(0.06, 0.06, 0.014, 14), { r: [PI / 2, 0, 0] }), 0, 0.32, 0.1, 0.004), shadow: false });
      break;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// expressions
// ---------------------------------------------------------------------------------------------
interface FaceCfg {
  bLy: number; bRy: number; bLt: number; bRt: number; // brow raise (m) and tilt (+ = inner end down / angry)
  eyeSY: number; eye: EyeKind; mouth: MouthKind; mx: number; tint: boolean;
}
const F = (bLy: number, bRy: number, bLt: number, bRt: number, eyeSY: number, eye: EyeKind, mouth: MouthKind, mx = 0, tint = false): FaceCfg =>
  ({ bLy, bRy, bLt, bRt, eyeSY, eye, mouth, mx, tint });
const FACES: Record<Expression, FaceCfg> = {
  neutral: F(0, 0, 0, 0, 1, 'dot', 'line'),
  happy: F(0.014, 0.014, -0.12, -0.12, 1, 'arc', 'smile'),
  suspicious: F(-0.016, 0.032, 0.42, -0.22, 0.42, 'dot', 'flat', 0.028),
  surprised: F(0.048, 0.048, -0.15, -0.15, 1.12, 'big', 'o'),
  angry: F(-0.018, -0.018, 0.66, 0.66, 0.72, 'dot', 'frown'),
  scared: F(0.036, 0.036, -0.55, -0.55, 1.05, 'big', 'o'),
  sleepy: F(-0.01, -0.01, -0.12, -0.12, 0.12, 'dot', 'flat'),
  sick: F(0.012, 0.012, -0.38, -0.38, 0.22, 'dot', 'wavy', 0, true),
  sad: F(0.022, 0.022, -0.58, -0.58, 0.85, 'dot', 'frown'),
  smug: F(0.022, -0.006, 0.12, 0.32, 0.48, 'dot', 'smirk'),
  focused: F(-0.012, -0.012, 0.32, 0.32, 0.6, 'dot', 'flat'),
};

// ---------------------------------------------------------------------------------------------
// two-bone IK: orients a limb root (rest pose hangs along -Y, bends towards local +Z)
// ---------------------------------------------------------------------------------------------
const _ikN = new THREE.Vector3();
const _ikU = new THREE.Vector3();
const _ikW = new THREE.Vector3();
const _ikM = new THREE.Vector3();
const _ikX = new THREE.Vector3();
const _ikY = new THREE.Vector3();
const _ikMat = new THREE.Matrix4();
/** returns the bend angle (radians, >= 0) and writes the root orientation to outQ */
function solveIK(root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3, a: number, b: number, outQ: THREE.Quaternion): number {
  _ikN.subVectors(target, root);
  let D = _ikN.length();
  if (!(D > 1e-5) || !Number.isFinite(D)) {
    _ikN.set(0, -1, 0);
    D = a + b;
  } else _ikN.multiplyScalar(1 / D);
  D = clamp(D, Math.abs(a - b) + 0.02, (a + b) * 0.9995);
  const bend = PI - Math.acos(clamp((a * a + b * b - D * D) / (2 * a * b), -1, 1));
  const alpha = Math.acos(clamp((a * a + D * D - b * b) / (2 * a * D), -1, 1));
  _ikM.copy(pole).addScaledVector(_ikN, -pole.dot(_ikN));
  if (_ikM.lengthSq() < 1e-8) {
    _ikM.set(0, 0, 1).addScaledVector(_ikN, -_ikN.z);
    if (_ikM.lengthSq() < 1e-8) _ikM.set(1, 0, 0);
  }
  _ikM.normalize();
  _ikU.copy(_ikN).multiplyScalar(Math.cos(alpha)).addScaledVector(_ikM, Math.sin(alpha)).normalize();
  _ikW.copy(_ikN).addScaledVector(_ikU, -_ikN.dot(_ikU));
  if (_ikW.lengthSq() < 1e-10) _ikW.copy(_ikM).negate();
  _ikW.normalize();
  _ikY.copy(_ikU).negate();
  _ikX.crossVectors(_ikY, _ikW).normalize();
  _ikMat.makeBasis(_ikX, _ikY, _ikW);
  outQ.setFromRotationMatrix(_ikMat);
  if (!Number.isFinite(outQ.x + outQ.y + outQ.z + outQ.w)) outQ.identity();
  return Number.isFinite(bend) ? bend : 0;
}

// ---------------------------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------------------------
const CH_NAMES = ['hipY', 'hipX', 'hipZ', 'pPitch', 'pRoll', 'lean', 'sRoll', 'sYaw', 'hPitch', 'hRoll', 'hYaw', 'shrug', 'breathe'] as const;
type ChName = (typeof CH_NAMES)[number];
type Ch = Record<ChName, number>;
const CH_RATE: Ch = { hipY: 7, hipX: 6, hipZ: 7, pPitch: 6, pRoll: 6, lean: 8, sRoll: 8, sYaw: 8, hPitch: 9, hRoll: 8, hYaw: 8, shrug: 12, breathe: 3 };
const newCh = (): Ch => ({ hipY: HIP_Y, hipX: 0, hipZ: 0, pPitch: 0, pRoll: 0, lean: 0, sRoll: 0, sYaw: 0, hPitch: 0, hRoll: 0, hYaw: 0, shrug: 0, breathe: 1 });
const HAT_COVER_HAIR: Partial<Record<HairStyle, HairKey>> = { short: 'under', slick: 'under', curly: 'under', spiky: 'under', bun: 'under' };
const TWO_HAND: ReadonlySet<Carry> = new Set<Carry>(['box', 'duck', 'fake_duck', 'vase', 'generic']);

type Pair<T> = [T, T];
const pair = <T>(f: (i: number) => T): Pair<T> => [f(0), f(1)];
const SIDE: Pair<number> = [1, -1]; // index 0 = left (+X), 1 = right (-X)

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class CharacterModel {
  readonly root = new THREE.Group();
  readonly carryAnchor: THREE.Object3D = new THREE.Group();
  get headTop(): number {
    return this._headTop;
  }

  private _headTop = 1.62;
  private readonly makeMat: MatFactory;
  private readonly mats = new Map<string, THREE.Material>();
  private app: Appearance;
  private spec: DressSpec;
  private girth = 1;

  // skeleton -------------------------------------------------------------------------------
  private readonly scaleG = new THREE.Group();
  private readonly bounce = new THREE.Group();
  private readonly pelvis = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly torsoG = new THREE.Group();
  private readonly skirtG = new THREE.Group(); // skirt + pelvis-level details (squashed when seated)
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hatG = new THREE.Group();
  private readonly ponyPivot = new THREE.Group();
  private readonly trayAnchor = new THREE.Group();
  private readonly bookAnchor = new THREE.Group();
  private readonly shoulders: Pair<THREE.Group> = pair(() => new THREE.Group());
  private readonly elbows: Pair<THREE.Group> = pair(() => new THREE.Group());
  private readonly hands: Pair<THREE.Group> = pair(() => new THREE.Group());
  private readonly propG: Pair<THREE.Group> = pair(() => new THREE.Group());
  private readonly holdG = new THREE.Group(); // right hand: bottle / wrench
  private readonly flashG = new THREE.Group(); // right hand: flashlight
  private readonly hips: Pair<THREE.Group> = pair(() => new THREE.Group());
  private readonly knees: Pair<THREE.Group> = pair(() => new THREE.Group());
  private readonly ankles: Pair<THREE.Group> = pair(() => new THREE.Group());

  // meshes -----------------------------------------------------------------------------------
  private readonly torso: THREE.Mesh;
  private readonly skirt: THREE.Mesh;
  private readonly headMesh: THREE.Mesh;
  private readonly hair: THREE.Mesh;
  private readonly pony: THREE.Mesh;
  private readonly eyes: THREE.Mesh;
  private readonly brows: Pair<THREE.Mesh>;
  private readonly mouth: THREE.Mesh;
  private readonly facial: THREE.Mesh;
  private readonly glasses: THREE.Mesh;
  private readonly monocle: THREE.Mesh;
  private readonly thighs: Pair<THREE.Mesh>;
  private readonly shins: Pair<THREE.Mesh>;
  private readonly shoes: Pair<THREE.Mesh>;
  private readonly uppers: Pair<THREE.Mesh>;
  private readonly fores: Pair<THREE.Mesh>;
  private readonly handMeshes: Pair<THREE.Mesh>;
  private readonly propMesh: Pair<THREE.Mesh>;
  private readonly flashMesh: THREE.Mesh;
  private readonly bookMesh: THREE.Mesh;
  private dynamic: THREE.Mesh[] = []; // outfit details + hat parts (rebuilt by setAppearance)
  private readonly items = new Map<Carry, THREE.Group>();
  private shownItem: Carry = 'none';

  // animation state ----------------------------------------------------------------------
  private t = Math.random() * 100;
  private readonly seed = Math.random();
  private fresh = true;
  private phase = 0;
  private wGait = 0;
  private runK = 0;
  private sneakK = 0;
  private readonly c: Ch = newCh();
  private readonly g: Ch = newCh();
  private readonly footC: Pair<THREE.Vector3> = pair((i) => new THREE.Vector3(SIDE[i] * 0.11, ANKLE_Y - HIP_Y, 0.02));
  private readonly footT: Pair<THREE.Vector3> = pair(() => new THREE.Vector3());
  private readonly kneeC: Pair<THREE.Vector3> = pair(() => new THREE.Vector3(0, 0, 1));
  private readonly kneeT: Pair<THREE.Vector3> = pair(() => new THREE.Vector3());
  private readonly handC: Pair<THREE.Vector3> = pair((i) => new THREE.Vector3(SIDE[i] * 0.285, 0.035, 0.05));
  private readonly handT: Pair<THREE.Vector3> = pair(() => new THREE.Vector3());
  private readonly elbowC: Pair<THREE.Vector3> = pair((i) => new THREE.Vector3(SIDE[i] * 0.5, -0.3, -1));
  private readonly elbowT: Pair<THREE.Vector3> = pair(() => new THREE.Vector3());
  private readonly gaitFoot: Pair<THREE.Vector3> = pair(() => new THREE.Vector3());
  private readonly propRot: Pair<THREE.Euler> = pair(() => new THREE.Euler());
  private readonly propKind: Pair<PropKind> = ['none', 'none'];
  private readonly face = { bLy: 0, bRy: 0, bLt: 0, bRt: 0, eyeSY: 1 };
  private blinkIn = 1.5;
  private blinkLeft = 0;
  private hopT = -1;
  private prevHop = false;
  private spinT = -1;
  private eyeKind: EyeKind | '' = '';
  private mouthKind: MouthKind | '' = '';
  private mouthX = NaN;
  private tinted: boolean | null = null;

  constructor(app: Appearance, makeMat: MatFactory) {
    this.makeMat = makeMat;
    this.app = app;
    this.spec = dressSpec(app);
    const ph = headGeo();
    const pm = this.mat(validHex(app.skin, '#f1c7a5'));
    const mk = (parent: THREE.Object3D, shadow = true): THREE.Mesh => {
      const m = new THREE.Mesh(ph, pm);
      m.castShadow = shadow;
      parent.add(m);
      return m;
    };

    // hierarchy
    this.root.name = 'CharacterModel';
    this.root.add(this.scaleG);
    this.scaleG.add(this.bounce);
    this.bounce.add(this.pelvis);
    this.pelvis.add(this.spine);
    this.spine.add(this.torsoG);
    this.spine.add(this.neck);
    this.neck.position.set(0, NECK_Y, 0);
    this.neck.add(this.head);
    this.head.position.set(0, HEAD_CY, 0);
    this.head.add(this.hatG);
    this.head.add(this.ponyPivot);
    this.ponyPivot.position.set(0, 0.11, -0.235);
    this.spine.add(this.carryAnchor);
    this.carryAnchor.position.set(0, 0.27, 0.34);
    this.carryAnchor.name = 'carryAnchor';
    this.spine.add(this.trayAnchor);
    this.trayAnchor.position.set(-0.4, 0.655, 0.14);
    this.spine.add(this.bookAnchor);
    this.bookAnchor.position.set(0, 0.36, 0.3);
    this.bookAnchor.rotation.set(-0.75, 0, 0);
    this.pelvis.rotation.order = 'YXZ';
    this.spine.rotation.order = 'YXZ';
    this.neck.rotation.order = 'YXZ';

    this.torso = mk(this.torsoG);
    this.pelvis.add(this.skirtG);
    this.skirt = mk(this.skirtG);
    this.headMesh = mk(this.head);
    this.hair = mk(this.head);
    this.pony = mk(this.ponyPivot);
    this.eyes = mk(this.head, false);
    this.eyes.position.set(0, EYE_Y, 0);
    this.brows = pair(() => {
      const b = mk(this.head, false);
      b.rotation.order = 'YXZ';
      return b;
    });
    this.mouth = mk(this.head, false);
    this.mouth.rotation.order = 'YXZ';
    this.facial = mk(this.head, false);
    this.glasses = mk(this.head, false);
    this.monocle = mk(this.head, false);

    for (let i = 0; i < 2; i++) {
      const sx = SIDE[i];
      this.spine.add(this.shoulders[i]);
      this.shoulders[i].position.set(sx * SH_X, SH_Y, 0);
      this.shoulders[i].add(this.elbows[i]);
      this.elbows[i].position.set(0, -UARM, 0);
      this.elbows[i].add(this.hands[i]);
      this.hands[i].position.set(0, -FARM, 0);
      this.hands[i].add(this.propG[i]);
      this.pelvis.add(this.hips[i]);
      this.hips[i].position.set(sx * HIP_X, -0.02, 0);
      this.hips[i].add(this.knees[i]);
      this.knees[i].position.set(0, -THIGH, 0);
      this.knees[i].add(this.ankles[i]);
      this.ankles[i].position.set(0, -SHIN, 0);
    }
    this.hands[1].add(this.holdG);
    this.hands[1].add(this.flashG);
    this.thighs = pair((i) => mk(this.hips[i]));
    this.shins = pair((i) => mk(this.knees[i]));
    this.shoes = pair((i) => mk(this.ankles[i]));
    this.uppers = pair((i) => mk(this.shoulders[i]));
    this.fores = pair((i) => mk(this.elbows[i]));
    this.handMeshes = pair((i) => mk(this.hands[i]));
    this.propMesh = pair((i) => mk(this.propG[i]));
    this.flashMesh = mk(this.flashG);
    this.flashMesh.geometry = flashlightGeo();
    this.flashMesh.material = this.mat('#f0c43a');
    this.flashMesh.visible = false;
    this.bookMesh = mk(this.bookAnchor);
    this.bookMesh.geometry = bookGeo();
    this.bookMesh.material = this.mat('#a23b3b');
    this.bookMesh.visible = false;
    for (const p of this.propMesh) p.visible = false;

    this.dress();
    this.update(0, { pose: 'stand', speed: 0, action: 'none', carry: 'none', expression: 'neutral', headYaw: 0 });
    this.fresh = true;
  }

  // -------------------------------------------------------------------------------------------
  private mat(hex: string): THREE.Material {
    let m = this.mats.get(hex);
    if (!m) {
      m = this.makeMat(hex);
      this.mats.set(hex, m);
    }
    return m;
  }

  setAppearance(app: Appearance): void {
    this.app = app;
    this.spec = dressSpec(app);
    this.eyeKind = '';
    this.mouthKind = '';
    this.mouthX = NaN;
    this.tinted = null;
    this.dress();
  }

  private dress(): void {
    const a = this.app;
    const sp = this.spec;
    const skin = validHex(a.skin, '#f1c7a5');
    const hairC = validHex(a.hair, '#4a3426');
    const h = clamp(fin(a.height, 1), 0.7, 1.3);
    const g = clamp(fin(a.girth, 1), 0.75, 1.45);
    this.girth = g;
    this.scaleG.scale.setScalar(h);

    for (const m of this.dynamic) m.removeFromParent();
    this.dynamic = [];
    const addDyn = (parent: THREE.Object3D, key: string, color: string, make: () => THREE.BufferGeometry, shadow = true): void => {
      const m = new THREE.Mesh(geo(key, make), this.mat(color));
      m.castShadow = shadow;
      parent.add(m);
      this.dynamic.push(m);
    };

    // torso + skirt + details
    this.torsoG.scale.set(g, 1, g);
    this.torso.geometry = torsoGeo(sp.tails);
    this.torso.material = this.mat(sp.torso);
    this.skirt.visible = sp.skirt !== null;
    if (sp.skirt) {
      this.skirt.geometry = skirtGeo(sp.skirt);
      this.skirt.material = this.mat(sp.skirtColor);
      this.skirt.scale.set(g, 1, g);
    }
    for (const d of sp.details) {
      if (d.pelvis) {
        addDyn(this.skirtG, d.key, d.color, d.make, d.shadow ?? true);
        this.dynamic[this.dynamic.length - 1].scale.set(g, 1, g);
      } else addDyn(this.torsoG, d.key, d.color, d.make, d.shadow ?? true);
    }

    // limbs
    const lg = 1 + (g - 1) * 0.5;
    const sameHand = sp.fore === sp.hand;
    for (let i = 0; i < 2; i++) {
      this.shoulders[i].position.x = SIDE[i] * SH_X * (1 + (g - 1) * 0.9);
      this.hips[i].position.x = SIDE[i] * HIP_X * (1 + (g - 1) * 0.8);
      this.uppers[i].geometry = upperArmGeo();
      this.uppers[i].material = this.mat(sp.upper);
      this.fores[i].geometry = foreArmGeo(sameHand);
      this.fores[i].material = this.mat(sp.fore);
      this.handMeshes[i].geometry = handGeo();
      this.handMeshes[i].material = this.mat(sp.hand);
      this.handMeshes[i].visible = !sameHand;
      this.thighs[i].visible = sp.thigh !== null;
      this.thighs[i].geometry = thighGeo();
      this.thighs[i].material = this.mat(sp.thigh ?? sp.skirtColor);
      this.shins[i].geometry = shinGeo();
      this.shins[i].material = this.mat(sp.shin);
      this.shoes[i].geometry = shoeGeo(sp.boot);
      this.shoes[i].material = this.mat(sp.shoe);
      for (const m of [this.uppers[i], this.fores[i], this.thighs[i], this.shins[i]]) m.scale.set(lg, 1, lg);
      if (sp.thigh === null) this.thighs[i].scale.set(lg * 1.3, 1, lg * 1.3);
    }

    // head, hair, hat
    this.headMesh.geometry = headGeo();
    this.headMesh.material = this.mat(skin);
    const hatStyle: HatStyle = a.hat === undefined ? sp.defaultHat : a.hat;
    const hd = hatDef(hatStyle, a);
    let hairStyle: HairKey = a.hairStyle;
    if (hd && hd.covers) hairStyle = HAT_COVER_HAIR[a.hairStyle] ?? hairStyle;
    const hg = hairGeo(hairStyle);
    this.hair.visible = hg !== null;
    if (hg) {
      this.hair.geometry = hg;
      this.hair.material = this.mat(hairC);
    }
    this.pony.visible = a.hairStyle === 'ponytail';
    this.pony.geometry = ponytailGeo();
    this.pony.material = this.mat(hairC);
    this.hatG.rotation.set(0, 0, 0);
    if (hd) {
      this.hatG.rotation.set(hd.tilt[0], hd.tilt[1], hd.tilt[2]);
      for (const p of hd.parts) addDyn(this.hatG, 'hat_' + p.key, p.color, p.make, true);
    }
    this._headTop = (HIP_Y + NECK_Y + HEAD_CY + HEAD_R + 0.015 + (hd ? hd.extra : 0)) * h;

    // face
    const browC = mixHex(hairC, '#1a1414', 0.62);
    for (const b of this.brows) {
      b.geometry = browGeo();
      b.material = this.mat(browC);
    }
    this.eyes.material = this.mat(C_FACE);
    this.mouth.material = this.mat(C_MOUTH);
    const fk = a.facial === 'mustache' || a.facial === 'beard' ? a.facial : null;
    this.facial.visible = fk !== null;
    if (fk) {
      this.facial.geometry = facialGeo(fk);
      this.facial.material = this.mat(hairC);
      this.facial.castShadow = fk === 'beard';
    }
    this.glasses.visible = !!a.glasses;
    this.glasses.geometry = glassesGeo();
    this.glasses.material = this.mat('#2a2a30');
    this.monocle.visible = !!a.monocle && !a.glasses;
    this.monocle.geometry = monocleGeo();
    this.monocle.material = this.mat('#e3c25a');
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
    this.dynamic = [];
    this.items.clear();
    this.mats.clear();
  }

  /** lazily built carried item */
  private item(c: Carry): THREE.Group | null {
    if (c === 'none' || c === 'generic') return null;
    let grp = this.items.get(c);
    if (!grp) {
      grp = new THREE.Group();
      for (const p of itemParts(c)) {
        const m = new THREE.Mesh(geo('item_' + p.key, p.make), this.mat(p.color));
        m.castShadow = true;
        grp.add(m);
      }
      if (c === 'tray') this.trayAnchor.add(grp);
      else if (c === 'bottle' || c === 'wrench') this.holdG.add(grp);
      else {
        this.carryAnchor.add(grp);
        if (c === 'vase') grp.position.y = 0.04;
        if (c === 'duck' || c === 'fake_duck') grp.position.set(0, 0.02, -0.02);
      }
      this.items.set(c, grp);
    }
    return grp;
  }

  // -------------------------------------------------------------------------------------------
  update(dt: number, s: AnimState): void {
    dt = clamp(fin(dt), 0, 0.1);
    const pose: Pose = s.pose;
    if (pose === 'hidden') {
      this.root.visible = false;
      this.prevHop = !!s.hop;
      return;
    }
    this.root.visible = true;
    this.t += dt;
    const t = this.t;
    const seedT = this.seed * 37;
    const h = this.scaleG.scale.y || 1;
    const speed = clamp(fin(s.speed), 0, 14);
    const lying = pose === 'sleep_floor';
    const sleeping = lying || pose === 'sleep_chair';
    const seated = pose === 'sit' || pose === 'sleep_chair';
    const cower = pose === 'cower';
    const busy = sleeping || cower;
    let action: Action = busy ? 'none' : s.action ?? 'none';
    const carry: Carry = busy ? 'none' : s.carry ?? 'none';
    const flashOn = !busy && (!!s.flashlight || action === 'flashlight');
    if (action === 'flashlight') action = 'none';
    const G = this.g;

    // ---- gait ------------------------------------------------------------------------------
    const canWalk = !seated && !busy;
    const k6 = kf(6, dt);
    this.wGait += ((canWalk ? sstep(0.05, 0.45, speed) : 0) - this.wGait) * k6;
    this.runK += ((canWalk ? (pose === 'run' ? 1 : pose === 'sneak' ? 0 : sstep(3.2, 4.6, speed)) : 0) - this.runK) * kf(5, dt);
    this.sneakK += ((pose === 'sneak' ? 1 : 0) - this.sneakK) * kf(5, dt);
    const runK = this.runK;
    const snK = this.sneakK;
    const sb = speed / h; // speed in body units
    const L = lerp(lerp(clamp(0.55 + 0.3 * sb, 0.7, 1.4), clamp(0.5 + 0.35 * sb, 0.55, 1.0), snK), clamp(0.95 + 0.22 * sb, 1.5, 2.3), runK);
    if (canWalk) this.phase = frac(this.phase + (sb * dt) / L);
    const phase = this.phase;
    const beta = lerp(0.58, 0.38, runK);
    const Ls = Math.min(beta * L, 0.8);
    const lift = lerp(lerp(0.1, 0.17, snK), 0.2, runK);
    for (let i = 0; i < 2; i++) {
      const ph = frac(phase + (i === 1 ? 0.5 : 0));
      let z: number;
      let y = 0;
      if (ph < beta) z = Ls / 2 - (ph / beta) * Ls;
      else {
        const u = (ph - beta) / (1 - beta);
        z = -Ls / 2 + Ls * (0.5 - 0.5 * Math.cos(PI * u));
        y = lift * Math.sin(PI * u);
      }
      this.gaitFoot[i].set(SIDE[i] * 0.11, ANKLE_Y + y, z + 0.03);
    }
    const bob = this.wGait * lerp(lerp(0.028, 0.02, snK), 0.055, runK) * Math.cos(TAU * 2 * (phase - beta / 2));
    // arm swing driver: + when left foot is forward
    const swing = (this.gaitFoot[0].z - this.gaitFoot[1].z) / Math.max(0.2, Ls);

    // ---- base pose targets -------------------------------------------------------------------
    Object.assign(G, newCh());
    G.lean = 0.03;
    const restX = SH_X * (1 + (this.girth - 1) * 0.9) + 0.05;
    let groundFeet = true;
    let feetZ = 0.02;
    let feetX = 0.11;
    const kick: Pair<number> = [0, 0];
    for (let i = 0; i < 2; i++) {
      const sx = SIDE[i];
      this.handT[i].set(sx * restX, 0.035, 0.05);
      this.elbowT[i].set(sx * 0.5, -0.3, -1);
      this.kneeT[i].set(sx * 0.12, 0, 1);
      this.propKind[i] = 'none';
      this.propRot[i].set(0, 0, 0);
    }
    let shake = clamp(fin(s.shake), 0, 1);
    let talking = false;
    let chewing = false;
    let yawn = 0;
    let showBook = false;

    if (seated) {
      G.hipY = 0.41;
      G.lean = -0.04;
      feetZ = 0.3;
      feetX = 0.13;
      for (let i = 0; i < 2; i++) {
        this.kneeT[i].set(SIDE[i] * 0.1, 1, 0.6);
        this.handT[i].set(SIDE[i] * 0.17, 0.07, 0.26);
      }
      if (pose === 'sleep_chair') {
        G.lean = -0.2;
        G.hPitch = 0.6;
        G.hRoll = this.seed > 0.5 ? 0.38 : -0.38;
        G.breathe = 2.6;
        feetZ = 0.38;
        feetX = 0.19;
        for (let i = 0; i < 2; i++) this.handT[i].set(SIDE[i] * 0.34, -0.03, 0.02);
      }
    } else if (lying) {
      groundFeet = false;
      G.hipY = 0.17;
      G.hipZ = -0.3;
      G.pPitch = -PI / 2;
      G.hRoll = this.seed > 0.5 ? 0.45 : -0.45;
      G.hPitch = -0.12;
      G.breathe = 3.2;
      this.footT[0].set(0.15, -0.6, 0.03);
      this.footT[1].set(-0.13, -0.42, 0.22);
      for (let i = 0; i < 2; i++) {
        this.handT[i].set(SIDE[i] * 0.68, 0.64, 0.02);
        this.elbowT[i].set(0, -0.2, -1);
        this.kneeT[i].set(SIDE[i] * 0.3, 0, 1);
      }
    } else if (cower) {
      G.hipY = 0.4;
      G.lean = 0.5;
      G.hPitch = 0.45;
      feetX = 0.15;
      feetZ = 0.07;
      shake = Math.max(shake, 0.4);
      for (let i = 0; i < 2; i++) {
        this.handT[i].set(SIDE[i] * 0.11, 0.9, 0.16);
        this.elbowT[i].set(SIDE[i], 0.3, 0.2);
        this.kneeT[i].set(SIDE[i] * 0.4, 0, 1);
      }
    } else {
      // stand / walk / run / sneak
      const still = 1 - this.wGait;
      G.hipX = 0.013 * Math.sin(t * 0.7 + seedT) * still;
      G.pRoll = 0.022 * Math.sin(t * 0.7 + seedT + 0.5) * still;
      G.sYaw = 0.1 * swing * this.wGait * (1 - snK);
      G.hipY = HIP_Y - 0.21 * snK;
      G.lean = lerp(lerp(0.03, 0.38, snK), 0.27, runK);
      G.hPitch = -0.32 * snK - 0.15 * runK;
      for (let i = 0; i < 2; i++) {
        const sx = SIDE[i];
        const sw = swing * (i === 0 ? -1 : 1) * this.wGait; // + = this hand forward
        const walkH = _v1.set(sx * restX, 0.035 + 0.03 * Math.abs(sw), 0.05 + 0.2 * sw);
        const runH = _v2.set(sx * 0.27, 0.2 + 0.08 * sw, 0.06 + 0.24 * sw);
        this.handT[i].copy(walkH).lerp(runH, runK);
        if (snK > 0.01) {
          const ph = Math.sin(TAU * (phase + i * 0.5));
          _v1.set(sx * 0.2, 0.42 + 0.05 * ph * this.wGait, 0.27);
          this.handT[i].lerp(_v1, snK);
          this.elbowT[i].lerp(_v2.set(sx * 0.7, -1, -0.2), snK);
        }
      }
    }

    // ---- actions (layered upper body) ---------------------------------------------------
    const rBusy = flashOn || carry === 'tray' || action === 'serve';
    const P = rBusy ? 0 : 1; // primary hand index
    const S = 1 - P;
    const sp = SIDE[P];
    const ss = SIDE[S];
    const hP = this.handT[P];
    const hS = this.handT[S];
    const eP = this.elbowT[P];
    const eS = this.elbowT[S];
    const onHip = (i: number): void => {
      this.handT[i].set(SIDE[i] * 0.3, 0.13, -0.02);
      this.elbowT[i].set(SIDE[i], 0, -0.3);
    };
    switch (action) {
      case 'talk': {
        talking = true;
        const gw = 0.5 + 0.5 * Math.sin(t * 2.7 + seedT);
        hP.lerp(_v1.set(sp * 0.27, 0.24 + 0.05 * Math.sin(t * 7), 0.27), gw);
        hS.lerp(_v1.set(ss * 0.26, 0.2 + 0.04 * Math.sin(t * 6 + 1), 0.23), (1 - gw) * 0.8);
        G.hPitch += 0.07 * Math.sin(t * 5.5);
        G.sYaw += 0.08 * Math.sin(t * 1.3);
        break;
      }
      case 'drink':
      case 'eat': {
        const drink = action === 'drink';
        const u = frac(t / (drink ? 4 : 2.2) + this.seed);
        const sip = pulse(u, 0.05, drink ? 0.3 : 0.4, 0.08);
        hP.set(sp * lerp(0.2, 0.05, sip), lerp(0.24, 0.6, sip), lerp(0.25, 0.27, sip));
        eP.set(sp * 0.8, -1, 0);
        G.hPitch -= (drink ? 0.25 : 0.08) * sip;
        this.propKind[P] = drink ? 'glass' : 'drumstick';
        this.propRot[P].set(-(drink ? 1.1 : 0.5) * sip, 0, 0);
        chewing = !drink && sip < 0.5;
        break;
      }
      case 'smoke': {
        const u = frac(t / 5 + this.seed);
        const puff = pulse(u, 0.05, 0.25, 0.08);
        hP.set(sp * lerp(0.09, 0.04, puff), lerp(0.3, 0.6, puff), lerp(0.22, 0.26, puff));
        eP.set(sp * 0.6, -1, 0);
        hS.set(sp * 0.1, 0.2, 0.2);
        eS.set(ss, -0.5, 0);
        this.propKind[P] = 'cigarette';
        this.propRot[P].set(0, -sp * 0.5, 0);
        break;
      }
      case 'cook':
        hP.set(sp * 0.1 + 0.07 * Math.cos(t * 5), 0.27, 0.36 + 0.07 * Math.sin(t * 5));
        hS.set(ss * 0.17, 0.22, 0.33);
        G.lean += 0.08;
        G.hPitch += 0.18;
        this.propKind[P] = 'spoon';
        this.propRot[P].set(0.25, 0, 0);
        break;
      case 'clean':
        hP.set(sp * 0.05 + 0.2 * Math.sin(t * 4), 0.3 + 0.05 * Math.cos(t * 8), 0.42);
        onHip(S);
        G.lean += 0.15;
        G.hPitch += 0.2;
        G.sYaw += 0.15 * Math.sin(t * 4);
        this.propKind[P] = 'duster';
        this.propRot[P].set(0.7, 0, 0);
        break;
      case 'piano':
        for (let i = 0; i < 2; i++) {
          const b = Math.max(0, Math.sin(t * 11 + i * 1.7) + 0.6 * Math.sin(t * 7.3 + i));
          this.handT[i].set(SIDE[i] * (0.13 + 0.035 * Math.sin(t * 1.3 + i * 2)), 0.27 + 0.025 * b, 0.37);
          this.elbowT[i].set(SIDE[i] * 0.8, -1, -0.2);
        }
        G.sRoll += 0.07 * Math.sin(t * 2.2);
        G.hPitch += 0.15 + 0.05 * Math.sin(t * 4.4);
        break;
      case 'radio':
        hP.set(sp * 0.14, 0.66, 0.13);
        eP.set(sp, -0.6, 0);
        G.hRoll += -sp * 0.15;
        this.propKind[P] = 'walkie';
        talking = true;
        break;
      case 'point':
        hP.set(sp * 0.17, 0.56, 0.47);
        eP.set(sp * 0.3, -1, 0);
        G.sYaw += -sp * 0.22;
        break;
      case 'clap': {
        const x = 0.025 + 0.1 * (0.5 + 0.5 * Math.sin(t * 14));
        for (let i = 0; i < 2; i++) {
          this.handT[i].set(SIDE[i] * x, 0.32, 0.33);
          this.elbowT[i].set(SIDE[i], -1, 0);
        }
        break;
      }
      case 'wave':
        hP.set(sp * (0.43 + 0.08 * Math.sin(t * 10)), 0.8, 0.12);
        eP.set(sp, -0.8, -0.2);
        G.hRoll += sp * 0.08;
        break;
      case 'dance': {
        const beat = t * 2.2 + seedT;
        const sb2 = Math.sin(PI * beat);
        G.hipX += 0.05 * sb2;
        G.pRoll += 0.08 * sb2;
        G.sRoll -= 0.1 * sb2;
        G.hipY -= 0.03 * Math.abs(sb2);
        G.hPitch += 0.1 * Math.sin(TAU * beat);
        for (let i = 0; i < 2; i++) {
          this.handT[i].set(SIDE[i] * 0.32, 0.5 + 0.32 * sb2 * SIDE[i], 0.18);
          this.elbowT[i].set(SIDE[i], -0.4, -0.3);
          kick[i] = 0.06 * Math.max(0, Math.sin(PI * beat + i * PI));
        }
        if (this.spinT < 0 && frac(beat / 8) < 0.02) this.spinT = 0;
        break;
      }
      case 'type':
        for (let i = 0; i < 2; i++) {
          this.handT[i].set(SIDE[i] * 0.12, 0.23 + 0.022 * Math.max(0, Math.sin(t * 19 + i * 2.1)), 0.34);
          this.elbowT[i].set(SIDE[i] * 0.8, -1, -0.2);
        }
        G.hPitch += 0.2;
        break;
      case 'read':
        showBook = true;
        for (let i = 0; i < 2; i++) {
          this.handT[i].set(SIDE[i] * 0.12, 0.31, 0.3);
          this.elbowT[i].set(SIDE[i] * 0.7, -1, -0.2);
        }
        G.hPitch += 0.38;
        break;
      case 'work': {
        const u = frac(t * 1.6 + this.seed);
        const hh = u < 0.6 ? sstep(0, 0.6, u) : 1 - sstep(0.6, 0.72, u);
        hP.set(sp * 0.12, 0.22 + 0.25 * hh, 0.36 - 0.08 * hh);
        hS.set(ss * 0.05, 0.17, 0.38);
        G.lean += 0.15;
        G.hPitch += 0.3;
        this.propKind[P] = 'hammer';
        this.propRot[P].set(lerp(1.4, -0.3, hh), 0, 0);
        break;
      }
      case 'search':
        G.hYaw += 0.95 * Math.sin(t * 1.7);
        G.sYaw += 0.25 * Math.sin(t * 1.7);
        G.lean += 0.1;
        G.hPitch += 0.1;
        for (let i = 0; i < 2; i++) this.handT[i].set(SIDE[i] * 0.37, 0.22, 0.22);
        break;
      case 'reach':
        hP.set(sp * 0.14, 0.44, 0.47);
        eP.set(sp * 0.3, -1, 0);
        hS.set(ss * 0.3, 0.1, -0.08);
        G.lean += 0.16;
        break;
      case 'shrug': {
        const sh = pulse(frac(t / 1.6 + this.seed), 0.1, 0.55, 0.12);
        for (let i = 0; i < 2; i++) {
          this.handT[i].set(SIDE[i] * (0.3 + 0.08 * sh), 0.12 + 0.07 * sh, 0.2);
          this.elbowT[i].set(SIDE[i] * 0.3, -1, -0.5);
        }
        G.shrug = 0.05 * sh;
        G.hRoll += 0.15 * sh;
        break;
      }
      case 'panic':
        for (let i = 0; i < 2; i++) {
          this.handT[i].set(SIDE[i] * (0.3 + 0.08 * Math.sin(t * 15 + i * 2)), 0.92 + 0.09 * Math.sin(t * 17 + i * 3), 0.06 + 0.1 * Math.sin(t * 13 + i));
          this.elbowT[i].set(SIDE[i], 0.2, -0.3);
        }
        G.hYaw += 0.35 * Math.sin(t * 9);
        shake = Math.max(shake, 0.2);
        break;
      case 'stretch': {
        const up = pulse(frac(t / 4 + this.seed), 0.1, 0.7, 0.15);
        for (let i = 0; i < 2; i++) {
          this.handT[i].set(SIDE[i] * (0.12 + 0.06 * (1 - up)), lerp(0.4, 1.02, up), lerp(0.2, 0.0, up));
          this.elbowT[i].set(SIDE[i], 0, -0.3);
        }
        G.lean -= 0.18 * up;
        G.hPitch -= 0.25 * up;
        yawn = up;
        break;
      }
      case 'paint':
        hP.set(sp * 0.12 + 0.12 * Math.sin(t * 2.6), 0.42 + 0.1 * Math.sin(t * 5.2), 0.45);
        hS.set(ss * 0.25, 0.22, 0.22);
        G.hRoll += 0.1 * Math.sin(t * 0.7);
        this.propKind[P] = 'brush';
        this.propRot[P].set(0.9, 0, 0);
        break;
      case 'lockpick':
        if (!seated) {
          G.hipY = Math.min(G.hipY, HIP_Y - 0.14);
          G.lean += 0.27;
          G.hPitch += 0.05;
        }
        hP.set(sp * 0.05 + 0.012 * Math.sin(t * 23), 0.42, 0.4);
        hS.set(ss * 0.06, 0.4 + 0.01 * Math.sin(t * 17), 0.4);
        eP.set(sp * 0.7, -1, 0);
        eS.set(ss * 0.7, -1, 0);
        this.propKind[P] = 'lockpick';
        break;
      case 'grab':
        for (let i = 0; i < 2; i++) this.handT[i].set(SIDE[i] * 0.14, 0.32, 0.46);
        G.lean += 0.18;
        break;
      case 'knock': {
        const u = frac(t / 1.6 + this.seed);
        const kk = u < 0.6 ? 0.5 + 0.5 * Math.cos((u / 0.6) * 3 * TAU) : 1;
        hP.set(sp * 0.16, 0.55, 0.36 + 0.07 * (1 - kk));
        eP.set(sp * 0.5, -1, 0);
        onHip(S);
        break;
      }
      case 'think':
        hP.set(sp * 0.03, 0.555 + 0.01 * Math.sin(t * 3), 0.25);
        eP.set(sp * 0.3, -1, 0.2);
        hS.set(sp * 0.1, 0.24, 0.2);
        eS.set(ss, -0.5, 0);
        G.hRoll += -sp * 0.12;
        G.hPitch -= 0.12;
        G.hYaw += 0.2 * Math.sin(t * 0.6);
        break;
      case 'facepalm':
        hP.set(sp * 0.02, 0.66, 0.29);
        eP.set(sp * 0.5, -1, 0);
        onHip(S);
        G.hPitch += 0.35;
        G.hYaw += 0.22 * Math.sin(t * 3);
        break;
      default:
        break;
    }
    // occupied right hand
    if (flashOn) {
      this.handT[1].set(-0.17, 0.33 + 0.02 * swing * this.wGait, 0.42);
      this.elbowT[1].set(-0.6, -1, 0);
      if (this.propKind[1] !== 'none') this.propKind[1] = 'none';
    } else if (carry === 'tray' || action === 'serve') {
      this.handT[1].set(-0.4, 0.6, 0.14);
      this.elbowT[1].set(-1, -0.7, -0.3);
      this.propKind[1] = 'none';
    }
    if (TWO_HAND.has(carry)) {
      const w = carry === 'box' ? 0.17 : 0.14;
      const yy = carry === 'box' ? 0.24 : 0.21;
      const bobH = 0.02 * Math.sin(TAU * 2 * phase) * this.wGait;
      for (let i = 0; i < 2; i++) {
        this.handT[i].set(SIDE[i] * w, yy + bobH, carry === 'generic' ? 0.34 : 0.31);
        this.elbowT[i].set(SIDE[i] * 0.7, -1, -0.2);
        this.propKind[i] = 'none';
      }
      showBook = false;
    }

    // feet targets (pelvis space)
    if (groundFeet) {
      for (let i = 0; i < 2; i++) this.footT[i].set(SIDE[i] * feetX, ANKLE_Y - G.hipY + kick[i], feetZ);
    }
    if (snK > 0.01) for (let i = 0; i < 2; i++) this.kneeT[i].set(SIDE[i] * 0.35, 0, 1);

    // head yaw input
    G.hYaw += clamp(fin(s.headYaw), -1.3, 1.3);
    G.hPitch += clamp(fin(s.headPitch), -0.8, 0.8);

    // ---- damping ------------------------------------------------------------------------------
    const C = this.c;
    if (this.fresh) {
      Object.assign(C, G);
      for (let i = 0; i < 2; i++) {
        this.footC[i].copy(this.footT[i]);
        this.kneeC[i].copy(this.kneeT[i]);
        this.handC[i].copy(this.handT[i]);
        this.elbowC[i].copy(this.elbowT[i]);
      }
      this.fresh = false;
    } else {
      for (const n of CH_NAMES) C[n] += (G[n] - C[n]) * kf(CH_RATE[n], dt);
      const kb = kf(7, dt);
      const kh = kf(13, dt);
      for (let i = 0; i < 2; i++) {
        this.footC[i].lerp(this.footT[i], kb);
        this.kneeC[i].lerp(this.kneeT[i], kb);
        this.handC[i].lerp(this.handT[i], kh);
        this.elbowC[i].lerp(this.elbowT[i], kh);
      }
    }

    // ---- hop / shake / spin -----------------------------------------------------------------
    const hop = !!s.hop;
    if (hop && !this.prevHop) this.hopT = 0;
    this.prevHop = hop;
    let hopY = 0;
    let sy = 1;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const T1 = 0.26;
      const T2 = 0.12;
      if (this.hopT < T1) {
        const u = this.hopT / T1;
        hopY = 0.18 * 4 * u * (1 - u);
        sy = 1 + 0.14 * Math.sin(PI * u);
      } else if (this.hopT < T1 + T2) {
        sy = 1 - 0.16 * Math.sin((PI * (this.hopT - T1)) / T2);
      } else this.hopT = -1;
    }
    const jx = shake > 0 ? (Math.random() - 0.5) * 0.03 * shake : 0;
    const jz = shake > 0 ? (Math.random() - 0.5) * 0.03 * shake : 0;
    this.bounce.position.set(jx, hopY / h, jz);
    const sxz = 1 / Math.sqrt(sy);
    this.bounce.scale.set(sxz, sy, sxz);
    let spin = 0;
    if (this.spinT >= 0) {
      this.spinT += dt;
      const u = this.spinT / 0.7;
      spin = TAU * sstep(0, 1, u);
      if (u >= 1) this.spinT = action === 'dance' ? -2 : -1;
    }
    if (this.spinT < -1.5 && action === 'dance' && frac((t * 2.2 + seedT) / 8) > 0.5) this.spinT = -1;
    if (action !== 'dance' && this.spinT >= 0) this.spinT = -1;

    // ---- apply skeleton ---------------------------------------------------------------------
    const pelvisY = C.hipY + bob;
    this.pelvis.position.set(C.hipX, pelvisY, C.hipZ);
    this.pelvis.rotation.set(C.pPitch, spin, C.pRoll);
    this.spine.rotation.set(C.lean, C.sYaw + 0.2 * C.hYaw, C.sRoll);
    const br = 1 + 0.012 * C.breathe * Math.sin(t * (sleeping ? 1.6 : 2.4) + seedT);
    this.torsoG.scale.y = br;
    if (this.skirt.visible) {
      // seated in a skirt: show fabric-coloured thighs so the lap reads as dress, not bare knees
      const lap = !lying && pelvisY < 0.52;
      this.thighs[0].visible = lap;
      this.thighs[1].visible = lap;
      const bb = this.skirt.geometry.boundingBox;
      const depth = bb ? Math.max(0.1, -bb.min.y) : 0.4;
      this.skirtG.scale.y = lying ? 1 : clamp((pelvisY - 0.07) / depth, 0.38, 1);
      this.skirtG.rotation.set(C.lean * 0.25, 0, 0.05 * Math.sin(TAU * phase) * this.wGait);
    }
    this.neck.position.y = NECK_Y + C.shrug * 0.4;
    this.neck.rotation.set(C.hPitch, 0.8 * C.hYaw, C.hRoll + (shake > 0 ? (Math.random() - 0.5) * 0.12 * shake : 0));

    const gx = 1 + (this.girth - 1) * 0.9;
    for (let i = 0; i < 2; i++) {
      // arms
      const sh = this.shoulders[i];
      sh.position.set(SIDE[i] * SH_X * gx, SH_Y + C.shrug, 0);
      const bend = solveIK(sh.position, this.handC[i], this.elbowC[i], UARM, FARM, sh.quaternion);
      this.elbows[i].rotation.set(-bend, 0, 0);
      // legs: blend posed feet with the gait cycle
      _v1.copy(this.footC[i]);
      if (this.wGait > 0.001) {
        _v2.copy(this.gaitFoot[i]);
        _v2.y -= pelvisY;
        _v1.lerp(_v2, this.wGait);
      }
      const hp = this.hips[i];
      const kb = solveIK(hp.position, _v1, this.kneeC[i], THIGH, SHIN, hp.quaternion);
      this.knees[i].rotation.set(-kb, 0, 0);
      this.ankles[i].quaternion.copy(hp.quaternion).multiply(this.knees[i].quaternion).invert();
      // hand prop orientation (spine space)
      const pk = this.propKind[i];
      this.propMesh[i].visible = pk !== 'none';
      if (pk !== 'none') {
        this.propMesh[i].geometry = propGeo(pk);
        this.propMesh[i].material = this.mat(PROPS[pk].color);
        this.orientInHand(i, this.propG[i], this.propRot[i]);
      }
    }
    // right hand: flashlight + held items
    this.flashMesh.visible = flashOn;
    if (flashOn) this.orientInHand(1, this.flashG, _eu.set(0.12, 0, 0));
    if (carry === 'bottle' || carry === 'wrench') this.orientInHand(1, this.holdG, _eu.set(carry === 'wrench' ? 0.25 : 0, 0, 0));
    this.bookMesh.visible = showBook;
    const wantItem: Carry = action === 'serve' && carry === 'none' ? 'tray' : carry;
    if (wantItem !== this.shownItem) {
      const old = this.item(this.shownItem);
      if (old) old.visible = false;
      const nw = this.item(wantItem);
      if (nw) nw.visible = true;
      this.shownItem = wantItem;
    }

    // ponytail
    if (this.pony.visible) {
      this.ponyPivot.rotation.set(
        0.5 - C.hPitch - C.lean * 0.8 + this.wGait * (0.1 + 0.12 * runK) * Math.sin(TAU * 2 * phase) + 0.04 * Math.sin(t * 1.8),
        0,
        this.wGait * 0.14 * Math.sin(TAU * phase) - C.hRoll * 0.8,
      );
    }

    this.updateFace(dt, s.expression, sleeping, talking, chewing, yawn);
  }

  /** orient a group inside hand i so that it has rotation `e` in spine space */
  private orientInHand(i: number, grp: THREE.Object3D, e: THREE.Euler): void {
    _q1.copy(this.shoulders[i].quaternion).multiply(this.elbows[i].quaternion).invert();
    _q2.setFromEuler(e);
    grp.quaternion.copy(_q1.multiply(_q2));
  }

  private updateFace(dt: number, expr: Expression, sleeping: boolean, talking: boolean, chewing: boolean, yawn: number): void {
    let ex: Expression = FACES[expr] ? expr : 'neutral';
    if (sleeping && (ex === 'neutral' || ex === 'sleepy' || ex === 'happy' || ex === 'smug')) ex = 'sleepy';
    const cfg = FACES[ex];
    const f = this.face;
    const k = kf(14, dt);
    f.bLy += (cfg.bLy - f.bLy) * k;
    f.bRy += (cfg.bRy - f.bRy) * k;
    f.bLt += (cfg.bLt - f.bLt) * k;
    f.bRt += (cfg.bRt - f.bRt) * k;
    f.eyeSY += (cfg.eyeSY - f.eyeSY) * k;

    // eyes + blink
    if (this.eyeKind !== cfg.eye) {
      this.eyeKind = cfg.eye;
      this.eyes.geometry = eyesGeo(cfg.eye);
    }
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkLeft = 0.13;
      this.blinkIn = 2 + Math.random() * 3.5;
    }
    let blink = 1;
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
      if (cfg.eye !== 'arc' && cfg.eyeSY > 0.3) blink = 0.12;
    }
    this.eyes.scale.set(1, Math.max(0.08, f.eyeSY * blink), 1);

    // brows
    for (let i = 0; i < 2; i++) {
      const sx = SIDE[i];
      const by = i === 0 ? f.bLy : f.bRy;
      const tilt = i === 0 ? f.bLt : f.bRt;
      const o = onFace(sx * 0.09, BROW_Y + by, FACE_R + 0.014);
      const b = this.brows[i];
      b.position.set(o.p[0], o.p[1], o.p[2]);
      b.rotation.set(o.rx, o.ry, sx * tilt);
    }

    // mouth
    let mk: MouthKind = cfg.mouth;
    if (sleeping && ex === 'sleepy') mk = frac(this.t / 3.2) < 0.5 ? 'small_o' : 'flat';
    if (talking && frac(this.t * 4.3) < 0.45) mk = mk === 'smile' ? 'o' : 'small_o';
    if (chewing) mk = frac(this.t * 3) < 0.5 ? 'flat' : 'small_o';
    if (yawn > 0.5) mk = 'o';
    if (mk !== this.mouthKind) {
      this.mouthKind = mk;
      this.mouth.geometry = mouthGeo(mk);
    }
    if (cfg.mx !== this.mouthX) {
      this.mouthX = cfg.mx;
      const beard = this.app.facial === 'beard';
      const tache = this.app.facial === 'mustache';
      const o = onFace(cfg.mx, MOUTH_Y - (tache ? 0.012 : 0), FACE_R + (beard ? 0.026 : 0.004));
      this.mouth.position.set(o.p[0], o.p[1], o.p[2]);
      this.mouth.rotation.set(o.rx, o.ry, 0);
    }

    // sick tint
    if (cfg.tint !== this.tinted) {
      this.tinted = cfg.tint;
      const skin = validHex(this.app.skin, '#f1c7a5');
      this.headMesh.material = this.mat(cfg.tint ? mixHex(skin, '#8fd16a', 0.5) : skin);
    }
  }
}
