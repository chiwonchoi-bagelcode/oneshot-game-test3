// The NPC "brain": perception -> knowledge -> reactions -> behaviours.
import { angleDiff, angleOf, clamp, dampAngle, dist, type V2 } from '../../core/math';
import type { Circuit, OutfitId } from '../level/types';
import { OUTFITS } from '../rules';
import type { Noise, Observable, RadioMsg, World } from '../World';
import {
  AlarmResponseBehavior,
  AttendBehavior,
  Behavior,
  ChaseBehavior,
  ConfrontBehavior,
  CowerBehavior,
  FixPowerBehavior,
  FleeReportBehavior,
  GatherBehavior,
  InvestigateBehavior,
  LockdownBehavior,
  NoticeBehavior,
  RedressBehavior,
  ReturnDuckBehavior,
  SearchBehavior,
  SickBehavior,
  SleepBehavior,
  type Report,
} from './behaviors';
import { HOSTILE_REASONS, type Npc, type SusReason } from './Npc';
import { canSee, evaluatePlayer, seeQuality } from './perception';
import { RoutineBehavior } from './routine';

const SEV: Record<SusReason, number> = {
  none: 0,
  behavior: 1,
  item: 2,
  lockdown: 3,
  trespass: 4,
  uninvited: 5,
  disguise: 6,
  recognized: 7,
  crime: 8,
  duck: 9,
};

export class Brain {
  routines = new Map<string, RoutineBehavior>();

  init(w: World, n: Npc) {
    const r = new RoutineBehavior();
    this.routines.set(n.id, r);
    n.behavior = r;
    r.enter(w, n);
  }

  routine(n: Npc): RoutineBehavior {
    return this.routines.get(n.id)!;
  }

  /** Ask an NPC to do something. Higher priority wins; `force` replaces regardless (used for hand-offs). */
  request(w: World, n: Npc, b: Behavior, force = false): boolean {
    const cur = n.behavior;
    if (cur.name === b.name && !cur.done && cur.absorb(w, n, b)) return true;
    if (!force && b.prio <= cur.prio && !cur.done) return false;
    if (cur.name === 'sleep' && n.asleep > 0) return false;
    this.switchTo(w, n, b);
    return true;
  }

  private switchTo(w: World, n: Npc, b: Behavior) {
    const cur = n.behavior;
    cur.exit(w, n);
    n.action = 'none';
    n.seated = false;
    n.pose = 'stand';
    n.behavior = b;
    b.t = 0;
    b.done = false;
    b.enter(w, n);
  }

  private endCurrent(w: World, n: Npc) {
    const r = this.routine(n);
    const cur = n.behavior;
    if (cur === r) {
      r.done = false;
      return;
    }
    cur.exit(w, n);
    n.action = 'none';
    n.seated = false;
    n.behavior = r;
    r.done = false;
    if (w.security.lockdown && n.awake) {
      if (n.isGuard) {
        n.behavior = new LockdownBehavior();
        n.behavior.enter(w, n);
        return;
      }
      if (n.role === 'guest' && w.security.announced) {
        n.behavior = new GatherBehavior();
        n.behavior.enter(w, n);
        return;
      }
    }
    if (w.flags.fireAlarm && n.awake && !n.isGuard) {
      w.director.evacuate(n);
      if (n.behavior !== r) return;
    }
    r.resume(w, n);
  }

  update(w: World, n: Npc, dt: number) {
    if (!n.active) return;
    // Drug effects kick in a little after drinking.
    if (n.pendingDrug && w.time >= n.pendingDrug.at) {
      const kind = n.pendingDrug.kind;
      n.pendingDrug = null;
      if (kind === 'sleep') this.fallAsleep(w, n, w.rng.range(95, 130));
      else {
        n.sick = 1;
        this.request(w, n, new SickBehavior(), true);
      }
    }
    if (n.asleep > 0) {
      n.asleep -= dt;
      n.knowledge.seesPlayer = false;
    } else {
      this.perceive(w, n, dt);
      n.scanT -= dt;
      if (n.scanT <= 0) {
        n.scanT = 0.3;
        this.scanObservables(w, n);
      }
    }
    n.behavior.t += dt;
    n.behavior.tick(w, n, dt);
    if (n.behavior.done) this.endCurrent(w, n);
    if (n.asleep <= 0) n.updateMove(w, dt);
    this.updateHead(w, n, dt);
    this.compose(w, n, dt);
  }

  fallAsleep(w: World, n: Npc, dur: number) {
    n.asleep = dur;
    n.sleepKind = n.seated || n.behavior.name === 'routine' && n.seated ? 'chair' : 'floor';
    if (n.job === 'operator' && dist(n.pos, w.station('st_operator').pos) < 1.2) n.sleepKind = 'chair';
    n.knowledge.suspicion = 0;
    w.stats.drugged.add(n.id);
    w.releaseToilet(n);
    if (n.slot) w.releaseSlot(n);
    this.switchTo(w, n, new SleepBehavior());
    w.events.emit('notify', { text: `${n.name}이(가) 잠들었다.`, kind: 'info' });
    w.observablesDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Perception of the player
  // ---------------------------------------------------------------------------
  private perceive(w: World, n: Npc, dt: number) {
    const k = n.knowledge;
    const p = w.player;
    k.wary = Math.max(0, k.wary - dt);
    let quality = 0;
    if (!p.hidden && !p.gone && dist(n.pos, p.pos) < 18) {
      // A gleaming golden duck is hard to miss, even in the dark.
      quality = seeQuality(w, n, p.pos, { crouch: p.crouching && !w.playerStatus.duckVisible, bright: w.playerStatus.duckVisible });
    }
    const sees = quality > 0;
    k.seesPlayer = sees;
    const decay = () => {
      k.suspicion = Math.max(0, k.suspicion - dt * (k.wary > 0 ? 0.12 : 0.22));
      if (k.suspicion === 0) k.reason = 'none';
    };
    if (sees) {
      k.seeTime += dt;
      const d = dist(n.pos, p.pos);
      const ev = evaluatePlayer(w, n, d);
      ev.rate *= quality;
      // Only keep track of someone we have reason to watch (a new disguise breaks the trail).
      if (k.compromised.has(p.outfit) || k.suspicion > 0.2 || ev.rate > 0) k.lastSeen = { pos: { ...p.pos }, t: w.time, outfit: p.outfit };
      if (ev.rate > 0) {
        if (SEV[ev.reason] >= SEV[k.reason] || k.suspicion < 0.25) {
          k.reason = ev.reason;
          k.reasonText = ev.text;
        }
        k.suspicion = Math.min(1.25, k.suspicion + ev.rate * dt);
        w.player.noticedBy.set(n.id, k.suspicion);
      } else decay();
    } else {
      k.seeTime = 0;
      decay();
    }
    if (k.suspicion > 0.02 && sees) w.player.noticedBy.set(n.id, k.suspicion);
    else w.player.noticedBy.delete(n.id);

    // Someone lingering right behind you makes you turn around.
    const d = dist(n.pos, p.pos);
    if (!sees && !p.hidden && !p.gone && d < 1.5 && !p.crouching && n.behavior.prio < 30 && w.grid.los(n.pos, p.pos)) {
      k.nearTime += dt;
      if (k.nearTime > 2.4) {
        k.nearTime = 0;
        n.lookAt(p.pos, 2.5);
        n.facing = dampAngle(n.facing, angleOf({ x: p.pos.x - n.pos.x, z: p.pos.z - n.pos.z }), 3, 0.4);
        n.say(w, w.rng.pick(['응? 무슨 일이시죠?', '왜 그렇게 붙어 계세요?', '...?']), 'normal', 2);
      }
    } else k.nearTime = Math.max(0, k.nearTime - dt);

    if (k.suspicion >= 1 && k.reason !== 'none') this.react(w, n);
    else if (sees && k.suspicion > 0.3 && k.reason !== 'none' && n.behavior.prio < 35) {
      if (n.role !== 'guest' || SEV[k.reason] >= 7) this.request(w, n, new NoticeBehavior());
    }
  }

  private react(w: World, n: Npc) {
    const k = n.knowledge;
    const p = w.player;
    const reason = k.reason;
    const cur = n.behavior.name;
    const hostile = HOSTILE_REASONS.has(reason) || (reason === 'disguise' && n.isGuard);
    if (hostile) {
      k.compromised.add(p.outfit);
      k.crime = k.reasonText;
      k.crimePos = { ...p.pos };
      k.crimeOutfit = p.outfit;
      if (reason === 'duck') this.learnTheft(w, n, 'saw');
      if (n.isGuard) {
        if (cur !== 'chase') this.escalate(w, n, reason, k.reasonText);
      } else if (cur !== 'report') {
        w.stats.noteSpotted(n.id, reason, w.time);
        this.request(
          w,
          n,
          new FleeReportBehavior({
            kind: reason === 'duck' ? 'theft' : 'intruder',
            outfit: p.outfit,
            pos: { ...p.pos },
            text: w.content.reportText(reason, p.outfit, k.reasonText),
          }),
        );
      }
      return;
    }
    // Non-hostile oddities.
    if (cur === 'confront' || cur === 'chase' || cur === 'report') return;
    if (n.isGuard || ((reason === 'uninvited' || reason === 'disguise') && n.enforces.size > 0)) {
      this.request(w, n, new ConfrontBehavior(reason));
      return;
    }
    // Staff complain about trespassers, and report repeat offenders.
    if (n.role === 'staff' && reason === 'trespass') {
      if (w.time - k.toldAt > 25) {
        k.toldAt = w.time;
        n.say(w, w.rng.pick(['여기는 직원만 들어올 수 있어요!', '손님, 여긴 들어오시면 안 돼요.']), 'normal', 2.6, 'ahem');
        k.suspicion = 0.55;
      } else {
        this.request(
          w,
          n,
          new FleeReportBehavior({ kind: 'trespass', outfit: p.outfit, pos: { ...p.pos }, text: w.content.reportText('trespass', p.outfit) }, false),
        );
        k.suspicion = 0.3;
      }
      return;
    }
    if (w.time - k.lastNoticeBark > 6) {
      k.lastNoticeBark = w.time;
      n.say(w, w.content.mildLine(n, reason), 'thought', 2.2, 'hmm');
    }
    k.suspicion = 0.5;
  }

  escalate(w: World, n: Npc, reason: SusReason, text: string) {
    const k = n.knowledge;
    const p = w.player;
    k.compromised.add(p.outfit);
    k.crime = text;
    k.crimePos = { ...p.pos };
    k.crimeOutfit = p.outfit;
    k.suspicion = 1.25;
    k.reason = reason;
    w.stats.noteSpotted(n.id, reason, w.time);
    this.request(w, n, new ChaseBehavior(text), true);
  }

  nearestGuard(w: World, from: V2, exclude?: string): Npc | null {
    let best: Npc | null = null;
    let bd = Infinity;
    for (const g of w.npcs) {
      if (!g.isGuard || !g.awake || !g.active || g.id === exclude) continue;
      let d = dist(g.pos, from);
      // Prefer guards in the same building section.
      if (w.grid.roomAt(g.pos)?.indoor !== w.grid.roomAt(from)?.indoor) d += 8;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  /** A civilian reaches a guard and tells them what they saw. */
  informGuard(w: World, g: Npc, info: Report, from: Npc | null) {
    const k = g.knowledge;
    k.toldAt = w.time;
    if (g.behavior.name === 'listen') g.behavior.done = true;
    const compromising = info.kind === 'intruder' || info.kind === 'theft' || info.kind === 'disguise' || info.kind === 'uniform';
    if (info.outfit && compromising) k.compromised.add(info.outfit);
    if (info.pos) k.lastSeen = { pos: info.pos, t: w.time, outfit: info.outfit ?? w.player.outfit };
    if (info.kind === 'theft') this.learnTheft(w, g, 'told');
    g.knowledge.wary = Math.max(g.knowledge.wary, 120);
    if (from) g.say(w, w.rng.pick(['알겠습니다. 제가 처리하죠!', '어디서요? 바로 가 보겠습니다!', '진정하세요, 확인하겠습니다.']), 'normal', 2.2);
    if (g.radio && info.outfit && compromising && info.kind !== 'theft') {
      w.security.radioIntruder(w, g, info.outfit, info.pos ?? g.pos, info.text);
    }
    if (info.kind === 'sleeper' && info.sleeperId) {
      this.request(w, g, new InvestigateBehavior(w.npc(info.sleeperId)?.pos ?? info.pos!, 'sleeper', { npcId: info.sleeperId }, 46), true);
      return;
    }
    if (info.kind === 'duck_found' && info.item) {
      if (w.claim('duck:' + info.item.id, g.id)) this.request(w, g, new ReturnDuckBehavior(info.item), true);
      return;
    }
    if (info.pos) this.request(w, g, new InvestigateBehavior(info.pos, 'report'), true);
  }

  // ---------------------------------------------------------------------------
  // Knowledge events
  // ---------------------------------------------------------------------------
  learnTheft(w: World, n: Npc, how: 'saw' | 'case' | 'told' | 'radio' | 'alarm' | 'found' | 'tour') {
    if (n.knowledge.knowsTheft) return;
    n.knowledge.knowsTheft = true;
    w.stats.noteTheftKnown(n.id, how, w.time);
    if (how === 'radio' || how === 'alarm') return;
    if (n.isGuard) {
      if (n.radio) w.security.radio(w, n, { kind: 'theft', text: '황금 오리가 도난당했다! 전원 경계!', pos: { ...n.pos } });
      // The chief (or the operator standing in for him) orders the lockdown himself.
      if (!n.radio || n.job === 'chief' || (n.job === 'operator' && !w.npcAwake('chief'))) w.security.startLockdown(w, n);
    } else if (how !== 'saw' && n.behavior.name !== 'report') {
      this.request(
        w,
        n,
        new FleeReportBehavior({ kind: 'theft', pos: { ...n.pos }, text: '큰일이에요! 황금 오리가 없어졌어요!', outfit: null }),
      );
    }
  }

  foundSleeper(w: World, finder: Npc, s: Npc) {
    if (finder.isGuard) {
      finder.knowledge.wary = Math.max(finder.knowledge.wary, 150);
      if (finder.radio) {
        w.security.radio(w, finder, { kind: 'sleeper', text: `${w.grid.roomAt(s.pos)?.name ?? '어딘가'}에 사람이 쓰러져 있다! 누군가 약을 탄 것 같다.`, pos: { ...s.pos } });
        if (s.stripped && s.uniform)
          w.security.radio(w, finder, { kind: 'uniform', text: `${s.name}의 ${OUTFITS[s.uniform].name}이(가) 사라졌다! 그 옷을 입은 놈을 찾아라!`, outfit: s.uniform });
      }
      this.request(w, finder, new SearchBehavior(s.pos, 25), true);
    } else {
      this.request(
        w,
        finder,
        new FleeReportBehavior({
          kind: s.stripped ? 'uniform' : 'sleeper',
          pos: { ...s.pos },
          sleeperId: s.id,
          outfit: s.stripped ? s.uniform : null,
          text: s.stripped ? '사람이 쓰러져 있는데 옷이 벗겨져 있어요!' : '저쪽에 사람이 쓰러져 있어요!',
        }),
        true,
      );
    }
  }

  wake(w: World, s: Npc, by: Npc) {
    s.asleep = 0;
    by.say(w, w.rng.pick(['이봐! 근무 중에 졸면 어떡해!', '정신 차려! 지금 몇 시인데!']), 'alert', 2.6);
    s.knowledge.wary = 60;
    w.stats.wokenUp++;
  }

  onWake(w: World, n: Npc) {
    n.pose = 'stand';
    n.knowledge.wary = Math.max(n.knowledge.wary, 60);
    if (n.stripped) {
      n.say(w, '어...? 내, 내 옷이 어디 갔지?!', 'alert', 3, 'gasp');
      if (n.uniform) {
        n.knowledge.compromised.add(n.uniform);
        if (n.radio)
          w.security.radio(w, n, { kind: 'uniform', text: `누가 내 ${OUTFITS[n.uniform].name}을(를) 훔쳐 갔다! 그 옷 입은 놈 조심해!`, outfit: n.uniform });
      }
      this.request(w, n, new RedressBehavior(), true);
      if (!n.radio && n.uniform)
        this.request(
          w,
          n,
          new FleeReportBehavior({ kind: 'uniform', outfit: n.uniform, pos: { ...n.pos }, text: `누가 제 ${OUTFITS[n.uniform].name}을 훔쳐 갔어요!` }, false),
          true,
        );
    } else {
      n.say(w, w.rng.pick(['으음... 내가 잠들었었나?', '하암... 깜빡 졸았네.', '어라, 여기가 어디지...']), 'normal', 2.6, 'sigh');
    }
  }

  foundHidden(w: World, n: Npc) {
    const p = w.player;
    n.say(w, w.rng.pick(['거기 숨어 있었군!', '찾았다!']), 'alert', 2.2, 'shout');
    p.exitHide(w, true);
    const c = new ChaseBehavior('숨어 있다가 발각');
    c.stun = 0.7;
    n.knowledge.compromised.add(p.outfit);
    w.stats.noteSpotted(n.id, 'crime', w.time);
    this.request(w, n, c, true);
  }

  // ---------------------------------------------------------------------------
  // Hearing
  // ---------------------------------------------------------------------------
  onNoise(w: World, n: Npc, noise: Noise, effDist: number) {
    if (!n.awake || !n.active) return;
    const cur = n.behavior;
    const src = noise.pos;
    switch (noise.kind) {
      case 'step':
        if ((n.isGuard || n.role === 'staff') && cur.prio < 30 && !n.knowledge.seesPlayer) {
          n.lookAt(src, 1.6);
          if (n.isGuard && n.knowledge.wary > 0 && effDist < noise.radius * 0.7 && cur.prio < 25)
            this.request(w, n, new InvestigateBehavior(src, 'noise'));
        }
        return;
      case 'whistle':
      case 'thud':
      case 'engine':
      case 'splash':
        if (cur.prio < 25) {
          if (w.claim('noise:' + noise.id, n.id, noise.kind === 'whistle' ? 1 : 2)) {
            this.request(w, n, new InvestigateBehavior(src, noise.kind === 'engine' ? 'engine' : noise.kind === 'whistle' ? 'whistle' : 'noise'));
          } else {
            n.lookAt(src, 2);
            if (n.role === 'guest' && w.rng.chance(0.3)) n.say(w, w.rng.pick(['방금 무슨 소리지?', '응?']), 'thought', 1.8, 'huh');
          }
        }
        return;
      case 'break':
        n.lookAt(src, 2.5);
        if (n.role === 'guest') {
          if (w.rng.chance(0.4)) n.say(w, w.rng.pick(['어머나!', '무슨 소리야?', '뭐가 깨졌나 봐요!']), 'normal', 2, 'gasp');
          return;
        }
        if (cur.prio < 25 && w.claim('noise:' + noise.id, n.id, 2)) this.request(w, n, new InvestigateBehavior(src, 'noise'));
        return;
      case 'shout':
        if (noise.source === n.id) return;
        if (n.isGuard) {
          if (cur.prio < 45 && n.job !== 'operator' && n.job !== 'gallery_guard') {
            const pos = (noise.data?.pos as V2 | undefined) ?? src;
            this.request(w, n, new InvestigateBehavior(pos, 'shout'));
          }
        } else if (cur.prio < 30) {
          n.lookAt(src, 2);
          if (effDist < 8 && cur.prio < 20) this.request(w, n, new CowerBehavior(3, src));
        }
        return;
      case 'scream':
        if (noise.source === n.id) return;
        if (n.isGuard) {
          if (cur.prio < 45 && n.job !== 'operator' && n.job !== 'gallery_guard') this.request(w, n, new InvestigateBehavior(src, 'scream'));
        } else if (cur.prio < 20) {
          n.lookAt(src, 2.5);
          if (n.role === 'guest' && w.rng.chance(0.5)) n.say(w, w.rng.pick(['무슨 일이야?', '방금 비명 소리 들었어요?']), 'normal', 2, 'gasp');
        }
        return;
      case 'alarm':
        if (n.isGuard) {
          this.learnTheft(w, n, 'alarm');
          if (n.job === 'chief' || (n.job === 'operator' && !w.npcAwake('chief'))) w.security.startLockdown(w, n);
          if (n.job !== 'doorman' && n.job !== 'svc_guard' && n.job !== 'operator') this.request(w, n, new AlarmResponseBehavior());
        } else if (cur.prio < 65) {
          this.request(w, n, new CowerBehavior(w.rng.range(3, 6), src));
        }
        return;
      case 'fire_alarm':
        if (n.isGuard) {
          if (n.job === 'chief' || n.job === 'patrol') this.request(w, n, new SearchBehavior(src, 30, 55));
        } else w.director.evacuate(n);
        return;
      case 'fireworks':
        if (n.isGuard) {
          if (n.id === 'patrol_back' && cur.prio < 25) this.request(w, n, new InvestigateBehavior(w.station('st_fireworks').pos, 'fireworks'));
        } else if (n.job !== 'pianist' && n.job !== 'chef') w.director.watchFireworks(n);
        return;
      case 'music':
        if ((n.role === 'staff' || n.isGuard) && cur.prio < 20 && n.job !== 'operator' && n.job !== 'gallery_guard') {
          if (w.claim('music', n.id)) this.request(w, n, new InvestigateBehavior(src, 'music'));
        }
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Radio
  // ---------------------------------------------------------------------------
  onRadio(w: World, n: Npc, m: RadioMsg) {
    const k = n.knowledge;
    const fixedPost = n.job === 'doorman' || n.job === 'svc_guard' || n.job === 'gallery_guard' || n.job === 'operator';
    switch (m.kind) {
      case 'intruder':
        if (m.outfit) k.compromised.add(m.outfit);
        if (m.pos) k.lastSeen = { pos: m.pos, t: w.time, outfit: m.outfit ?? w.player.outfit };
        k.wary = Math.max(k.wary, 150);
        if (n.isGuard && !fixedPost && m.pos && dist(n.pos, m.pos) < 32 && n.behavior.prio < 60) {
          this.request(w, n, new SearchBehavior(m.pos, 30), true);
        }
        return;
      case 'investigate':
        if (n.id === m.target && m.pos) this.request(w, n, new InvestigateBehavior(m.pos, 'camera'), true);
        else k.wary = Math.max(k.wary, 40);
        return;
      case 'theft':
        this.learnTheft(w, n, 'radio');
        k.wary = 300;
        if (n.job === 'chief' || (n.job === 'operator' && !w.npcAwake('chief'))) w.security.startLockdown(w, n);
        return;
      case 'lockdown':
        // Guards busy chasing/searching keep at it; they switch to lockdown duties afterwards.
        if (n.isGuard) this.request(w, n, new LockdownBehavior());
        return;
      case 'power_out':
        if (n.job === 'electrician') this.request(w, n, new FixPowerBehavior());
        if (n.job === 'chief' && m.circuits?.includes('C')) w.director.chiefGuardDuck(n);
        return;
      case 'power_ok':
        return;
      case 'sleeper':
        k.wary = Math.max(k.wary, 150);
        return;
      case 'uniform':
        if (m.outfit) k.compromised.add(m.outfit);
        k.wary = Math.max(k.wary, 150);
        return;
      case 'duck_found':
        this.learnTheft(w, n, 'radio');
        return;
    }
  }

  /** Someone noticed the power went out. */
  noticePowerOut(w: World, n: Npc, circuits: Circuit[]) {
    if (n.job === 'electrician') {
      this.request(w, n, new FixPowerBehavior());
      return;
    }
    if (n.radio && !w.flags.powerReported) {
      w.flags.powerReported = true;
      w.security.radio(w, n, { kind: 'power_out', text: circuits.includes('C') && circuits.length === 1 ? '보안 시스템 전원이 나갔다! 전기기사 불러!' : '정전이다! 전기기사, 차단기 확인 바람!', circuits });
    }
  }

  // ---------------------------------------------------------------------------
  // Observables
  // ---------------------------------------------------------------------------
  private scanObservables(w: World, n: Npc) {
    const room = w.grid.roomAt(n.pos)?.id;
    for (const o of w.observables) {
      if (n.knowledge.handled.has(o.key)) continue;
      if (o.room) {
        if (o.room !== room) continue;
      } else {
        if (dist(n.pos, o.pos) > (o.range ?? 11)) continue;
        if (!canSee(w, n, o.pos, { bright: o.bright, range: o.range })) continue;
      }
      if (o.only && !o.only(n)) continue;
      n.knowledge.handled.add(o.key);
      this.onObserve(w, n, o);
    }
  }

  private onObserve(w: World, n: Npc, o: Observable) {
    const cur = n.behavior;
    switch (o.kind) {
      case 'duck_out': {
        const item = o.item!;
        this.learnTheft(w, n, 'found');
        if (n.isGuard) {
          if (w.claim('duck:' + item.id, n.id) && cur.prio < 62) this.request(w, n, new ReturnDuckBehavior(item), true);
        } else if (cur.name !== 'report') {
          n.say(w, '저건... 황금 오리잖아?!', 'alert', 2.4, 'gasp');
          this.request(w, n, new FleeReportBehavior({ kind: 'duck_found', item, pos: { ...item.pos }, text: '황금 오리가 바닥에 떨어져 있어요!' }, false), true);
        }
        return;
      }
      case 'case_empty':
        n.say(w, '오리가... 황금 오리가 없어!', 'alert', 2.6, 'gasp');
        this.learnTheft(w, n, 'case');
        return;
      case 'case_fake':
        n.say(w, '잠깐... 이건 고무 오리잖아?!', 'alert', 2.6, 'gasp');
        this.learnTheft(w, n, 'case');
        return;
      case 'sleeper': {
        const s = w.npc(o.npcId!);
        if (!s || s.awake) return;
        if (n.role === 'guest') {
          if (cur.name !== 'report') this.foundSleeper(w, n, s);
        } else if (cur.prio < 42 && w.claim('sleeper:' + s.id, n.id)) {
          this.request(w, n, new InvestigateBehavior(s.pos, 'sleeper', { npcId: s.id }));
        } else if (n.isGuard) n.knowledge.wary = Math.max(n.knowledge.wary, 90);
        return;
      }
      case 'napper': {
        const s = w.npc(o.npcId!);
        if (!s || s.awake) return;
        if ((n.isGuard || n.job === 'butler') && cur.prio < 20 && w.claim('napper:' + s.id, n.id)) {
          this.request(w, n, new InvestigateBehavior(s.pos, 'napper', { npcId: s.id }));
        }
        return;
      }
      case 'mess':
        if (n.role === 'guest') {
          if (w.rng.chance(0.4)) n.say(w, w.rng.pick(['어머, 누가 깨뜨렸나 봐.', '조심해요, 유리 조각!']), 'normal', 2);
          return;
        }
        if (cur.prio < 20 && w.claim('mess:' + o.item!.id, n.id)) this.request(w, n, new InvestigateBehavior(o.pos, 'mess', { item: o.item }));
        return;
      case 'gallery_open':
        if (n.isGuard && cur.prio < 30 && w.claim('door:' + o.door, n.id)) {
          this.request(w, n, new InvestigateBehavior(o.pos, 'door', { door: o.door }));
        }
        return;
      case 'window_open':
        if ((n.isGuard || n.role === 'staff') && cur.prio < 20 && w.claim('window:' + o.window, n.id)) {
          this.request(w, n, new InvestigateBehavior(o.pos, 'window', { window: o.window }));
        }
        return;
      case 'dark_room':
        if (n.role === 'guest') {
          if (w.rng.chance(0.5)) n.say(w, w.rng.pick(['어머, 불이 꺼졌네?', '누가 불 좀 켜 줘요!', '깜깜해라!']), 'normal', 2);
          return;
        }
        if (cur.prio < 20 && w.claim('dark:' + o.roomId, n.id)) this.request(w, n, new InvestigateBehavior(o.pos, 'light', { room: o.roomId }));
        return;
      case 'power_out':
        if (n.role === 'guest') {
          if (w.rng.chance(0.5)) n.say(w, w.rng.pick(['어머, 정전이야!', '꺄! 아무것도 안 보여!', '이것도 파티 이벤트인가요?']), 'normal', 2.4, 'gasp');
          return;
        }
        // The operator finds the cameras switched off at the console (power is fine): someone was here.
        if (n.job === 'operator' && w.power.on('C') && !w.security.camerasEnabled) {
          w.schedule(2, () => {
            if (!n.awake || w.security.camerasEnabled) return;
            w.security.camerasEnabled = true;
            n.knowledge.wary = 200;
            if (n.radio) w.security.radio(w, n, { kind: 'sleeper', text: '누가 보안실 콘솔에서 카메라를 꺼 놨다! 다들 경계해!' });
          });
          n.say(w, '어? 카메라가 왜 다 꺼져 있지?', 'alert', 2.4, 'huh');
          return;
        }
        this.noticePowerOut(w, n, o.circuits ?? []);
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Head & presentation
  // ---------------------------------------------------------------------------
  private updateHead(w: World, n: Npc, dt: number) {
    let target = 0;
    if (n.asleep > 0) {
      n.headYaw = 0;
      return;
    }
    if (n.headTarget && n.headTimer > 0) {
      n.headTimer -= dt;
      const a = angleOf({ x: n.headTarget.x - n.pos.x, z: n.headTarget.z - n.pos.z });
      target = clamp(angleDiff(n.facing, a), -1.3, 1.3);
      // Turn the body too if it's far behind.
      if (Math.abs(angleDiff(n.facing, a)) > 1.4 && !n.moving && !n.seated) n.facing = dampAngle(n.facing, a, 3, dt);
    } else {
      n.headTarget = null;
      // Idle glances: guards scan more.
      n.headTimer -= dt;
      if (n.headTimer < -w.rng.range(1.5, n.isGuard ? 3 : 6)) {
        n.headTimer = 0;
        const amp = n.isGuard ? 1.1 : 0.7;
        n.lookAt(
          {
            x: n.pos.x + Math.sin(n.facing + w.rng.range(-amp, amp)) * 4,
            z: n.pos.z + Math.cos(n.facing + w.rng.range(-amp, amp)) * 4,
          },
          w.rng.range(1, 2.2),
        );
      }
    }
    if (n.moving && !n.headTarget) target *= 0.3;
    n.headYaw = n.headYaw + angleDiff(n.headYaw, target) * Math.min(1, dt * 5);
  }

  private compose(w: World, n: Npc, dt: number) {
    const k = n.knowledge;
    const b = n.behavior.name;
    // Pose
    if (n.asleep > 0) n.pose = n.sleepKind === 'chair' ? 'sleep_chair' : 'sleep_floor';
    else if (b === 'cower') n.pose = 'cower';
    else if (n.seated && !n.moving) n.pose = 'sit';
    else if (n.speed > 3.2) n.pose = 'run';
    else if (n.speed > 0.15) n.pose = 'walk';
    else n.pose = 'stand';
    n.shake = Math.max(0, n.shake - dt);
    // Flashlight in the dark
    n.flashlightOn = n.hasFlashlight && n.awake && w.lighting.at(n.pos) < 0.62;
    // Expression defaults
    if (b === 'routine') {
      if (k.suspicion > 0.15 && k.seesPlayer) n.expr = 'suspicious';
      else if (w.power.anyOff() && w.lighting.at(n.pos) < 0.4 && n.role === 'guest') n.expr = 'scared';
      else if (k.wary > 0 && n.isGuard) n.expr = 'focused';
      else if (n.role === 'guest' || n.job === 'host' || n.job === 'pianist') n.expr = n.talkUntil > w.time ? 'happy' : 'neutral';
      else n.expr = n.action === 'smoke' || n.action === 'eat' ? 'happy' : 'neutral';
    }
    // Icons
    let icon: Npc['icon'] = null;
    if (n.asleep > 0) icon = { g: 'zzz', color: 'blue' };
    else if (b === 'chase') icon = { g: '!', color: 'red' };
    else if (b === 'confront') icon = { g: '!', color: 'orange' };
    else if (b === 'report') icon = { g: '!', color: (n.behavior as FleeReportBehavior).panic ? 'red' : 'orange' };
    else if (b === 'search' || b === 'alarm' || b === 'lockdown') icon = { g: '?', color: 'orange' };
    else if (b === 'sick') icon = { g: '💧', color: 'green' };
    else if (b === 'fixpower') icon = { g: '🔧', color: 'white' };
    else if (b === 'investigate') icon = { g: '?', color: 'yellow' };
    else if (b === 'listen') icon = { g: '…', color: 'white' };
    else if (b === 'cower') icon = { g: '!', color: 'yellow' };
    if (k.suspicion > 0.03 && (k.seesPlayer || b === 'notice') && b !== 'chase' && b !== 'confront' && b !== 'report') {
      icon = { g: '?', meter: clamp(k.suspicion, 0, 1), color: SEV[k.reason] >= 7 ? 'red' : SEV[k.reason] >= 4 ? 'orange' : 'yellow' };
    }
    if (!icon && n.action === 'piano') icon = { g: '♪', color: 'white' };
    n.icon = icon;
  }
}

export { SEV };
export type { OutfitId };
export { AttendBehavior };
