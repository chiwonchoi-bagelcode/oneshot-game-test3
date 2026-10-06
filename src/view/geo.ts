// Tiny helper to merge many coloured primitives into one geometry (one draw call).
import * as THREE from 'three';

const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const T = {
  box: ni(new THREE.BoxGeometry(1, 1, 1)),
  cyl: ni(new THREE.CylinderGeometry(1, 1, 1, 14)),
  cyl6: ni(new THREE.CylinderGeometry(1, 1, 1, 6)),
  cyl8: ni(new THREE.CylinderGeometry(1, 1, 1, 8)),
  sphere: ni(new THREE.SphereGeometry(1, 12, 8)),
  sphereLo: ni(new THREE.IcosahedronGeometry(1, 1)),
  sphereTiny: ni(new THREE.IcosahedronGeometry(1, 0)),
  cone: ni(new THREE.ConeGeometry(1, 1, 14)),
  cone4: ni(new THREE.ConeGeometry(1, 1, 4)),
  cone8: ni(new THREE.ConeGeometry(1, 1, 8)),
  torus: ni(new THREE.TorusGeometry(1, 0.12, 6, 20)),
  plane: ni(new THREE.PlaneGeometry(1, 1)),
};
export type Prim = keyof typeof T;

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();
const nm = new THREE.Matrix3();
const c = new THREE.Color();

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];

  add(prim: Prim, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string | THREE.Color, ry = 0, rx = 0, rz = 0) {
    // Small decorative spheres don't need many triangles.
    if (prim === 'sphere') {
      const m = Math.max(sx, sy, sz);
      if (m < 0.1) prim = 'sphereTiny';
      else if (m < 0.3) prim = 'sphereLo';
    }
    const g = T[prim];
    e.set(rx, ry, rz, 'YXZ');
    q.setFromEuler(e);
    v.set(x, y, z);
    s.set(sx, sy, sz);
    m4.compose(v, q, s);
    nm.getNormalMatrix(m4);
    if (typeof color === 'string') c.set(color);
    else c.copy(color);
    const p = g.attributes.position.array as Float32Array;
    const n = g.attributes.normal.array as Float32Array;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) {
      tmp.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m4);
      this.pos.push(tmp.x, tmp.y, tmp.z);
      tmp.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize();
      this.nor.push(tmp.x, tmp.y, tmp.z);
      this.col.push(c.r, c.g, c.b);
    }
  }

  /** Axis aligned box from min corner/size (y from base). */
  box(cx: number, by: number, cz: number, sx: number, sy: number, sz: number, color: string | THREE.Color, ry = 0) {
    this.add('box', cx, by + sy / 2, cz, sx, sy, sz, color, ry);
  }
  cyl(cx: number, by: number, cz: number, r: number, h: number, color: string | THREE.Color, prim: Prim = 'cyl') {
    this.add(prim, cx, by + h / 2, cz, r, h, r, color);
  }
  ball(cx: number, cy: number, cz: number, r: number, color: string | THREE.Color, sy = 1, prim: Prim = 'sphere') {
    this.add(prim, cx, cy, cz, r, r * sy, r, color);
  }
  /** Flat quad on the ground (y up), axis aligned. */
  quad(x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.Color) {
    this.pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    for (let i = 0; i < 6; i++) {
      this.nor.push(0, 1, 0);
      this.col.push(color.r, color.g, color.b);
    }
  }

  get empty() {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Convert an sRGB hex colour to a linear THREE.Color (vertex colours are linear). */
export function col(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
