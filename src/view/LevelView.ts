// Static mansion geometry: floors, walls (with cut-away), windows, doors, props.
import * as THREE from 'three';
import type { V2 } from '../core/math';
import type { DoorState, Grid, WindowState } from '../sim/Grid';
import { BARRIERS, FURNITURE, LAMPS, PATCHES } from '../sim/level/layout';
import { E_WALL, E_WINDOW, type Floor, type FurnDef } from '../sim/level/types';
import type { World } from '../sim/World';
import { col, GeoBuilder } from './geo';
import type { Mats } from './materials';

export const WALL_H = 2.7;
const WALL_T = 0.2;
const CUT_H = 0.42;

interface WallInst {
  x: number;
  z: number;
  len: number;
  axis: 'h' | 'v';
  y0: number;
  y1: number;
  /** Lowered height factor (current). */
  cur: number;
  target: number;
  exterior: boolean;
}

const FLOOR_COLORS: Record<Floor, [string, string]> = {
  grass: ['#a6c477', '#9dbd6e'],
  gravel: ['#e4d7ba', '#dccfae'],
  asphalt: ['#5f6373', '#5a5e6d'],
  sidewalk: ['#cdc7bd', '#c3bdb2'],
  concrete: ['#c2bdb2', '#b9b4a8'],
  stone: ['#dacdb6', '#cfc1a8'],
  wood: ['#c9a074', '#c0966a'],
  parquet: ['#d6a675', '#c9966a'],
  marble: ['#efebe4', '#e3ded6'],
  checker: ['#f1ece2', '#3f3d48'],
  carpet_red: ['#a9483f', '#a2443b'],
  carpet_green: ['#628d5e', '#5d8659'],
  carpet_purple: ['#6e5c90', '#69578a'],
  tile_blue: ['#d2e6ec', '#f5f8f6'],
  tile_white: ['#f0f3f1', '#e1e6e4'],
  tile_mint: ['#cfeadf', '#e8f6ef'],
  lino: ['#bcc7b4', '#b5c0ad'],
  terracotta: ['#dc977d', '#d0896e'],
  water: ['#7cb7c9', '#7cb7c9'],
  deck: ['#ad7f55', '#a27650'],
};

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class LevelView {
  readonly group = new THREE.Group();
  private walls: WallInst[] = [];
  private wallMesh!: THREE.InstancedMesh;
  private capMesh!: THREE.InstancedMesh;
  private doorPanels: { door: DoorState; pivots: THREE.Object3D[]; base: number[]; cut: number }[] = [];
  private windowPanes: { win: WindowState; mesh: THREE.Mesh; base: THREE.Vector3; cut: number }[] = [];
  private lampGlows: { circuit: 'A' | 'B' | 'S'; mesh: THREE.Mesh }[] = [];
  private stringBulbs: THREE.Mesh | null = null;
  private monitors: THREE.Mesh | null = null;
  private shedRoof: THREE.Object3D | null = null;
  private water: THREE.Mesh[] = [];
  private jukeLights: THREE.Mesh | null = null;
  private caseGlass: THREE.Mesh | null = null;
  private caseLamp: THREE.Mesh | null = null;
  private fireGlow: THREE.Mesh | null = null;
  private dummy = new THREE.Object3D();
  private t = 0;

  constructor(private grid: Grid, private mats: Mats) {
    this.buildGround();
    this.buildFloors();
    this.buildWalls();
    this.buildBarriers();
    this.buildFurniture();
    this.buildLamps();
    this.buildDoors();
    this.buildWindows();
    this.buildOuterDecor();
  }

  // ---------------------------------------------------------------------------
  private buildGround() {
    const g = new THREE.PlaneGeometry(400, 400);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.mats.lit('#8fae66'));
    m.position.set(36, -0.03, 33);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private buildFloors() {
    const gb = new GeoBuilder();
    const out = new GeoBuilder();
    const G = this.grid;
    const ca = new THREE.Color();
    for (let z = 0; z < G.h; z++) {
      for (let x = 0; x < G.w; x++) {
        const ri = G.room[x + z * G.w];
        if (ri < 0) continue;
        const r = G.rooms[ri];
        const f = r.floor;
        if (f === 'water') continue;
        const [c0, c1] = FLOOR_COLORS[f];
        const y = r.indoor ? 0.02 : 0;
        const target = r.indoor ? gb : out;
        if (f === 'checker' || f === 'marble' || f === 'terracotta') {
          ca.set((x + z) % 2 === 0 ? c0 : c1);
          target.quad(x, z, x + 1, z + 1, y, ca);
        } else if (f === 'tile_blue' || f === 'tile_white' || f === 'tile_mint') {
          for (let i = 0; i < 2; i++)
            for (let j = 0; j < 2; j++) {
              ca.set((i + j) % 2 === 0 ? c0 : c1);
              target.quad(x + i * 0.5, z + j * 0.5, x + i * 0.5 + 0.5, z + j * 0.5 + 0.5, y, ca);
            }
        } else if (f === 'parquet') {
          for (let i = 0; i < 2; i++)
            for (let j = 0; j < 2; j++) {
              ca.set((i + j + x + z) % 2 === 0 ? c0 : c1);
              const xx = x + i * 0.5;
              const zz = z + j * 0.5;
              target.quad(xx, zz, xx + 0.5, zz + 0.5, y, ca);
            }
        } else if (f === 'wood' || f === 'deck') {
          for (let i = 0; i < 4; i++) {
            ca.set(hash(x * 4 + i, Math.floor((z + (i % 2) * 0.5) / 2)) > 0.5 ? c0 : c1);
            if (f === 'deck') target.quad(x, z + i * 0.25, x + 1, z + i * 0.25 + 0.25, y + 0.15, ca);
            else target.quad(x + i * 0.25, z, x + i * 0.25 + 0.25, z + 1, y, ca);
          }
        } else if (f === 'grass') {
          ca.set(Math.floor(x / 2) % 2 === 0 ? c0 : c1);
          const h = hash(x, z);
          ca.offsetHSL(0, 0, (h - 0.5) * 0.025);
          target.quad(x, z, x + 1, z + 1, y, ca);
        } else {
          ca.set(hash(x, z) > 0.5 ? c0 : c1);
          target.quad(x, z, x + 1, z + 1, y, ca);
        }
      }
    }
    for (const p of PATCHES) {
      const [x0, z0, x1, z1] = p.rect;
      const [c0, c1] = FLOOR_COLORS[p.floor];
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) {
          const ri = G.room[x + z * G.w];
          if (ri >= 0 && G.rooms[ri].indoor) continue;
          ca.set(p.floor === 'stone' ? ((x + z) % 2 === 0 ? c0 : c1) : hash(x + 3, z + 7) > 0.5 ? c0 : c1);
          out.quad(x, z, x + 1, z + 1, 0.012, ca);
        }
    }
    // Rugs and stage are drawn with furniture.
    const m1 = new THREE.Mesh(gb.build(), this.mats.vertex);
    m1.receiveShadow = true;
    const m2 = new THREE.Mesh(out.build(), this.mats.vertex);
    m2.receiveShadow = true;
    this.group.add(m1, m2);

    // Lake & dock water
    const wg = new THREE.PlaneGeometry(28 + 60, 4 + 40);
    wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, this.mats.lm.patch(new THREE.MeshLambertMaterial({ color: '#7fb8cc', transparent: true, opacity: 0.92 })));
    water.position.set(44 + 44, -0.18, 2 - 20);
    water.receiveShadow = true;
    this.group.add(water);
    this.water.push(water);
    // Lake bank
    const bank = new GeoBuilder();
    bank.box(58, -0.4, 4.1, 28, 0.42, 0.25, '#b8a98a');
    bank.box(44.1, -0.4, -6, 0.25, 0.42, 20, '#b8a98a');
    // Dock
    for (let z = 0; z < 4; z += 0.5) bank.box(61, 0.08, z + 0.25, 2, 0.1, 0.44, z % 1 === 0 ? '#a77a50' : '#9c7049');
    for (const [x, z] of [
      [60.1, 0.3],
      [61.9, 0.3],
      [60.1, 2],
      [61.9, 2],
      [60.1, 3.7],
      [61.9, 3.7],
    ])
      bank.cyl(x, -0.6, z, 0.12, 1.0, '#7a5638');
    const bm = new THREE.Mesh(bank.build(), this.mats.vertex);
    bm.castShadow = true;
    bm.receiveShadow = true;
    this.group.add(bm);
  }

  // ---------------------------------------------------------------------------
  private addWall(x: number, z: number, len: number, axis: 'h' | 'v', y0: number, y1: number, exterior: boolean) {
    this.walls.push({ x, z, len, axis, y0, y1, cur: 1, target: 1, exterior });
  }

  private buildWalls() {
    const G = this.grid;
    const isIndoor = (x: number, z: number) => {
      if (!G.inBounds(x, z)) return false;
      const r = G.room[x + z * G.w];
      return r >= 0 && G.rooms[r].indoor;
    };
    // Horizontal edges
    for (let z = 0; z <= G.h; z++) {
      for (let x = 0; x < G.w; x++) {
        const k = G.hKind(x, z);
        if (k === 0 || k > 3) continue;
        const ext = isIndoor(x, z - 1) !== isIndoor(x, z);
        if (k === E_WALL) this.addWall(x + 0.5, z, 1, 'h', 0, WALL_H, ext);
        else if (k === E_WINDOW) {
          const w = G.hWindow(x, z)!;
          const sill = w.def.fixed ? 0.35 : 0.9;
          this.addWall(x + 0.5, z, 1, 'h', 0, sill, ext);
          this.addWall(x + 0.5, z, 1, 'h', 2.3, WALL_H, ext);
        } else {
          const d = G.hDoor(x, z)!;
          if (!d.def.gate) this.addWall(x + 0.5, z, 1, 'h', 2.25, WALL_H, ext);
        }
      }
    }
    for (let z = 0; z < G.h; z++) {
      for (let x = 0; x <= G.w; x++) {
        const k = G.vKind(x, z);
        if (k === 0 || k > 3) continue;
        const ext = isIndoor(x - 1, z) !== isIndoor(x, z);
        if (k === E_WALL) this.addWall(x, z + 0.5, 1, 'v', 0, WALL_H, ext);
        else if (k === E_WINDOW) {
          const w = G.vWindow(x, z)!;
          const sill = w.def.fixed ? 0.35 : 0.9;
          this.addWall(x, z + 0.5, 1, 'v', 0, sill, ext);
          this.addWall(x, z + 0.5, 1, 'v', 2.3, WALL_H, ext);
        } else {
          const d = G.vDoor(x, z)!;
          if (!d.def.gate) this.addWall(x, z + 0.5, 1, 'v', 2.25, WALL_H, ext);
        }
      }
    }
    // Corner posts where walls meet (avoid gaps) — added as tiny wall pieces.
    const posts = new Set<string>();
    for (let z = 0; z <= G.h; z++) {
      for (let x = 0; x <= G.w; x++) {
        const around = [G.hKind(x - 1, z), G.hKind(x, z), G.vKind(x, z - 1), G.vKind(x, z)].filter((k) => k === 1 || k === 2 || k === 3);
        const hasV = [G.vKind(x, z - 1), G.vKind(x, z)].some((k) => k >= 1 && k <= 3);
        const hasH = [G.hKind(x - 1, z), G.hKind(x, z)].some((k) => k >= 1 && k <= 3);
        if (around.length >= 2 && hasV && hasH) posts.add(`${x},${z}`);
      }
    }
    for (const p of posts) {
      const [x, z] = p.split(',').map(Number);
      const ext = isIndoor(x - 1, z - 1) !== isIndoor(x, z) || isIndoor(x - 1, z) !== isIndoor(x, z - 1);
      this.walls.push({ x, z, len: WALL_T, axis: 'h', y0: 0, y1: WALL_H, cur: 1, target: 1, exterior: ext });
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.wallMesh = new THREE.InstancedMesh(geo, this.mats.lit('#ffffff'), this.walls.length);
    this.capMesh = new THREE.InstancedMesh(geo, this.mats.lm.patch(new THREE.MeshLambertMaterial({ color: '#6f6160' }), 0), this.walls.length);
    const cIn = new THREE.Color('#f2e9d8');
    const cExt = new THREE.Color('#ecc8b2');
    this.walls.forEach((w, i) => {
      this.wallMesh.setColorAt(i, w.exterior ? cExt : cIn);
    });
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;
    this.capMesh.castShadow = false;
    this.writeWalls(true);
    this.group.add(this.wallMesh, this.capMesh);
  }

  private writeWalls(all = false) {
    const d = this.dummy;
    let changed = false;
    this.walls.forEach((w, i) => {
      if (!all && Math.abs(w.cur - w.target) < 0.001) return;
      changed = true;
      const top = w.y0 >= CUT_H ? Math.max(CUT_H, w.y0 + (w.y1 - w.y0) * w.cur) : CUT_H + (w.y1 - CUT_H) * w.cur;
      const visible = !(w.y0 >= CUT_H && w.cur < 0.05);
      const y0 = Math.min(w.y0, top);
      const h = Math.max(0.001, Math.min(w.y1, top) - y0);
      const sx = w.axis === 'h' ? w.len : WALL_T;
      const sz = w.axis === 'h' ? WALL_T : w.len;
      d.position.set(w.x, y0 + h / 2, w.z);
      d.scale.set(visible ? sx : 0.0001, visible ? h : 0.0001, visible ? sz : 0.0001);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.wallMesh.setMatrixAt(i, d.matrix);
      // Cap: dark section line on top of the (cut) wall.
      const capTop = Math.min(w.y1, top);
      d.position.set(w.x, capTop + 0.015, w.z);
      d.scale.set(visible ? sx + 0.01 : 0.0001, 0.03, visible ? sz + 0.01 : 0.0001);
      d.updateMatrix();
      this.capMesh.setMatrixAt(i, d.matrix);
    });
    if (changed || all) {
      this.wallMesh.instanceMatrix.needsUpdate = true;
      this.capMesh.instanceMatrix.needsUpdate = true;
      if (this.wallMesh.instanceColor) this.wallMesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------------
  private buildBarriers() {
    const gb = new GeoBuilder();
    for (const b of BARRIERS) {
      for (let t = b.from; t < b.to; t++) {
        const cx = b.axis === 'h' ? t + 0.5 : b.at;
        const cz = b.axis === 'h' ? b.at : t + 0.5;
        if (b.kind === 'hedge') {
          const sx = b.axis === 'h' ? 1.02 : 0.7;
          const sz = b.axis === 'h' ? 0.7 : 1.02;
          gb.box(cx, 0, cz, sx, 1.35, sz, '#5f8d50');
          gb.add('sphere', cx, 1.35, cz, sx * 0.55, 0.22, sz * 0.55, '#679a57');
        } else if (b.kind === 'fence') {
          gb.box(cx, 0, cz, b.axis === 'h' ? 1 : 0.06, 0.08, b.axis === 'h' ? 0.06 : 1, '#f4efe6');
          gb.box(cx, 0.55, cz, b.axis === 'h' ? 1 : 0.06, 0.07, b.axis === 'h' ? 0.06 : 1, '#f4efe6');
          for (let i = 0; i < 3; i++) {
            const o = -0.33 + i * 0.33;
            gb.box(b.axis === 'h' ? cx + o : cx, 0, b.axis === 'h' ? cz : cz + o, 0.08, 0.95, 0.08, '#fbf7ef');
          }
        } else {
          // crawl gap: hedge arch with a hole near the ground
          gb.box(cx, 0.75, cz, 1.02, 0.6, 0.7, '#5f8d50');
          gb.add('sphere', cx, 1.35, cz, 0.56, 0.22, 0.38, '#679a57');
          gb.box(cx - 0.42, 0, cz, 0.18, 0.75, 0.7, '#5a874b');
          gb.box(cx + 0.42, 0, cz, 0.18, 0.75, 0.7, '#5a874b');
        }
      }
    }
    const m = new THREE.Mesh(gb.build(), this.mats.vertex);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ---------------------------------------------------------------------------
  private buildFurniture() {
    const gb = new GeoBuilder();
    const glass = new GeoBuilder();
    const glow: GeoBuilder = new GeoBuilder();
    const monitors = new GeoBuilder();
    for (const f of FURNITURE) this.furn(f, gb, glass, glow, monitors);
    const m = new THREE.Mesh(gb.build(), this.mats.vertex);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    if (!glass.empty) {
      this.caseGlass = new THREE.Mesh(
        glass.build(),
        new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false }),
      );
      this.group.add(this.caseGlass);
    }
    if (!monitors.empty) {
      this.monitors = new THREE.Mesh(monitors.build(), new THREE.MeshBasicMaterial({ color: '#9fe8ff' }));
      this.group.add(this.monitors);
    }
    // Shed roof
    const roof = new GeoBuilder();
    roof.add('cone4', 5, 3.4, 5.5, 4.6, 1.5, 3.8, '#b5654e', Math.PI / 4);
    roof.box(5, 2.7, 5.5, 6.3, 0.1, 5.3, '#8f4f3e');
    this.shedRoof = new THREE.Mesh(roof.build(), this.mats.vertexFlat);
    this.shedRoof.castShadow = true;
    this.group.add(this.shedRoof);
  }

  /** Build one furniture piece. Local frame: facing +z. */
  private furn(f: FurnDef, gb: GeoBuilder, glass: GeoBuilder, glow: GeoBuilder, monitors: GeoBuilder) {
    const rot = f.rot ?? 0;
    const turned = Math.abs(Math.sin(rot)) > 0.7;
    const lw = turned ? f.d : f.w;
    const ld = turned ? f.w : f.d;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const L = (prim: Parameters<GeoBuilder['add']>[0], lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: string, ry = 0, rx = 0, rz = 0, target: GeoBuilder = gb) => {
      const x = f.x + lx * cs + lz * sn;
      const z = f.z - lx * sn + lz * cs;
      target.add(prim, x, ly, z, sx, sy, sz, color, rot + ry, rx, rz);
    };
    const B = (lx: number, by: number, lz: number, sx: number, sy: number, sz: number, color: string, target: GeoBuilder = gb) =>
      L('box', lx, by + sy / 2, lz, sx, sy, sz, color, 0, 0, 0, target);
    const C = (lx: number, by: number, lz: number, r: number, h: number, color: string) => L('cyl', lx, by + h / 2, lz, r, h, r, color);
    const S = (lx: number, y: number, lz: number, r: number, color: string, sy = 1) => L('sphere', lx, y, lz, r, r * sy, r, color);
    const wood = f.color ?? '#8b5a3c';
    const legs = (h: number, inset = 0.08, r = 0.04, color = '#5e3d29') => {
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        C(a * (lw / 2 - inset), 0, b * (ld / 2 - inset), r, h, color);
    };
    switch (f.kind) {
      case 'table_round': {
        C(0, 0, 0, 0.12, 0.7, '#6d4a33');
        L('cyl', 0, 0.42, 0, lw * 0.5, 0.68, lw * 0.5, '#f7f2e7');
        L('cyl', 0, 0.77, 0, lw * 0.52, 0.04, lw * 0.52, '#fbf8f1');
        C(0, 0.79, 0, 0.07, 0.18, '#e8b0c0');
        S(0, 1.0, 0, 0.12, '#f28fa8');
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.6;
          C(Math.sin(a) * lw * 0.32, 0.79, Math.cos(a) * lw * 0.32, 0.1, 0.015, '#ffffff');
        }
        break;
      }
      case 'table_long':
      case 'gift_table':
      case 'punch_table':
      case 'buffet': {
        B(0, 0.05, 0, lw, 0.72, ld, '#f7f2e7');
        B(0, 0.77, 0, lw + 0.06, 0.04, ld + 0.06, '#fbf8f1');
        if (f.kind === 'table_long') {
          for (let i = -1; i <= 1; i++) {
            C(i * lw * 0.3, 0.8, 0, 0.05, 0.3, '#e9d9a6');
            S(i * lw * 0.3, 1.12, 0, 0.04, '#ffd36b');
          }
          for (let i = 0; i < 6; i++) C(-lw / 2 + 0.4 + i * ((lw - 0.8) / 5), 0.8, ld / 2 - 0.25, 0.13, 0.015, '#ffffff');
          for (let i = 0; i < 6; i++) C(-lw / 2 + 0.4 + i * ((lw - 0.8) / 5), 0.8, -ld / 2 + 0.25, 0.13, 0.015, '#ffffff');
        } else if (f.kind === 'buffet') {
          const foods = ['#f2a65a', '#e76f51', '#e9c46a', '#8ab17d', '#f4a6c0', '#c97b63'];
          for (let i = 0; i < 6; i++) {
            const x = -lw / 2 + 0.4 + i * ((lw - 0.8) / 5);
            C(x, 0.8, 0, 0.22, 0.03, '#ffffff');
            L('sphere', x, 0.86, 0, 0.16, 0.09, 0.16, foods[i]);
          }
        } else if (f.kind === 'punch_table') {
          L('sphere', 0, 0.93, 0, 0.3, 0.16, 0.3, '#f7b7c8');
          C(0, 0.8, 0, 0.16, 0.06, '#e8e8f0');
          for (let i = 0; i < 5; i++) C(0.12, 0.8, -0.8 + i * 0.4, 0.05, 0.1, '#e8f0f8');
        }
        break;
      }
      case 'table_small':
      case 'umbrella_table': {
        const top = f.kind === 'umbrella_table' ? '#f4efe6' : wood;
        B(0, 0.7, 0, lw, 0.05, ld, top);
        legs(0.7, 0.08, 0.035, f.kind === 'umbrella_table' ? '#d8d0c4' : '#5e3d29');
        if (f.kind === 'umbrella_table') {
          C(0, 0.75, 0, 0.03, 1.5, '#d8d0c4');
          L('cone8', 0, 2.35, 0, 1.2, 0.45, 1.2, '#e76f51');
          for (const a of [0, 1.6, 3.2, 4.7]) B(Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7, 0.35, 0.45, 0.35, '#f4efe6');
        }
        break;
      }
      case 'desk': {
        B(0, 0.72, 0, lw, 0.06, ld, '#6b4430');
        B(-lw / 2 + 0.25, 0, 0, 0.45, 0.72, ld - 0.05, '#5e3b2a');
        B(lw / 2 - 0.25, 0, 0, 0.45, 0.72, ld - 0.05, '#5e3b2a');
        C(lw / 2 - 0.3, 0.78, -0.2, 0.05, 0.3, '#c9a24a');
        L('sphere', lw / 2 - 0.3, 1.1, -0.2, 0.14, 0.08, 0.14, '#3f7d5c');
        B(-0.2, 0.78, 0.05, 0.45, 0.02, 0.32, '#f5f1e6');
        break;
      }
      case 'desk_monitors': {
        B(0, 0.72, 0, lw, 0.06, ld, '#7a7f87');
        B(0, 0, 0.1, lw - 0.1, 0.72, ld - 0.3, '#686d75');
        for (let i = 0; i < 4; i++) {
          const x = -lw / 2 + 0.7 + i * ((lw - 1.4) / 3);
          B(x, 0.78, 0.25, 0.9, 0.6, 0.08, '#2b2e35');
          const lx = x;
          const lz = 0.2;
          const wx = f.x + lx * cs + lz * sn;
          const wz = f.z - lx * sn + lz * cs;
          monitors.add('box', wx, 1.08, wz, 0.8, 0.5, 0.02, '#ffffff', rot);
          B(x, 0.78, 0.35, 0.08, 0.15, 0.08, '#2b2e35');
        }
        B(1.9, 0.78, -0.1, 0.5, 0.06, 0.25, '#2b2e35');
        break;
      }
      case 'chair': {
        B(0, 0.42, 0, 0.44, 0.06, 0.44, f.color ?? '#b07d55');
        B(0, 0.42, -0.2, 0.44, 0.5, 0.06, f.color ?? '#9c6b47');
        C(-0.18, 0, -0.18, 0.025, 0.42, '#5e3d29');
        C(0.18, 0, -0.18, 0.025, 0.42, '#5e3d29');
        C(-0.18, 0, 0.18, 0.025, 0.42, '#5e3d29');
        C(0.18, 0, 0.18, 0.025, 0.42, '#5e3d29');
        break;
      }
      case 'armchair': {
        const c = f.color ?? '#7a9e6f';
        B(0, 0.1, 0.02, lw, 0.35, ld * 0.9, c);
        B(0, 0.1, -ld / 2 + 0.1, lw, 0.85, 0.2, c);
        B(-lw / 2 + 0.08, 0.1, 0, 0.16, 0.6, ld * 0.9, c);
        B(lw / 2 - 0.08, 0.1, 0, 0.16, 0.6, ld * 0.9, c);
        break;
      }
      case 'sofa': {
        const c = f.color ?? '#6b5b95';
        B(0, 0.08, 0.05, lw, 0.35, ld * 0.85, c);
        B(0, 0.08, -ld / 2 + 0.1, lw, 0.8, 0.22, c);
        B(-lw / 2 + 0.1, 0.08, 0, 0.2, 0.6, ld, c);
        B(lw / 2 - 0.1, 0.08, 0, 0.2, 0.6, ld, c);
        for (let i = -1; i <= 1; i += 2) L('sphere', i * lw * 0.22, 0.5, 0.05, lw * 0.2, 0.08, ld * 0.35, '#f2e3c6');
        break;
      }
      case 'bookshelf': {
        B(0, 0, 0, lw, 1.95, ld, '#5d3f2c');
        const cols = ['#c0504d', '#4f81bd', '#9bbb59', '#f2c94c', '#8064a2', '#4bacc6', '#f79646'];
        for (let row = 0; row < 4; row++) {
          for (let i = 0; i < Math.floor(lw / 0.12); i++) {
            const x = -lw / 2 + 0.1 + i * 0.12;
            const h = 0.26 + hash(f.x * 3 + i, row + f.z) * 0.1;
            B(x, 0.12 + row * 0.45, ld / 2 + 0.01, 0.1, h, 0.08, cols[(i + row * 3 + Math.floor(f.x)) % cols.length]);
          }
        }
        break;
      }
      case 'shelf': {
        const c = f.tall ? '#8a6a4a' : '#9aa0a6';
        for (let row = 0; row < 4; row++) B(0, 0.1 + row * 0.5, 0, lw, 0.05, ld, c);
        C(-lw / 2 + 0.05, 0, -ld / 2 + 0.05, 0.03, 1.7, c);
        C(lw / 2 - 0.05, 0, -ld / 2 + 0.05, 0.03, 1.7, c);
        C(-lw / 2 + 0.05, 0, ld / 2 - 0.05, 0.03, 1.7, c);
        C(lw / 2 - 0.05, 0, ld / 2 - 0.05, 0.03, 1.7, c);
        const goods = ['#e9c46a', '#f4a261', '#e76f51', '#2a9d8f', '#d8d0c4', '#b5838d'];
        for (let row = 0; row < 3; row++)
          for (let i = 0; i < Math.floor(lw / 0.35); i++) {
            if (hash(i + f.x, row + f.z) < 0.25) continue;
            const x = -lw / 2 + 0.2 + i * 0.35;
            if (hash(i, row) > 0.5) B(x, 0.15 + row * 0.5, 0, 0.26, 0.24, ld * 0.7, goods[(i + row) % goods.length]);
            else C(x, 0.15 + row * 0.5, 0, 0.09, 0.26, goods[(i * 2 + row) % goods.length]);
          }
        break;
      }
      case 'locker': {
        const n = Math.max(1, Math.round(ld / 0.55));
        for (let i = 0; i < n; i++) {
          const z = -ld / 2 + (i + 0.5) * (ld / n);
          B(0, 0, z, lw, 1.9, ld / n - 0.03, i % 2 ? '#7f9cb5' : '#86a3bb');
          B(lw / 2 + 0.005, 1.4, z, 0.01, 0.12, 0.25, '#5b6f80');
        }
        break;
      }
      case 'counter':
      case 'sink': {
        B(0, 0, 0, lw, 0.86, ld, '#ece7df');
        B(0, 0.86, 0, lw + 0.04, 0.05, ld + 0.04, '#9ea4ab');
        if (f.kind === 'sink') {
          B(0, 0.88, 0, Math.min(0.6, lw * 0.6), 0.04, ld * 0.6, '#c9d4dc');
          C(0, 0.9, -ld * 0.35, 0.03, 0.25, '#b8bec5');
        }
        break;
      }
      case 'stove': {
        B(0, 0, 0, lw, 0.88, ld, '#b9bec6');
        B(0, 0.88, 0, lw + 0.04, 0.04, ld + 0.04, '#4a4d55');
        for (let i = 0; i < 3; i++) {
          C(-lw / 3 + i * (lw / 3), 0.92, 0, 0.17, 0.02, '#222');
          if (i !== 1) {
            C(-lw / 3 + i * (lw / 3), 0.94, 0, 0.18, 0.28, i === 0 ? '#c0c6ce' : '#d08a5a');
          }
        }
        break;
      }
      case 'fridge':
        B(0, 0, 0, lw, 1.95, ld, '#e8edf0');
        B(lw / 2 + 0.01, 0.9, 0.2, 0.03, 0.6, 0.04, '#9aa0a6');
        break;
      case 'bar': {
        B(0, 0, 0, lw, 1.0, ld, '#6b3e2e');
        B(0, 1.0, 0, lw + 0.1, 0.06, ld + 0.12, '#3e2418');
        B(0, 0.12, ld / 2 + 0.02, lw, 0.04, 0.04, '#d4a017');
        for (let i = 0; i < 4; i++) {
          C(-lw / 2 + 0.6 + i * ((lw - 1.2) / 3), 0, ld / 2 + 0.45, 0.04, 0.7, '#3e2418');
          C(-lw / 2 + 0.6 + i * ((lw - 1.2) / 3), 0.7, ld / 2 + 0.45, 0.18, 0.06, '#b3423a');
        }
        // back shelf on the wall behind
        B(0, 1.1, -ld / 2 - 0.7, lw, 0.05, 0.25, '#3e2418');
        for (let i = 0; i < 10; i++) C(-lw / 2 + 0.25 + i * (lw / 10), 1.15, -ld / 2 - 0.7, 0.05, 0.28, ['#2f6f4f', '#a33', '#d9b44a', '#5b4a8a'][i % 4]);
        break;
      }
      case 'piano': {
        L('cyl', 0, 0.75, 0, lw * 0.5, 0.3, ld * 0.55, '#16161a', 0);
        B(0, 0.6, ld * 0.3, lw * 0.9, 0.3, ld * 0.45, '#16161a');
        B(0, 0.86, ld * 0.48, lw * 0.85, 0.05, 0.18, '#f4f4f4');
        L('box', 0.1, 1.35, -0.1, lw * 0.85, 0.03, ld * 0.8, '#1d1d22', 0, -0.55);
        for (const [x, z] of [
          [-0.7, 0.5],
          [0.7, 0.5],
          [0, -0.6],
        ])
          C(x, 0, z, 0.05, 0.62, '#16161a');
        B(0, 0, ld / 2 + 0.45, 0.9, 0.48, 0.35, '#16161a');
        break;
      }
      case 'podium':
        B(0, 0, 0, lw, 1.1, ld, '#7a4f35');
        B(0, 1.1, 0.05, lw + 0.1, 0.05, ld + 0.1, '#5e3b2a');
        L('sphere', 0, 1.25, 0.15, 0.05, 0.05, 0.05, '#333');
        break;
      case 'stage':
        B(0, 0, 0, lw, 0.18, ld, '#8b2f3a');
        B(0, 0.18, 0, lw, 0.02, ld, '#a63a48');
        B(0, 0, ld / 2, lw, 0.2, 0.04, '#d4a017');
        break;
      case 'pedestal_case': {
        B(0, 0, 0, lw * 0.9, 0.95, ld * 0.9, '#f0ebe3');
        B(0, 0.95, 0, lw, 0.1, ld, '#d9d2c7');
        B(0, 0, 0, lw, 0.08, ld, '#d9d2c7');
        L('box', 0, 1.05 + 0.5, 0, lw * 0.9, 1.0, ld * 0.9, '#cfefff', 0, 0, 0, glass);
        // Thin gold frame on the glass edges (no lid, so the duck is visible from above).
        for (const [a, b2] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          B((a * lw * 0.9) / 2, 1.05, (b2 * ld * 0.9) / 2, 0.05, 1.0, 0.05, '#c9a24a');
        B(0, 2.04, (-ld * 0.9) / 2, lw * 0.9, 0.04, 0.05, '#c9a24a');
        B(0, 2.04, (ld * 0.9) / 2, lw * 0.9, 0.04, 0.05, '#c9a24a');
        B((-lw * 0.9) / 2, 2.04, 0, 0.05, 0.04, ld * 0.9, '#c9a24a');
        B((lw * 0.9) / 2, 2.04, 0, 0.05, 0.04, ld * 0.9, '#c9a24a');
        // little velvet cushion
        L('sphere', 0, 1.08, 0, 0.32, 0.06, 0.32, '#8b2f3a');
        break;
      }
      case 'rope': {
        const r = lw / 2;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const x = Math.sin(a) * r;
          const z = Math.cos(a) * r;
          if (z > r * 0.85) continue; // gap at the front (south)
          C(x, 0, z, 0.04, 0.85, '#c9a24a');
          S(x, 0.88, z, 0.06, '#c9a24a');
          const a2 = ((i + 1) / 8) * Math.PI * 2;
          const x2 = Math.sin(a2) * r;
          const z2 = Math.cos(a2) * r;
          if (z2 > r * 0.85) continue;
          const len = Math.hypot(x2 - x, z2 - z);
          L('box', (x + x2) / 2, 0.72, (z + z2) / 2, 0.04, 0.04, len, '#a3252f', Math.atan2(x2 - x, z2 - z));
        }
        break;
      }
      case 'statue':
        B(0, 0, 0, lw, 0.9, ld, '#e8e2d8');
        S(0, 1.25, 0, 0.28, '#f2eee8', 1.1);
        L('sphere', 0, 1.55, 0.05, 0.16, 0.18, 0.16, '#f2eee8');
        break;
      case 'plant':
        C(0, 0, 0, 0.2, 0.35, '#c97b63');
        S(0, 0.6, 0, 0.3, '#6a9a56');
        S(0.12, 0.8, 0.05, 0.22, '#78aa61');
        break;
      case 'plant_big':
        C(0, 0, 0, 0.32, 0.45, '#b56d55');
        for (let i = 0; i < 5; i++) {
          const a = i * 1.3;
          S(Math.sin(a) * 0.2, 0.9 + (i % 2) * 0.35, Math.cos(a) * 0.2, 0.36, i % 2 ? '#5e9550' : '#6fa65c');
        }
        break;
      case 'hedge':
        B(0, 0, 0, lw, 1.45, ld, '#5f8d50');
        L('sphere', 0, 1.45, 0, lw * 0.55, 0.25, ld * 0.55, '#689b58');
        break;
      case 'bush':
        S(0, 0.55, 0, 0.62, '#5f9450', 0.95);
        S(0.25, 0.85, 0.1, 0.42, '#6ba85b');
        S(-0.22, 0.8, -0.1, 0.4, '#6aa35a');
        S(0.05, 0.4, 0.3, 0.38, '#5a8b4b');
        break;
      case 'tree':
        C(0, 0, 0, 0.18, 2.0, '#8a6448');
        S(0, 2.6, 0, 1.25, '#7fae63', 0.9, );
        S(0.6, 2.25, 0.3, 0.85, '#88b86b');
        S(-0.55, 2.3, -0.2, 0.9, '#76a65b');
        S(0.1, 3.3, -0.1, 0.8, '#8cbd70');
        break;
      case 'pine':
        C(0, 0, 0, 0.14, 0.8, '#7a5638');
        L('cone', 0, 1.6, 0, 0.95, 1.6, 0.95, '#4f7f5a');
        L('cone', 0, 2.5, 0, 0.75, 1.3, 0.75, '#5a8b63');
        L('cone', 0, 3.3, 0, 0.5, 1.0, 0.5, '#66976c');
        break;
      case 'flowerbed': {
        B(0, 0, 0, lw, 0.18, ld, '#7a5a43');
        const fc = ['#f28fa8', '#ffd36b', '#ffffff', '#b98ce0', '#f4a261'];
        const n = Math.floor(lw * ld * 6);
        for (let i = 0; i < n; i++) {
          const x = (hash(i, f.x) - 0.5) * (lw - 0.2);
          const z = (hash(f.z, i) - 0.5) * (ld - 0.2);
          S(x, 0.28, z, 0.09, fc[i % fc.length]);
          S(x, 0.2, z, 0.08, '#5f8d50');
        }
        break;
      }
      case 'fountain': {
        L('cyl', 0, 0.25, 0, lw / 2, 0.5, lw / 2, '#d9d2c7');
        L('cyl', 0, 0.42, 0, lw / 2 - 0.15, 0.2, lw / 2 - 0.15, '#86c3d6');
        C(0, 0.3, 0, 0.18, 1.2, '#e3ddd3');
        L('cyl', 0, 1.5, 0, 0.6, 0.12, 0.6, '#d9d2c7');
        S(0, 1.7, 0, 0.18, '#e3ddd3');
        break;
      }
      case 'duck_fountain': {
        L('cyl', 0, 0.22, 0, lw / 2, 0.44, lw / 2, '#d4cdc1');
        L('cyl', 0, 0.38, 0, lw / 2 - 0.15, 0.16, lw / 2 - 0.15, '#86c3d6');
        // A big stone duck (the host is obsessed)
        L('sphere', 0, 1.05, 0.1, 0.7, 0.55, 0.9, '#f0ece4');
        S(0, 1.75, 0.55, 0.38, '#f0ece4');
        L('cone', 0, 1.7, 1.0, 0.14, 0.4, 0.14, '#e9b44c', 0, Math.PI / 2);
        L('sphere', 0, 1.3, -0.75, 0.3, 0.2, 0.25, '#f0ece4');
        break;
      }
      case 'car': {
        const c = f.color ?? '#a0c4e8';
        const along = lw < ld; // long along z
        const L1 = along ? ld : lw;
        const W1 = along ? lw : ld;
        const ry = along ? 0 : Math.PI / 2;
        const Bc = (lx: number, by: number, lz: number, sx: number, sy: number, sz: number, colr: string) => {
          const x = along ? lx : lz;
          const z = along ? lz : lx;
          gb.add('box', f.x + x, by + sy / 2, f.z + z, sx, sy, sz, colr, ry);
        };
        Bc(0, 0.22, 0, W1 * 0.95, 0.5, L1 * 0.95, c);
        Bc(0, 0.72, -L1 * 0.05, W1 * 0.8, 0.45, L1 * 0.5, c);
        Bc(0, 0.76, -L1 * 0.05, W1 * 0.82, 0.32, L1 * 0.46, '#cfe6f2');
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          const x = a * W1 * 0.42;
          const z = b * L1 * 0.32;
          gb.add('cyl', f.x + (along ? x : z), 0.22, f.z + (along ? z : x), 0.22, 0.2, 0.22, '#2b2b30', 0, 0, Math.PI / 2 + (along ? 0 : 0));
        }
        Bc(0, 0.4, L1 * 0.48, W1 * 0.7, 0.1, 0.04, '#fff3c4');
        break;
      }
      case 'van': {
        const c = f.color ?? '#f2f2f2';
        B(0, 0.3, -0.4, lw * 0.95, 1.8, ld * 0.72, c);
        B(0, 0.3, ld / 2 - 0.75, lw * 0.95, 1.1, 1.3, c);
        B(0, 0.95, ld / 2 - 0.3, lw * 0.85, 0.4, 0.3, '#cfe6f2');
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          L('cyl', a * lw * 0.45, 0.3, b * ld * 0.33, 0.3, 0.22, 0.3, '#2b2b30', 0, 0, Math.PI / 2);
        if (f.id === 'electric_van') {
          B(0, 2.1, -0.4, lw * 0.6, 0.08, ld * 0.6, '#9aa0a6');
          B(lw / 2 - 0.02, 1.1, -0.4, 0.05, 0.4, 1.6, '#3d6fb5');
        } else {
          B(lw / 2 + 0.01, 1.2, -0.4, 0.04, 0.5, 2, '#e76f51');
          B(-lw / 2 - 0.01, 1.2, -0.4, 0.04, 0.5, 2, '#e76f51');
        }
        break;
      }
      case 'bench': {
        const c = f.color ?? '#9c6b47';
        B(0, 0.4, 0, lw, 0.06, ld * 0.8, c);
        B(0, 0.4, -ld / 2 + 0.03, lw, 0.45, 0.05, c);
        B(-lw / 2 + 0.1, 0, 0, 0.06, 0.4, ld * 0.7, '#4a4a4a');
        B(lw / 2 - 0.1, 0, 0, 0.06, 0.4, ld * 0.7, '#4a4a4a');
        break;
      }
      case 'crate':
        B(0, 0, 0, lw, lw * 0.85, ld, '#c49a6c');
        B(0, lw * 0.4, ld / 2 + 0.005, lw, 0.08, 0.01, '#a77d52');
        break;
      case 'barrel':
        C(0, 0, 0, lw / 2, 0.95, '#8a5f3e');
        C(0, 0.2, 0, lw / 2 + 0.02, 0.05, '#555');
        C(0, 0.72, 0, lw / 2 + 0.02, 0.05, '#555');
        break;
      case 'dumpster':
        B(0, 0, 0, lw, 1.1, ld, '#3e7a5a');
        B(0, 1.1, -0.05, lw + 0.05, 0.08, ld + 0.1, '#2f5f45');
        break;
      case 'gazebo': {
        const r = lw / 2;
        L('cyl8', 0, 0.05, 0, r, 0.1, r, '#e8e0d2');
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          if (i === 0) continue; // entrance gap facing south
          C(Math.sin(a) * (r - 0.2), 0, Math.cos(a) * (r - 0.2), 0.08, 2.4, '#f4efe6');
        }
        L('cone8', 0, 3.0, 0, r + 0.3, 1.2, r + 0.3, '#c96f5a');
        S(0, 3.7, 0, 0.12, '#e9c46a');
        break;
      }
      case 'fireworks': {
        B(0, 0, 0, lw, 0.4, ld, '#8b2f3a');
        const cs_ = ['#f2c94c', '#56ccf2', '#eb5757', '#6fcf97', '#bb6bd9'];
        for (let i = 0; i < 9; i++) C(-0.35 + (i % 3) * 0.35, 0.4, -0.35 + Math.floor(i / 3) * 0.35, 0.09, 0.5 + (i % 2) * 0.2, cs_[i % 5]);
        break;
      }
      case 'boat': {
        L('sphere', 0, 0.05, 0, lw / 2, 0.35, ld / 2, '#b5654e');
        B(0, 0.25, 0, lw * 0.8, 0.06, 0.25, '#8a5a3c');
        L('box', 0.5, 0.35, 0, 0.06, 0.06, 1.4, '#c49a6c', 0.4);
        break;
      }
      case 'dock_post':
        break;
      case 'toilet':
        B(0, 0, 0.05, 0.38, 0.42, 0.45, '#f7f7f7');
        B(0, 0.3, -0.22, 0.42, 0.45, 0.16, '#f7f7f7');
        break;
      case 'stall': {
        B(-lw / 2 + 0.03, 0, 0, 0.05, 1.8, ld, '#c9d8d6');
        B(lw / 2 - 0.03, 0, 0, 0.05, 1.8, ld, '#c9d8d6');
        B(-lw / 4, 0.1, ld / 2, lw / 2 - 0.1, 1.7, 0.05, '#b8cbc8');
        break;
      }
      case 'bathtub':
        B(0, 0, 0, lw, 0.55, ld, '#f7f7f7');
        B(0, 0.4, 0, lw - 0.2, 0.18, ld - 0.2, '#bfe3ee');
        C(-lw / 2 + 0.2, 0.55, 0, 0.04, 0.3, '#c0c6ce');
        break;
      case 'cabinet': {
        const c = f.color ?? '#e8f4f0';
        const isAlarm = f.id.startsWith('firealarm');
        const h = f.h ?? 0.6;
        B(0, isAlarm ? 1.1 : 1.15, 0, lw, h, ld, c);
        if (f.id === 'firstaid') {
          B(0, 1.32, ld / 2 + 0.01, 0.06, 0.2, 0.01, '#d33');
          B(0, 1.39, ld / 2 + 0.01, 0.2, 0.06, 0.01, '#d33');
        }
        if (isAlarm) S(0, 1.35, 0, 0.06, '#ffffff');
        break;
      }
      case 'coffee_machine':
        B(0, 0.9, 0, 0.32, 0.42, 0.3, '#3b3b42');
        C(0.02, 0.92, 0.1, 0.07, 0.16, '#9fd3e6');
        break;
      case 'water_cooler':
        B(0, 0, 0, lw * 0.8, 1.0, ld * 0.8, '#e8edf0');
        C(0, 1.0, 0, 0.17, 0.45, '#8ec9e6');
        break;
      case 'jukebox': {
        B(0, 0, 0, lw, 1.3, ld, '#b5523b');
        L('cyl', 0, 1.3, 0, lw / 2, 0.05, ld / 2, '#b5523b');
        S(0, 1.3, 0, lw / 2, '#d9a441', 0.6);
        B(0, 0.5, ld / 2 + 0.01, lw * 0.7, 0.5, 0.02, '#f2e3c6');
        break;
      }
      case 'fusebox':
        B(0, 1.0, 0, lw, 0.9, 0.18, '#8d949c');
        for (let i = 0; i < 4; i++) B(-0.45 + i * 0.3, 1.35, 0.1, 0.12, 0.25, 0.06, i === 3 ? '#d33' : '#333');
        break;
      case 'console':
        break;
      case 'wardrobe': {
        const c = f.color ?? '#7a4f35';
        B(0, 0, 0, lw, 2.0, ld, c);
        B(lw / 2 + 0.005, 0.1, 0, 0.01, 1.8, 0.03, '#4a3020');
        S(lw / 2 + 0.02, 1.0, 0.1, 0.04, '#c9a24a');
        S(lw / 2 + 0.02, 1.0, -0.1, 0.04, '#c9a24a');
        break;
      }
      case 'fireplace': {
        B(0, 0, 0, lw, 1.15, ld, '#b4574a');
        B(0, 0.05, 0.05, lw * 0.6, 0.65, ld * 0.8, '#2b1e1a');
        B(0, 1.15, 0.05, lw + 0.2, 0.08, ld + 0.15, '#e8e2d8');
        C(0.4, 1.23, 0.1, 0.05, 0.25, '#d9b44a');
        const fl = new GeoBuilder();
        fl.add('sphere', f.x, 0.25, f.z + 0.12, 0.22, 0.22, 0.12, '#ff9a3c');
        this.fireGlow = new THREE.Mesh(fl.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
        this.group.add(this.fireGlow);
        break;
      }
      case 'stairs': {
        // Steps rising towards the north-east wall with a banister and velvet rope.
        for (let i = 0; i < 8; i++) B(0.3, 0, -ld / 2 + 0.15 + i * 0.28, lw - 0.6, 0.18 + i * 0.25, 0.3, '#c9a074');
        B(-lw / 2 + 0.25, 0, 0, 0.1, 2.2, ld, '#7a4f35');
        C(-lw / 2 + 0.4, 0, ld / 2 + 0.1, 0.05, 0.9, '#c9a24a');
        C(lw / 2 - 0.2, 0, ld / 2 + 0.1, 0.05, 0.9, '#c9a24a');
        L('box', 0.1, 0.75, ld / 2 + 0.1, lw - 0.6, 0.05, 0.05, '#a3252f');
        break;
      }
      case 'rug':
        B(0, 0.022, 0, lw, 0.012, ld, f.color ?? '#b03a3a');
        B(0, 0.026, 0, lw - 0.3, 0.012, ld - 0.3, shade(f.color ?? '#b03a3a', 0.12));
        break;
      case 'coat_rack':
        C(0, 0, 0, 0.04, 1.8, '#5e3d29');
        S(0.15, 1.45, 0, 0.18, '#7a6a9a', 1.6);
        S(-0.12, 1.4, 0.1, 0.16, '#5f8d50', 1.6);
        break;
      case 'booth': {
        const c = f.color ?? '#dfe6ec';
        B(0, 0, 0, lw, 2.2, ld, c);
        B(0, 1.0, ld / 2 + 0.01, lw * 0.8, 0.7, 0.02, '#cfe6f2');
        B(0, 2.2, 0, lw + 0.25, 0.15, ld + 0.25, '#3d4f7a');
        break;
      }
      case 'trash':
        C(0, 0, 0, lw / 2, 0.7, '#6f7a80');
        C(0, 0.7, 0, lw / 2 + 0.03, 0.05, '#555c61');
        break;
      case 'workbench':
        B(0, 0.8, 0, lw, 0.08, ld, '#9c6b47');
        legs(0.8);
        B(-0.3, 0.88, 0, 0.3, 0.15, 0.2, '#d33');
        C(0.4, 0.88, 0.1, 0.08, 0.2, '#e9c46a');
        break;
      case 'string_lights':
        for (const [x, z] of [
          [-lw / 2, -ld / 2],
          [lw / 2, -ld / 2],
          [-lw / 2, ld / 2],
          [lw / 2, ld / 2],
        ])
          C(x, 0, z, 0.05, 2.6, '#5e3d29');
        break;
      case 'painting': {
        const thin = lw < ld;
        B(0, 1.2, 0, thin ? 0.05 : lw, 0.9, thin ? ld : 0.05, '#c9a24a');
        B(0, 1.27, 0, thin ? 0.07 : lw - 0.16, 0.76, thin ? ld - 0.16 : 0.07, f.color ?? '#7fb3d5');
        break;
      }
      case 'notice_board':
        B(0, 1.1, 0, lw, 0.75, 0.05, '#c49a6c');
        for (let i = 0; i < 4; i++) B(-0.4 + i * 0.27, 1.25 + (i % 2) * 0.2, 0.03, 0.2, 0.25, 0.01, ['#fff', '#ffd36b', '#cde', '#fdd'][i]);
        break;
      case 'globe':
        C(0, 0, 0, 0.18, 0.7, '#6d4a33');
        S(0, 0.95, 0, 0.26, '#6fa8c9');
        break;
      case 'hydrant':
        C(0, 0, 0, 0.14, 0.6, '#d64545');
        S(0, 0.62, 0, 0.14, '#d64545');
        break;
      case 'mailbox':
        C(0, 0, 0, 0.05, 0.9, '#555');
        B(0, 0.9, 0, 0.3, 0.35, 0.45, '#3d6fb5');
        break;
      case 'phone_booth':
        B(0, 0, 0, lw, 2.3, ld, '#c0392b');
        B(0, 0.6, ld / 2 + 0.01, lw * 0.7, 1.4, 0.02, '#cfe6f2');
        break;
      case 'tool_rack':
        B(0, 1.2, 0, lw, 0.7, 0.05, '#9c6b47');
        for (let i = 0; i < 4; i++) B(-0.5 + i * 0.33, 1.0, 0.05, 0.05, 0.6, 0.04, '#777');
        break;
      case 'ladder':
        L('box', -0.2, 1.1, 0, 0.05, 2.2, 0.05, '#c49a6c', 0, -0.25);
        L('box', 0.2, 1.1, 0, 0.05, 2.2, 0.05, '#c49a6c', 0, -0.25);
        break;
      case 'lamp':
      case 'tv':
      case 'console' as never:
        break;
      default:
        B(0, 0, 0, lw, 0.8, ld, f.color ?? '#999');
    }
    // String lights bulbs (powered by the main house circuit)
    if (f.kind === 'string_lights') {
      const bulbs = new GeoBuilder();
      const pts: V2[] = [
        { x: f.x - f.w / 2, z: f.z - f.d / 2 },
        { x: f.x + f.w / 2, z: f.z - f.d / 2 },
        { x: f.x + f.w / 2, z: f.z + f.d / 2 },
        { x: f.x - f.w / 2, z: f.z + f.d / 2 },
        { x: f.x - f.w / 2, z: f.z - f.d / 2 },
        { x: f.x + f.w / 2, z: f.z + f.d / 2 },
      ];
      const cols = ['#ffd36b', '#ff9fb1', '#9fe0ff', '#b9f5a6'];
      let k = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.8);
        for (let j = 0; j <= n; j++) {
          const t = j / n;
          const sag = Math.sin(t * Math.PI) * 0.45;
          bulbs.add('sphere', a.x + (b.x - a.x) * t, 2.55 - sag, a.z + (b.z - a.z) * t, 0.07, 0.07, 0.07, cols[k++ % cols.length]);
        }
      }
      this.stringBulbs = new THREE.Mesh(bulbs.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
      this.group.add(this.stringBulbs);
    }
    if (f.kind === 'jukebox') {
      const jl = new GeoBuilder();
      const lx = 0;
      const lz = f.d / 2 + 0.03;
      jl.add('box', f.x + lx * Math.cos(rot) + lz * Math.sin(rot), 1.05, f.z - lx * Math.sin(rot) + lz * Math.cos(rot), 0.5, 0.25, 0.02, '#ff6fb1', rot);
      this.jukeLights = new THREE.Mesh(jl.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
      this.group.add(this.jukeLights);
    }
    if (f.kind === 'pedestal_case') {
      const cl = new GeoBuilder();
      cl.add('sphere', f.x + 0.62, 1.12, f.z + 0.62, 0.05, 0.05, 0.05, '#ffffff');
      this.caseLamp = new THREE.Mesh(cl.build(), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }));
      this.group.add(this.caseLamp);
    }
    void glow;
  }

  private buildLamps() {
    const gb = new GeoBuilder();
    const geo = new THREE.SphereGeometry(0.2, 12, 8);
    for (const l of LAMPS) {
      gb.cyl(l.x, 0, l.z, 0.06, 2.7, '#3a3a40');
      gb.cyl(l.x, 0, l.z, 0.14, 0.25, '#3a3a40');
      gb.add('cone', l.x, 3.0, l.z, 0.28, 0.25, 0.28, '#3a3a40');
      const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffe3a3' }));
      glow.position.set(l.x, 2.8, l.z);
      this.group.add(glow);
      this.lampGlows.push({ circuit: l.circuit, mesh: glow });
    }
    const m = new THREE.Mesh(gb.build(), this.mats.vertex);
    m.castShadow = true;
    this.group.add(m);
  }

  // ---------------------------------------------------------------------------
  private buildDoors() {
    for (const d of this.grid.doors) {
      const style = d.def.style ?? 'wood';
      const width = d.def.to - d.def.from;
      const leaves = style === 'double' || style === 'gate' || (style === 'glass' && width > 1) ? 2 : 1;
      const leafW = width / leaves;
      const pivots: THREE.Object3D[] = [];
      const base: number[] = [];
      for (let i = 0; i < leaves; i++) {
        const gb = new GeoBuilder();
        const h = style === 'gate' ? 1.9 : 2.2;
        const color =
          style === 'metal' ? '#8d949c' : style === 'staff' ? '#b9c7cf' : style === 'glass' ? '#f4efe6' : style === 'gate' ? '#33343a' : '#8a5a3c';
        // Leaf built along +x from the hinge at origin.
        if (style === 'gate') {
          gb.box(leafW / 2, 0, 0, leafW, 0.08, 0.06, color);
          gb.box(leafW / 2, h - 0.08, 0, leafW, 0.08, 0.06, color);
          for (let b = 0; b <= Math.floor(leafW / 0.2); b++) gb.box(0.05 + b * 0.2, 0, 0, 0.04, h, 0.04, color);
          gb.ball(leafW - 0.1, h + 0.05, 0, 0.06, '#c9a24a');
        } else if (style === 'glass') {
          gb.box(leafW / 2, 0, 0, leafW - 0.04, 0.12, 0.06, color);
          gb.box(leafW / 2, h - 0.1, 0, leafW - 0.04, 0.1, 0.06, color);
          gb.box(0.04, 0, 0, 0.08, h, 0.06, color);
          gb.box(leafW - 0.06, 0, 0, 0.08, h, 0.06, color);
        } else {
          gb.box(leafW / 2, 0, 0, leafW - 0.04, h, 0.07, color);
          gb.box(leafW / 2, 0.25, 0.04, leafW - 0.25, 0.7, 0.01, shade(color, -0.06));
          gb.box(leafW / 2, 1.1, 0.04, leafW - 0.25, 0.85, 0.01, shade(color, -0.06));
          gb.ball(leafW - 0.12, 1.0, 0.06, 0.045, '#d9b44a');
          gb.ball(leafW - 0.12, 1.0, -0.06, 0.045, '#d9b44a');
          if (style === 'staff') gb.ball(leafW / 2, 1.55, 0, 0.14, '#cfe6f2', 0.3);
        }
        const leaf = new THREE.Mesh(gb.build(), this.mats.vertex);
        leaf.castShadow = true;
        const pivot = new THREE.Object3D();
        pivot.add(leaf);
        // Hinge position
        const fromEnd = i === 0;
        const hingeT = fromEnd ? d.def.from : d.def.to;
        if (d.def.axis === 'h') {
          pivot.position.set(hingeT, 0.02, d.def.at);
          pivot.rotation.y = fromEnd ? 0 : Math.PI;
        } else {
          pivot.position.set(d.def.at, 0.02, hingeT);
          pivot.rotation.y = fromEnd ? -Math.PI / 2 : Math.PI / 2;
        }
        base.push(pivot.rotation.y);
        if (style === 'glass') {
          const pane = new THREE.Mesh(
            new THREE.BoxGeometry(leafW - 0.16, h - 0.25, 0.02),
            new THREE.MeshLambertMaterial({ color: '#cfefff', transparent: true, opacity: 0.3, depthWrite: false }),
          );
          pane.position.set(leafW / 2, h / 2, 0);
          pivot.add(pane);
        }
        this.group.add(pivot);
        pivots.push(pivot);
      }
      this.doorPanels.push({ door: d, pivots, base, cut: 1 });
    }
  }

  private buildWindows() {
    for (const w of this.grid.windows) {
      const len = w.def.to - w.def.from;
      const sill = w.def.fixed ? 0.35 : 0.9;
      const h = 2.3 - sill;
      const gb = new GeoBuilder();
      const along = w.def.axis === 'h';
      // Frame (static; part of window object so it is cut with walls)
      const cx = along ? (w.def.from + w.def.to) / 2 : w.def.at;
      const cz = along ? w.def.at : (w.def.from + w.def.to) / 2;
      const sx = along ? len : 0.08;
      const sz = along ? 0.08 : len;
      gb.box(0, sill - 0.02, 0, sx + 0.06, 0.06, sz + 0.12, '#f7f3ea');
      gb.box(0, 2.28, 0, sx + 0.02, 0.06, sz + 0.06, '#f7f3ea');
      for (let i = 0; i <= len; i++) {
        const o = -len / 2 + i;
        gb.box(along ? o : 0, sill, along ? 0 : o, 0.06, h, 0.06, '#f7f3ea');
      }
      gb.box(0, sill + h * 0.55, 0, along ? len : 0.04, 0.04, along ? 0.04 : len, '#f7f3ea');
      const frame = new THREE.Mesh(gb.build(), this.mats.vertex);
      frame.position.set(cx, 0, cz);
      this.group.add(frame);
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(along ? len - 0.06 : 0.03, h - 0.06, along ? 0.03 : len - 0.06),
        new THREE.MeshLambertMaterial({ color: '#cfefff', transparent: true, opacity: 0.32, depthWrite: false }),
      );
      pane.position.set(cx, sill + h / 2, cz);
      this.group.add(pane);
      const base = pane.position.clone();
      this.windowPanes.push({ win: w, mesh: pane, base, cut: 1 });
      (pane.userData as { frame: THREE.Object3D }).frame = frame;
    }
  }

  private buildOuterDecor() {
    // Trees and hedges around the map border so the world doesn't end abruptly.
    const gb = new GeoBuilder();
    const tree = (x: number, z: number, s = 1) => {
      gb.cyl(x, 0, z, 0.2 * s, 2.0 * s, '#8a6448');
      gb.ball(x, 2.7 * s, z, 1.4 * s, hash(x, z) > 0.5 ? '#7aa95f' : '#86b46a', 0.9);
      gb.ball(x + 0.6 * s, 2.3 * s, z + 0.3, 0.9 * s, '#76a65b');
    };
    for (let x = -6; x < 80; x += 3.3) {
      tree(x, -3 + hash(x, 1) * 1.5, 1.1);
      tree(x + 1.5, -7 + hash(x, 2) * 2, 1.3);
    }
    for (let z = 2; z < 70; z += 3.1) {
      tree(-3 - hash(z, 3) * 1.5, z, 1.1);
      tree(75 + hash(z, 4) * 1.5, z, 1.1);
      tree(-7, z + 1.4, 1.3);
      tree(79, z + 1.2, 1.3);
    }
    // Street far side: a low hedge and a few trees (kept low so they never block the view).
    for (let x = -6; x < 80; x += 1) gb.box(x + 0.5, 0, 66.6, 1.02, 0.9, 0.8, '#5f8d50');
    const m = new THREE.Mesh(gb.build(), this.mats.vertex);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ---------------------------------------------------------------------------
  update(dt: number, w: World, focus: V2, focusRoom: string | undefined) {
    this.t += dt;
    // Cut-away: lower walls in front of (south of) the focus point.
    for (const wl of this.walls) {
      const zMin = wl.axis === 'v' ? wl.z - wl.len / 2 : wl.z;
      const dzc = zMin - focus.z;
      const dx = Math.abs(wl.x - focus.x);
      const south = dzc > (wl.axis === 'h' ? 0.05 : -0.45) && dzc < 11 && dx < 15;
      wl.target = south ? 0 : 1;
      wl.cur += (wl.target - wl.cur) * Math.min(1, dt * 8);
      if (Math.abs(wl.cur - wl.target) < 0.002) wl.cur = wl.target;
    }
    this.writeWalls();

    // Doors
    for (const dp of this.doorPanels) {
      const d = dp.door;
      const target = d.open ? 1 : 0;
      d.anim += (target - d.anim) * Math.min(1, dt * 9);
      const zMin = d.def.axis === 'h' ? d.def.at : d.center.z - (d.def.to - d.def.from) / 2;
      const dzc = zMin - focus.z;
      const south = dzc > (d.def.axis === 'h' ? 0.05 : -0.45) && dzc < 11 && Math.abs(d.center.x - focus.x) < 15;
      dp.cut += ((south ? 0 : 1) - dp.cut) * Math.min(1, dt * 8);
      dp.pivots.forEach((p, i) => {
        const dir = i === 0 ? 1 : -1;
        const open = d.def.gate ? 1.45 : 1.5;
        p.rotation.y = dp.base[i] + dir * d.swing * d.anim * open;
        p.scale.y = Math.max(0.12, dp.cut);
      });
    }
    for (const wp of this.windowPanes) {
      const w = wp.win;
      const zMin = w.def.axis === 'h' ? w.def.at : w.center.z - (w.def.to - w.def.from) / 2;
      const dzc = zMin - focus.z;
      const south = dzc > (w.def.axis === 'h' ? 0.05 : -0.45) && dzc < 11 && Math.abs(w.center.x - focus.x) < 15;
      wp.cut += ((south ? 0 : 1) - wp.cut) * Math.min(1, dt * 8);
      const vis = wp.cut > 0.1;
      wp.mesh.visible = vis && !w.open;
      const frame = (wp.mesh.userData as { frame: THREE.Object3D }).frame;
      frame.visible = vis;
    }

    // Powered things
    const pw = w.power;
    for (const l of this.lampGlows) {
      const on = l.circuit === 'S' || pw.on(l.circuit);
      (l.mesh.material as THREE.MeshBasicMaterial).color.set(on ? '#ffe3a3' : '#4a4a55');
    }
    if (this.stringBulbs) (this.stringBulbs.material as THREE.MeshBasicMaterial).color.set(pw.on('B') ? '#ffffff' : '#3a3a44');
    if (this.monitors) {
      const on = pw.on('C') && w.security.camerasEnabled;
      (this.monitors.material as THREE.MeshBasicMaterial).color.set(on ? (Math.sin(this.t * 3) > 0.95 ? '#c8f4ff' : '#9fe8ff') : '#15171c');
    }
    if (this.jukeLights) {
      const on = w.flags.jukeboxOn;
      const c = (this.jukeLights.material as THREE.MeshBasicMaterial).color;
      if (on) c.setHSL((this.t * 0.5) % 1, 0.8, 0.6);
      else c.set(pw.on('B') ? '#8a5a6a' : '#2a2025');
    }
    if (this.caseLamp) {
      const armed = w.security.alarmArmed && pw.on('C');
      (this.caseLamp.material as THREE.MeshBasicMaterial).color.set(
        w.security.alarmOn ? (Math.sin(this.t * 20) > 0 ? '#ff2020' : '#400') : armed ? '#ff4040' : '#3a3a3a',
      );
    }
    if (this.fireGlow) {
      const s = 1 + Math.sin(this.t * 9) * 0.1 + Math.sin(this.t * 13) * 0.06;
      this.fireGlow.scale.set(s, s * 1.1, 1);
    }
    if (this.shedRoof) this.shedRoof.visible = focusRoom !== 'shed' && !(focus.x < 9.5 && focus.z < 9.5 && focus.z > 2);
    for (const wm of this.water) wm.position.y = -0.18 + Math.sin(this.t * 0.8) * 0.015;
  }
}

function shade(hex: string, amount: number): string {
  const c = col(hex);
  c.offsetHSL(0, 0, amount);
  return '#' + c.getHexString();
}
