// NPC behaviours. Each NPC runs exactly one behaviour at a time; higher priority
// behaviours pre-empt lower ones, and when a behaviour finishes the NPC goes back
// to its routine. All knowledge an NPC acts on comes from what *it* perceived or
// was told (see brain.ts / perception.ts).
import { angleOf, dist, type V2 } from '../../core/math';
import type { Item } from '../Items';
import type { OutfitId } from '../level/types';
import { OUTFITS } from '../rules';
import type { World } from '../World';
import type { Npc, SusReason } from './Npc';

export abstract class Behavior {
  abstract readonly name: string;
  done = false;
  t = 0;
  constructor(public prio: number) {}
  enter(w: World, n: Npc): void {
    void w;
    void n;
  }
  abstract tick(w: World, n: Npc, dt: number): void;
  exit(w: World, n: Npc): void {
    void w;
    void n;
  }
  /** Absorb an incoming request of the same kind instead of being replaced. */
  absorb(w: World, n: Npc, b: Behavior): boolean {
    void w;
    void n;
    void b;
    return false;
  }
}

export interface Report {
  kind: 'intruder' | 'theft' | 'sleeper' | 'trespass' | 'disguise' | 'duck_found' | 'uniform';
  outfit?: OutfitId | null;
  pos?: V2;
  text: string;
  item?: Item;
  sleeperId?: string;
}

const lookAround = (w: World, n: Npc, t: number) => {
  const a = n.facing + Math.sin(t * 1.7) * 1.1;
  n.lookAt({ x: n.pos.x + Math.sin(a) * 3, z: n.pos.z + Math.cos(a) * 3 }, 0.3);
  void w;
};

// ---------------------------------------------------------------------------
// Notice: stop and stare while suspicion builds.
// ---------------------------------------------------------------------------
export class NoticeBehavior extends Behavior {
  readonly name = 'notice';
  constructor() {
    super(35);
  }
  enter(w: World, n: Npc) {
    n.stop();
    if (w.time - n.knowledge.lastNoticeBark > 8) {
      n.knowledge.lastNoticeBark = w.time;
      const lines = w.content.noticeLines(n, n.knowledge.reason);
      n.say(w, w.rng.pick(lines), 'thought', 2.2, 'hmm');
      w.events.emit('sfx', { name: 'notice', x: n.pos.x, z: n.pos.z, volume: 0.6 });
    }
  }
  tick(w: World, n: Npc, dt: number) {
    const k = n.knowledge;
    n.expr = 'suspicious';
    if (k.seesPlayer) {
      n.faceTowards(w.player.pos, w, dt, 4);
      n.lookAt(w.player.pos, 0.5);
    } else if (k.lastSeen) {
      n.lookAt(k.lastSeen.pos, 0.5);
    }
    if (k.suspicion < 0.08) {
      this.done = true;
      return;
    }
    if (!k.seesPlayer && this.t > 1.2) {
      // Lost them before making up our mind.
      this.done = true;
      if (k.suspicion > 0.45 && k.lastSeen && (n.isGuard || n.enforces.size > 0)) {
        w.brain.request(w, n, new InvestigateBehavior(k.lastSeen.pos, 'sight'));
      } else if (w.time - k.lastNoticeBark > 2) {
        n.say(w, w.rng.pick(['기분 탓인가...', '뭐였지?', '음... 아닌가.']), 'thought', 2);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Investigate a position (noise, sighting, report, environment change...).
// ---------------------------------------------------------------------------
export type InvestigateWhy =
  | 'noise'
  | 'whistle'
  | 'sight'
  | 'report'
  | 'light'
  | 'music'
  | 'mess'
  | 'door'
  | 'window'
  | 'sleeper'
  | 'napper'
  | 'camera'
  | 'fireworks'
  | 'scream'
  | 'shout'
  | 'engine';

export class InvestigateBehavior extends Behavior {
  readonly name = 'investigate';
  private phase = 0;
  private timer = 0;
  constructor(
    public pos: V2,
    public why: InvestigateWhy,
    public data: { room?: string; door?: number; window?: number; item?: Item; npcId?: string; claim?: string } = {},
    prio?: number,
  ) {
    super(prio ?? InvestigateBehavior.prioFor(why));
  }
  static prioFor(why: InvestigateWhy): number {
    switch (why) {
      case 'light':
      case 'music':
      case 'mess':
      case 'window':
      case 'napper':
        return 20;
      case 'door':
        return 30;
      case 'sleeper':
        return 42;
      case 'scream':
      case 'shout':
      case 'report':
      case 'camera':
        return 45;
      case 'sight':
        return 40;
      default:
        return 25;
    }
  }
  absorb(w: World, n: Npc, b: Behavior): boolean {
    if (b instanceof InvestigateBehavior && b.why === this.why && dist(b.pos, this.pos) < 6) {
      this.pos = b.pos;
      if (this.phase >= 2) {
        this.phase = 1;
        n.goTo(w, this.target(w), this.mode(n), true);
      }
      return true;
    }
    return false;
  }
  private urgent(): boolean {
    return ['scream', 'shout', 'report', 'camera', 'sleeper'].includes(this.why);
  }
  private mode(n: Npc) {
    if (this.urgent()) return n.isGuard ? 'run' : 'fast';
    if (this.why === 'sight' || this.why === 'whistle' || this.why === 'noise') return n.knowledge.wary > 0 ? 'fast' : 'walk';
    return 'walk';
  }
  private target(w: World): V2 {
    if (this.why === 'light' && this.data.room) {
      const r = w.grid.roomById(this.data.room);
      if (r.switchAt) return { x: r.switchAt[0], z: r.switchAt[1] };
    }
    if (this.why === 'music') return w.station('st_jukebox').pos;
    if ((this.why === 'door') && this.data.door !== undefined) {
      const d = w.grid.doors[this.data.door];
      return w.grid.doorApproach(d, 1, 0.9);
    }
    if (this.why === 'window' && this.data.window !== undefined) {
      const win = w.grid.windows[this.data.window];
      return w.grid.windowApproach(win, win.inward.x + win.inward.z > 0 ? 1 : -1, 0.8);
    }
    if (this.why === 'sleeper' || this.why === 'napper') {
      const s = this.data.npcId ? w.npc(this.data.npcId) : null;
      if (s) return w.approach(s.pos, 0.9);
    }
    if (this.why === 'mess' && this.data.item) return w.approach(this.data.item.pos, 0.7);
    return w.approach(this.pos, 0.2);
  }
  enter(w: World, n: Npc) {
    this.phase = this.urgent() ? 1 : 0;
    this.timer = w.rng.range(0.6, 1.1);
    n.stop();
    n.lookAt(this.pos, 1.5);
    if (this.phase === 1) n.goTo(w, this.target(w), this.mode(n), true);
    const line = w.content.investigateLine(n, this.why);
    if (line) n.say(w, line, this.urgent() ? 'alert' : 'thought', 2.4, this.urgent() ? 'huh' : 'hmm');
  }
  exit(w: World, n: Npc) {
    w.releaseClaims(n.id);
    n.action = 'none';
  }
  tick(w: World, n: Npc, dt: number) {
    if (this.phase === 0) {
      n.faceTowards(this.pos, w, dt, 5);
      n.expr = 'suspicious';
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 1;
        if (!n.goTo(w, this.target(w), this.mode(n), true)) {
          this.done = true;
        }
      }
      return;
    }
    if (this.phase === 1) {
      n.expr = this.urgent() ? 'focused' : 'suspicious';
      if (n.failed) {
        n.say(w, '이쪽으로는 못 가겠네...', 'thought', 2);
        this.done = true;
        return;
      }
      // Sleeper/napper may wake up while we walk.
      if ((this.why === 'sleeper' || this.why === 'napper') && this.data.npcId) {
        const s = w.npc(this.data.npcId);
        if (!s || s.awake) {
          this.done = true;
          return;
        }
      }
      if (this.why === 'mess' && this.data.item && this.data.item.state !== 'ground') {
        this.done = true;
        return;
      }
      if (n.arrived) {
        this.phase = 2;
        this.timer = this.handleTime();
      }
      return;
    }
    if (this.phase === 2) {
      this.timer -= dt;
      this.handle(w, n, dt);
      if (this.timer <= 0) {
        this.finishHandle(w, n);
        this.phase = 3;
        this.timer = this.lookTime(w);
      }
      return;
    }
    if (this.phase === 3) {
      n.action = 'search';
      lookAround(w, n, this.t);
      this.timer -= dt;
      if (this.timer <= 0) {
        n.action = 'none';
        if ((this.why === 'report' || this.why === 'camera' || this.why === 'shout' || this.why === 'scream') && n.isGuard) {
          w.brain.request(w, n, new SearchBehavior(this.pos, 22), true);
        } else if (['noise', 'whistle', 'sight', 'engine'].includes(this.why) && w.rng.chance(0.6)) {
          n.say(w, w.rng.pick(w.content.lines.nothing), 'thought', 2.2);
        }
        if (n.isGuard) n.knowledge.wary = Math.max(n.knowledge.wary, 40);
        this.done = true;
      }
    }
  }
  private handleTime() {
    switch (this.why) {
      case 'light':
      case 'music':
      case 'window':
        return 0.8;
      case 'mess':
        return 4;
      case 'door':
        return 1.2;
      case 'sleeper':
      case 'napper':
        return 2.2;
      default:
        return 0.1;
    }
  }
  private lookTime(w: World) {
    switch (this.why) {
      case 'light':
      case 'music':
      case 'mess':
      case 'window':
      case 'napper':
        return 0.6;
      case 'door':
        return 1.5;
      case 'sleeper':
        return 0.5;
      default:
        return w.rng.range(2.5, 4);
    }
  }
  private handle(w: World, n: Npc, dt: number) {
    switch (this.why) {
      case 'mess':
        n.action = 'clean';
        if (this.data.item) n.faceTowards(this.data.item.pos, w, dt);
        break;
      case 'light':
      case 'music':
      case 'window':
      case 'door':
        n.action = 'reach';
        break;
      case 'sleeper':
      case 'napper': {
        const s = this.data.npcId ? w.npc(this.data.npcId) : null;
        if (s) n.faceTowards(s.pos, w, dt);
        n.action = 'grab';
        break;
      }
      default:
        n.action = 'search';
        lookAround(w, n, this.t);
    }
  }
  private finishHandle(w: World, n: Npc) {
    n.action = 'none';
    switch (this.why) {
      case 'light':
        if (this.data.room && !w.lighting.switches.get(this.data.room)) {
          w.setSwitch(this.data.room, true, n.id);
          n.say(w, w.rng.pick(['누가 불을 껐지?', '이제야 좀 보이네.', '장난치는 사람이 있나...']), 'normal', 2.2);
        }
        break;
      case 'music':
        if (w.flags.jukeboxOn) {
          w.setJukebox(false, n.id);
          n.say(w, w.rng.pick(['시끄러워 죽겠네!', '누가 이걸 틀어놨어?', '파티 분위기 망치겠군.']), 'normal', 2.2);
        }
        break;
      case 'mess':
        if (this.data.item && this.data.item.state === 'ground') {
          w.removeItem(this.data.item);
          n.say(w, w.rng.pick(['누가 깨뜨린 거야...', '조심 좀 하지.', '이걸 또 치우네.']), 'normal', 2.2);
        }
        break;
      case 'window':
        if (this.data.window !== undefined) {
          const win = w.grid.windows[this.data.window];
          if (win.open) {
            w.setWindow(win, false, n.id);
            n.say(w, '창문이 왜 열려 있지?', 'thought', 2);
          }
        }
        break;
      case 'door': {
        if (this.data.door !== undefined) {
          const d = w.grid.doors[this.data.door];
          if (d.open && !w.someoneInDoorway(d, n.id)) w.setDoorOpen(d, false, n.id, n.pos);
          if (!d.open && d.def.lock && n.keys.has(d.def.lock)) w.setDoorLocked(d, true, n.id);
          n.say(w, d.def.id === 'd_gallery' ? '전시실 문이 왜 열려 있었지...?' : '문을 닫아 둬야지.', 'thought', 2.2);
          if (d.def.id === 'd_gallery' && n.isGuard) n.knowledge.wary = Math.max(n.knowledge.wary, 90);
        }
        break;
      }
      case 'napper': {
        const s = this.data.npcId ? w.npc(this.data.npcId) : null;
        if (s && !s.awake && s.sleepKind === 'chair') {
          w.brain.wake(w, s, n);
        }
        break;
      }
      case 'sleeper': {
        const s = this.data.npcId ? w.npc(this.data.npcId) : null;
        if (s && !s.awake) {
          n.say(w, w.rng.pick(['이봐요! 정신 차려요!', '일어나 봐요! 괜찮아요?']), 'alert', 2.2, 'gasp');
          w.brain.foundSleeper(w, n, s);
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Confront: guard (or enforcer) approaches the player and asks them to comply.
// ---------------------------------------------------------------------------
export class ConfrontBehavior extends Behavior {
  readonly name = 'confront';
  private phase = 0;
  private hold = 0;
  private lost = 0;
  private repath = 0;
  private okTimer = 0;
  private warned = false;
  constructor(public reason: SusReason) {
    super(50);
  }
  absorb(): boolean {
    return true;
  }
  private startOutfit: OutfitId | null = null;
  enter(w: World, n: Npc) {
    n.goTo(w, w.player.pos, 'fast', true);
    w.player.confrontedBy.add(n.id);
    w.stats.confrontations++;
    this.startOutfit = w.player.outfit;
  }
  exit(w: World, n: Npc) {
    w.player.confrontedBy.delete(n.id);
  }
  private warning(w: World): string {
    return w.content.confrontLine(this.reason, w.player.outfit);
  }
  private complied(w: World, n: Npc): boolean {
    const st = w.playerStatus;
    switch (this.reason) {
      case 'trespass':
        return !st.trespass;
      case 'uninvited':
        if (w.player.legit) return true;
        if (w.player.hasItem('invitation')) {
          w.player.removePocket('invitation');
          w.player.legit = true;
          n.say(w, '아, 초대장 확인했습니다. 실례했습니다.', 'normal', 2.5);
          w.events.emit('notify', { text: '초대장을 보여줬다. 이제 정식 손님이다.', kind: 'good' });
          w.events.emit('sfx', { name: 'pocket' });
          return true;
        }
        return st.inStreet;
      case 'behavior':
        return !st.running && !st.crouching;
      case 'disguise':
        // "You're not one of ours": only getting out of that uniform settles it.
        return w.player.outfit !== this.startOutfit;
      case 'item':
        return !st.oddItem;
      case 'lockdown': {
        const r = w.grid.roomAt(w.player.pos)?.id;
        if (w.player.hand && w.player.hand.hasInside('golden_duck')) return false;
        return r === 'ballroom' || r === 'lounge' || !st.lockdownViolation;
      }
      default:
        return false;
    }
  }
  tick(w: World, n: Npc, dt: number) {
    const k = n.knowledge;
    const p = w.player;
    n.expr = this.reason === 'uninvited' ? 'suspicious' : 'angry';
    if (!k.seesPlayer) {
      this.lost += dt;
      if (this.lost > 3) {
        this.done = true;
        if (k.lastSeen && n.isGuard) w.brain.request(w, n, new InvestigateBehavior(k.lastSeen.pos, 'sight'), true);
        return;
      }
    } else this.lost = 0;

    // Frisk during lockdown: a container hiding the duck is discovered.
    if (this.phase === 1 && w.security.lockdown && n.isGuard && dist(n.pos, p.pos) < 2.4 && p.hand?.hasInside('golden_duck')) {
      n.say(w, '그 상자 안 좀 봅시다... 이건 황금 오리잖아!', 'alert', 3);
      this.done = true;
      w.brain.escalate(w, n, 'duck', '숨겨 둔 황금 오리를 들켰다');
      return;
    }

    if (this.phase === 0) {
      this.repath -= dt;
      if (this.repath <= 0 && k.seesPlayer) {
        this.repath = 0.5;
        n.goTo(w, p.pos, 'fast', true);
      }
      const d = dist(n.pos, p.pos);
      if (!this.warned && d < 7 && k.seesPlayer) {
        this.warned = true;
        n.say(w, this.warning(w), 'alert', 3.2, 'ahem');
      }
      if (d < 2.2) {
        n.stop();
        this.phase = 1;
        this.hold = this.reason === 'uninvited' ? 5 : this.reason === 'lockdown' ? 8 : 6;
        if (!this.warned) {
          this.warned = true;
          n.say(w, this.warning(w), 'alert', 3.2, 'ahem');
        }
      }
      if (this.complied(w, n)) this.okTimer += dt;
      else this.okTimer = 0;
      if (this.okTimer > 1.2) this.resolve(w, n);
      return;
    }
    // Holding: facing the player, waiting for compliance.
    n.faceTowards(p.pos, w, dt, 6);
    n.lookAt(p.pos, 0.4);
    n.action = 'point';
    const d = dist(n.pos, p.pos);
    if (d > 3.2 && k.seesPlayer) {
      // Follow at a short distance.
      n.goTo(w, p.pos, 'fast', true);
      this.phase = 0;
    }
    if (this.complied(w, n)) {
      this.okTimer += dt;
      if (this.okTimer > (this.reason === 'trespass' ? 0.6 : 1.4)) this.resolve(w, n);
      return;
    }
    this.okTimer = 0;
    this.hold -= dt;
    if (this.hold <= 0) {
      this.done = true;
      n.action = 'none';
      if (n.isGuard) {
        n.say(w, w.rng.pick(['말로 해서는 안 되겠군!', '좋아, 순순히 따르지 않겠다면!']), 'alert', 2.4);
        w.brain.escalate(w, n, 'recognized', '경고를 무시했다');
      } else {
        w.brain.request(
          w,
          n,
          new FleeReportBehavior({ kind: this.reason === 'uninvited' || this.reason === 'disguise' ? 'disguise' : 'trespass', outfit: p.outfit, pos: { ...p.pos }, text: w.content.reportText(this.reason, p.outfit) }, false),
          true,
        );
      }
    }
  }
  private resolve(w: World, n: Npc) {
    this.done = true;
    n.action = 'none';
    n.knowledge.suspicion = 0.35;
    n.knowledge.forgiven = { outfit: w.player.outfit, t: w.time, reason: this.reason };
    if (this.reason !== 'uninvited') n.say(w, w.rng.pick(['좋습니다. 조심하세요.', '다음엔 봐드리지 않습니다.', '흠, 그럼 됐습니다.']), 'normal', 2.2);
    n.knowledge.wary = Math.max(n.knowledge.wary, 60);
  }
}

// ---------------------------------------------------------------------------
// Chase: run the player down. Catching them ends the game.
// ---------------------------------------------------------------------------
export class ChaseBehavior extends Behavior {
  readonly name = 'chase';
  private repath = 0;
  private shoutT = 0;
  private lostT = 0;
  stun = 0;
  constructor(public why: string) {
    super(80);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.hop = true;
    n.expr = 'angry';
    n.say(w, w.rng.pick(w.content.lines.chaseStart), 'alert', 2.5, 'shout');
    w.events.emit('sfx', { name: 'alert', x: n.pos.x, z: n.pos.z });
    w.player.chasers.add(n.id);
    if (n.radio) w.security.radioIntruder(w, n, w.player.outfit, { ...w.player.pos }, this.why);
  }
  exit(w: World, n: Npc) {
    w.player.chasers.delete(n.id);
    // Still on edge, but it takes a fresh sighting to start another chase.
    n.knowledge.suspicion = Math.min(n.knowledge.suspicion, 0.9);
    n.knowledge.wary = Math.max(n.knowledge.wary, 120);
  }
  private hiddenT = 0;
  tick(w: World, n: Npc, dt: number) {
    const k = n.knowledge;
    const p = w.player;
    n.expr = 'angry';
    if (this.stun > 0) {
      this.stun -= dt;
      n.expr = 'surprised';
      n.stop();
      return;
    }
    this.shoutT -= dt;
    if (this.shoutT <= 0) {
      this.shoutT = w.rng.range(4, 6.5);
      if (this.t > 1) n.say(w, w.rng.pick(w.content.lines.chase), 'alert', 2, 'shout');
      w.emitNoise({ pos: { ...n.pos }, radius: 15, kind: 'shout', source: n.id, data: { pos: k.lastSeen?.pos } });
    }
    // We chase the person we recognise: after an unseen change of clothes they're a stranger.
    const recognised = k.seesPlayer && !p.hidden && (k.compromised.has(p.outfit) || w.playerStatus.duckVisible || !!w.playerStatus.illegal);
    if (recognised) {
      this.lostT = 0;
      this.repath -= dt;
      if (this.repath <= 0 || n.arrived) {
        this.repath = 0.25;
        n.goTo(w, p.pos, 'chase', true);
      }
      if (dist(n.pos, p.pos) < 1.0 && !p.climbing) {
        w.playerCaught(n, this.why);
        this.done = true;
      }
      return;
    }
    // Saw the player get into a hiding spot.
    if (p.hidden && p.hideSeenBy.has(n.id) && this.hiddenT < 15) {
      const spot = p.hidden;
      this.hiddenT += dt;
      if (dist(n.pos, spot.exit) > 0.7 && dist(n.pos, spot.pos) > 1.0) {
        if (!n.failed && (!n.goal || dist(n.goal, spot.exit) > 0.3)) n.goTo(w, spot.exit, 'chase', true);
        // Can't get there (locked out): give up on it and search around instead.
        if (!n.failed) return;
        this.hiddenT = 99;
      } else {
        n.say(w, '거기 숨은 거 다 봤다!', 'alert', 2);
        w.playerCaught(n, '숨는 모습을 들켰다');
        this.done = true;
        return;
      }
    }
    this.lostT += dt;
    const target = k.lastSeen?.pos;
    if (target && (n.goal === null || dist(n.goal, target) > 0.5) && !n.arrived) n.goTo(w, target, 'chase');
    if ((n.arrived || n.failed || !target) && this.lostT > 1.2) {
      this.done = true;
      n.say(w, w.rng.pick(['어디 갔지?!', '분명 이쪽으로 왔는데!', '놓쳤나?!']), 'alert', 2.2);
      w.events.emit('sfx', { name: 'lost', x: n.pos.x, z: n.pos.z, volume: 0.5 });
      w.brain.request(w, n, new SearchBehavior(target ?? n.pos, 35), true);
    }
  }
}

// ---------------------------------------------------------------------------
// Search an area after losing the player (or after a report).
// ---------------------------------------------------------------------------
export class SearchBehavior extends Behavior {
  readonly name = 'search';
  private points: { p: V2; hide?: string }[] = [];
  private phase = 0;
  private timer = 0;
  private remaining: number;
  constructor(public center: V2, dur: number, prio = 60) {
    super(prio);
    this.remaining = dur;
  }
  absorb(w: World, n: Npc, b: Behavior): boolean {
    if (b instanceof SearchBehavior) {
      this.center = b.center;
      this.remaining = Math.max(this.remaining, b.remaining);
      this.points = [];
      this.plan(w, n);
      return true;
    }
    return false;
  }
  private plan(w: World, n: Npc) {
    this.points = [{ p: this.center }];
    const spots = w.hideSpots.filter((h) => dist(h.pos, this.center) < 8);
    for (const h of spots) if (w.rng.chance(0.55)) this.points.push({ p: h.exit, hide: h.id });
    for (let i = 0; i < 4; i++) {
      const q = w.grid.randomFreeNear(this.center, 8, () => w.rng.next());
      if (q) this.points.push({ p: q });
    }
    // shuffle the tail, keep the centre first
    const tail = w.rng.shuffle(this.points.slice(1));
    this.points = [this.points[0], ...tail];
    this.phase = 0;
    void n;
  }
  enter(w: World, n: Npc) {
    this.plan(w, n);
    this.next(w, n);
    w.searchers.add(n.id);
  }
  exit(w: World, n: Npc) {
    w.searchers.delete(n.id);
    n.action = 'none';
  }
  private next(w: World, n: Npc) {
    const pt = this.points.shift();
    if (!pt) {
      this.plan(w, n);
      return;
    }
    this.cur = pt;
    n.goTo(w, pt.p, 'fast', true);
    this.phase = 0;
  }
  private cur: { p: V2; hide?: string } | null = null;
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'focused';
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.done = true;
      n.say(w, w.rng.pick(w.content.lines.giveUp), 'thought', 2.6, 'grumble');
      n.knowledge.wary = Math.max(n.knowledge.wary, 120);
      return;
    }
    if (this.phase === 0) {
      if (n.arrived || n.failed) {
        this.phase = 1;
        this.timer = this.cur?.hide ? 1.6 : w.rng.range(1.8, 3);
      }
      return;
    }
    this.timer -= dt;
    if (this.cur?.hide) {
      const spot = w.hideSpots.find((h) => h.id === this.cur!.hide);
      if (spot) n.faceTowards(spot.pos, w, dt);
      n.action = 'search';
      if (this.timer <= 0) {
        // Only if we actually got to it (not stuck behind a locked door).
        if (spot && w.player.hidden === spot && !n.failed && dist(n.pos, spot.exit) < 1.0) {
          w.brain.foundHidden(w, n);
          this.done = true;
          return;
        }
      }
    } else {
      n.action = 'search';
      lookAround(w, n, this.t);
    }
    if (this.timer <= 0) {
      n.action = 'none';
      this.next(w, n);
    }
  }
}

// ---------------------------------------------------------------------------
// Civilians: run to the nearest guard and tell them what they saw.
// ---------------------------------------------------------------------------
export class FleeReportBehavior extends Behavior {
  readonly name = 'report';
  private guardId: string | null = null;
  private repath = 0;
  private talking = 0;
  private cower = 0;
  constructor(public info: Report, public panic = true) {
    super(panic ? 70 : 48);
  }
  absorb(w: World, n: Npc, b: Behavior): boolean {
    if (b instanceof FleeReportBehavior) {
      // Upgrade the report (e.g. trespass -> theft).
      const rank = (r: Report) => ['trespass', 'disguise', 'sleeper', 'duck_found', 'uniform', 'intruder', 'theft'].indexOf(r.kind);
      if (rank(b.info) > rank(this.info)) this.info = b.info;
      if (b.panic && !this.panic) {
        this.panic = true;
        this.prio = 70;
      }
      return true;
    }
    return false;
  }
  enter(w: World, n: Npc) {
    n.hop = this.panic;
    if (this.panic) {
      n.say(w, w.content.screamLine(this.info), 'alert', 2.6, n.role === 'guest' ? 'scream' : 'gasp');
      w.emitNoise({ pos: { ...n.pos }, radius: 13, kind: 'scream', source: n.id, data: { info: this.info } });
    } else {
      n.say(w, w.rng.pick(['경비원한테 알려야겠어.', '이건 보고해야겠군.']), 'thought', 2.2);
    }
    this.pickGuard(w, n);
  }
  private pickGuard(w: World, n: Npc) {
    const g = w.brain.nearestGuard(w, n.pos, n.id);
    this.guardId = g?.id ?? null;
    if (g) n.goTo(w, w.approach(g.pos, 1.2), this.panic ? 'run' : 'fast', true);
    else n.goTo(w, w.station('st_assembly').pos, this.panic ? 'run' : 'fast', true);
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = this.panic ? 'scared' : 'focused';
    if (this.panic && this.talking <= 0 && this.cower <= 0) n.action = 'panic';
    if (this.cower > 0) {
      this.cower -= dt;
      n.action = 'none';
      n.expr = 'scared';
      if (this.cower <= 0) this.done = true;
      return;
    }
    const g = this.guardId ? w.npc(this.guardId) : null;
    if (this.talking > 0) {
      this.talking -= dt;
      n.action = 'point';
      if (g) n.faceTowards(g.pos, w, dt);
      if (this.talking <= 0) {
        if (g && g.awake) w.brain.informGuard(w, g, this.info, n);
        this.cower = this.panic ? 3 : 0.5;
      }
      return;
    }
    if (!g || !g.awake) {
      if (n.arrived || n.failed || !g) {
        if (this.t > 1) this.pickGuard(w, n);
        if (!this.guardId) {
          // No guard anywhere: shout for help and calm down.
          w.emitNoise({ pos: { ...n.pos }, radius: 18, kind: 'scream', source: n.id, data: { info: this.info } });
          this.cower = 4;
        }
      }
      return;
    }
    this.repath -= dt;
    if (this.repath <= 0) {
      this.repath = 0.8;
      n.goTo(w, w.approach(g.pos, 1.2), this.panic ? 'run' : 'fast', true);
    }
    if (dist(n.pos, g.pos) < 2.0) {
      n.stop();
      this.talking = 1.8;
      n.say(w, this.info.text, 'alert', 3);
      // A busy guard (chasing, raising the alarm) hears it on the move instead of stopping.
      if (w.brain.canDivert(g)) w.brain.request(w, g, new ListenBehavior(n.id), true);
    } else if (n.failed && this.t > 0.5) {
      this.pickGuard(w, n);
    }
    if (this.t > 45) this.done = true;
  }
}

export class ListenBehavior extends Behavior {
  readonly name = 'listen';
  constructor(public from: string) {
    super(73);
  }
  enter(w: World, n: Npc) {
    n.stop();
    void w;
  }
  tick(w: World, n: Npc, dt: number) {
    const f = w.npc(this.from);
    if (f) {
      n.faceTowards(f.pos, w, dt);
      n.lookAt(f.pos, 0.4);
    }
    n.expr = 'focused';
    if (this.t > 2.6) this.done = true;
  }
}

export class CowerBehavior extends Behavior {
  readonly name = 'cower';
  constructor(public dur: number, public from?: V2) {
    super(65);
  }
  enter(w: World, n: Npc) {
    n.stop();
    n.hop = true;
    void w;
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'scared';
    n.pose = 'cower';
    if (this.from) n.faceTowards(this.from, w, dt, 3);
    if (this.t > this.dur) this.done = true;
  }
}

// ---------------------------------------------------------------------------
// Electrician / butler: go restore the power.
// ---------------------------------------------------------------------------
export class FixPowerBehavior extends Behavior {
  readonly name = 'fixpower';
  private phase = 0;
  private timer = 0;
  constructor() {
    super(55);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.say(w, w.rng.pick(['또 정전이야? 차단기 보러 가야겠군.', '전기가 나갔네. 금방 고칩니다!']), 'normal', 2.6);
    n.goTo(w, w.station('st_fusebox').pos, 'fast', true);
    w.flags.fixer = n.id;
  }
  exit(w: World, n: Npc) {
    if (w.flags.fixer === n.id) w.flags.fixer = null;
    n.action = 'none';
  }
  tick(w: World, n: Npc, dt: number) {
    if (!w.power.anyOff()) {
      this.done = true;
      return;
    }
    if (this.phase === 0) {
      n.expr = 'focused';
      if (n.failed) {
        if (n.radio) w.security.radio(w, n, { kind: 'power_out', text: '전기실에 못 들어가겠다! 열쇠가 없어! 누가 좀 열어 줘!', circuits: [] });
        else n.say(w, '전기실에 못 들어가겠어!', 'alert', 2.5);
        w.flags.fixFailedBy.add(n.id);
        this.done = true;
        return;
      }
      if (n.arrived) {
        this.phase = 1;
        this.timer = 4;
      }
      return;
    }
    n.facing = Math.PI;
    n.action = 'work';
    this.timer -= dt;
    if (this.timer <= 0) {
      w.restorePower(n);
      if (n.radio) w.security.radio(w, n, { kind: 'power_ok', text: '전기 복구 완료!' });
      else n.say(w, '자, 다시 들어왔다!', 'normal', 2);
      this.done = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Guards respond to the gallery alarm.
// ---------------------------------------------------------------------------
export class AlarmResponseBehavior extends Behavior {
  readonly name = 'alarm';
  private phase = 0;
  constructor() {
    super(75);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.say(w, w.rng.pick(['전시실 경보다!', '오리가 위험해!', '전원 전시실로!']), 'alert', 2.4, 'shout');
    const target = n.keys.has('key_gallery') ? w.station('st_case').pos : w.station('st_galguard').pos;
    n.goTo(w, target, 'run', true);
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'angry';
    if (this.phase === 0 && (n.arrived || n.failed)) {
      this.phase = 1;
      w.brain.request(w, n, new SearchBehavior(n.pos, 40), true);
      this.done = true;
    }
    void dt;
  }
}

// ---------------------------------------------------------------------------
// Lockdown posts and searches.
// ---------------------------------------------------------------------------
export class LockdownBehavior extends Behavior {
  readonly name = 'lockdown';
  private phase = 0;
  private timer = 0;
  private post: V2 | null = null;
  private postFace = 0;
  constructor() {
    super(58);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    this.phase = 0;
    switch (n.job) {
      case 'doorman':
        this.post = { x: 36, z: 57.4 };
        this.postFace = Math.PI;
        break;
      case 'svc_guard':
        this.post = { x: 4.5, z: 57.4 };
        this.postFace = Math.PI;
        break;
      case 'patrol':
        if (n.id === 'patrol_back') {
          this.post = { x: 61, z: 4.8 };
          this.postFace = Math.PI;
        }
        break;
      case 'gallery_guard':
        this.post = w.station('st_galguard').pos;
        this.postFace = 0;
        break;
      case 'operator':
        this.post = w.station('st_operator').pos;
        this.postFace = Math.PI;
        break;
    }
    if (this.post) n.goTo(w, this.post, 'run', true);
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'focused';
    if (this.post) {
      if (this.phase === 0 && (n.arrived || n.failed)) {
        this.phase = 1;
        if (n.job === 'doorman') w.closeGate('d_front_gate', n);
        if (n.job === 'svc_guard') w.closeGate('d_service_gate', n);
        if (n.job === 'operator') {
          n.seated = true;
          this.timer = 6;
        }
      }
      if (this.phase === 1) {
        const d = this.postFace - n.facing;
        n.facing += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 4);
        n.action = n.job === 'operator' ? 'type' : 'none';
        if (n.job === 'operator') {
          n.seated = true;
          this.timer -= dt;
          if (this.timer <= 0 && !w.security.tapesReviewed) w.security.reviewTapes(w, n);
        } else {
          lookAround(w, n, this.t * 0.6);
        }
      }
      return;
    }
    // Rovers: search room after room.
    if (this.phase === 0 || n.arrived || n.failed) {
      this.timer -= dt;
      n.action = 'search';
      lookAround(w, n, this.t);
      if (this.phase === 0 || this.timer <= 0) {
        this.phase = 1;
        this.timer = w.rng.range(2, 4);
        const rooms = ['ballroom', 'lounge', 'foyer', 'dining', 'galhall', 'library', 'conserv', 'kitchen', 'staffroom', 'svc', 'frontyard', 'backgarden', 'eastgarden', 'easthall', 'wc', 'bath', 'serviceyard'];
        const room = w.rng.pick(rooms);
        const cells = w.grid.roomCells(room);
        if (cells.length) n.goTo(w, cells[Math.floor(w.rng.next() * cells.length)], 'fast', true);
      }
    }
  }
}

export class GatherBehavior extends Behavior {
  readonly name = 'gather';
  private settled = false;
  constructor() {
    super(57);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    const cells = w.grid.roomCells('ballroom');
    const p = cells[Math.floor(w.rng.next() * cells.length)];
    n.goTo(w, p, 'fast', true);
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'scared';
    if (!this.settled && (n.arrived || n.failed)) this.settled = true;
    if (this.settled) {
      n.action = w.time < n.talkUntil ? 'talk' : 'none';
      if (w.rng.chance(dt * 0.04)) n.say(w, w.rng.pick(w.content.lines.lockdownGuest), 'normal', 2.6);
    }
  }
}

// ---------------------------------------------------------------------------
// Drugged / sick states.
// ---------------------------------------------------------------------------
export class SleepBehavior extends Behavior {
  readonly name = 'sleep';
  constructor() {
    super(100);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.stop();
    n.action = 'none';
    n.carry = 'none';
    n.flashlightOn = false;
    if (n.hand) w.dropNpcHand(n);
    w.events.emit('sfx', { name: 'thud', x: n.pos.x, z: n.pos.z, volume: 0.5 });
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'sleepy';
    n.pose = n.sleepKind === 'chair' ? 'sleep_chair' : 'sleep_floor';
    if (w.rng.chance(dt * 0.25)) w.events.emit('sfx', { name: 'snore', x: n.pos.x, z: n.pos.z, volume: 0.35, pitch: n.def.pitch });
    if (n.asleep <= 0) {
      this.done = true;
      w.brain.onWake(w, n);
    }
  }
}

export class SickBehavior extends Behavior {
  readonly name = 'sick';
  private phase = 0;
  private timer = 0;
  private toiletPos: V2 | null = null;
  private toiletFace = 0;
  constructor() {
    super(45);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.say(w, w.rng.pick(['으윽... 배가...!', '화, 화장실...!', '아까 마신 게 이상했어...!']), 'alert', 2.4, 'grumble');
    this.seek(w, n);
  }
  private seek(w: World, n: Npc) {
    const t = w.claimToilet(n);
    if (t) {
      this.toiletPos = t.pos;
      this.toiletFace = t.face;
      n.goTo(w, t.pos, 'fast', true);
      this.phase = 1;
    } else {
      this.phase = 0;
      this.timer = 2;
      n.goTo(w, w.station('st_wc_wait').pos, 'fast', true);
    }
  }
  exit(w: World, n: Npc) {
    w.releaseToilet(n);
    n.seated = false;
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'sick';
    n.shake = 0.3;
    if (this.phase === 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.seek(w, n);
      return;
    }
    if (this.phase === 1) {
      if (n.failed) {
        this.phase = 0;
        this.timer = 2;
        w.releaseToilet(n);
        return;
      }
      if (n.arrived && this.toiletPos) {
        this.phase = 2;
        this.timer = 22;
      }
      return;
    }
    n.seated = true;
    const d = this.toiletFace - n.facing;
    n.facing += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 5);
    this.timer -= dt;
    if (w.rng.chance(dt * 0.15)) n.say(w, w.rng.pick(['으으음...', '끄응...', '다시는 안 마셔...']), 'normal', 2, 'grumble');
    if (this.timer <= 0) {
      w.events.emit('sfx', { name: 'flush', x: n.pos.x, z: n.pos.z, volume: 0.7 });
      n.sick = 0;
      this.done = true;
      n.say(w, '휴... 살았다.', 'normal', 2);
    }
  }
}

// ---------------------------------------------------------------------------
// A guard found the duck lying around: pick it up and bring it back.
// ---------------------------------------------------------------------------
export class ReturnDuckBehavior extends Behavior {
  readonly name = 'returnduck';
  private phase = 0;
  private timer = 0;
  private target: 'case' | 'desk' = 'desk';
  constructor(public item: Item) {
    super(62);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.goTo(w, w.approach(this.item.pos, 0.6), 'run', true);
  }
  exit(w: World, n: Npc) {
    w.releaseClaims(n.id);
    // Interrupted on the way: don't walk around with it forever.
    if (n.hand === this.item) w.npcStoreDuck(n, 'pocket');
  }
  private head(w: World, n: Npc, target: 'case' | 'desk') {
    this.target = target;
    this.timer = 0;
    n.goTo(w, target === 'case' ? w.station('st_case').pos : w.station('st_secdesk').pos, 'fast', true);
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'surprised';
    if (this.phase === 0) {
      if (this.item.state !== 'ground' || this.item.secured) {
        this.done = true;
        return;
      }
      const d = dist(n.pos, this.item.pos);
      if (d < 1.1 || (n.arrived && d < 1.7)) {
        w.npcPickUp(n, this.item);
        n.say(w, '찾았다! 황금 오리를 되찾았어!', 'alert', 2.6);
        if (n.radio) w.security.radio(w, n, { kind: 'duck_found', text: '황금 오리를 회수했다! 전시실로 돌려놓겠다.', pos: { ...n.pos } });
        this.phase = 1;
        const canDisplay = (n.keys.has('key_gallery') || w.door('d_gallery').open) && !w.caseItem && this.item.type === 'golden_duck';
        this.head(w, n, canDisplay ? 'case' : 'desk');
      } else if (n.failed || n.arrived) this.done = true;
      return;
    }
    if (this.phase === 1) {
      if (n.hand !== this.item) {
        this.done = true;
        return;
      }
      if (n.failed) {
        // Can't get there: try the security desk, else keep it.
        if (this.target === 'case') this.head(w, n, 'desk');
        else {
          w.npcStoreDuck(n, 'pocket');
          this.done = true;
        }
        return;
      }
      if (n.arrived) {
        if (this.target === 'case' && w.caseItem) {
          n.say(w, '응? 진열장에 이미 오리가...?', 'thought', 2.2, 'hmm');
          this.head(w, n, 'desk');
          return;
        }
        this.timer += dt;
        n.action = 'reach';
        if (this.timer > 1) {
          w.npcStoreDuck(n, this.target);
          this.done = true;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduled social events.
// ---------------------------------------------------------------------------
export class AttendBehavior extends Behavior {
  readonly name: string;
  private settled = false;
  constructor(
    public kind: 'speech' | 'fireworks' | 'evacuate' | 'tour',
    public spot: V2,
    public face: V2,
    public until: () => boolean,
    prio: number,
  ) {
    super(prio);
    this.name = 'attend_' + kind;
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.goTo(w, this.spot, this.kind === 'evacuate' ? 'fast' : 'walk', true);
  }
  tick(w: World, n: Npc, dt: number) {
    if (this.until()) {
      if (this.kind === 'speech' || this.kind === 'fireworks') {
        if (w.rng.chance(0.5)) n.say(w, w.rng.pick(['멋졌어요!', '브라보!', '와아~']), 'normal', 1.8, 'cheer');
      }
      this.done = true;
      return;
    }
    if (!this.settled && (n.arrived || n.failed)) this.settled = true;
    if (!this.settled) return;
    n.faceTowards(this.face, w, dt, 4);
    switch (this.kind) {
      case 'speech':
        n.expr = 'happy';
        n.action = w.flags.speechClap ? 'clap' : 'none';
        break;
      case 'fireworks':
        n.expr = 'happy';
        n.action = w.rng.chance(dt * 0.3) ? 'clap' : n.action === 'clap' && w.rng.chance(dt) ? 'none' : n.action;
        n.lookAt({ x: this.face.x, z: this.face.z }, 0.3);
        if (w.rng.chance(dt * 0.12)) n.say(w, w.rng.pick(['와아~!', '예쁘다!', '우와!']), 'normal', 1.6, 'cheer');
        break;
      case 'evacuate':
        n.expr = 'scared';
        n.action = w.time < n.talkUntil ? 'talk' : 'none';
        if (w.rng.chance(dt * 0.05)) n.say(w, w.rng.pick(['불이 난 거야?', '연기는 안 보이는데...', '무서워라.']), 'normal', 2.2);
        break;
      case 'tour':
        n.expr = 'happy';
        break;
    }
  }
}

/** Host gives the speech at the podium. */
export class SpeechBehavior extends Behavior {
  readonly name = 'speech';
  private phase = 0;
  private line = 0;
  private timer = 0;
  constructor() {
    super(16);
  }
  enter(w: World, n: Npc) {
    n.goTo(w, w.station('st_podium').pos, 'walk', true);
  }
  exit(w: World, n: Npc) {
    w.flags.speechActive = false;
    w.flags.speechClap = false;
    n.action = 'none';
  }
  tick(w: World, n: Npc, dt: number) {
    if (this.phase === 0) {
      if (n.arrived || n.failed) {
        this.phase = 1;
        this.timer = 2.5;
        w.director.speechStarted();
      }
      return;
    }
    n.facing = 0;
    n.expr = 'happy';
    this.timer -= dt;
    n.action = 'talk';
    if (this.timer <= 0) {
      const lines = w.content.lines.speech;
      if (this.line < lines.length) {
        n.say(w, lines[this.line], 'speech', 4.2, 'chatter');
        this.line++;
        this.timer = 4.4;
      } else if (!w.flags.speechClap) {
        w.flags.speechClap = true;
        this.timer = 4;
        w.events.emit('voice', { kind: 'cheer', x: n.pos.x, z: n.pos.z + 3, pitch: 1 });
      } else {
        this.done = true;
      }
    }
  }
}

/** Host leads a few guests into the gallery to admire the duck. */
export class TourBehavior extends Behavior {
  readonly name = 'tour';
  private phase = 0;
  private timer = 0;
  private line = 0;
  constructor() {
    super(16);
  }
  enter(w: World, n: Npc) {
    n.say(w, '자, 여러분! 제 자랑인 황금 오리를 보여드리죠!', 'speech', 3.2);
    n.goTo(w, w.station('st_tour_door').pos, 'walk', true);
    w.flags.tourActive = true;
    w.director.tourStarted(n);
  }
  exit(w: World, n: Npc) {
    w.flags.tourActive = false;
    w.flags.tourInside = false;
    n.action = 'none';
    w.director.tourEnded();
  }
  tick(w: World, n: Npc, dt: number) {
    switch (this.phase) {
      case 0:
        if (n.arrived || n.failed) {
          this.phase = 1;
          n.goTo(w, w.station('st_case').pos, 'walk', true);
        }
        return;
      case 1:
        if (n.failed) {
          n.say(w, '이런, 문이 안 열리네? 투어는 다음에...', 'speech', 3);
          this.done = true;
          return;
        }
        if (n.arrived) {
          this.phase = 2;
          this.timer = 2;
          w.flags.tourInside = true;
        }
        return;
      case 2: {
        n.facing = Math.PI;
        n.action = 'point';
        n.expr = 'happy';
        this.timer -= dt;
        if (this.timer <= 0) {
          const lines = w.content.lines.tour;
          if (this.line < lines.length) {
            n.say(w, lines[this.line], 'speech', 3.6);
            this.line++;
            this.timer = 3.8;
          } else {
            this.phase = 3;
            this.timer = 2.5;
            w.director.tourInspect(n);
          }
        }
        return;
      }
      case 3:
        this.timer -= dt;
        n.action = 'none';
        if (this.timer <= 0) {
          this.phase = 4;
          w.flags.tourInside = false;
          n.goTo(w, w.station('st_tour_door').pos, 'walk', true);
        }
        return;
      case 4:
        if (n.arrived || n.failed) {
          this.phase = 5;
          this.timer = 3;
        }
        return;
      case 5:
        // Wait for followers to leave the gallery, then lock up.
        this.timer -= dt;
        if (this.timer <= 0 || w.director.tourOut()) {
          const d = w.door('d_gallery');
          if (d.open && !w.someoneInDoorway(d, n.id)) w.setDoorOpen(d, false, n.id, n.pos);
          if (!d.open && !d.locked && n.keys.has('key_gallery')) w.setDoorLocked(d, true, n.id);
          this.done = true;
        }
    }
  }
}

/** Gallery guard steps aside for the tour. */
export class StepAsideBehavior extends Behavior {
  readonly name = 'stepaside';
  constructor(public until: () => boolean) {
    super(16);
  }
  enter(w: World, n: Npc) {
    n.goTo(w, { x: 38.6, z: 23.6 }, 'walk', true);
  }
  tick(w: World, n: Npc, dt: number) {
    if (n.arrived) n.faceTowards({ x: 36, z: 22 }, w, dt);
    if (this.until()) this.done = true;
  }
}

/** Follow the host into the gallery. */
export class FollowBehavior extends Behavior {
  readonly name = 'follow';
  private repath = 0;
  constructor(public leader: string, public until: () => boolean, public offset: V2) {
    super(16);
  }
  tick(w: World, n: Npc, dt: number) {
    const l = w.npc(this.leader);
    if (!l || this.until()) {
      this.done = true;
      return;
    }
    n.expr = 'happy';
    this.repath -= dt;
    const target = { x: l.pos.x + this.offset.x, z: l.pos.z + this.offset.z };
    if (dist(n.pos, target) > 1.2 && this.repath <= 0) {
      this.repath = 0.8;
      n.goTo(w, w.approach(target, 0.3), 'walk', true);
    } else if (dist(n.pos, target) <= 1.2) {
      n.faceTowards(w.flags.tourInside ? w.station('st_case_look').pos : l.pos, w, dt);
    }
  }
}

/** Stripped / woken NPC goes to fetch spare clothes. */
export class RedressBehavior extends Behavior {
  readonly name = 'redress';
  private timer = 0;
  constructor() {
    super(44);
  }
  enter(w: World, n: Npc) {
    n.goTo(w, w.station(n.isGuard ? 'st_guard_locker' : 'st_staff_locker').pos, 'fast', true);
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'sad';
    if (n.arrived || n.failed) {
      this.timer += dt;
      n.action = 'reach';
      if (this.timer > 2.5) {
        n.stripped = false;
        n.look = { ...n.def.look };
        w.events.emit('sfx', { name: 'zip', x: n.pos.x, z: n.pos.z, volume: 0.5 });
        this.done = true;
      }
    }
  }
}

export const describeOutfit = (o: OutfitId | null | undefined) => (o ? OUTFITS[o].name : '알 수 없는 차림');
export const faceAngle = (from: V2, to: V2) => angleOf({ x: to.x - from.x, z: to.z - from.z });
