import { angleOf, dampAngle, dist, type V2 } from '../../core/math';
import type { Appearance } from '../look';
import type { DoorState, NavAgent } from '../Grid';
import type { Item } from '../Items';
import type { KeyId, OutfitId, Zone } from '../level/types';
import { CHAR_RADIUS, NPC_SPEED } from '../rules';
import type { World } from '../World';
import type { Behavior } from './behaviors';
import type { Task } from './routine';

export type Role = 'guest' | 'staff' | 'guard' | 'host';
export type Job =
  | 'guest'
  | 'late_guest'
  | 'host'
  | 'butler'
  | 'chef'
  | 'cook'
  | 'waiter'
  | 'bartender'
  | 'maid'
  | 'electrician'
  | 'gardener'
  | 'pianist'
  | 'doorman'
  | 'svc_guard'
  | 'gallery_guard'
  | 'operator'
  | 'chief'
  | 'patrol';

export type MoveMode = 'stroll' | 'walk' | 'fast' | 'run' | 'chase';

export type Pose = 'stand' | 'walk' | 'run' | 'sneak' | 'sit' | 'sleep_floor' | 'sleep_chair' | 'cower' | 'hidden';
export type Action =
  | 'none'
  | 'talk'
  | 'drink'
  | 'cook'
  | 'clean'
  | 'piano'
  | 'smoke'
  | 'radio'
  | 'point'
  | 'clap'
  | 'wave'
  | 'dance'
  | 'type'
  | 'read'
  | 'work'
  | 'search'
  | 'reach'
  | 'shrug'
  | 'panic'
  | 'flashlight'
  | 'serve'
  | 'stretch'
  | 'eat'
  | 'paint'
  | 'lockpick'
  | 'grab'
  | 'knock'
  | 'think'
  | 'facepalm';
export type Expression =
  | 'neutral'
  | 'happy'
  | 'suspicious'
  | 'surprised'
  | 'angry'
  | 'scared'
  | 'sleepy'
  | 'sick'
  | 'sad'
  | 'smug'
  | 'focused';
export type CarryKind = 'none' | 'tray' | 'box' | 'duck' | 'fake_duck' | 'bottle' | 'generic' | 'vase' | 'wrench';

export type SusReason =
  | 'none'
  | 'trespass'
  | 'disguise'
  | 'uninvited'
  | 'behavior'
  | 'item'
  | 'lockdown'
  | 'crime'
  | 'duck'
  | 'recognized';

export const HOSTILE_REASONS: ReadonlySet<SusReason> = new Set(['crime', 'duck', 'recognized']);

export interface NpcDef {
  id: string;
  name: string;
  role: Role;
  job: Job;
  look: Appearance;
  pitch: number;
  start: V2;
  face?: number;
  zones: Zone[];
  keys?: KeyId[];
  items?: import('../rules').ItemType[];
  radio?: boolean;
  flashlight?: boolean;
  /** Outfits this NPC can see through at close range. */
  enforces?: OutfitId[];
  /** Outfit this NPC wears (can be taken while they sleep). */
  uniform?: OutfitId;
  routine: Task[];
  /** Starts the game inactive (e.g. appears later). */
  speed?: number;
}

export interface Icon {
  g: '?' | '!' | 'zzz' | '♪' | '💡' | '…' | '💢' | '💧' | '👀' | '📻' | '🔧' | '🎆' | '🧹' | '🚽';
  meter?: number;
  color: 'white' | 'yellow' | 'orange' | 'red' | 'blue' | 'green';
}

export class Knowledge {
  suspicion = 0;
  reason: SusReason = 'none';
  reasonText = '';
  seesPlayer = false;
  /** Seconds the player has been continuously visible. */
  seeTime = 0;
  lastSeen: { pos: V2; t: number; outfit: OutfitId } | null = null;
  compromised = new Set<OutfitId>();
  knowsTheft = false;
  /** Heightened alertness timer (seconds). */
  wary = 0;
  handled = new Set<string>();
  /** Short memory of what crime they saw, for reporting. */
  crime: string | null = null;
  crimePos: V2 | null = null;
  crimeOutfit: OutfitId | null = null;
  /** Peripheral proximity timer (player lingering close behind). */
  nearTime = 0;
  lastNoticeBark = -99;
  /** Last time this npc was warned / told about intruder. */
  toldAt = -99;
  /** Player outfit last confronted about and resolved (avoid nagging). */
  forgiven: { outfit: OutfitId; t: number; reason: SusReason } | null = null;
}

let barkGuard = 0;

export class Npc {
  readonly id: string;
  readonly def: NpcDef;
  name: string;
  role: Role;
  job: Job;
  look: Appearance;
  pos: V2;
  facing: number;
  headYaw = 0;
  headTarget: V2 | null = null;
  headTimer = 0;
  speed = 0;
  vel: V2 = { x: 0, z: 0 };
  radius = CHAR_RADIUS;

  // Navigation
  path: V2[] = [];
  pathIdx = 0;
  goal: V2 | null = null;
  mode: MoveMode = 'walk';
  arrived = true;
  failed = false;
  private stuckT = 0;
  private stuckRef: V2 = { x: 0, z: 0 };
  private replans = 0;
  private navVersion = -1;
  doorBusy = 0;
  doorTarget: DoorState | null = null;
  closeBehind: { door: DoorState; side: number; lock: boolean }[] = [];
  agent: NavAgent;

  // State
  keys: Set<KeyId>;
  pockets: Item[] = [];
  hand: Item | null = null;
  radio: boolean;
  hasFlashlight: boolean;
  flashlightOn = false;
  zones: Set<Zone>;
  enforces: Set<OutfitId>;
  uniform: OutfitId | null;
  stripped = false;
  asleep = 0;
  sleepKind: 'floor' | 'chair' = 'floor';
  sick = 0;
  pendingDrug: { kind: 'sleep' | 'sick'; at: number } | null = null;
  seated = false;
  hidden = false;
  /** Has walked onto the property (late guest). */
  active = true;

  knowledge = new Knowledge();
  behavior!: Behavior;
  routineIdx = 0;
  routineState: unknown = null;

  // Animation / presentation
  pose: Pose = 'stand';
  action: Action = 'none';
  expr: Expression = 'neutral';
  carry: CarryKind = 'none';
  hop = false;
  shake = 0;
  icon: Icon | null = null;
  lastBark = -99;
  talkUntil = 0;
  /** Chat spot slot occupied. */
  slot: { spot: string; i: number } | null = null;
  scanT = Math.random() * 0.3;

  constructor(def: NpcDef) {
    this.id = def.id;
    this.def = def;
    this.name = def.name;
    this.role = def.role;
    this.job = def.job;
    this.look = { ...def.look };
    this.pos = { ...def.start };
    this.facing = def.face ?? 0;
    this.keys = new Set(def.keys ?? []);
    this.radio = !!def.radio;
    this.hasFlashlight = !!def.flashlight;
    this.zones = new Set(def.zones);
    this.enforces = new Set(def.enforces ?? []);
    this.uniform = def.uniform ?? null;
    this.agent = { keys: this.keys, opens: true, zones: this.zones };
  }

  get isGuard(): boolean {
    return this.role === 'guard';
  }
  get awake(): boolean {
    return this.asleep <= 0;
  }
  get busyHostile(): boolean {
    return !!this.behavior && this.behavior.prio >= 60;
  }

  speedFor(mode: MoveMode): number {
    const base = this.def.speed ?? 1;
    switch (mode) {
      case 'stroll':
        return NPC_SPEED.stroll * base;
      case 'walk':
        return NPC_SPEED.walk * base;
      case 'fast':
        return NPC_SPEED.fast * base;
      case 'run':
        return NPC_SPEED.run * base;
      case 'chase':
        return NPC_SPEED.chase * base;
    }
  }

  say(w: World, text: string, kind: import('../events').BarkKind = 'normal', dur = 2.8, voice?: string) {
    this.lastBark = w.time;
    this.talkUntil = w.time + Math.min(dur, 2.2);
    w.events.emit('bark', { id: this.id, text, dur, kind });
    const v =
      voice ??
      (kind === 'alert' ? 'shout' : kind === 'radio' ? undefined : kind === 'thought' ? 'hmm' : 'chatter');
    if (v) {
      // Avoid a wall of overlapping voices.
      if (w.time - barkGuard > 0.05 || kind === 'alert') {
        barkGuard = w.time;
        w.events.emit('voice', { kind: v, x: this.pos.x, z: this.pos.z, pitch: this.def.pitch });
      }
    }
    if (kind === 'radio') w.events.emit('sfx', { name: 'radio', x: this.pos.x, z: this.pos.z, volume: 0.6 });
  }

  lookAt(p: V2 | null, dur = 2) {
    this.headTarget = p ? { x: p.x, z: p.z } : null;
    this.headTimer = dur;
  }

  faceTowards(p: V2, w: World, dt: number, rate = 8) {
    const a = angleOf({ x: p.x - this.pos.x, z: p.z - this.pos.z });
    this.facing = dampAngle(this.facing, a, rate, dt);
    void w;
  }

  /** Direction the head looks (world angle). */
  get viewAngle(): number {
    return this.facing + this.headYaw;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  goTo(w: World, target: V2, mode: MoveMode = 'walk', force = false): boolean {
    if (!force && this.goal && !this.failed && dist(this.goal, target) < 0.3 && this.path.length > 0) {
      this.mode = mode;
      return true;
    }
    this.mode = mode;
    this.goal = { x: target.x, z: target.z };
    this.failed = false;
    this.arrived = false;
    this.replans = 0;
    return this.plan(w);
  }

  private plan(w: World): boolean {
    if (!this.goal) return false;
    const raw = w.grid.findPath(this.pos, this.goal, this.agent);
    this.navVersion = w.grid.navVersion;
    if (!raw) {
      this.path = [];
      this.failed = true;
      this.arrived = false;
      return false;
    }
    this.path = w.grid.smooth(raw, this.pos, this.radius + 0.02, this.agent);
    this.pathIdx = 0;
    this.stuckT = 0;
    this.stuckRef = { ...this.pos };
    return true;
  }

  stop() {
    this.path = [];
    this.goal = null;
    this.arrived = true;
    this.failed = false;
    this.speed = 0;
  }

  get moving(): boolean {
    return !this.arrived && !this.failed && this.path.length > 0;
  }

  /** Remaining straight-line distance to goal. */
  get distToGoal(): number {
    return this.goal ? dist(this.pos, this.goal) : 0;
  }

  updateMove(w: World, dt: number) {
    // Handle doors we promised to close.
    this.updateCloseBehind(w);

    if (this.doorBusy > 0) {
      this.doorBusy -= dt;
      this.speed = 0;
      if (this.doorTarget) this.faceTowards(this.doorTarget.center, w, dt);
      if (this.doorBusy <= 0 && this.doorTarget) {
        const d = this.doorTarget;
        this.doorTarget = null;
        if (d.locked) {
          if (d.def.lock && this.keys.has(d.def.lock)) w.setDoorLocked(d, false, this.id);
          else {
            // Door was locked while we waited: replan.
            this.plan(w);
            return;
          }
        }
        if (!d.open) w.setDoorOpen(d, true, this.id, this.pos);
      }
      return;
    }
    if (this.arrived || this.failed || this.path.length === 0) {
      this.speed = 0;
      return;
    }
    if (this.navVersion !== w.grid.navVersion) {
      // A door changed somewhere; make sure our path is still valid lazily below.
      this.navVersion = w.grid.navVersion;
    }
    const wp = this.path[this.pathIdx];
    const last = this.pathIdx >= this.path.length - 1;

    // Doors between us and the next waypoint.
    const crossed = w.grid.doorsCrossed(this.pos, wp);
    for (const d of crossed) {
      if (d.open) {
        if (d.def.keepClosed && !this.closeBehind.some((c) => c.door === d)) {
          this.closeBehind.push({ door: d, side: w.grid.doorSide(d, this.pos), lock: !!d.def.lock && this.keys.has(d.def.lock) });
        }
        continue;
      }
      if (dist(this.pos, d.center) < 1.35) {
        const canUnlock = !d.locked || (d.def.lock && this.keys.has(d.def.lock));
        if (!canUnlock) {
          // Blocked: replan around it.
          this.replans++;
          if (this.replans > 3 || !this.plan(w)) this.failed = true;
          return;
        }
        this.doorTarget = d;
        this.doorBusy = d.locked ? 1.1 : 0.45;
        if (d.locked) w.events.emit('sfx', { name: 'unlock', x: d.center.x, z: d.center.z, volume: 0.6 });
        const relock = !!d.def.lock && this.keys.has(d.def.lock) && (d.locked || d.def.keepClosed === true);
        if (d.def.keepClosed || d.locked) {
          this.closeBehind.push({ door: d, side: w.grid.doorSide(d, this.pos), lock: relock });
        }
        this.speed = 0;
        return;
      }
      break;
    }

    const dx = wp.x - this.pos.x;
    const dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const sp = this.speedFor(this.mode);
    const reach = last ? 0.12 : 0.35;
    if (d <= reach) {
      if (last) {
        this.arrived = true;
        this.path = [];
        this.speed = 0;
        return;
      }
      this.pathIdx++;
      return;
    }
    const step = Math.min(d, sp * dt);
    const nx = dx / d;
    const nz = dz / d;
    const np = w.grid.move(this.pos, nx * step, nz * step, this.radius, this.agent);
    const moved = Math.hypot(np.x - this.pos.x, np.z - this.pos.z);
    this.vel = { x: (np.x - this.pos.x) / dt, z: (np.z - this.pos.z) / dt };
    this.pos = np;
    this.speed = moved / dt;
    this.facing = dampAngle(this.facing, angleOf({ x: nx, z: nz }), 10, dt);

    // Stuck detection
    this.stuckT += dt;
    if (this.stuckT > 1.6) {
      if (dist(this.pos, this.stuckRef) < 0.35) {
        this.replans++;
        if (this.replans > 4) {
          this.failed = true;
          return;
        }
        // Nudge sideways then replan.
        this.pos = w.grid.move(this.pos, -nz * 0.3, nx * 0.3, this.radius, this.agent);
        this.plan(w);
      }
      this.stuckT = 0;
      this.stuckRef = { ...this.pos };
    }
  }

  private updateCloseBehind(w: World) {
    for (let i = this.closeBehind.length - 1; i >= 0; i--) {
      const c = this.closeBehind[i];
      const dd = dist(this.pos, c.door.center);
      const side = w.grid.doorSide(c.door, this.pos);
      if (dd > 6) {
        this.closeBehind.splice(i, 1);
        continue;
      }
      if (side !== c.side && dd > 1.15 && dd < 3.5) {
        if (c.door.open && !w.someoneInDoorway(c.door, this.id)) {
          w.setDoorOpen(c.door, false, this.id, this.pos);
        }
        if (c.lock && !c.door.open && !c.door.locked) w.setDoorLocked(c.door, true, this.id);
        this.closeBehind.splice(i, 1);
      }
    }
  }

  /** Approximate path distance to a point (straight line fallback). */
  near(p: V2, r: number): boolean {
    return dist(this.pos, p) <= r;
  }
}
