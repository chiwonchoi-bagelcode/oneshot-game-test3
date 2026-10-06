// The simulation root. Owns every system and entity; the view/UI only read from it.
import { angleOf, dist, Rng, type V2 } from '../core/math';
import { Director } from './Director';
import { Emitter, type GameEvents } from './events';
import { Grid, type DoorState, type WindowState } from './Grid';
import { buildInteractables, itemActions, type ActionDef, type Interactable } from './interactions';
import { Item, resetItemIds, type Bin } from './Items';
import {
  BINS,
  Content,
  HIDE_SPOTS,
  INTEL,
  ITEM_SPAWNS,
  NPCS,
  PLAYER_LOOKS,
  SPOTS,
  STATIONS,
  TODOS,
  UNDERWEAR_LOOK,
} from './level/content';
import { PLAYER_START } from './level/layout';
import type { Circuit, OutfitId, Zone } from './level/types';
import { Lighting, Power } from './Lighting';
import { FixPowerBehavior } from './npc/behaviors';
import { Brain } from './npc/brain';
import { Npc, type SusReason } from './npc/Npc';
import { Player, type HideSpot } from './Player';
import { isDuck, ITEMS, OUTFITS, type ItemType } from './rules';
import { Security } from './Security';

export interface Noise {
  id: number;
  pos: V2;
  radius: number;
  kind: 'step' | 'whistle' | 'thud' | 'break' | 'shout' | 'scream' | 'alarm' | 'fire_alarm' | 'fireworks' | 'music' | 'engine' | 'splash';
  source: string;
  data?: Record<string, unknown>;
}

export interface Observable {
  key: string;
  kind: 'duck_out' | 'case_empty' | 'case_fake' | 'sleeper' | 'napper' | 'mess' | 'gallery_open' | 'window_open' | 'dark_room' | 'power_out';
  pos: V2;
  room?: string;
  range?: number;
  bright?: boolean;
  only?: (n: Npc) => boolean;
  item?: Item;
  npcId?: string;
  door?: number;
  window?: number;
  roomId?: string;
  circuits?: Circuit[];
}

export interface RadioMsg {
  kind: 'intruder' | 'investigate' | 'theft' | 'lockdown' | 'power_out' | 'power_ok' | 'sleeper' | 'uniform' | 'duck_found';
  text: string;
  pos?: V2;
  outfit?: OutfitId | null;
  target?: string;
  circuits?: Circuit[];
}

export interface PlayerStatus {
  outfit: OutfitId;
  legit: boolean;
  zone: Zone;
  roomId: string;
  indoor: boolean;
  trespass: boolean;
  illegal: string | null;
  duckVisible: boolean;
  oddItem: ItemType | null;
  running: boolean;
  crouching: boolean;
  inStreet: boolean;
  lockdownViolation: boolean;
}

export class Stats {
  spotted = 0;
  spottedBy = new Set<string>();
  spotEvents: { t: number; by: string; reason: SusReason }[] = [];
  compromised = new Set<OutfitId>();
  confrontations = 0;
  alarms = 0;
  lockdown = false;
  theftKnownAt = -1;
  theftKnownHow = '';
  drugged = new Set<string>();
  sickened = new Set<string>();
  outfitsUsed = new Set<OutfitId>(['guest']);
  pickpockets = 0;
  lockpicks = 0;
  hides = 0;
  recorded = 0;
  tapesErased = 0;
  wokenUp = 0;
  intel = new Set<string>();
  todos = new Set<string>();
  route = '';
  caughtBy = '';
  caughtWhy = '';
  endTime = 0;
  swapped = false;
  noteSpotted(id: string, reason: SusReason, t: number) {
    this.spotted++;
    this.spottedBy.add(id);
    this.spotEvents.push({ t, by: id, reason });
  }
  noteTheftKnown(id: string, how: string, t: number) {
    if (this.theftKnownAt < 0) {
      this.theftKnownAt = t;
      this.theftKnownHow = how;
    }
    void id;
  }
}

export interface Flags {
  jukeboxOn: boolean;
  fireworksUsed: boolean;
  fireworksShow: boolean;
  fireAlarm: boolean;
  speechActive: boolean;
  speechClap: boolean;
  tourActive: boolean;
  tourInside: boolean;
  lateGuestArguing: boolean;
  powerReported: boolean;
  fixer: string | null;
  duckFound: boolean;
  enteredProperty: boolean;
  sawDuck: boolean;
  /** NPCs who tried and failed to reach the fuse box (e.g. their key was stolen). */
  fixFailedBy: Set<string>;
}

interface Slot {
  pos: V2;
  face: number;
  owner: string | null;
}
interface Spot {
  id: string;
  center: V2;
  room: string;
  slots: Slot[];
  talkT: number;
}

interface ConvoState {
  id: string;
  line: number;
  timer: number;
  heard: number;
  speakers: Npc[];
}

export interface Option {
  target: Interactable | null;
  item: Item | null;
  action: ActionDef;
  name: string;
}

export class World {
  readonly grid = new Grid();
  readonly rng: Rng;
  readonly events = new Emitter<GameEvents>();
  readonly content = new Content();
  readonly power = new Power();
  readonly lighting: Lighting;
  readonly security = new Security();
  readonly brain = new Brain();
  readonly director: Director;
  readonly stats = new Stats();
  time = 0;
  tick = 0;
  player: Player;
  npcs: Npc[] = [];
  private npcMap = new Map<string, Npc>();
  items: Item[] = [];
  bins = new Map<string, Bin>();
  hideSpots: HideSpot[] = HIDE_SPOTS;
  observables: Observable[] = [];
  observablesDirty = true;
  private obsT = 0;
  searchers = new Set<string>();
  private claims = new Map<string, Set<string>>();
  private claimOwner = new Map<string, string[]>();
  private claimAt = new Map<string, number>();
  private noiseId = 1;
  recentNoises: (Noise & { t: number })[] = [];
  playerStatus!: PlayerStatus;
  caseItem: Item | null = null;
  caseVersion = 0;
  spiked: Record<'coffee' | 'cooler' | 'punch', { type: 'sleeping_pills' | 'laxative'; doses: number } | null> = {
    coffee: null,
    cooler: null,
    punch: null,
  };
  flags: Flags = {
    jukeboxOn: false,
    fireworksUsed: false,
    fireworksShow: false,
    fireAlarm: false,
    speechActive: false,
    speechClap: false,
    tourActive: false,
    tourInside: false,
    lateGuestArguing: false,
    powerReported: false,
    fixer: null,
    duckFound: false,
    enteredProperty: false,
    sawDuck: false,
    fixFailedBy: new Set<string>(),
  };
  private stations = new Map<string, { pos: V2; face: number }>();
  private spots: Spot[] = [];
  private toilets: { pos: V2; face: number; owner: string | null }[] = [];
  interactables: Interactable[] = [];
  options: Option[] = [];
  optionIdx = 0;
  convoBusy = new Set<string>();
  private convo: ConvoState | null = null;
  private convoCooldown = new Map<string, number>();
  ended: 'none' | 'caught' | 'escaped' = 'none';
  private jukeT = 0;
  private outageNoticeT = 0;

  constructor(seed = Date.now() % 100000) {
    resetItemIds();
    this.rng = new Rng(seed);
    this.lighting = new Lighting(this.grid, this.power);
    this.director = new Director(this);
    this.player = new Player({ x: PLAYER_START.x, z: PLAYER_START.z }, PLAYER_START.face);
    for (const s of STATIONS) this.stations.set(s.id, { pos: { x: s.x, z: s.z }, face: s.face ?? 0 });
    for (const sp of SPOTS) {
      const n = sp.slots;
      const r = sp.r ?? 0.85;
      const slots: Slot[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4;
        const pos = { x: sp.x + Math.sin(a) * r, z: sp.z + Math.cos(a) * r };
        slots.push({ pos, face: angleOf({ x: sp.x - pos.x, z: sp.z - pos.z }), owner: null });
      }
      this.spots.push({ id: sp.id, center: { x: sp.x, z: sp.z }, room: sp.room, slots, talkT: this.rng.range(1, 4) });
    }
    this.toilets = [
      { pos: { x: 49, z: 35.75 }, face: 0, owner: null },
      { pos: { x: 51, z: 35.75 }, face: 0, owner: null },
      { pos: { x: 53, z: 35.75 }, face: 0, owner: null },
    ];
    for (const b of BINS) this.bins.set(b.id, { id: b.id, name: b.name, pos: { x: b.x, z: b.z }, items: [], capacity: b.capacity });
    for (const s of ITEM_SPAWNS) {
      const it = new Item(s.type, { x: s.x, z: s.z }, s.y, this.grid.roomAt({ x: s.x, z: s.z })?.id ?? '');
      it.variant = s.variant ?? 0;
      this.items.push(it);
    }
    // The duck on display
    const duck = new Item('golden_duck', { x: 36, z: 18 }, 1.15, 'gallery');
    duck.state = 'display';
    this.items.push(duck);
    this.caseItem = duck;

    for (const def of NPCS) {
      const n = new Npc({ ...def, routine: def.routine.map((t) => ({ ...t })) as typeof def.routine });
      n.scanT = this.rng.next() * 0.3;
      for (const t of def.items ?? []) {
        const it = new Item(t, n.pos, 0, '');
        it.state = 'pocket';
        it.holder = n.id;
        n.pockets.push(it);
        this.items.push(it);
      }
      for (const k of def.keys ?? []) {
        const it = new Item(k, n.pos, 0, '');
        it.state = 'pocket';
        it.holder = n.id;
        n.pockets.push(it);
        this.items.push(it);
      }
      this.npcs.push(n);
      this.npcMap.set(n.id, n);
    }
    for (const n of this.npcs) this.brain.init(this, n);
    this.interactables = buildInteractables(this);
    this.lighting.update();
    this.playerStatus = this.computeStatus();
    // Rumours the player already knows from the briefing.
    this.stats.intel.add('intel_hedge');
    this.stats.intel.add('intel_invite');
  }

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------
  npc(id: string): Npc | undefined {
    return this.npcMap.get(id);
  }
  npcAwake(id: string): boolean {
    const n = this.npcMap.get(id);
    return !!n && n.awake;
  }
  station(id: string): { pos: V2; face: number } {
    const s = this.stations.get(id);
    if (!s) throw new Error('unknown station ' + id);
    return s;
  }
  door(id: string): DoorState {
    return this.grid.doors.find((d) => d.def.id === id)!;
  }
  /** A walkable point near p. */
  approach(p: V2, off = 0): V2 {
    const free = this.grid.nearestFree(p);
    if (!free) return p;
    if (off <= 0 && Math.floor(p.x) === Math.floor(free.x) && Math.floor(p.z) === Math.floor(free.z)) return p;
    return free;
  }

  // ---------------------------------------------------------------------------
  // Spots, toilets, claims
  // ---------------------------------------------------------------------------
  claimSlot(n: Npc, spotIds: string[]): { pos: V2; face: number } | null {
    this.releaseSlot(n);
    const cands = this.rng.shuffle(this.spots.filter((s) => spotIds.includes(s.id) && s.slots.some((sl) => !sl.owner)));
    // Prefer spots that already have someone to talk to.
    cands.sort((a, b) => b.slots.filter((s) => s.owner).length - a.slots.filter((s) => s.owner).length);
    const sp = cands[0];
    if (!sp) return null;
    const i = sp.slots.findIndex((s) => !s.owner);
    sp.slots[i].owner = n.id;
    n.slot = { spot: sp.id, i };
    return { pos: sp.slots[i].pos, face: sp.slots[i].face };
  }
  releaseSlot(n: Npc) {
    if (!n.slot) return;
    const sp = this.spots.find((s) => s.id === n.slot!.spot);
    if (sp && sp.slots[n.slot.i].owner === n.id) sp.slots[n.slot.i].owner = null;
    n.slot = null;
  }
  claimToilet(n: Npc): { pos: V2; face: number } | null {
    this.releaseToilet(n);
    const stall = this.hideSpots.find((h) => h.id === 'h_stall')!;
    const free = this.toilets.filter((t) => !t.owner && !(this.player.hidden === stall && t.pos.x === 51));
    if (!free.length) return null;
    free.sort((a, b) => dist(a.pos, n.pos) - dist(b.pos, n.pos));
    free[0].owner = n.id;
    return free[0];
  }
  releaseToilet(n: Npc) {
    for (const t of this.toilets) if (t.owner === n.id) t.owner = null;
  }
  hideOccupied(h: HideSpot): boolean {
    if (h.kind === 'stall') return this.toilets[1].owner !== null;
    return false;
  }
  /** Claim a job (e.g. investigating a noise). Up to `max` NPCs may hold it. */
  claim(key: string, npcId: string, max = 1): boolean {
    let s = this.claims.get(key);
    if (!s) {
      s = new Set();
      this.claims.set(key, s);
    }
    if (s.has(npcId)) return true;
    // Drop stale claimers: back to their routine, or busy with something newer than the claim.
    for (const id of [...s]) {
      const o = this.npc(id);
      if (!o || !o.awake || o.behavior.prio === 0 || o.behaviorSince > (this.claimAt.get(key + '|' + id) ?? 0)) s.delete(id);
    }
    if (s.size >= max) return false;
    s.add(npcId);
    this.claimAt.set(key + '|' + npcId, this.time);
    const arr = this.claimOwner.get(npcId) ?? [];
    arr.push(key);
    this.claimOwner.set(npcId, arr);
    return true;
  }
  releaseClaims(npcId: string) {
    const arr = this.claimOwner.get(npcId);
    if (!arr) return;
    for (const k of arr) this.claims.get(k)?.delete(npcId);
    this.claimOwner.delete(npcId);
  }

  // ---------------------------------------------------------------------------
  // Doors, windows, power, lights
  // ---------------------------------------------------------------------------
  setDoorOpen(d: DoorState, open: boolean, by: string, from?: V2) {
    if (d.open === open) return;
    if (open && d.locked) return;
    d.open = open;
    d.changedAt = this.time;
    d.lastUser = by;
    // Doors swing away from whoever pushes them open.
    if (from) d.swing = (d.def.axis === 'h' ? 1 : -1) * this.grid.doorSide(d, from);
    this.grid.navVersion++;
    this.lighting.dirty = true;
    this.events.emit('sfx', { name: open ? 'door_open' : 'door_close', x: d.center.x, z: d.center.z, volume: by === 'player' ? 0.8 : 0.5 });
    this.observablesDirty = true;
  }
  setDoorLocked(d: DoorState, locked: boolean, by: string) {
    if (d.locked === locked) return;
    if (locked && d.open) return;
    d.locked = locked;
    d.changedAt = this.time;
    d.lastUser = by;
    this.grid.navVersion++;
    this.events.emit('sfx', { name: 'unlock', x: d.center.x, z: d.center.z, volume: 0.6 });
  }
  someoneInDoorway(d: DoorState, except: string): boolean {
    const r = 1.05;
    if (except !== 'player' && !this.player.gone && dist(this.player.pos, d.center) < r) return true;
    for (const n of this.npcs) if (n.id !== except && n.active && dist(n.pos, d.center) < r) return true;
    return false;
  }
  closeGate(id: string, by: Npc) {
    const d = this.door(id);
    if (d.open && !this.someoneInDoorway(d, by.id)) this.setDoorOpen(d, false, by.id);
    if (!d.open) {
      d.locked = true;
      this.grid.navVersion++;
      by.say(this, '문을 닫았다! 아무도 못 나간다!', 'alert', 2.4);
    } else {
      // Someone in the way: try again a moment later.
      setTimeoutSim(this, 1.5, () => this.closeGate(id, by));
    }
  }
  setWindow(win: WindowState, open: boolean, by: string) {
    if (win.open === open) return;
    win.open = open;
    this.events.emit('sfx', { name: open ? 'door_open' : 'door_close', x: win.center.x, z: win.center.z, volume: 0.5 });
    this.observablesDirty = true;
    void by;
  }
  setSwitch(room: string, on: boolean, by: string) {
    this.lighting.setSwitch(room, on);
    this.events.emit('sfx', { name: 'switch', x: this.player.pos.x, z: this.player.pos.z, volume: by === 'player' ? 0.8 : 0.3 });
    this.observablesDirty = true;
  }
  setBreaker(c: 'main' | Circuit, on: boolean, by: string) {
    const changed = this.power.set(c, on, this.time);
    this.lighting.dirty = true;
    this.observablesDirty = true;
    this.flags.powerReported = false;
    for (const ch of changed) this.events.emit('power', { circuit: ch, on: this.power.on(ch) });
    if (changed.length) {
      this.events.emit('sfx', { name: on ? 'power_up' : 'power_down', volume: 0.9 });
      if (!on) {
        if (by === 'player') this.completeTodo('blackout');
        if (!this.power.on('B') && this.flags.jukeboxOn) this.setJukebox(false, 'power');
        const names = changed.map((x) => ({ A: '서비스동', B: '본관', C: '보안 시스템' })[x]).join(', ');
        this.events.emit('notify', { text: `⚡ ${names} 전기가 나갔다!${changed.includes('C') ? ' (카메라·진열장 경보 꺼짐)' : ''}`, kind: 'good' });
      } else {
        this.events.emit('notify', { text: '💡 전기가 다시 들어왔다.', kind: 'info' });
      }
    }
    if (this.security.alarmOn && !this.power.on('C')) this.security.stopAlarm(this);
  }
  restorePower(n: Npc): boolean {
    if (!this.power.anyOff() && this.power.breakers.main) return false;
    const changed = this.power.restoreAll(this.time);
    this.lighting.dirty = true;
    this.observablesDirty = true;
    this.flags.powerReported = false;
    for (const ch of changed) this.events.emit('power', { circuit: ch, on: true });
    if (changed.length) {
      this.events.emit('sfx', { name: 'power_up', volume: 0.9 });
      this.events.emit('notify', { text: `💡 ${n.name}이(가) 전기를 복구했다.`, kind: 'warn' });
    }
    return changed.length > 0;
  }
  setJukebox(on: boolean, by: string) {
    if (on && !this.power.on('B')) return;
    this.flags.jukeboxOn = on;
    this.jukeT = 0;
    if (on && by === 'player') this.completeTodo('jukebox');
  }

  // ---------------------------------------------------------------------------
  // Noise
  // ---------------------------------------------------------------------------
  emitNoise(n: Omit<Noise, 'id'>) {
    const noise: Noise = { ...n, id: this.noiseId++ };
    this.recentNoises.push({ ...noise, t: this.time });
    if (noise.kind !== 'step' || noise.radius > 3) this.events.emit('noise', { x: noise.pos.x, z: noise.pos.z, radius: noise.radius, kind: noise.kind });
    for (const npc of this.npcs) {
      if (!npc.awake || !npc.active || npc.id === noise.source) continue;
      const d = dist(npc.pos, noise.pos);
      if (d > noise.radius + 1) continue;
      const eff = d + this.grid.barriersBetween(npc.pos, noise.pos) * 4;
      if (eff > noise.radius && noise.radius < 60) continue;
      this.brain.onNoise(this, npc, noise, eff);
    }
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------
  removeItem(it: Item) {
    it.state = 'gone';
    it.holder = null;
    this.observablesDirty = true;
  }
  private detach(it: Item) {
    it.secured = false;
    if (it.holder) {
      const h = it.holder === 'player' ? null : this.npc(it.holder);
      if (it.holder === 'player') {
        if (this.player.hand === it) this.player.hand = null;
        this.player.pockets = this.player.pockets.filter((x) => x !== it);
      } else if (h) {
        if (h.hand === it) h.hand = null;
        h.pockets = h.pockets.filter((x) => x !== it);
      }
    }
    if (it.container) {
      it.container.contents = null;
      it.container = null;
    }
    if (it.bin) {
      const b = this.bins.get(it.bin);
      if (b) b.items = b.items.filter((x) => x !== it);
      it.bin = null;
    }
    if (this.caseItem === it) {
      this.caseItem = null;
      this.caseVersion++;
    }
    it.holder = null;
  }
  /** Put an item in the player's pocket/hand. */
  private giveToPlayer(it: Item) {
    this.detach(it);
    const p = this.player;
    if (it.def.size === 'pocket') {
      it.state = 'pocket';
      it.holder = 'player';
      p.pockets.push(it);
      this.events.emit('sfx', { name: 'pocket' });
    } else {
      if (p.hand) this.dropHeld();
      it.state = 'held';
      it.holder = 'player';
      p.hand = it;
      this.events.emit('sfx', { name: 'pickup' });
    }
    this.observablesDirty = true;
    this.afterInventoryChange();
  }
  givePlayer(type: ItemType) {
    const it = new Item(type, this.player.pos, 0, '');
    this.items.push(it);
    this.giveToPlayer(it);
    this.events.emit('notify', { text: `${ITEMS[type].icon} ${ITEMS[type].name}을(를) 챙겼다.`, kind: 'good' });
  }
  playerPickUp(it: Item) {
    if (it.state !== 'ground') return;
    this.giveToPlayer(it);
    this.events.emit('notify', { text: `${it.def.icon} ${it.name}${it.contents ? ` (안에 ${it.contents.name})` : ''}을(를) 집었다.`, kind: 'info' });
  }
  putIntoHeld(it: Item) {
    const h = this.player.hand;
    if (!h || !h.def.container || h.contents) return;
    this.detach(it);
    it.state = 'inside';
    it.container = h;
    h.contents = it;
    this.events.emit('sfx', { name: 'pocket' });
    this.observablesDirty = true;
    this.afterInventoryChange();
  }
  putHeldInto(box: Item) {
    const h = this.player.hand;
    if (!h || box.contents) return;
    this.detach(h);
    h.state = 'inside';
    h.container = box;
    box.contents = h;
    this.giveToPlayer(box);
  }
  swapHand(it: Item) {
    this.dropHeld();
    this.giveToPlayer(it);
  }
  takeOutOfContainer() {
    const h = this.player.hand;
    if (!h || !h.contents) return;
    const c = h.contents;
    if (c.def.size === 'pocket') {
      this.giveToPlayer(c);
      return;
    }
    // Put the container down, hold the content.
    this.dropHeld();
    this.giveToPlayer(c);
  }
  dropHeld() {
    const p = this.player;
    const it = p.hand;
    if (!it) return;
    p.hand = null;
    it.holder = null;
    it.state = 'ground';
    const front = { x: p.pos.x + Math.sin(p.facing) * 0.6, z: p.pos.z + Math.cos(p.facing) * 0.6 };
    const ok = this.grid.walkable(p.pos, front, 0.15, p.agent);
    it.pos = ok ? front : { ...p.pos };
    it.y = 0;
    it.version++;
    this.events.emit('sfx', { name: 'drop', x: it.pos.x, z: it.pos.z, volume: 0.6 });
    this.observablesDirty = true;
    this.afterInventoryChange();
  }
  throwHeld() {
    const p = this.player;
    const it = p.hand;
    if (!it || !it.def.throwable) {
      if (it) this.events.emit('notify', { text: `${it.name}은(는) 던질 수 없다.`, kind: 'info' });
      return;
    }
    p.hand = null;
    it.holder = null;
    it.state = 'flying';
    it.thrower = 'player';
    const dir = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    const spawn = { x: p.pos.x + dir.x * 0.4, z: p.pos.z + dir.z * 0.4 };
    // Standing against a wall: start from the player, or it would appear on the other side.
    it.pos = this.grid.projectileHit(p.pos, spawn) ? { ...p.pos } : spawn;
    it.y = 1.3;
    it.vel = { x: dir.x * 8.5, y: 4.2, z: dir.z * 8.5 };
    it.spin = 8;
    p.illegalFlash = { text: '물건을 집어던진다', until: this.time + 0.6 };
    this.events.emit('sfx', { name: 'throw', x: p.pos.x, z: p.pos.z });
    this.afterInventoryChange();
  }
  private updateItems(dt: number) {
    for (const it of this.items) {
      if (it.state === 'held' || it.state === 'pocket') {
        const h = it.holder === 'player' ? this.player.pos : it.holder ? this.npc(it.holder)?.pos : null;
        if (h) it.pos = { ...h };
      }
      if (it.state === 'inside' && it.container) it.pos = { ...it.container.pos };
      if (it.state !== 'flying') continue;
      it.vel.y -= 16 * dt;
      const next = { x: it.pos.x + it.vel.x * dt, z: it.pos.z + it.vel.z * dt };
      const hit = this.grid.projectileHit(it.pos, next);
      if (hit) {
        it.pos = { x: hit.x + hit.nx * 0.15, z: hit.z + hit.nz * 0.15 };
        if (hit.nx) it.vel.x = -it.vel.x * 0.25;
        if (hit.nz) it.vel.z = -it.vel.z * 0.25;
        this.events.emit('sfx', { name: 'thud', x: it.pos.x, z: it.pos.z, volume: 0.6 });
      } else it.pos = next;
      it.y += it.vel.y * dt;
      if (it.y <= 0) this.land(it);
    }
  }
  private land(it: Item) {
    it.y = 0;
    it.vel = { x: 0, y: 0, z: 0 };
    const cx = Math.floor(it.pos.x);
    const cz = Math.floor(it.pos.z);
    if (this.grid.isBlockedCell(cx, cz)) {
      const f = this.grid.nearestFree(it.pos);
      if (f) it.pos = { x: f.x + this.rng.range(-0.2, 0.2), z: f.z + this.rng.range(-0.2, 0.2) };
    }
    it.version++;
    this.observablesDirty = true;
    if (it.def.fragile) {
      it.state = 'gone';
      const sh = new Item('shards', it.pos, 0, '');
      this.items.push(sh);
      this.events.emit('sfx', { name: 'glass_break', x: it.pos.x, z: it.pos.z });
      this.events.emit('fx', { kind: 'shards', x: it.pos.x, z: it.pos.z });
      this.emitNoise({ pos: { ...it.pos }, radius: 13, kind: 'break', source: 'player' });
    } else {
      it.state = 'ground';
      this.events.emit('sfx', { name: 'thud', x: it.pos.x, z: it.pos.z });
      this.emitNoise({ pos: { ...it.pos }, radius: 8, kind: 'thud', source: 'player' });
    }
  }
  npcPickUp(n: Npc, it: Item) {
    this.detach(it);
    it.state = 'held';
    it.holder = n.id;
    n.hand = it;
    n.carry = it.type === 'golden_duck' ? 'duck' : it.type === 'fake_duck' ? 'fake_duck' : 'generic';
    this.observablesDirty = true;
  }
  dropNpcHand(n: Npc) {
    const it = n.hand;
    if (!it) return;
    n.hand = null;
    n.carry = 'none';
    it.holder = null;
    it.state = 'ground';
    it.pos = { x: n.pos.x + 0.3, z: n.pos.z + 0.2 };
    it.y = 0;
    it.version++;
    this.observablesDirty = true;
  }
  /** Guard puts away a found duck: back on the pedestal, on the security desk, or in his pocket. */
  npcStoreDuck(n: Npc, where: 'case' | 'desk' | 'pocket') {
    const it = n.hand;
    if (!it) return;
    n.hand = null;
    n.carry = 'none';
    if (where === 'case' && !this.caseItem) {
      it.holder = null;
      it.state = 'display';
      it.pos = { x: 36, z: 18 };
      it.y = 1.15;
      this.caseItem = it;
      this.caseVersion++;
      n.say(this, '휴, 제자리에 돌려놨다.', 'normal', 2.2);
    } else if (where === 'desk') {
      it.holder = null;
      it.state = 'ground';
      it.pos = { x: 22.6, z: 14.7 };
      it.y = 0.78;
      it.version++;
      it.secured = true;
      n.say(this, '보안실에 일단 보관해 두자.', 'normal', 2.2);
    } else {
      // Nowhere to put it: he keeps it on him (a pickpocket could still get it back).
      it.state = 'pocket';
      it.holder = n.id;
      n.pockets.push(it);
      n.say(this, '내가 직접 갖고 있어야겠군.', 'normal', 2.2);
    }
    this.flags.duckFound = true;
    this.observablesDirty = true;
  }
  collectBin(n: Npc, binId: string) {
    const b = this.bins.get(binId);
    if (!b) return;
    for (const it of b.items) {
      it.bin = null;
      it.state = 'pocket';
      it.holder = n.id;
      n.pockets.push(it);
    }
    if (b.items.length) n.carry = 'generic';
    b.items = [];
  }
  dumpCarried(n: Npc, binId: string) {
    const b = this.bins.get(binId)!;
    const keep: Item[] = [];
    for (const it of n.pockets) {
      if (isDuck(it.type) || it.type === 'gift_box' || it.type === 'tray' || it.type === 'bottle' || it.type === 'wrench' || it.type === 'rubber_duck' || it.type === 'gold_paint') {
        it.state = 'inside';
        it.holder = null;
        it.bin = binId;
        it.pos = { ...b.pos };
        b.items.push(it);
      } else keep.push(it);
    }
    n.pockets = keep;
  }
  putInBin(binId: string) {
    const b = this.bins.get(binId)!;
    const it = this.player.hand;
    if (!it) return;
    this.detach(it);
    it.state = 'inside';
    it.bin = binId;
    it.pos = { ...b.pos };
    b.items.push(it);
    this.events.emit('sfx', { name: 'drop', x: b.pos.x, z: b.pos.z, volume: 0.5 });
    this.afterInventoryChange();
  }
  takeFromBin(binId: string) {
    const b = this.bins.get(binId)!;
    const it = b.items[b.items.length - 1];
    if (!it) return;
    if (it.def.size === 'hand' && this.player.hand) {
      if (this.player.hand.def.container && !this.player.hand.contents && it.def.fits) {
        this.detach(it);
        it.state = 'inside';
        it.container = this.player.hand;
        this.player.hand.contents = it;
        this.afterInventoryChange();
        return;
      }
      return;
    }
    this.giveToPlayer(it);
  }

  // ---------------------------------------------------------------------------
  // Duck case
  // ---------------------------------------------------------------------------
  takeDuckFromCase() {
    const duck = this.caseItem;
    if (!duck || duck.type !== 'golden_duck') return;
    const armed = this.security.alarmArmed && this.power.on('C');
    const h = this.player.hand;
    if (h && h.def.container && !h.contents) {
      this.detach(duck);
      duck.state = 'inside';
      duck.container = h;
      h.contents = duck;
      this.afterInventoryChange();
    } else this.giveToPlayer(duck);
    this.caseVersion++;
    this.events.emit('fx', { kind: 'sparkle', x: 36, z: 18, y: 1.2 });
    if (armed) {
      this.security.triggerAlarm(this);
      this.events.emit('notify', { text: '🚨 경보가 울렸다! 진열장 무게 센서가 반응했다!', kind: 'danger' });
    } else {
      this.events.emit('notify', { text: '🦆 황금 오리를 손에 넣었다! 이제 빠져나가자.', kind: 'good' });
      this.events.emit('bark', { id: 'player', text: '헤헤, 이제 내 거다.', dur: 2, kind: 'thought' });
    }
  }
  swapDuck() {
    const p = this.player;
    const shown = this.caseItem;
    const h = p.hand;
    if (!shown || !h || !isDuck(h.type) || !isDuck(shown.type) || h.type === shown.type) return;
    this.detach(shown);
    this.detach(h);
    h.state = 'display';
    h.pos = { x: 36, z: 18 };
    h.y = 1.15;
    this.caseItem = h;
    this.caseVersion++;
    shown.state = 'held';
    shown.holder = 'player';
    p.hand = shown;
    this.events.emit('fx', { kind: 'sparkle', x: 36, z: 18, y: 1.2 });
    if (h.type === 'fake_duck') {
      this.stats.swapped = true;
      this.completeTodo('swap');
      this.events.emit('notify', { text: '🦆 감쪽같이 바꿔치기했다! 무게 센서도 조용하다.', kind: 'good' });
    }
    this.observablesDirty = true;
    this.afterInventoryChange();
  }
  placeOnCase() {
    const p = this.player;
    const h = p.hand;
    if (!h || !isDuck(h.type) || this.caseItem) return;
    this.detach(h);
    h.state = 'display';
    h.pos = { x: 36, z: 18 };
    h.y = 1.15;
    this.caseItem = h;
    this.caseVersion++;
    if (h.type === 'fake_duck') {
      this.stats.swapped = true;
      this.completeTodo('swap');
      this.events.emit('notify', { text: '빈 진열장에 가짜 오리를 올려 두었다. 멀리서 보면 감쪽같다.', kind: 'good' });
    }
    this.observablesDirty = true;
    this.afterInventoryChange();
  }
  paintDuck() {
    const p = this.player;
    const rd = p.removePocket('rubber_duck');
    const gp = p.removePocket('gold_paint');
    if (rd) rd.state = 'gone';
    if (gp) gp.state = 'gone';
    const fake = new Item('fake_duck', p.pos, 0, '');
    this.items.push(fake);
    this.giveToPlayer(fake);
    this.events.emit('fx', { kind: 'paint', x: p.pos.x, z: p.pos.z, y: 1 });
    this.events.emit('notify', { text: '🐤 고무 오리를 금색으로 칠했다. 가짜 황금 오리 완성!', kind: 'good' });
    this.completeTodo('fakeduck');
  }

  // ---------------------------------------------------------------------------
  // Player ↔ NPC
  // ---------------------------------------------------------------------------
  pickpocket(n: Npc, asleep: boolean) {
    const stolen = n.pockets.filter((i) => i.state === 'pocket');
    if (!stolen.length) return;
    const take = asleep ? stolen : [stolen[0]];
    for (const it of take) {
      n.pockets = n.pockets.filter((x) => x !== it);
      if (it.type.startsWith('key_')) n.keys.delete(it.type as never);
      this.giveToPlayer(it);
    }
    this.stats.pickpockets++;
    this.completeTodo('pickpocket');
    this.events.emit('notify', { text: `👛 ${n.name}에게서 ${take.map((i) => i.name).join(', ')}을(를) 슬쩍했다.`, kind: 'good' });
  }
  stripNpc(n: Npc) {
    if (!n.uniform || n.stripped) return;
    n.stripped = true;
    n.look = UNDERWEAR_LOOK(n.look);
    this.changeOutfit(n.uniform, true);
    this.observablesDirty = true;
  }
  changeOutfit(o: OutfitId, fromSource: boolean) {
    const p = this.player;
    const was = p.outfit;
    // Anyone watching us change now knows both looks.
    for (const n of this.npcs) {
      if (n.knowledge.seesPlayer && n.awake) {
        n.knowledge.compromised.add(o);
        n.knowledge.compromised.add(was);
      }
    }
    p.setOutfit(this, o);
    this.events.emit('sfx', { name: 'zip' });
    this.events.emit('fx', { kind: 'poof', x: p.pos.x, z: p.pos.z, y: 1 });
    const msg = fromSource ? `${OUTFITS[o].icon} ${OUTFITS[o].name}으로 갈아입었다. (숫자키로 언제든 다시 바꿔 입을 수 있다)` : `${OUTFITS[o].icon} ${OUTFITS[o].name}으로 갈아입었다.`;
    this.events.emit('notify', { text: msg, kind: 'good' });
    if (p.owned.size >= 3) this.completeTodo('disguise3');
  }
  /** Player-initiated outfit change from the wardrobe (number keys). */
  requestOutfit(o: OutfitId) {
    const p = this.player;
    if (!p.owned.has(o) || p.outfit === o || p.action || p.hidden || p.gone) return;
    p.startAction(this, {
      id: 'change',
      label: `${OUTFITS[o].name}으로 갈아입는 중`,
      dur: 2,
      illegal: '옷을 갈아입는다',
      anim: 'stretch',
      target: null,
      // Whoever catches any part of the change sees both the old clothes and the new uniform.
      during: (w) => {
        for (const n of w.npcs) {
          if (n.awake && n.knowledge.seesPlayer) {
            n.knowledge.compromised.add(o);
            n.knowledge.compromised.add(p.outfit);
          }
        }
      },
      done: (w) => w.changeOutfit(o, false),
    });
    this.events.emit('sfx', { name: 'cloth' });
  }
  spike(key: 'coffee' | 'cooler' | 'punch', t: 'sleeping_pills' | 'laxative') {
    const it = this.player.removePocket(t);
    if (!it) return;
    it.state = 'gone';
    this.spiked[key] = { type: t, doses: key === 'punch' ? 3 : 1 };
    this.events.emit('fx', { kind: 'pills', x: this.player.pos.x, z: this.player.pos.z, y: 1 });
    this.events.emit('notify', {
      text: `${ITEMS[t].icon} ${ITEMS[t].name}을(를) 몰래 탔다. 누가 마시게 될까?`,
      kind: 'good',
    });
  }
  consume(n: Npc, use: string) {
    if (use === 'smoke') {
      this.events.emit('fx', { kind: 'smoke', x: n.pos.x, z: n.pos.z, y: 1.6 });
      return;
    }
    if (use !== 'coffee' && use !== 'cooler' && use !== 'punch') return;
    const s = this.spiked[use];
    if (!s) return;
    s.doses--;
    if (s.doses <= 0) this.spiked[use] = null;
    this.events.emit('sfx', { name: 'gulp', x: n.pos.x, z: n.pos.z, volume: 0.5 });
    if (s.type === 'sleeping_pills') {
      n.pendingDrug = { kind: 'sleep', at: this.time + this.rng.range(7, 11) };
      this.completeTodo('sleepy');
    } else {
      n.pendingDrug = { kind: 'sick', at: this.time + this.rng.range(3, 6) };
      this.stats.sickened.add(n.id);
      this.completeTodo('sick');
    }
  }
  climbWindow(win: WindowState) {
    const p = this.player;
    const side = win.def.axis === 'h' ? (p.pos.z < win.def.at ? -1 : 1) : p.pos.x < win.def.at ? -1 : 1;
    const to = this.grid.windowApproach(win, -side, 0.7);
    const from = this.grid.windowApproach(win, side, 0.5);
    p.climb = { from, to, t: 0, dur: 0.5 };
    p.climbing = true;
    this.events.emit('sfx', { name: 'cloth', x: p.pos.x, z: p.pos.z });
  }
  whistle() {
    const p = this.player;
    if (p.whistleCd > 0 || p.gone || p.hidden) return;
    p.whistleCd = 2.2;
    this.events.emit('sfx', { name: 'whistle', x: p.pos.x, z: p.pos.z });
    this.events.emit('bark', { id: 'player', text: this.rng.pick(['휘~ 휘익♪', '삐-삐익♪', '휘리릭~']), dur: 1.4, kind: 'normal' });
    this.emitNoise({ pos: { ...p.pos }, radius: 9, kind: 'whistle', source: 'player' });
  }
  closestChaser(): number {
    let d = Infinity;
    for (const id of this.player.chasers) {
      const n = this.npc(id);
      if (n) d = Math.min(d, dist(n.pos, this.player.pos));
    }
    return d;
  }
  playerCaught(n: Npc, why: string) {
    if (this.ended !== 'none') return;
    this.ended = 'caught';
    this.player.caught = true;
    this.stats.caughtBy = n.name;
    this.stats.caughtWhy = why;
    this.stats.endTime = this.time;
    n.action = 'grab';
    n.say(this, w_caughtLine(this), 'alert', 4, 'shout');
    this.events.emit('bark', { id: 'player', text: '앗... 들켰다!', dur: 3, kind: 'thought' });
    this.events.emit('caught', { by: n.name, reason: why });
  }
  escape(route: string) {
    if (this.ended !== 'none') return;
    this.ended = 'escaped';
    this.player.escaped = true;
    this.player.gone = true;
    this.stats.route = route;
    this.stats.endTime = this.time;
    this.completeTodo('escape');
    if (this.stats.spotted === 0 && this.stats.compromised.size === 0) this.completeTodo('ghost');
    if (route === 'van') {
      this.events.emit('sfx', { name: 'engine', x: 5, z: 26 });
      this.emitNoise({ pos: { x: 5, z: 26 }, radius: 25, kind: 'engine', source: 'player' });
    }
    if (route === 'boat') this.events.emit('sfx', { name: 'boat', x: 61, z: 1 });
    if (route === 'front') {
      const dm = this.npc('doorman');
      if (dm && dm.awake && dm.behavior.prio < 50) dm.say(this, this.player.legit ? '조심히 들어가십시오, 손님!' : '...저분, 언제 들어오셨더라?', 'normal', 3);
    }
    this.events.emit('escaped', { route });
  }

  // ---------------------------------------------------------------------------
  // Intel, notes, todos
  // ---------------------------------------------------------------------------
  learnIntel(id: string) {
    if (this.stats.intel.has(id)) return;
    this.stats.intel.add(id);
    const def = INTEL.find((i) => i.id === id);
    if (def) {
      this.events.emit('intel', { id, title: def.title });
      this.events.emit('sfx', { name: 'intel' });
    }
  }
  learnIntelSilently(id: string) {
    this.learnIntel(id);
  }
  readNote(id: string) {
    const def = INTEL.find((i) => i.id === id);
    if (def) this.events.emit('notify', { text: `📝 ${def.hint}`, kind: 'intel' });
    this.learnIntel(id);
  }
  completeTodo(id: string) {
    if (this.stats.todos.has(id)) return;
    if (!TODOS.find((t) => t.id === id)) return;
    this.stats.todos.add(id);
    this.events.emit('todo', { id });
    this.events.emit('sfx', { name: 'objective' });
  }
  onRadioHeard(from: Npc, msg: RadioMsg) {
    const p = this.player;
    if (p.gone) return;
    let near = dist(from.pos, p.pos) < 12;
    if (!near) for (const n of this.npcs) if (n.radio && n.awake && dist(n.pos, p.pos) < 7) near = true;
    if (near && msg.kind !== 'power_ok') this.events.emit('notify', { text: `📻 ${from.name}: "${msg.text}"`, kind: 'warn' });
  }

  private afterInventoryChange() {
    const p = this.player;
    if (p.hasGoldenDuck() || p.pockets.some((i) => i.type === 'golden_duck')) this.completeTodo('steal');
    this.observablesDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Player status (what an onlooker could notice)
  // ---------------------------------------------------------------------------
  private computeStatus(): PlayerStatus {
    const p = this.player;
    const room = this.grid.roomAt(p.pos);
    const zone: Zone = room?.zone ?? 'street';
    let allowed = new Set(OUTFITS[p.outfit].zones);
    if (p.outfit === 'electrician' && this.power.anyOff()) allowed = new Set([...allowed, 'public', 'sec_elec']);
    // During the host's tour, guests are welcome in the gallery.
    if (this.flags.tourActive && p.outfit === 'guest') allowed.add('sec_gallery');
    const trespass = !allowed.has(zone);
    const h = p.hand;
    const duckVisible = !!h && isDuck(h.type);
    const oddItem = h && !duckVisible && h.def.odd?.includes(p.outfit) ? h.type : null;
    const rid = room?.id ?? 'street';
    let illegal = p.action?.illegal ?? null;
    if (!illegal && p.illegalFlash) illegal = p.illegalFlash.text;
    if (!illegal && p.climbing) illegal = '창문을 넘는다';
    const staffOk = (p.outfit === 'waiter' || p.outfit === 'chef' || p.outfit === 'electrician') && zone === 'staff';
    const lockdownViolation =
      this.security.lockdown && p.outfit !== 'guard' && !staffOk && rid !== 'ballroom' && rid !== 'lounge';
    return {
      outfit: p.outfit,
      legit: p.legit,
      zone,
      roomId: rid,
      indoor: !!room?.indoor,
      trespass,
      illegal,
      duckVisible,
      oddItem,
      running: p.run && !p.crouching && p.speed > 3.6,
      crouching: p.crouching && p.speed > 0.2,
      inStreet: zone === 'street',
      lockdownViolation,
    };
  }

  // ---------------------------------------------------------------------------
  // Observables refresh
  // ---------------------------------------------------------------------------
  private refreshObservables() {
    const obs: Observable[] = [];
    for (const it of this.items) {
      if (isDuck(it.type) && it.state === 'ground' && !it.secured) {
        obs.push({ key: `duck:${it.id}:${it.version}`, kind: 'duck_out', pos: it.pos, range: 11, bright: true, item: it });
      }
      if (it.type === 'shards' && it.state === 'ground') obs.push({ key: `mess:${it.id}`, kind: 'mess', pos: it.pos, range: 10, item: it });
    }
    for (const n of this.npcs) {
      if (n.awake || !n.active) continue;
      obs.push({
        key: `sleep:${n.id}:${n.sleepCount}:${n.sleepKind}:${n.stripped}`,
        kind: n.sleepKind === 'chair' && !n.stripped ? 'napper' : 'sleeper',
        pos: n.pos,
        range: 10,
        npcId: n.id,
        only: (o) => o.id !== n.id,
      });
    }
    const casePos = { x: 36, z: 18 };
    if (!this.caseItem) obs.push({ key: `case_empty:${this.caseVersion}`, kind: 'case_empty', pos: casePos, range: 9, bright: true });
    else if (this.caseItem.type === 'fake_duck')
      obs.push({ key: `case_fake:${this.caseVersion}`, kind: 'case_fake', pos: casePos, range: 1.9, only: (n) => n.job === 'host' && !this.flags.tourActive });
    const gd = this.door('d_gallery');
    if (gd.open && !this.flags.tourActive)
      obs.push({ key: `galopen:${gd.changedAt}`, kind: 'gallery_open', pos: gd.center, range: 9, door: gd.idx, only: (n) => n.isGuard });
    for (const w of this.grid.windows) {
      if (!w.open || w.def.id === 'w_bath' || w.def.fixed) continue;
      obs.push({
        key: `win:${w.idx}:${Math.floor(this.time / 60)}`,
        kind: 'window_open',
        pos: w.center,
        range: 7,
        window: w.idx,
        only: (n) => !!this.grid.roomAt(n.pos)?.indoor,
      });
    }
    for (const r of this.grid.rooms) {
      if (!r.indoor || !r.switchAt || r.dark) continue;
      const circ = r.circuit ?? 'B';
      if (!this.lighting.switches.get(r.id) && this.power.on(circ)) {
        obs.push({ key: `dark:${r.id}:${this.lighting.version}`, kind: 'dark_room', pos: { x: r.switchAt[0], z: r.switchAt[1] }, room: r.id, roomId: r.id });
      }
      if (!this.power.on(circ)) {
        obs.push({ key: `pout:${r.id}:${this.power.version}`, kind: 'power_out', pos: { x: r.switchAt[0], z: r.switchAt[1] }, room: r.id, circuits: [circ] });
      }
    }
    if (!this.power.on('C') || !this.security.camerasEnabled) {
      obs.push({
        key: `poutC:${this.power.version}:${this.security.camToggles}`,
        kind: 'power_out',
        pos: this.station('st_operator').pos,
        room: 'security',
        circuits: ['C'],
        only: (n) => n.job === 'operator',
      });
    }
    this.observables = obs;
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------
  private updateChats(dt: number) {
    const p = this.player;
    for (const sp of this.spots) {
      sp.talkT -= dt;
      if (sp.talkT > 0) continue;
      sp.talkT = this.rng.range(2.5, 5);
      const occ = sp.slots
        .map((s) => (s.owner ? this.npc(s.owner) : undefined))
        .filter((n): n is Npc => !!n && n.awake && n.behavior.name === 'routine' && n.arrived && !this.convoBusy.has(n.id));
      if (occ.length < 2) continue;
      if (dist(sp.center, p.pos) > 24) continue;
      const sp_ = this.rng.pick(occ);
      const lines = sp_.job === 'host' ? this.content.lines.hostChat : this.content.lines.guestChat;
      sp_.say(this, this.rng.pick(lines), 'normal', 2.8);
      for (const o of occ) if (o !== sp_) o.lookAt(sp_.pos, 2);
    }
    // Scripted rumours
    if (this.convo) {
      const c = this.convo;
      const def = INTEL.find((i) => i.id === c.id)!;
      const ok = c.speakers.every((s) => s.awake && s.behavior.name === 'routine');
      if (!ok) {
        this.endConvo();
        return;
      }
      for (const s of c.speakers) {
        const other = c.speakers.find((o) => o !== s);
        if (other) s.lookAt(other.pos, 1);
      }
      c.timer -= dt;
      if (c.timer <= 0) {
        const lines = def.convo!.lines;
        if (c.line < lines.length) {
          const [who, text] = lines[c.line];
          const sp = c.speakers[who];
          const near = dist(sp.pos, p.pos) < 8.5 && !p.gone;
          sp.say(this, text, near ? 'intel' : 'normal', 3.3);
          if (near) c.heard++;
          c.line++;
          c.timer = 3.5;
        } else {
          if (c.heard >= Math.max(1, def.convo!.lines.length - 1)) this.learnIntel(c.id);
          this.endConvo();
        }
      }
      return;
    }
    if (this.tick % 15 !== 0 || p.gone) return;
    for (const def of INTEL) {
      if (!def.convo) continue;
      const cd = this.convoCooldown.get(def.id) ?? -99;
      if (this.time < cd) continue;
      const speakers = def.convo.who.map((id) => this.npc(id));
      if (speakers.some((s) => !s || !s.awake || !s.active || s.behavior.name !== 'routine' || s.moving || (s.job !== 'gardener' && s.speed > 0.1))) continue;
      const ss = speakers as Npc[];
      if (ss.length > 1 && dist(ss[0].pos, ss[1].pos) > def.convo.near) continue;
      if (dist(ss[0].pos, p.pos) > 6.5) continue;
      if (!this.grid.los(ss[0].pos, p.pos) && this.grid.roomAt(ss[0].pos) !== this.grid.roomAt(p.pos)) continue;
      this.convo = { id: def.id, line: 0, timer: 0.4, heard: 0, speakers: ss };
      for (const s of ss) this.convoBusy.add(s.id);
      this.convoCooldown.set(def.id, this.time + (this.stats.intel.has(def.id) ? 150 : 45));
      break;
    }
  }
  private endConvo() {
    if (!this.convo) return;
    for (const s of this.convo.speakers) this.convoBusy.delete(s.id);
    this.convo = null;
  }
  get convoActive(): string | null {
    return this.convo?.id ?? null;
  }

  // ---------------------------------------------------------------------------
  // Interaction options
  // ---------------------------------------------------------------------------
  private refreshOptions() {
    const p = this.player;
    const opts: (Option & { score: number })[] = [];
    if (p.gone || p.action || p.climb) {
      this.options = [];
      return;
    }
    if (p.hidden) {
      const it = this.interactables.find((i) => i.id === 'hide:' + p.hidden!.id)!;
      this.options = it.actions(this).map((a) => ({ target: it, item: null, action: a, name: it.name }));
      this.optionIdx = 0;
      return;
    }
    const facingScore = (pos: V2) => {
      const d = dist(p.pos, pos);
      if (d < 0.3) return d;
      const a = Math.abs(Math.atan2(Math.sin(angleOf({ x: pos.x - p.pos.x, z: pos.z - p.pos.z }) - p.facing), Math.cos(angleOf({ x: pos.x - p.pos.x, z: pos.z - p.pos.z }) - p.facing)));
      return d + a * 0.45;
    };
    for (const it of this.interactables) {
      const pos = it.pos(this);
      const d = dist(p.pos, pos);
      if (d > it.range) continue;
      if (it.id.startsWith('npc:')) {
        const n = this.npc(it.id.slice(4));
        if (!n || !n.active) continue;
        // Furniture between you is fine (a man asleep at his desk), a wall is not.
        if (this.grid.barriersBetween(p.pos, n.pos) > 0) continue;
      }
      const isEdge = it.id.startsWith('door:') || it.id.startsWith('win:');
      if (!isEdge && it.id !== 'self' && !it.id.startsWith('npc:') && !this.grid.los(p.pos, pos)) continue;
      if (isEdge && !this.grid.los(p.pos, { x: pos.x + (p.pos.x - pos.x) * 0.2, z: pos.z + (p.pos.z - pos.z) * 0.2 })) continue;
      const acts = it.actions(this);
      const sc = (it.id === 'self' ? 50 : facingScore(pos)) + (it.bias ?? 0);
      acts.forEach((a, i) => opts.push({ target: it, item: null, action: a, name: it.name, score: sc + i * 0.01 }));
    }
    for (const item of this.items) {
      if (item.state !== 'ground') continue;
      const d = dist(p.pos, item.pos);
      if (d > 1.35) continue;
      if (!this.grid.los(p.pos, item.pos)) continue;
      const acts = itemActions(this, item);
      const sc = facingScore(item.pos) - 0.15;
      acts.forEach((a, i) => opts.push({ target: null, item, action: a, name: item.name, score: sc + i * 0.01 }));
    }
    opts.sort((a, b) => a.score - b.score);
    const prev = this.options[this.optionIdx];
    this.options = opts.slice(0, 6);
    // Keep the selection stable when possible.
    const keep = prev ? this.options.findIndex((o) => o.action.id === prev.action.id && o.target === prev.target && o.item === prev.item) : -1;
    this.optionIdx = keep >= 0 ? keep : 0;
  }
  cycleOption() {
    if (this.options.length) this.optionIdx = (this.optionIdx + 1) % this.options.length;
  }
  activateOption() {
    const p = this.player;
    if (p.gone || this.ended !== 'none') return;
    if (p.action) return;
    const o = this.options[this.optionIdx];
    if (!o) return;
    if (o.action.disabled) {
      this.events.emit('notify', { text: o.action.disabled, kind: 'info' });
      this.events.emit('sfx', { name: 'door_locked', volume: 0.4 });
      return;
    }
    const target = o.item ? o.item.pos : o.target ? o.target.pos(this) : null;
    if (o.action.sfx) this.events.emit('sfx', { name: o.action.sfx, x: p.pos.x, z: p.pos.z });
    p.startAction(this, {
      id: o.action.id,
      label: o.action.label,
      dur: o.action.dur ?? 0,
      illegal: o.action.illegal ?? null,
      anim: o.action.anim ?? 'reach',
      target: target && o.target?.id !== 'self' ? { ...target } : null,
      done: (w) => o.action.run(w),
      during: o.action.during,
    });
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------
  update(dt: number) {
    if (this.ended !== 'none') {
      // Keep the world breathing a little behind the end screen.
      this.time += dt;
      for (const n of this.npcs) n.updateMove(this, dt);
      return;
    }
    this.time += dt;
    this.tick++;
    this.player.noticedBy.clear();
    this.player.update(this, dt);
    this.playerStatus = this.computeStatus();

    if (this.lighting.update()) this.observablesDirty = true;
    this.obsT -= dt;
    if (this.observablesDirty || this.obsT <= 0) {
      this.obsT = 0.25;
      this.observablesDirty = false;
      this.refreshObservables();
    }
    this.security.update(this, dt);
    this.director.update(this, dt);
    for (const n of this.npcs) this.brain.update(this, n, dt);
    this.separate(dt);
    this.updateItems(dt);
    this.updateChats(dt);
    this.updateSimTimers(dt);
    this.updateWorldReactions(dt);
    this.updateProgress();
    this.refreshOptions();
    if (this.recentNoises.length > 40) this.recentNoises.splice(0, this.recentNoises.length - 40);
  }

  private separate(dt: number) {
    const all: { pos: V2; r: number; id: string; mobile: boolean }[] = [];
    for (const n of this.npcs) if (n.active && n.awake) all.push({ pos: n.pos, r: n.radius, id: n.id, mobile: true });
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.r + b.r - 0.08;
        if (d < min && d > 1e-4) {
          const push = ((min - d) / 2) * Math.min(1, dt * 12);
          const na = this.npc(a.id)!;
          const nb = this.npc(b.id)!;
          na.pos = this.grid.move(na.pos, (-dx / d) * push, (-dz / d) * push, na.radius, na.agent);
          nb.pos = this.grid.move(nb.pos, (dx / d) * push, (dz / d) * push, nb.radius, nb.agent);
        }
      }
    }
    // Player vs NPCs: whoever walks into the other mostly gets stopped. A player who
    // pushes into people barely moves them; people walking into a still player give way.
    const p = this.player;
    if (p.gone || p.hidden || p.climb) return;
    const pushing = Math.hypot(p.input.x, p.input.z) > 0.1;
    for (const n of this.npcs) {
      if (!n.active) continue;
      const dx = p.pos.x - n.pos.x;
      const dz = p.pos.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      const min = p.radius + n.radius - 0.05;
      if (d < min && d > 1e-4) {
        const push = min - d;
        const share = !n.awake ? 1 : pushing ? 0.8 : 0.3;
        p.pos = this.grid.move(p.pos, (dx / d) * push * share, (dz / d) * push * share, p.radius, p.agent);
        if (n.awake) n.pos = this.grid.move(n.pos, (-dx / d) * push * (1 - share), (-dz / d) * push * (1 - share), n.radius, n.agent);
      }
    }
  }

  private timers: { at: number; fn: () => void }[] = [];
  schedule(delay: number, fn: () => void) {
    this.timers.push({ at: this.time + delay, fn });
  }
  private updateSimTimers(dt: number) {
    void dt;
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= this.time);
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.fn();
  }

  private updateWorldReactions(dt: number) {
    // Jukebox noise
    if (this.flags.jukeboxOn) {
      this.jukeT -= dt;
      if (this.jukeT <= 0) {
        this.jukeT = 3;
        this.emitNoise({ pos: { x: 59, z: 26 }, radius: 11, kind: 'music', source: 'jukebox' });
      }
    }
    // The electrician notices dark windows from outside; the butler covers if needed.
    this.outageNoticeT -= dt;
    if (this.outageNoticeT <= 0) {
      this.outageNoticeT = 1;
      const offA = !this.power.on('A') ? this.time - this.power.offSince.A : -1;
      const offB = !this.power.on('B') ? this.time - this.power.offSince.B : -1;
      const offC = !this.power.on('C') ? this.time - this.power.offSince.C : -1;
      if (!this.power.anyOff()) this.flags.fixFailedBy.clear();
      const el = this.npc('electrician');
      const fixing = this.flags.fixer && this.npc(this.flags.fixer)?.behavior.name === 'fixpower';
      const elOk = el && el.awake && !this.flags.fixFailedBy.has(el.id);
      if (!fixing && elOk && (offA > 5 || offB > 5) && el.behavior.prio < 55) {
        this.brain.noticePowerOut(this, el, (['A', 'B', 'C'] as Circuit[]).filter((c) => !this.power.on(c)));
      }
      const longest = Math.max(offA, offB, offC);
      // Lights going out is plain to see; a dead security circuit only matters once someone reports it.
      const known = offA > 0 || offB > 0 || this.flags.powerReported;
      if (!fixing && known && longest > (elOk ? 50 : 12)) {
        // Someone else with an electrical room key steps in.
        for (const id of ['butler', 'chief']) {
          const o = this.npc(id);
          if (!o || !o.awake || this.flags.fixFailedBy.has(id) || !o.keys.has('key_elec') || o.behavior.prio >= 55) continue;
          if (o.behavior.name !== 'fixpower') {
            o.say(this, '전기기사가 못 온다고? 내가 차단기를 올리지.', 'normal', 2.6);
            this.brain.request(this, o, new FixPowerBehavior());
          }
          break;
        }
      }
    }
  }

  private updateProgress() {
    const p = this.player;
    const room = this.grid.roomAt(p.pos);
    if (!this.flags.enteredProperty && room && room.zone !== 'street') {
      this.flags.enteredProperty = true;
      this.completeTodo('enter');
    }
    if (!this.flags.sawDuck && dist(p.pos, { x: 36, z: 18 }) < 9 && this.grid.los(p.pos, { x: 36, z: 18 }) && this.caseItem) {
      this.flags.sawDuck = true;
      this.completeTodo('find');
    }
    if (p.legit) this.completeTodo('legit');
    // Walking out through a gate (or the crawl gap) with the duck.
    if (!p.gone && p.pos.z > 60.2 && p.hasGoldenDuck()) {
      if (this.closestChaser() < 4) {
        if (this.tick % 60 === 0) this.events.emit('notify', { text: '추격자를 따돌려야 도망칠 수 있다!', kind: 'danger' });
      } else {
        const route = p.pos.x < 12 ? 'service' : p.pos.x > 60 ? 'gap' : 'front';
        this.escape(route);
      }
    }
  }
}


function setTimeoutSim(w: World, delay: number, fn: () => void) {
  w.schedule(delay, fn);
}

function w_caughtLine(w: World): string {
  return w.rng.pick(['잡았다, 이 불청객!', '꼼짝 마! 넌 끝났어!', '드디어 잡았군!']);
}

export { PLAYER_LOOKS };
