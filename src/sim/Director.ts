// Scheduled party events and global incidents (speech, gallery tour, fireworks,
// fire alarm, chief guarding the duck during outages).
import { dist, type V2 } from '../core/math';
import { AttendBehavior, FollowBehavior, SpeechBehavior, StepAsideBehavior, TourBehavior, Behavior } from './npc/behaviors';
import type { Npc } from './npc/Npc';
import type { World } from './World';

/** Security power is down: the chief posts himself at the gallery doors until it is back. */
class GuardDuckBehavior extends Behavior {
  readonly name = 'guardduck';
  private settled = false;
  private looked = 0;
  constructor() {
    super(56);
  }
  absorb(): boolean {
    return true;
  }
  enter(w: World, n: Npc) {
    n.say(w, '보안 전원이 나갔다고? 전시실 문은 내가 직접 지킨다!', 'alert', 2.6);
    n.goTo(w, { x: 34.4, z: 23.6 }, 'run', true);
  }
  tick(w: World, n: Npc, dt: number) {
    n.expr = 'focused';
    if (!this.settled && (n.arrived || n.failed)) this.settled = true;
    if (this.settled) {
      // Facing the ballroom arches: nobody gets to those doors without him seeing.
      const d = 0 - n.facing;
      n.facing += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 4);
      this.looked += dt;
    }
    if (w.power.on('C') && this.looked > 4) this.done = true;
    if (this.t > 180) this.done = true;
  }
}

export class Director {
  speechAt = 150;
  tourAt = 330;
  finaleAt = 1020;
  speechDone = false;
  private tourFollowers: string[] = [];
  private fireUntil = 0;
  private fwUntil = 0;
  private fwBursts = 0;
  private fwNextBurst = 0;

  update(w: World, dt: number) {
    const host = w.npc('host');
    const hostFree = host && host.awake && host.behavior.prio < 16 && !w.security.lockdown && !w.flags.fireAlarm;
    if (!this.speechDone && w.time >= this.speechAt) {
      if (hostFree) {
        this.speechDone = true;
        w.brain.request(w, host!, new SpeechBehavior());
      } else this.speechAt = w.time + 30;
    }
    if (w.time >= this.tourAt && this.speechDone) {
      if (hostFree && !w.flags.speechActive) {
        this.tourAt = w.time + 480;
        w.brain.request(w, host!, new TourBehavior());
      } else this.tourAt = w.time + 25;
    }
    if (!w.flags.fireworksUsed && w.time >= this.finaleAt) {
      const gardener = w.npc('gardener');
      if (gardener && gardener.awake && !w.security.lockdown) {
        this.launchFireworks('gardener');
        gardener.say(w, '자, 회장님 분부대로 불꽃놀이 시작이오!', 'normal', 3);
      } else this.finaleAt = w.time + 60;
    }
    // Fire alarm
    if (w.flags.fireAlarm) {
      if (Math.floor(w.time * 0.5) !== Math.floor((w.time - dt) * 0.5)) w.events.emit('sfx', { name: 'fire_bell_hit', x: 37, z: 39, volume: 0.9 });
      if (w.time > this.fireUntil) {
        w.flags.fireAlarm = false;
        const chief = w.npc('chief');
        const speaker = chief && chief.awake ? chief : w.npcs.find((n) => n.isGuard && n.awake);
        if (speaker) {
          speaker.say(w, '오경보입니다! 다들 안으로 돌아가셔도 됩니다.', 'alert', 3);
          speaker.knowledge.wary = 200;
        }
        w.events.emit('notify', { text: '화재 경보가 멈췄다. 사람들이 제자리로 돌아간다.', kind: 'info' });
      }
    }
    // Fireworks show
    if (w.time < this.fwUntil) {
      if (w.time >= this.fwNextBurst) {
        this.fwNextBurst = w.time + w.rng.range(0.5, 1.4);
        this.fwBursts++;
        w.events.emit('fx', { kind: 'fireworks', x: 28 + w.rng.range(-6, 6), z: 2 + w.rng.range(-3, 2), y: 14 + w.rng.range(0, 6) });
        w.events.emit('sfx', { name: 'fireworks_boom', x: 28, z: 2, volume: 0.9, pitch: w.rng.range(0.8, 1.2) });
        if (this.fwBursts % 5 === 0) w.emitNoise({ pos: { x: 28, z: 4 }, radius: 70, kind: 'fireworks', source: 'fireworks' });
      }
    } else if (w.flags.fireworksShow) {
      w.flags.fireworksShow = false;
    }
  }

  speechStarted() {
    const w = this.w;
    w.flags.speechActive = true;
    w.learnIntelSilently('intel_tour');
    for (const n of w.npcs) {
      if (n.role !== 'guest' || !n.awake || !n.active || n.behavior.prio >= 15) continue;
      const room = w.grid.roomAt(n.pos);
      if (!room || (room.indoor === false && dist(n.pos, { x: 36, z: 30 }) > 30)) continue;
      const spot = w.grid.randomFreeNear({ x: 36.5, z: 30.5 }, 3.5, () => w.rng.next(), new Set(['public'])) ?? { x: 36.5, z: 30.5 };
      w.brain.request(w, n, new AttendBehavior('speech', spot, { x: 36.5, z: 25.8 }, () => !w.flags.speechActive, 15));
    }
  }

  tourStarted(host: Npc) {
    const w = this.w;
    const guests = w.npcs
      .filter((n) => n.role === 'guest' && n.awake && n.active && n.behavior.prio < 16 && dist(n.pos, host.pos) < 18)
      .sort((a, b) => dist(a.pos, host.pos) - dist(b.pos, host.pos))
      .slice(0, 3);
    const offs: V2[] = [
      { x: -1.2, z: 1.0 },
      { x: 1.2, z: 1.0 },
      { x: 0, z: 1.8 },
    ];
    this.tourFollowers = guests.map((g) => g.id);
    guests.forEach((g, i) => w.brain.request(w, g, new FollowBehavior(host.id, () => !w.flags.tourActive, offs[i])));
    const gg = w.npc('gallery_guard');
    if (gg && gg.awake && gg.behavior.prio < 16) w.brain.request(w, gg, new StepAsideBehavior(() => !w.flags.tourActive));
  }

  tourInspect(host: Npc) {
    const w = this.w;
    const item = w.caseItem;
    if (item && item.type === 'golden_duck') {
      host.say(w, '역시... 언제 봐도 아름답군! 꽥!', 'speech', 3);
    } else if (item && item.type === 'fake_duck') {
      host.say(w, '잠깐... 이건... 고무 오리잖아?! 내 오리가 바뀌었어!!', 'alert', 3.5, 'gasp');
      w.brain.learnTheft(w, host, 'tour');
      for (const id of this.tourFollowers) {
        const g = w.npc(id);
        if (g) g.knowledge.knowsTheft = true;
      }
    } else {
      host.say(w, '오, 오리가... 내 황금 오리가 없어!!!', 'alert', 3.5, 'scream');
      w.brain.learnTheft(w, host, 'tour');
    }
  }

  tourOut(): boolean {
    const w = this.w;
    return this.tourFollowers.every((id) => {
      const g = w.npc(id);
      return !g || w.grid.roomAt(g.pos)?.id !== 'gallery';
    });
  }

  tourEnded() {
    this.tourFollowers = [];
  }

  evacuate(n: Npc) {
    const w = this.w;
    if (!w.flags.fireAlarm || n.behavior.name === 'attend_evacuate' || n.behavior.prio >= 70) return;
    const spot = w.grid.randomFreeNear({ x: 36.5, z: 47.5 }, 5, () => w.rng.next()) ?? { x: 36.5, z: 47 };
    w.brain.request(w, n, new AttendBehavior('evacuate', spot, { x: 36.5, z: 42 }, () => !w.flags.fireAlarm, 70));
  }

  watchFireworks(n: Npc) {
    const w = this.w;
    if (!w.flags.fireworksShow || n.behavior.prio >= 15) return;
    const spot = w.grid.randomFreeNear({ x: 36, z: 10.5 }, 5, () => w.rng.next()) ?? { x: 34, z: 10.5 };
    w.brain.request(w, n, new AttendBehavior('fireworks', spot, { x: 28, z: 2 }, () => !w.flags.fireworksShow, 15));
  }

  launchFireworks(by: string) {
    const w = this.w;
    if (w.flags.fireworksUsed) return;
    w.flags.fireworksUsed = true;
    w.flags.fireworksShow = true;
    this.fwUntil = w.time + 40;
    this.fwNextBurst = w.time + 1.2;
    this.fwBursts = 0;
    w.events.emit('sfx', { name: 'fireworks_launch', x: 28, z: 4 });
    w.emitNoise({ pos: { x: 28, z: 4 }, radius: 70, kind: 'fireworks', source: by });
    if (by === 'player') {
      w.completeTodo('fireworks');
      w.events.emit('notify', { text: '🎆 불꽃놀이가 터졌다! 사람들이 정원으로 몰려든다.', kind: 'good' });
    } else {
      w.events.emit('notify', { text: '🎆 피날레 불꽃놀이가 시작됐다!', kind: 'info' });
    }
  }

  fireAlarm(pos: V2) {
    const w = this.w;
    w.flags.fireAlarm = true;
    this.fireUntil = w.time + 55;
    w.completeTodo('fire_alarm');
    w.events.emit('notify', { text: '🔔 화재 경보! 모두 앞마당으로 대피한다.', kind: 'good' });
    w.emitNoise({ pos, radius: 90, kind: 'fire_alarm', source: 'player' });
  }

  chiefGuardDuck(chief: Npc) {
    const w = this.w;
    if (!chief.awake || chief.behavior.prio >= 56 || w.security.lockdown) return;
    w.brain.request(w, chief, new GuardDuckBehavior());
  }

  constructor(private w: World) {}
}
