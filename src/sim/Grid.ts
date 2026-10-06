import { clamp, type V2 } from '../core/math';
import {
  BARRIERS,
  DOORS,
  FURNITURE,
  MAP_H,
  MAP_W,
  OPENINGS,
  ROOMS,
  WINDOWS,
} from './level/layout';
import {
  E_CRAWL,
  E_DOOR,
  E_FENCE,
  E_HEDGE,
  E_NONE,
  E_WALL,
  E_WINDOW,
  type DoorDef,
  type FurnDef,
  type KeyId,
  type RoomDef,
  type WindowDef,
  type Zone,
} from './level/types';

export interface DoorState {
  idx: number;
  def: DoorDef;
  open: boolean;
  locked: boolean;
  /** Visual 0..1 animation progress (view only). */
  anim: number;
  /** Which side the door swings towards: +1 / -1. */
  swing: number;
  /** Last time state changed (world time). */
  changedAt: number;
  /** Who last opened it ('player' or npc id). */
  lastUser: string;
  /** Has been forced/picked by the player. */
  tampered: boolean;
  center: V2;
}

export interface WindowState {
  idx: number;
  def: WindowDef;
  open: boolean;
  center: V2;
  /** Indoor side normal (points into the building). */
  inward: V2;
}

export interface NavAgent {
  keys?: ReadonlySet<KeyId> | null;
  /** Can open (unlocked) doors. */
  opens: boolean;
  /** Preferred zones; others cost more. Undefined = all zones equally. */
  zones?: ReadonlySet<Zone> | null;
  crawl?: boolean;
  /** Ignore door locks (pathing for searches where agent has master access). */
  master?: boolean;
}

export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const BLOCK_NAV = 1;
const BLOCK_LOS = 2;
const WATER = 4;

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  clear() {
    this.items.length = 0;
    this.prio.length = 0;
  }
  push(item: number, p: number) {
    const it = this.items;
    const pr = this.prio;
    it.push(item);
    pr.push(p);
    let i = it.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [it[parent], it[i]] = [it[i], it[parent]];
      [pr[parent], pr[i]] = [pr[i], pr[parent]];
      i = parent;
    }
  }
  pop(): number {
    const it = this.items;
    const pr = this.prio;
    const top = it[0];
    const lastI = it.pop()!;
    const lastP = pr.pop()!;
    if (it.length > 0) {
      it[0] = lastI;
      pr[0] = lastP;
      let i = 0;
      const n = it.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && pr[l] < pr[m]) m = l;
        if (r < n && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]];
        [pr[m], pr[i]] = [pr[i], pr[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Grid {
  readonly w = MAP_W;
  readonly h = MAP_H;
  readonly rooms: RoomDef[] = ROOMS;
  readonly roomIndex = new Map<string, number>();
  /** Room index per cell. */
  readonly room: Int16Array;
  /** Horizontal edges: line z between (x,z-1) and (x,z). index x + z*w, z in [0,h]. */
  readonly hEdge: Uint8Array;
  readonly hRef: Int16Array;
  /** Vertical edges: line x between (x-1,z) and (x,z). index x + z*(w+1), x in [0,w]. */
  readonly vEdge: Uint8Array;
  readonly vRef: Int16Array;
  readonly flags: Uint8Array;
  readonly doors: DoorState[] = [];
  readonly windows: WindowState[] = [];
  readonly furniture: FurnDef[] = FURNITURE;
  readonly furnById = new Map<string, FurnDef>();
  private furnByCell: number[][];
  /** Bumped whenever a door changes so cached paths can be revalidated. */
  navVersion = 0;

  constructor() {
    const { w, h } = this;
    this.room = new Int16Array(w * h).fill(-1);
    this.hEdge = new Uint8Array(w * (h + 1));
    this.hRef = new Int16Array(w * (h + 1)).fill(-1);
    this.vEdge = new Uint8Array((w + 1) * h);
    this.vRef = new Int16Array((w + 1) * h).fill(-1);
    this.flags = new Uint8Array(w * h);
    this.furnByCell = Array.from({ length: w * h }, () => []);

    ROOMS.forEach((r, i) => {
      this.roomIndex.set(r.id, i);
      const [x0, z0, x1, z1] = r.rect;
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.room[x + z * w] = i;
    });
    // Water
    for (let i = 0; i < w * h; i++) {
      if (this.room[i] >= 0 && ROOMS[this.room[i]].floor === 'water') this.flags[i] |= BLOCK_NAV | WATER;
    }
    // Structural walls between different rooms where one side is indoor.
    for (let z = 0; z < h; z++) {
      for (let x = 1; x < w; x++) {
        const a = this.room[x - 1 + z * w];
        const b = this.room[x + z * w];
        if (a !== b && (ROOMS[a]?.indoor || ROOMS[b]?.indoor)) this.vEdge[x + z * (w + 1)] = E_WALL;
      }
    }
    for (let z = 1; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const a = this.room[x + (z - 1) * w];
        const b = this.room[x + z * w];
        if (a !== b && (ROOMS[a]?.indoor || ROOMS[b]?.indoor)) this.hEdge[x + z * w] = E_WALL;
      }
    }
    for (const o of OPENINGS) this.forEdge(o.axis, o.at, o.from, o.to, E_NONE, -1);
    DOORS.forEach((d, i) => {
      this.forEdge(d.axis, d.at, d.from, d.to, E_DOOR, i);
      const mid = (d.from + d.to) / 2;
      this.doors.push({
        idx: i,
        def: d,
        open: !!d.open,
        locked: !!d.lock && !d.open,
        anim: d.open ? 1 : 0,
        swing: 1,
        changedAt: -999,
        lastUser: '',
        tampered: false,
        center: d.axis === 'h' ? { x: mid, z: d.at } : { x: d.at, z: mid },
      });
    });
    WINDOWS.forEach((wd, i) => {
      this.forEdge(wd.axis, wd.at, wd.from, wd.to, E_WINDOW, i);
      const mid = (wd.from + wd.to) / 2;
      const center = wd.axis === 'h' ? { x: mid, z: wd.at } : { x: wd.at, z: mid };
      // Determine which side is indoor.
      const probeA = wd.axis === 'h' ? { x: mid, z: wd.at - 0.5 } : { x: wd.at - 0.5, z: mid };
      const aIndoor = this.roomAt(probeA)?.indoor ?? false;
      const inward = wd.axis === 'h' ? { x: 0, z: aIndoor ? -1 : 1 } : { x: aIndoor ? -1 : 1, z: 0 };
      this.windows.push({ idx: i, def: wd, open: !!wd.open, center, inward });
    });
    for (const b of BARRIERS) {
      const k = b.kind === 'hedge' ? E_HEDGE : b.kind === 'fence' ? E_FENCE : E_CRAWL;
      this.forEdge(b.axis, b.at, b.from, b.to, k, -1);
    }

    FURNITURE.forEach((f, fi) => {
      this.furnById.set(f.id, f);
      if (f.wall) return;
      const x0 = f.x - f.w / 2;
      const x1 = f.x + f.w / 2;
      const z0 = f.z - f.d / 2;
      const z1 = f.z + f.d / 2;
      // Nav blocking: any cell overlapped (with a small shrink so touching doesn't count).
      if (f.block !== false) {
        const s = 0.05;
        for (let z = Math.floor(z0 + s); z <= Math.floor(z1 - s); z++) {
          for (let x = Math.floor(x0 + s); x <= Math.floor(x1 - s); x++) {
            if (!this.inBounds(x, z)) continue;
            this.flags[x + z * w] |= BLOCK_NAV;
            if (f.tall) this.flags[x + z * w] |= BLOCK_LOS;
          }
        }
      }
      // Collision lookup (cells overlapped by box expanded by 0.6).
      if (f.block !== false || this.collides(f)) {
        for (let z = Math.floor(z0 - 0.6); z <= Math.floor(z1 + 0.6); z++) {
          for (let x = Math.floor(x0 - 0.6); x <= Math.floor(x1 + 0.6); x++) {
            if (this.inBounds(x, z)) this.furnByCell[x + z * w].push(fi);
          }
        }
      }
    });
  }

  /** Furniture that collides physically even if not nav-blocking. */
  private collides(f: FurnDef): boolean {
    return f.kind === 'lamp' || f.kind === 'dock_post';
  }

  private forEdge(axis: 'h' | 'v', at: number, from: number, to: number, kind: number, ref: number) {
    for (let t = from; t < to; t++) {
      if (axis === 'h') {
        const i = t + at * this.w;
        this.hEdge[i] = kind;
        this.hRef[i] = ref;
      } else {
        const i = at + t * (this.w + 1);
        this.vEdge[i] = kind;
        this.vRef[i] = ref;
      }
    }
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }

  cellOf(p: V2): number {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (!this.inBounds(x, z)) return -1;
    return x + z * this.w;
  }

  roomIdxAt(p: V2): number {
    const c = this.cellOf(p);
    return c < 0 ? -1 : this.room[c];
  }

  roomAt(p: V2): RoomDef | undefined {
    const i = this.roomIdxAt(p);
    return i >= 0 ? this.rooms[i] : undefined;
  }

  roomById(id: string): RoomDef {
    return this.rooms[this.roomIndex.get(id)!];
  }

  isBlockedCell(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return true;
    return (this.flags[x + z * this.w] & BLOCK_NAV) !== 0;
  }

  isWater(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    return (this.flags[x + z * this.w] & WATER) !== 0;
  }

  isTallCell(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return true;
    return (this.flags[x + z * this.w] & BLOCK_LOS) !== 0;
  }

  /** Horizontal edge (line z) at column x. */
  hKind(x: number, z: number): number {
    if (x < 0 || x >= this.w || z < 0 || z > this.h) return E_WALL;
    return this.hEdge[x + z * this.w];
  }
  vKind(x: number, z: number): number {
    if (z < 0 || z >= this.h || x < 0 || x > this.w) return E_WALL;
    return this.vEdge[x + z * (this.w + 1)];
  }
  hDoor(x: number, z: number): DoorState | null {
    const r = this.hRef[x + z * this.w];
    return this.hEdge[x + z * this.w] === E_DOOR && r >= 0 ? this.doors[r] : null;
  }
  vDoor(x: number, z: number): DoorState | null {
    const i = x + z * (this.w + 1);
    const r = this.vRef[i];
    return this.vEdge[i] === E_DOOR && r >= 0 ? this.doors[r] : null;
  }
  hWindow(x: number, z: number): WindowState | null {
    const i = x + z * this.w;
    return this.hEdge[i] === E_WINDOW && this.hRef[i] >= 0 ? this.windows[this.hRef[i]] : null;
  }
  vWindow(x: number, z: number): WindowState | null {
    const i = x + z * (this.w + 1);
    return this.vEdge[i] === E_WINDOW && this.vRef[i] >= 0 ? this.windows[this.vRef[i]] : null;
  }

  // ---------------------------------------------------------------------------
  // Line of sight
  // ---------------------------------------------------------------------------
  private opaqueH(x: number, z: number): boolean {
    const k = this.hKind(x, z);
    if (k === E_WALL || k === E_HEDGE || k === E_CRAWL) return true;
    if (k === E_DOOR) {
      const d = this.hDoor(x, z);
      return !d || (!d.open && d.def.style !== 'glass' && d.def.style !== 'gate');
    }
    return false;
  }
  private opaqueV(x: number, z: number): boolean {
    const k = this.vKind(x, z);
    if (k === E_WALL || k === E_HEDGE || k === E_CRAWL) return true;
    if (k === E_DOOR) {
      const d = this.vDoor(x, z);
      return !d || (!d.open && d.def.style !== 'glass' && d.def.style !== 'gate');
    }
    return false;
  }

  /** True if nothing opaque lies between a and b. */
  los(a: V2, b: V2): boolean {
    let x = Math.floor(a.x);
    let z = Math.floor(a.z);
    const ex = Math.floor(b.x);
    const ez = Math.floor(b.z);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (x + 1 - a.x) / dx : dx < 0 ? (a.x - x) / -dx : Infinity;
    let tMaxZ = dz > 0 ? (z + 1 - a.z) / dz : dz < 0 ? (a.z - z) / -dz : Infinity;
    let guard = 0;
    while ((x !== ex || z !== ez) && guard++ < 400) {
      if (tMaxX < tMaxZ - 1e-9) {
        if (this.opaqueV(stepX > 0 ? x + 1 : x, z)) return false;
        x += stepX;
        tMaxX += tDeltaX;
      } else if (tMaxZ < tMaxX - 1e-9) {
        if (this.opaqueH(x, stepZ > 0 ? z + 1 : z)) return false;
        z += stepZ;
        tMaxZ += tDeltaZ;
      } else {
        const vx = stepX > 0 ? x + 1 : x;
        const hz = stepZ > 0 ? z + 1 : z;
        const p1 = !this.opaqueV(vx, z) && !this.isTallCell(x + stepX, z) && !this.opaqueH(x + stepX, hz);
        const p2 = !this.opaqueH(x, hz) && !this.isTallCell(x, z + stepZ) && !this.opaqueV(vx, z + stepZ);
        if (!p1 && !p2) return false;
        x += stepX;
        z += stepZ;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      }
      if ((x !== ex || z !== ez) && this.isTallCell(x, z) && !this.isWater(x, z)) return false;
    }
    return true;
  }

  /** Distance along a ray until the first sight-blocking edge/cell (for drawing vision cones). */
  castRay(a: V2, angle: number, max: number): number {
    const b = { x: a.x + Math.sin(angle) * max, z: a.z + Math.cos(angle) * max };
    let x = Math.floor(a.x);
    let z = Math.floor(a.z);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (x + 1 - a.x) / dx : dx < 0 ? (a.x - x) / -dx : Infinity;
    let tMaxZ = dz > 0 ? (z + 1 - a.z) / dz : dz < 0 ? (a.z - z) / -dz : Infinity;
    let guard = 0;
    while (guard++ < 200) {
      const t = Math.min(tMaxX, tMaxZ);
      if (t >= 1) return max;
      if (tMaxX < tMaxZ) {
        if (this.opaqueV(stepX > 0 ? x + 1 : x, z)) return t * max;
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        if (this.opaqueH(x, stepZ > 0 ? z + 1 : z)) return t * max;
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (this.isTallCell(x, z) && !this.isWater(x, z)) return t * max;
    }
    return max;
  }

  /** Sound attenuation: how many barriers separate a and b (closed doors/windows count less). */
  barriersBetween(a: V2, b: V2): number {
    let x = Math.floor(a.x);
    let z = Math.floor(a.z);
    const ex = Math.floor(b.x);
    const ez = Math.floor(b.z);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (x + 1 - a.x) / dx : dx < 0 ? (a.x - x) / -dx : Infinity;
    let tMaxZ = dz > 0 ? (z + 1 - a.z) / dz : dz < 0 ? (a.z - z) / -dz : Infinity;
    let n = 0;
    let guard = 0;
    const cost = (k: number, door: DoorState | null) => {
      if (k === E_WALL) return 1;
      if (k === E_WINDOW) return 0.6;
      if (k === E_HEDGE || k === E_CRAWL) return 0.3;
      if (k === E_DOOR) return door && door.open ? 0 : 0.7;
      return 0;
    };
    while ((x !== ex || z !== ez) && guard++ < 400) {
      if (tMaxX <= tMaxZ) {
        const lx = stepX > 0 ? x + 1 : x;
        n += cost(this.vKind(lx, z), this.vKind(lx, z) === E_DOOR ? this.vDoor(lx, z) : null);
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        const lz = stepZ > 0 ? z + 1 : z;
        n += cost(this.hKind(x, lz), this.hKind(x, lz) === E_DOOR ? this.hDoor(x, lz) : null);
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Movement passability
  // ---------------------------------------------------------------------------
  /** Can `agent` pass the edge of given kind/door right now (or after opening)? Returns extra cost or -1. */
  private edgeCost(kind: number, door: DoorState | null, agent: NavAgent): number {
    if (kind === E_NONE) return 0;
    if (kind === E_CRAWL) return agent.crawl ? 0.5 : -1;
    if (kind !== E_DOOR || !door) return -1;
    if (door.open) return 0;
    if (!agent.opens) return -1;
    if (door.locked) {
      if (agent.master) return 2.5;
      if (door.def.lock && agent.keys?.has(door.def.lock)) return 2.5;
      return -1;
    }
    return 1;
  }

  /** Cost to step between orthogonally adjacent cells, -1 if impassable. */
  stepCost(x: number, z: number, nx: number, nz: number, agent: NavAgent): number {
    if (this.isBlockedCell(nx, nz)) return -1;
    if (nx !== x) {
      const lx = Math.max(x, nx);
      const k = this.vKind(lx, z);
      return this.edgeCost(k, k === E_DOOR ? this.vDoor(lx, z) : null, agent);
    }
    const lz = Math.max(z, nz);
    const k = this.hKind(x, lz);
    return this.edgeCost(k, k === E_DOOR ? this.hDoor(x, lz) : null, agent);
  }

  private zoneCost(cell: number, agent: NavAgent): number {
    if (!agent.zones) return 0;
    const r = this.room[cell];
    if (r < 0) return 0;
    return agent.zones.has(this.rooms[r].zone) ? 0 : 6;
  }

  private gScore = new Float32Array(MAP_W * MAP_H);
  private came = new Int32Array(MAP_W * MAP_H);
  private gen = new Uint32Array(MAP_W * MAP_H);
  private closedGen = new Uint32Array(MAP_W * MAP_H);
  private curGen = 1;
  private heap = new MinHeap();

  /** Nearest free cell to p (spiral search). */
  nearestFree(p: V2, agent?: NavAgent): V2 | null {
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    if (this.inBounds(cx, cz) && !this.isBlockedCell(cx, cz)) return { x: cx + 0.5, z: cz + 0.5 };
    for (let r = 1; r < 6; r++) {
      let best: V2 | null = null;
      let bd = Infinity;
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
          if (!this.inBounds(x, z) || this.isBlockedCell(x, z)) continue;
          const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: x + 0.5, z: z + 0.5 };
          }
        }
      }
      if (best) return best;
    }
    void agent;
    return null;
  }

  /** A* over cells. Returns world points (cell centres) from start to goal inclusive, or null. */
  findPath(from: V2, to: V2, agent: NavAgent, maxNodes = 6000): V2[] | null {
    const s = this.nearestFree(from);
    const g = this.nearestFree(to);
    if (!s || !g) return null;
    const sx = Math.floor(s.x);
    const sz = Math.floor(s.z);
    const gx = Math.floor(g.x);
    const gz = Math.floor(g.z);
    const w = this.w;
    const start = sx + sz * w;
    const goal = gx + gz * w;
    if (start === goal) return [{ x: to.x, z: to.z }];

    const gen = ++this.curGen;
    const heap = this.heap;
    heap.clear();
    this.gen[start] = gen;
    this.gScore[start] = 0;
    this.came[start] = -1;
    const hfn = (x: number, z: number) => {
      const dx = Math.abs(x - gx);
      const dz = Math.abs(z - gz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    heap.push(start, hfn(sx, sz));
    let expanded = 0;
    const DIRS = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closedGen[cur] === gen) continue;
      this.closedGen[cur] = gen;
      if (cur === goal) break;
      if (++expanded > maxNodes) return null;
      const cx = cur % w;
      const cz = (cur - cx) / w;
      const gc = this.gScore[cur];
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!this.inBounds(nx, nz)) continue;
        const ni = nx + nz * w;
        if (this.closedGen[ni] === gen) continue;
        let cost: number;
        if (dx !== 0 && dz !== 0) {
          // Diagonal: both orthogonal routes must be plain open edges.
          const a1 = this.stepCost(cx, cz, nx, cz, agent);
          const a2 = this.stepCost(nx, cz, nx, nz, agent);
          const b1 = this.stepCost(cx, cz, cx, nz, agent);
          const b2 = this.stepCost(cx, nz, nx, nz, agent);
          if (a1 !== 0 || a2 !== 0 || b1 !== 0 || b2 !== 0) continue;
          cost = Math.SQRT2;
        } else {
          const c = this.stepCost(cx, cz, nx, nz, agent);
          if (c < 0) continue;
          cost = 1 + c;
        }
        cost += this.zoneCost(ni, agent);
        const ng = gc + cost;
        if (this.gen[ni] !== gen || ng < this.gScore[ni]) {
          this.gen[ni] = gen;
          this.gScore[ni] = ng;
          this.came[ni] = cur;
          heap.push(ni, ng + hfn(nx, nz));
        }
      }
    }
    if (this.closedGen[goal] !== gen) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => ({ x: (c % w) + 0.5, z: Math.floor(c / w) + 0.5 }));
    // Replace endpoints by exact positions when they lie in the same cells.
    pts[pts.length - 1] = { x: to.x, z: to.z };
    if (Math.floor(to.x) !== gx || Math.floor(to.z) !== gz) pts[pts.length - 1] = g;
    return pts;
  }

  /** Path cost estimate (length) or Infinity if unreachable. */
  pathLength(from: V2, to: V2, agent: NavAgent): number {
    const p = this.findPath(from, to, agent);
    if (!p) return Infinity;
    let l = Math.hypot(p[0].x - from.x, p[0].z - from.z);
    for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    return l;
  }

  // ---------------------------------------------------------------------------
  // Collision geometry
  // ---------------------------------------------------------------------------
  private edgeBlocksMove(kind: number, door: DoorState | null, agent: NavAgent): boolean {
    if (kind === E_NONE) return false;
    if (kind === E_CRAWL) return !agent.crawl;
    if (kind === E_DOOR) return !(door && door.open);
    return true;
  }

  private halfFor(kind: number): number {
    if (kind === E_HEDGE || kind === E_CRAWL) return 0.28;
    if (kind === E_FENCE) return 0.06;
    if (kind === E_DOOR) return 0.06;
    return 0.1;
  }

  /** Blocking segments & boxes around p within radius r. */
  collectColliders(p: V2, r: number, agent: NavAgent, segs: Seg[], boxes: Box[]) {
    segs.length = 0;
    boxes.length = 0;
    const x0 = Math.floor(p.x - r - 1);
    const x1 = Math.floor(p.x + r + 1);
    const z0 = Math.floor(p.z - r - 1);
    const z1 = Math.floor(p.z + r + 1);
    for (let z = z0; z <= z1 + 1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= this.w || z < 0 || z > this.h) continue;
        const k = this.hEdge[x + z * this.w];
        if (k !== E_NONE) {
          const d = k === E_DOOR ? this.hDoor(x, z) : null;
          if (this.edgeBlocksMove(k, d, agent)) segs.push({ ax: x, az: z, bx: x + 1, bz: z, half: this.halfFor(k) });
        }
      }
    }
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1 + 1; x++) {
        if (x < 0 || x > this.w || z < 0 || z >= this.h) continue;
        const k = this.vEdge[x + z * (this.w + 1)];
        if (k !== E_NONE) {
          const d = k === E_DOOR ? this.vDoor(x, z) : null;
          if (this.edgeBlocksMove(k, d, agent)) segs.push({ ax: x, az: z, bx: x, bz: z + 1, half: this.halfFor(k) });
        }
      }
    }
    const seen = new Set<number>();
    for (let z = z0 + 1; z <= z1 - 1; z++) {
      for (let x = x0 + 1; x <= x1 - 1; x++) {
        if (!this.inBounds(x, z)) {
          boxes.push({ x0: x, z0: z, x1: x + 1, z1: z + 1 });
          continue;
        }
        const ci = x + z * this.w;
        if (this.flags[ci] & WATER) boxes.push({ x0: x, z0: z, x1: x + 1, z1: z + 1 });
        for (const fi of this.furnByCell[ci]) {
          if (seen.has(fi)) continue;
          seen.add(fi);
          const f = this.furniture[fi];
          boxes.push({ x0: f.x - f.w / 2, z0: f.z - f.d / 2, x1: f.x + f.w / 2, z1: f.z + f.d / 2 });
        }
      }
    }
  }

  private tmpSegs: Seg[] = [];
  private tmpBoxes: Box[] = [];

  /** Is a circle of radius r at p free of obstacles? */
  circleFree(p: V2, r: number, agent: NavAgent): boolean {
    this.collectColliders(p, r, agent, this.tmpSegs, this.tmpBoxes);
    for (const s of this.tmpSegs) {
      const d = distToSeg(p.x, p.z, s);
      if (d < r + s.half - 0.01) return false;
    }
    for (const b of this.tmpBoxes) {
      const cx = clamp(p.x, b.x0, b.x1);
      const cz = clamp(p.z, b.z0, b.z1);
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < (r - 0.01) ** 2) return false;
    }
    return true;
  }

  /** Can a circle of radius r travel the straight segment a->b? */
  walkable(a: V2, b: V2, r: number, agent: NavAgent): boolean {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / 0.2));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.circleFree({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, r, agent)) return false;
    }
    return true;
  }

  /** Greedy string-pulling. Keeps waypoints next to closed doors. */
  smooth(points: V2[], start: V2, r: number, agent: NavAgent): V2[] {
    const out: V2[] = [];
    let cur = start;
    let i = 0;
    while (i < points.length) {
      let best = i;
      for (let j = Math.min(points.length - 1, i + 14); j > i; j--) {
        if (this.walkable(cur, points[j], r, agent)) {
          best = j;
          break;
        }
      }
      out.push(points[best]);
      cur = points[best];
      i = best + 1;
    }
    return out;
  }

  /** Move a circle by delta with sliding collision. Returns the new position. */
  move(p: V2, dx: number, dz: number, r: number, agent: NavAgent): V2 {
    const L = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(L / 0.12));
    let x = p.x;
    let z = p.z;
    for (let s = 0; s < steps; s++) {
      x += dx / steps;
      z += dz / steps;
      this.collectColliders({ x, z }, r, agent, this.tmpSegs, this.tmpBoxes);
      for (let it = 0; it < 3; it++) {
        let moved = false;
        for (const sg of this.tmpSegs) {
          const abx = sg.bx - sg.ax;
          const abz = sg.bz - sg.az;
          const l2 = abx * abx + abz * abz;
          const t = clamp(((x - sg.ax) * abx + (z - sg.az) * abz) / l2, 0, 1);
          const qx = sg.ax + abx * t;
          const qz = sg.az + abz * t;
          const ddx = x - qx;
          const ddz = z - qz;
          const d = Math.hypot(ddx, ddz);
          const minD = r + sg.half;
          if (d < minD) {
            if (d > 1e-6) {
              x = qx + (ddx / d) * minD;
              z = qz + (ddz / d) * minD;
            } else {
              // Exactly on the segment: push along the segment normal towards where we came from.
              const nx = -abz / Math.sqrt(l2);
              const nz = abx / Math.sqrt(l2);
              const side = (p.x - qx) * nx + (p.z - qz) * nz >= 0 ? 1 : -1;
              x = qx + nx * minD * side;
              z = qz + nz * minD * side;
            }
            moved = true;
          }
        }
        for (const b of this.tmpBoxes) {
          const cx = clamp(x, b.x0, b.x1);
          const cz = clamp(z, b.z0, b.z1);
          const ddx = x - cx;
          const ddz = z - cz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < r * r) {
            if (d2 > 1e-10) {
              const d = Math.sqrt(d2);
              x = cx + (ddx / d) * r;
              z = cz + (ddz / d) * r;
            } else {
              // Centre inside the box: push out through the nearest side.
              const pl = x - b.x0;
              const pr = b.x1 - x;
              const pt = z - b.z0;
              const pb = b.z1 - z;
              const m = Math.min(pl, pr, pt, pb);
              if (m === pl) x = b.x0 - r;
              else if (m === pr) x = b.x1 + r;
              else if (m === pt) z = b.z0 - r;
              else z = b.z1 + r;
            }
            moved = true;
          }
        }
        if (!moved) break;
      }
      x = clamp(x, r, this.w - r);
      z = clamp(z, r, this.h - r);
    }
    return { x, z };
  }

  /** First blocking edge crossing between a and b for projectiles (walls, closed doors/windows). */
  projectileHit(a: V2, b: V2): { x: number; z: number; nx: number; nz: number } | null {
    let x = Math.floor(a.x);
    let z = Math.floor(a.z);
    const ex = Math.floor(b.x);
    const ez = Math.floor(b.z);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (x + 1 - a.x) / dx : dx < 0 ? (a.x - x) / -dx : Infinity;
    let tMaxZ = dz > 0 ? (z + 1 - a.z) / dz : dz < 0 ? (a.z - z) / -dz : Infinity;
    let guard = 0;
    const blocks = (k: number, door: DoorState | null, win: WindowState | null) => {
      if (k === E_NONE || k === E_FENCE) return false;
      if (k === E_DOOR) return !(door && door.open);
      if (k === E_WINDOW) return !(win && win.open);
      return true;
    };
    while ((x !== ex || z !== ez) && guard++ < 100) {
      if (tMaxX < tMaxZ) {
        const lx = stepX > 0 ? x + 1 : x;
        const k = this.vKind(lx, z);
        if (blocks(k, this.vDoor(lx, z), this.vWindow(lx, z))) {
          return { x: a.x + dx * tMaxX, z: a.z + dz * tMaxX, nx: -stepX, nz: 0 };
        }
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        const lz = stepZ > 0 ? z + 1 : z;
        const k = this.hKind(x, lz);
        if (blocks(k, this.hDoor(x, lz), this.hWindow(x, lz))) {
          return { x: a.x + dx * tMaxZ, z: a.z + dz * tMaxZ, nx: 0, nz: -stepZ };
        }
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return null;
  }

  /** Doors whose edges the straight segment a->b crosses. */
  doorsCrossed(a: V2, b: V2): DoorState[] {
    const out: DoorState[] = [];
    let x = Math.floor(a.x);
    let z = Math.floor(a.z);
    const ex = Math.floor(b.x);
    const ez = Math.floor(b.z);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (x + 1 - a.x) / dx : dx < 0 ? (a.x - x) / -dx : Infinity;
    let tMaxZ = dz > 0 ? (z + 1 - a.z) / dz : dz < 0 ? (a.z - z) / -dz : Infinity;
    let guard = 0;
    while ((x !== ex || z !== ez) && guard++ < 200) {
      if (tMaxX < tMaxZ) {
        const lx = stepX > 0 ? x + 1 : x;
        const d = this.vDoor(lx, z);
        if (d && !out.includes(d)) out.push(d);
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        const lz = stepZ > 0 ? z + 1 : z;
        const d = this.hDoor(x, lz);
        if (d && !out.includes(d)) out.push(d);
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return out;
  }

  /** Which side of the door's edge line is p on (+1 = greater coordinate). */
  doorSide(d: DoorState, p: V2): number {
    return d.def.axis === 'h' ? (p.z >= d.def.at ? 1 : -1) : p.x >= d.def.at ? 1 : -1;
  }

  /** Point just in front of a door on the given side. */
  doorApproach(d: DoorState, side: number, off = 0.8): V2 {
    return d.def.axis === 'h'
      ? { x: d.center.x, z: d.def.at + side * off }
      : { x: d.def.at + side * off, z: d.center.z };
  }

  /** Point just in front of a window on the given side. */
  windowApproach(w: WindowState, side: number, off = 0.7): V2 {
    return w.def.axis === 'h'
      ? { x: w.center.x, z: w.def.at + side * off }
      : { x: w.def.at + side * off, z: w.center.z };
  }

  /** Random free cell within radius of p that is reachable-ish and in an allowed zone. */
  randomFreeNear(p: V2, radius: number, rnd: () => number, zones?: ReadonlySet<Zone> | null, tries = 30): V2 | null {
    for (let i = 0; i < tries; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      const x = Math.floor(p.x + Math.sin(a) * r);
      const z = Math.floor(p.z + Math.cos(a) * r);
      if (!this.inBounds(x, z) || this.isBlockedCell(x, z)) continue;
      if (zones) {
        const ri = this.room[x + z * this.w];
        if (ri < 0 || !zones.has(this.rooms[ri].zone)) continue;
      }
      return { x: x + 0.5, z: z + 0.5 };
    }
    return null;
  }

  /** Cells of a room (centres), excluding blocked. */
  roomCells(roomId: string): V2[] {
    const r = this.roomById(roomId);
    const out: V2[] = [];
    const [x0, z0, x1, z1] = r.rect;
    const ri = this.roomIndex.get(roomId)!;
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        if (this.room[x + z * this.w] === ri && !this.isBlockedCell(x, z)) out.push({ x: x + 0.5, z: z + 0.5 });
      }
    return out;
  }
}

export function distToSeg(px: number, pz: number, s: { ax: number; az: number; bx: number; bz: number }): number {
  const abx = s.bx - s.ax;
  const abz = s.bz - s.az;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 0 ? clamp(((px - s.ax) * abx + (pz - s.az) * abz) / l2, 0, 1) : 0;
  return Math.hypot(px - (s.ax + abx * t), pz - (s.az + abz * t));
}
