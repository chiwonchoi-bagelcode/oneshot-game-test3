// Power circuits + light field. The same light field drives gameplay visibility
// (what NPCs/cameras can see) and the rendered lighting (via a texture).
import type { V2 } from '../core/math';
import type { Grid } from './Grid';
import { LAMPS } from './level/layout';
import type { Circuit } from './level/types';

export const LM_RES = 4; // texels per metre for the rendered light map

type RGB = [number, number, number];

const LIT_WARM: RGB = [1.0, 0.93, 0.8];
const LIT_GALLERY: RGB = [0.98, 0.97, 1.0];
const LIT_LOUNGE: RGB = [1.0, 0.86, 0.86];
const LIT_STAFF: RGB = [0.95, 0.97, 0.93];
const DARK: RGB = [0.2, 0.23, 0.4];
const OUTDOOR: RGB = [0.5, 0.53, 0.74];
const LAMP: RGB = [0.6, 0.45, 0.26];
const STREET: RGB = [0.5, 0.42, 0.3];

export class Power {
  breakers: Record<'main' | Circuit, boolean> = { main: true, A: true, B: true, C: true };
  /** When the outage started per circuit (world time), for NPC reactions. */
  offSince: Record<Circuit, number> = { A: -1, B: -1, C: -1 };
  version = 0;

  on(c: Circuit): boolean {
    return this.breakers.main && this.breakers[c];
  }
  anyOff(): boolean {
    return !this.on('A') || !this.on('B') || !this.on('C');
  }
  set(which: 'main' | Circuit, v: boolean, now: number): Circuit[] {
    const before: Record<Circuit, boolean> = { A: this.on('A'), B: this.on('B'), C: this.on('C') };
    this.breakers[which] = v;
    const changed: Circuit[] = [];
    for (const c of ['A', 'B', 'C'] as Circuit[]) {
      const now_ = this.on(c);
      if (now_ !== before[c]) {
        changed.push(c);
        this.offSince[c] = now_ ? -1 : now;
      }
    }
    if (changed.length) this.version++;
    return changed;
  }
  restoreAll(now: number): Circuit[] {
    const changed: Circuit[] = [];
    for (const k of ['main', 'A', 'B', 'C'] as const) {
      if (!this.breakers[k]) changed.push(...this.set(k, true, now));
    }
    return changed;
  }
}

export class Lighting {
  readonly cell: Float32Array; // gameplay luminance per cell
  readonly tex: Uint8Array; // RGBA, LM_RES texels per metre
  readonly texW: number;
  readonly texH: number;
  /** Light switch state per room id (true = on). */
  switches = new Map<string, boolean>();
  dirty = true;
  /** Bumped when the texture changes (view uploads). */
  version = 0;
  private roomColor: RGB[] = [];

  constructor(private grid: Grid, private power: Power) {
    this.cell = new Float32Array(grid.w * grid.h);
    this.texW = grid.w * LM_RES;
    this.texH = grid.h * LM_RES;
    this.tex = new Uint8Array(this.texW * this.texH * 4);
    for (const r of grid.rooms) if (r.indoor) this.switches.set(r.id, !r.dark);
  }

  setSwitch(roomId: string, on: boolean) {
    this.switches.set(roomId, on);
    this.dirty = true;
  }

  roomLit(roomId: string): boolean {
    const r = this.grid.roomById(roomId);
    if (!r.indoor) return true;
    return !!this.switches.get(roomId) && this.power.on(r.circuit ?? 'B');
  }

  /** Gameplay light 0..~1.2 at a position. */
  at(p: V2): number {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (x < 0 || z < 0 || x >= this.grid.w || z >= this.grid.h) return 0.5;
    return this.cell[x + z * this.grid.w];
  }

  private lampsOn(): { x: number; z: number; r: number; c: RGB }[] {
    const out: { x: number; z: number; r: number; c: RGB }[] = [];
    for (const l of LAMPS) {
      const on = l.circuit === 'S' ? true : this.power.on(l.circuit);
      if (on) out.push({ x: l.x, z: l.z, r: 5.5, c: l.circuit === 'S' ? STREET : LAMP });
    }
    // Window glow: lit rooms spill light through their windows.
    for (const w of this.grid.windows) {
      const inside = { x: w.center.x + w.inward.x * 0.5, z: w.center.z + w.inward.z * 0.5 };
      const room = this.grid.roomAt(inside);
      if (!room || !room.indoor || !this.roomLit(room.id)) continue;
      const out_ = { x: w.center.x - w.inward.x * 1.2, z: w.center.z - w.inward.z * 1.2 };
      out.push({ x: out_.x, z: out_.z, r: 2.6, c: [0.42, 0.36, 0.22] });
    }
    // Front door spill
    return out;
  }

  update(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    const g = this.grid;
    this.roomColor = g.rooms.map((r) => {
      if (!r.indoor) return OUTDOOR;
      if (!this.roomLit(r.id)) return DARK;
      if (r.id === 'gallery') return LIT_GALLERY;
      if (r.id === 'lounge') return LIT_LOUNGE;
      if (r.zone === 'staff' || r.zone === 'sec_elec' || r.zone === 'sec_security') return LIT_STAFF;
      return LIT_WARM;
    });
    const lamps = this.lampsOn();
    const sample = (x: number, z: number, out: RGB) => {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      const ri = g.inBounds(cx, cz) ? g.room[cx + cz * g.w] : -1;
      const base = ri >= 0 ? this.roomColor[ri] : OUTDOOR;
      out[0] = base[0];
      out[1] = base[1];
      out[2] = base[2];
      if (ri < 0 || !g.rooms[ri].indoor) {
        for (const l of lamps) {
          const dx = x - l.x;
          const dz = z - l.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > l.r * l.r) continue;
          const f = 1 - Math.sqrt(d2) / l.r;
          const k = f * f * (3 - 2 * f);
          out[0] += l.c[0] * k;
          out[1] += l.c[1] * k;
          out[2] += l.c[2] * k;
        }
      }
    };
    const c: RGB = [0, 0, 0];
    for (let z = 0; z < g.h; z++) {
      for (let x = 0; x < g.w; x++) {
        sample(x + 0.5, z + 0.5, c);
        this.cell[x + z * g.w] = Math.min(1.25, 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2]);
      }
    }
    const inv = 1 / LM_RES;
    const SCALE = 255 / 1.6;
    for (let tz = 0; tz < this.texH; tz++) {
      for (let tx = 0; tx < this.texW; tx++) {
        sample((tx + 0.5) * inv, (tz + 0.5) * inv, c);
        const i = (tx + tz * this.texW) * 4;
        this.tex[i] = Math.min(255, c[0] * SCALE);
        this.tex[i + 1] = Math.min(255, c[1] * SCALE);
        this.tex[i + 2] = Math.min(255, c[2] * SCALE);
        this.tex[i + 3] = 255;
      }
    }
    this.version++;
    return true;
  }
}
