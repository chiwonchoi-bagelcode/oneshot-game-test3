import { angleOf, dampAngle, dist, type V2 } from '../core/math';
import type { NavAgent } from './Grid';
import type { Item } from './Items';
import type { KeyId, OutfitId } from './level/types';
import type { Action } from './npc/Npc';
import { CHAR_RADIUS, isDuck, isKey, ITEMS, OUTFITS, PLAYER_SPEED, type ItemType } from './rules';
import type { World } from './World';

export interface HideSpot {
  id: string;
  name: string;
  /** Where the hiding spot is (furniture centre). */
  pos: V2;
  /** Where the player stands to get in/out. */
  exit: V2;
  kind: 'locker' | 'wardrobe' | 'bush' | 'table' | 'stall' | 'closet';
}

export interface ActiveAction {
  id: string;
  label: string;
  dur: number;
  t: number;
  illegal: string | null;
  anim: Action;
  target: V2 | null;
  done: (w: World) => void;
  /** Called every tick while in progress (e.g. lockpick sounds). */
  during?: (w: World, dt: number) => void;
  startPos: V2;
}

export class Player {
  readonly id = 'player';
  pos: V2;
  facing: number;
  vel: V2 = { x: 0, z: 0 };
  speed = 0;
  readonly radius = CHAR_RADIUS - 0.02;
  input: V2 = { x: 0, z: 0 };
  run = false;
  crouching = false;

  outfit: OutfitId = 'guest';
  owned = new Set<OutfitId>(['guest']);
  legit = false;
  hand: Item | null = null;
  pockets: Item[] = [];

  hidden: HideSpot | null = null;
  hideSeenBy = new Set<string>();
  action: ActiveAction | null = null;
  climbing = false;
  climb: { from: V2; to: V2; t: number; dur: number } | null = null;
  gone = false;
  caught = false;
  escaped = false;

  chasers = new Set<string>();
  confrontedBy = new Set<string>();
  noticedBy = new Map<string, number>();
  illegalFlash: { text: string; until: number } | null = null;

  private footT = 0;
  whistleCd = 0;
  private lockedHintT = 0;
  hop = false;
  agent: NavAgent;

  constructor(start: V2, face: number) {
    this.pos = { ...start };
    this.facing = face;
    this.agent = { keys: null, opens: false, crawl: false };
  }

  keys(): Set<KeyId> {
    const s = new Set<KeyId>();
    for (const i of this.pockets) if (isKey(i.type)) s.add(i.type);
    return s;
  }
  hasItem(t: ItemType): boolean {
    return this.pockets.some((i) => i.type === t) || this.hand?.type === t;
  }
  pocketItem(t: ItemType): Item | undefined {
    return this.pockets.find((i) => i.type === t);
  }
  removePocket(t: ItemType): Item | null {
    const i = this.pockets.findIndex((x) => x.type === t);
    if (i < 0) return null;
    const [it] = this.pockets.splice(i, 1);
    return it;
  }
  /** Is the player carrying the real golden duck in any way (hand or inside the held container)? */
  hasGoldenDuck(): boolean {
    if (!this.hand) return false;
    return this.hand.type === 'golden_duck' || this.hand.hasInside('golden_duck');
  }

  setOutfit(w: World, o: OutfitId) {
    this.outfit = o;
    this.owned.add(o);
    w.events.emit('outfit', { outfit: o });
    w.stats.outfitsUsed.add(o);
  }

  startAction(w: World, a: Omit<ActiveAction, 't' | 'startPos'>) {
    if (a.dur <= 0) {
      a.done(w);
      return;
    }
    this.action = { ...a, t: 0, startPos: { ...this.pos } };
  }

  cancelAction(w: World, reason?: string) {
    if (!this.action) return;
    this.action = null;
    if (reason) w.events.emit('notify', { text: reason, kind: 'warn' });
  }

  exitHide(w: World, forced = false) {
    const h = this.hidden;
    if (!h) return;
    this.hidden = null;
    this.hideSeenBy.clear();
    const p = w.grid.nearestFree(h.exit) ?? h.exit;
    this.pos = { x: p.x, z: p.z };
    w.events.emit('sfx', { name: forced ? 'door_open' : 'cloth', x: h.pos.x, z: h.pos.z, volume: 0.7 });
    if (forced) this.hop = true;
  }

  enterHide(w: World, h: HideSpot) {
    this.hidden = h;
    this.hideSeenBy.clear();
    for (const n of w.npcs) if (n.knowledge.seesPlayer) this.hideSeenBy.add(n.id);
    this.pos = { ...h.pos };
    this.vel = { x: 0, z: 0 };
    this.speed = 0;
    w.stats.hides++;
    w.events.emit('sfx', { name: 'cloth', x: h.pos.x, z: h.pos.z, volume: 0.7 });
  }

  update(w: World, dt: number) {
    this.whistleCd = Math.max(0, this.whistleCd - dt);
    this.lockedHintT = Math.max(0, this.lockedHintT - dt);
    if (this.illegalFlash && w.time > this.illegalFlash.until) this.illegalFlash = null;
    if (this.gone) return;

    if (this.climb) {
      this.climbing = true;
      this.climb.t += dt;
      const k = Math.min(1, this.climb.t / this.climb.dur);
      this.pos = { x: this.climb.from.x + (this.climb.to.x - this.climb.from.x) * k, z: this.climb.from.z + (this.climb.to.z - this.climb.from.z) * k };
      if (k >= 1) {
        this.climb = null;
        this.climbing = false;
      }
      return;
    }
    if (this.hidden) {
      this.speed = 0;
      if (Math.hypot(this.input.x, this.input.z) > 0.5 && !this.action) this.exitHide(w);
      return;
    }

    // Action in progress?
    if (this.action) {
      const a = this.action;
      if (Math.hypot(this.input.x, this.input.z) > 0.3) {
        this.cancelAction(w);
      } else {
        a.t += dt;
        a.during?.(w, dt);
        if (a.target) this.facing = dampAngle(this.facing, angleOf({ x: a.target.x - this.pos.x, z: a.target.z - this.pos.z }), 10, dt);
        this.vel = { x: 0, z: 0 };
        this.speed = 0;
        if (a.t >= a.dur) {
          this.action = null;
          a.done(w);
        }
        return;
      }
    }

    // Movement
    const inLen = Math.hypot(this.input.x, this.input.z);
    let max = this.crouching ? PLAYER_SPEED.crouch : this.run ? PLAYER_SPEED.run : PLAYER_SPEED.walk;
    if (this.hand && isDuck(this.hand.type)) max *= 0.9;
    const target = inLen > 0.01 ? { x: (this.input.x / Math.max(1, inLen)) * max, z: (this.input.z / Math.max(1, inLen)) * max } : { x: 0, z: 0 };
    const k = 1 - Math.exp(-14 * dt);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;
    this.agent.crawl = this.crouching;
    const before = this.pos;
    // Auto-open doors we walk into.
    if (inLen > 0.1) {
      const ahead = { x: this.pos.x + (this.input.x / inLen) * 0.75, z: this.pos.z + (this.input.z / inLen) * 0.75 };
      for (const d of w.grid.doorsCrossed(this.pos, ahead)) {
        if (d.open) continue;
        if (!d.locked) {
          w.setDoorOpen(d, true, 'player', this.pos);
        } else if (this.lockedHintT <= 0) {
          this.lockedHintT = 2.5;
          const need = d.def.lock ? ITEMS[d.def.lock].name : '';
          const has = d.def.lock && this.keys().has(d.def.lock);
          w.events.emit('notify', {
            text: d.def.gate ? '문이 굳게 닫혀 있다.' : has ? `잠겨 있다. [E]로 ${need}를 써서 열 수 있다.` : `잠겨 있다.${need ? ` (${need} 필요${d.def.pickable ? ', 또는 자물쇠 따기' : ''})` : ''}`,
            kind: 'info',
          });
          w.events.emit('sfx', { name: 'door_locked', x: d.center.x, z: d.center.z, volume: 0.6 });
        }
      }
    }
    this.pos = w.grid.move(this.pos, this.vel.x * dt, this.vel.z * dt, this.radius, this.agent);
    const moved = dist(before, this.pos);
    this.speed = moved / Math.max(dt, 1e-4);
    if (inLen > 0.1) this.facing = dampAngle(this.facing, angleOf(this.input), 14, dt);

    // Footsteps
    if (this.speed > 0.4) {
      this.footT -= dt * (this.speed / 2.2);
      if (this.footT <= 0) {
        this.footT = 0.5;
        const room = w.grid.roomAt(this.pos);
        const soft = !room || !room.indoor || room.floor.startsWith('carpet') || room.floor === 'grass';
        const running = this.run && !this.crouching && this.speed > 4;
        w.events.emit('sfx', {
          name: room && !room.indoor && room.floor === 'grass' ? 'step_grass' : running ? 'step_run' : 'step',
          x: this.pos.x,
          z: this.pos.z,
          volume: this.crouching ? 0.15 : running ? 0.8 : 0.35,
        });
        if (running) w.emitNoise({ pos: { ...this.pos }, radius: soft ? 5 : 7, kind: 'step', source: 'player' });
        else if (!this.crouching && !soft) w.emitNoise({ pos: { ...this.pos }, radius: 1.6, kind: 'step', source: 'player' });
      }
    }
  }

  get statusText(): string {
    return OUTFITS[this.outfit].name;
  }
}
