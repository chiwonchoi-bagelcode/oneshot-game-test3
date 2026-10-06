// Daily routines ("what people do when nothing unusual happens").
import { angleOf, dist, type V2 } from '../../core/math';
import type { World } from '../World';
import { Behavior } from './behaviors';
import type { Action, MoveMode, Npc } from './Npc';

export type UseKind = 'coffee' | 'cooler' | 'punch' | 'bar' | 'buffet' | 'smoke' | 'none';

export type Task =
  | {
      k: 'do';
      at: string;
      dur: [number, number];
      act?: Action;
      pose?: 'stand' | 'sit';
      use?: UseKind;
      mode?: MoveMode;
      say?: string[];
      carry?: Npc['carry'];
    }
  | { k: 'go'; at: string; mode?: MoveMode }
  | { k: 'chat'; spots: string[]; dur: [number, number] }
  | { k: 'wander'; room: string; dur: [number, number] }
  | { k: 'patrol'; route: string[]; pause?: [number, number]; act?: Action; mode?: MoveMode }
  | { k: 'serve'; rooms: string[]; count: number }
  | { k: 'toilet' }
  | { k: 'trash' }
  | { k: 'gate' }
  | { k: 'guest' }
  | { k: 'wait'; dur: [number, number]; act?: Action }
  | { k: 'check_elec' };

type Phase = 'start' | 'move' | 'act' | 'sub';

/** The default behaviour: runs the NPC's task list forever. */
export class RoutineBehavior extends Behavior {
  readonly name = 'routine';
  private queue: Task[] = [];
  private task: Task | null = null;
  private phase: Phase = 'start';
  private timer = 0;
  private target: V2 | null = null;
  private face: number | null = null;
  private idx = 0;
  private sub = 0;
  private guestFor: string | null = null;
  private servePass: V2 | null = null;
  private patrolI = 0;
  private gateT = 0;

  constructor() {
    super(0);
  }

  /** Abort the current task and pick the next one (e.g. after an interruption that moved us far away). */
  restartTask() {
    this.phase = 'start';
  }

  /** Called when the routine becomes active again after an interruption. */
  resume(w: World, n: Npc) {
    void w;
    // Keep patrol progress but re-walk to the current target.
    if (this.task && this.task.k === 'do' && this.phase === 'act' && this.target && dist(n.pos, this.target) < 0.8) {
      return; // still in place
    }
    this.phase = this.task ? 'start' : 'start';
    n.seated = false;
  }

  exit(w: World, n: Npc) {
    this.releaseSlot(w, n);
    n.seated = false;
    n.action = 'none';
    if (n.carry === 'tray' && n.job === 'waiter') n.carry = 'none';
  }

  private releaseSlot(w: World, n: Npc) {
    if (n.slot) {
      w.releaseSlot(n);
    }
  }

  private nextTask(w: World, n: Npc): Task {
    if (this.queue.length) return this.queue.shift()!;
    const r = n.def.routine;
    if (r.length === 0) return { k: 'wait', dur: [5, 10] };
    const t = r[this.idx % r.length];
    this.idx++;
    if (t.k === 'guest') return w.content.pickGuestTask(w, n);
    return t;
  }

  /** Insert a task to run next (used by events like 'go to toilet'). */
  push(t: Task) {
    this.queue.unshift(t);
  }

  tick(w: World, n: Npc, dt: number) {
    // Busy gossiping: the routine waits until the conversation is over.
    if (w.convoBusy.has(n.id)) {
      n.action = w.time < n.talkUntil ? 'talk' : 'none';
      return;
    }
    if (!this.task || this.phase === 'start') {
      if (!this.task) this.task = this.nextTask(w, n);
      this.begin(w, n, this.task);
    }
    const t = this.task!;
    switch (t.k) {
      case 'do':
        return this.tickDo(w, n, t, dt);
      case 'go':
        if (n.arrived || n.failed) this.finish(w, n);
        return;
      case 'chat':
        return this.tickChat(w, n, t, dt);
      case 'wander':
        return this.tickWander(w, n, t, dt);
      case 'patrol':
        return this.tickPatrol(w, n, t, dt);
      case 'serve':
        return this.tickServe(w, n, t, dt);
      case 'toilet':
        return this.tickToilet(w, n, dt);
      case 'trash':
        return this.tickTrash(w, n, dt);
      case 'gate':
        return this.tickGate(w, n, dt);
      case 'wait':
        this.timer -= dt;
        n.action = t.act ?? 'none';
        if (this.timer <= 0) this.finish(w, n);
        return;
      case 'check_elec':
        return this.tickCheckElec(w, n, dt);
      case 'guest':
        this.finish(w, n);
        return;
    }
  }

  private finish(w: World, n: Npc) {
    this.releaseSlot(w, n);
    n.seated = false;
    n.action = 'none';
    this.task = this.nextTask(w, n);
    this.begin(w, n, this.task);
  }

  private begin(w: World, n: Npc, t: Task) {
    this.phase = 'move';
    this.timer = 0;
    this.face = null;
    this.target = null;
    this.sub = 0;
    n.seated = false;
    switch (t.k) {
      case 'do': {
        const st = w.station(t.at);
        this.target = st.pos;
        this.face = st.face;
        n.goTo(w, st.pos, t.mode ?? (n.role === 'guest' ? 'stroll' : 'walk'), true);
        if (t.carry) n.carry = t.carry;
        break;
      }
      case 'go': {
        const st = w.station(t.at);
        n.goTo(w, st.pos, t.mode ?? 'walk', true);
        break;
      }
      case 'chat': {
        const slot = w.claimSlot(n, t.spots);
        if (!slot) {
          // Nobody's spot free: wander instead.
          this.task = { k: 'wander', room: w.grid.roomAt(n.pos)?.id ?? 'ballroom', dur: [6, 12] };
          this.begin(w, n, this.task);
          return;
        }
        this.target = slot.pos;
        this.face = slot.face;
        n.goTo(w, slot.pos, 'stroll', true);
        this.timer = w.rng.range(t.dur[0], t.dur[1]);
        break;
      }
      case 'wander': {
        this.timer = w.rng.range(t.dur[0], t.dur[1]);
        this.pickWander(w, n, t.room);
        break;
      }
      case 'patrol': {
        this.patrolI = 0;
        const st = w.station(t.route[0]);
        n.goTo(w, st.pos, t.mode ?? 'walk', true);
        break;
      }
      case 'serve': {
        const pass = w.station('st_pass');
        this.servePass = pass.pos;
        this.target = pass.pos;
        this.face = pass.face;
        this.sub = 0;
        n.goTo(w, pass.pos, 'walk', true);
        break;
      }
      case 'toilet': {
        const toilet = w.claimToilet(n);
        if (!toilet) {
          this.task = { k: 'wait', dur: [3, 6] };
          this.begin(w, n, this.task);
          return;
        }
        this.target = toilet.pos;
        this.face = toilet.face;
        n.goTo(w, toilet.pos, 'walk', true);
        break;
      }
      case 'trash': {
        this.sub = 0;
        break;
      }
      case 'gate': {
        this.sub = 0;
        this.gateT = 0;
        n.goTo(w, { x: 36.5, z: 60.6 }, 'walk', true);
        break;
      }
      case 'wait':
        this.timer = w.rng.range(t.dur[0], t.dur[1]);
        n.stop();
        break;
      case 'check_elec':
        this.sub = 0;
        n.goTo(w, w.station('st_fusebox').pos, 'walk', true);
        break;
      case 'guest':
        break;
    }
  }

  private arriveFace(w: World, n: Npc, dt: number) {
    if (this.face !== null) {
      const target = this.face;
      const d = Math.atan2(Math.sin(target - n.facing), Math.cos(target - n.facing));
      n.facing += d * Math.min(1, dt * 6);
    }
    void w;
  }

  private tickDo(w: World, n: Npc, t: Extract<Task, { k: 'do' }>, dt: number) {
    if (this.phase === 'move') {
      if (n.failed) {
        this.finish(w, n);
        return;
      }
      if (n.arrived) {
        this.phase = 'act';
        this.timer = w.rng.range(t.dur[0], t.dur[1]);
        if (t.pose === 'sit') n.seated = true;
        if (t.say && t.say.length && w.rng.chance(0.5)) n.say(w, w.rng.pick(t.say));
        if (t.use === 'smoke') w.events.emit('fx', { kind: 'smoke', x: n.pos.x, z: n.pos.z, y: 1.5 });
      }
      return;
    }
    this.arriveFace(w, n, dt);
    n.action = t.act ?? 'none';
    // Nobody dances in the dark.
    if (t.act === 'dance' && !w.lighting.roomLit(w.grid.roomAt(n.pos)?.id ?? 'ballroom')) n.action = 'none';
    if (t.pose === 'sit') n.seated = true;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (t.use && t.use !== 'none') w.consume(n, t.use);
      if (t.carry && n.carry === t.carry) n.carry = 'none';
      this.finish(w, n);
    }
  }

  private tickChat(w: World, n: Npc, t: Extract<Task, { k: 'chat' }>, dt: number) {
    if (this.phase === 'move') {
      if (n.failed) {
        this.finish(w, n);
        return;
      }
      if (n.arrived) this.phase = 'act';
      return;
    }
    this.arriveFace(w, n, dt);
    n.action = w.time < n.talkUntil ? 'talk' : 'none';
    this.timer -= dt;
    if (this.timer <= 0) this.finish(w, n);
    void t;
  }

  private pickWander(w: World, n: Npc, room: string) {
    const cells = w.grid.roomCells(room);
    const p = cells.length ? cells[Math.floor(w.rng.next() * cells.length)] : n.pos;
    n.goTo(w, p, 'stroll', true);
    this.phase = 'move';
  }

  private tickWander(w: World, n: Npc, t: Extract<Task, { k: 'wander' }>, dt: number) {
    this.timer -= dt;
    if (this.phase === 'move') {
      if (n.arrived || n.failed) {
        this.phase = 'act';
        this.sub = w.rng.range(2, 5);
      }
    } else {
      this.sub -= dt;
      n.action = 'none';
      if (this.sub <= 0) {
        if (this.timer <= 0) {
          this.finish(w, n);
          return;
        }
        this.pickWander(w, n, t.room);
      }
    }
  }

  private tickPatrol(w: World, n: Npc, t: Extract<Task, { k: 'patrol' }>, dt: number) {
    if (this.phase === 'move') {
      if (n.arrived || n.failed) {
        this.phase = 'act';
        const pr = t.pause ?? [1, 2.5];
        this.timer = w.rng.range(pr[0], pr[1]);
        const st = w.station(t.route[this.patrolI]);
        this.face = st.face;
      }
      return;
    }
    this.arriveFace(w, n, dt);
    n.action = t.act ?? 'none';
    this.timer -= dt;
    if (this.timer <= 0) {
      n.action = 'none';
      this.patrolI++;
      if (this.patrolI >= t.route.length) {
        this.finish(w, n);
        return;
      }
      const st = w.station(t.route[this.patrolI]);
      n.goTo(w, st.pos, t.mode ?? 'walk', true);
      this.phase = 'move';
    }
  }

  private tickServe(w: World, n: Npc, t: Extract<Task, { k: 'serve' }>, dt: number) {
    // sub 0: go to pass; 1: pick up; 2: walk to guest; 3: serve; 4: return
    if (this.sub === 0) {
      if (n.failed) return this.finish(w, n);
      if (n.arrived) {
        this.sub = 1;
        this.timer = 2.2;
        this.face = w.station('st_pass').face;
      }
      return;
    }
    if (this.sub === 1) {
      this.arriveFace(w, n, dt);
      n.action = 'reach';
      this.timer -= dt;
      if (this.timer <= 0) {
        n.action = 'none';
        n.carry = 'tray';
        this.timer = t.count;
        this.sub = 2;
        this.guestFor = null;
        this.toGuest(w, n, t);
      }
      return;
    }
    if (this.sub === 2) {
      const g = this.guestFor ? w.npc(this.guestFor) : null;
      if (!g || !g.awake || n.failed) {
        this.toGuest(w, n, t);
        return;
      }
      if (dist(n.pos, g.pos) < 1.4) {
        n.stop();
        this.sub = 3;
        this.sub3 = 2.4;
        n.say(w, w.rng.pick(w.content.lines.serve));
        g.lookAt(n.pos, 2.5);
        return;
      }
      if (n.arrived) n.goTo(w, g.pos, 'walk', true);
      else if (n.goal && dist(n.goal, g.pos) > 1.5) n.goTo(w, g.pos, 'walk', true);
      return;
    }
    if (this.sub === 3) {
      const g = this.guestFor ? w.npc(this.guestFor) : null;
      if (g) n.facing = angleOf({ x: g.pos.x - n.pos.x, z: g.pos.z - n.pos.z });
      n.action = 'serve';
      this.sub3 -= dt;
      if (this.sub3 <= 0) {
        n.action = 'none';
        if (g && g.awake && g.behavior.name === 'routine') {
          g.say(w, w.rng.pick(w.content.lines.thanks));
          w.consume(g, 'bar');
        }
        this.timer -= 1;
        if (this.timer <= 0) {
          this.sub = 4;
          n.goTo(w, this.servePass!, 'walk', true);
        } else {
          this.sub = 2;
          this.toGuest(w, n, t);
        }
      }
      return;
    }
    if (this.sub === 4) {
      if (n.arrived || n.failed) {
        n.carry = 'none';
        this.finish(w, n);
      }
    }
  }
  private sub3 = 0;

  private toGuest(w: World, n: Npc, t: Extract<Task, { k: 'serve' }>) {
    const rooms = new Set(t.rooms);
    const cands = w.npcs.filter(
      (g) =>
        g.role === 'guest' &&
        g.awake &&
        g.active &&
        g.behavior.name === 'routine' &&
        !g.moving &&
        rooms.has(w.grid.roomAt(g.pos)?.id ?? '') &&
        g.id !== this.guestFor,
    );
    if (!cands.length) {
      this.sub = 4;
      n.goTo(w, this.servePass!, 'walk', true);
      return;
    }
    const g = w.rng.pick(cands);
    this.guestFor = g.id;
    n.goTo(w, g.pos, 'walk', true);
  }

  private tickToilet(w: World, n: Npc, dt: number) {
    if (this.phase === 'move') {
      if (n.failed) {
        w.releaseToilet(n);
        return this.finish(w, n);
      }
      if (n.arrived) {
        this.phase = 'act';
        this.timer = w.rng.range(8, 14);
        n.seated = true;
      }
      return;
    }
    this.arriveFace(w, n, dt);
    n.seated = true;
    this.timer -= dt;
    if (this.timer <= 0) {
      w.events.emit('sfx', { name: 'flush', x: n.pos.x, z: n.pos.z, volume: 0.6 });
      w.releaseToilet(n);
      this.finish(w, n);
    }
  }

  private tickTrash(w: World, n: Npc, dt: number) {
    // Visit every bin, collect, then dump in the dumpster.
    const bins = ['trash_galhall', 'trash_kitchen'];
    if (this.sub < bins.length) {
      const bin = w.bins.get(bins[this.sub])!;
      if (this.phase === 'move' && !n.goal) {
        n.goTo(w, w.approach(bin.pos), 'walk', true);
      }
      if (n.arrived || n.failed) {
        this.timer += dt;
        n.action = 'clean';
        n.facing = angleOf({ x: bin.pos.x - n.pos.x, z: bin.pos.z - n.pos.z });
        if (this.timer > 2) {
          w.collectBin(n, bin.id);
          this.timer = 0;
          this.sub++;
          n.action = 'none';
          if (this.sub < bins.length) n.goTo(w, w.approach(w.bins.get(bins[this.sub])!.pos), 'walk', true);
          else n.goTo(w, w.station('st_dumpster').pos, 'walk', true);
        }
      }
      return;
    }
    if (n.arrived || n.failed) {
      this.timer += dt;
      n.action = 'reach';
      n.facing = angleOf({ x: 9.5 - n.pos.x, z: 41.5 - n.pos.z });
      if (this.timer > 1.6) {
        w.dumpCarried(n, 'dumpster');
        n.carry = 'none';
        this.finish(w, n);
      }
    }
  }

  private tickGate(w: World, n: Npc, dt: number) {
    // Late guest: queue at the front gate, show the invitation to the doorman.
    const doorman = w.npc('doorman');
    if (this.sub === 0) {
      if (n.arrived || n.failed) {
        this.sub = 1;
        this.gateT = 0;
        n.facing = Math.PI;
        const hasInv = n.pockets.some((i) => i.type === 'invitation');
        if (doorman && doorman.awake && doorman.behavior.name === 'routine') {
          if (hasInv) {
            n.say(w, '초대장 여기 있습니다.');
            this.sub = 2;
          } else {
            n.say(w, '어? 초대장이... 분명 여기 있었는데!', 'normal', 3);
            this.sub = 3;
            w.flags.lateGuestArguing = true;
          }
        } else {
          this.sub = 4; // nobody checks: walk in
        }
      }
      return;
    }
    this.gateT += dt;
    if (this.sub === 2) {
      if (doorman && this.gateT > 1.5 && this.gateT - dt <= 1.5) doorman.say(w, '환영합니다. 즐거운 시간 되십시오.');
      if (this.gateT > 3) this.sub = 4;
      return;
    }
    if (this.sub === 3) {
      // Arguing: the doorman is busy with him.
      const lines = w.content.lines.lateArgue;
      const k = Math.floor(this.gateT / 3.4);
      if (k < lines.length && Math.floor((this.gateT - dt) / 3.4) !== k) {
        const [who, text] = lines[k];
        if (who === 0) n.say(w, text, 'normal', 3.2);
        else doorman?.say(w, text, 'normal', 3.2);
      }
      if (doorman) {
        doorman.lookAt(n.pos, 1);
        doorman.facing = angleOf({ x: n.pos.x - doorman.pos.x, z: n.pos.z - doorman.pos.z });
      }
      if (this.gateT > lines.length * 3.4 + 1) {
        w.flags.lateGuestArguing = false;
        this.sub = 4;
      }
      return;
    }
    if (this.sub === 4) {
      w.flags.lateGuestArguing = false;
      n.def.routine.splice(0, n.def.routine.length, { k: 'guest' });
      this.idx = 0;
      n.zones.add('public');
      this.queue.length = 0;
      this.queue.push({ k: 'chat', spots: ['sp_front1', 'sp_front2', 'sp_ball1', 'sp_ball2'], dur: [30, 50] });
      this.finish(w, n);
    }
  }

  private tickCheckElec(w: World, n: Npc, dt: number) {
    if (this.sub === 0) {
      if (n.arrived || n.failed) {
        this.sub = 1;
        this.timer = 4;
        this.face = Math.PI;
      }
      return;
    }
    this.arriveFace(w, n, dt);
    n.action = 'work';
    this.timer -= dt;
    if (this.timer <= 0) {
      const changed = w.restorePower(n);
      if (changed) n.say(w, '누가 차단기를 내렸지? 다시 올려야겠군.', 'normal', 3);
      this.finish(w, n);
    }
  }
}
