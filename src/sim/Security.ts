// Mansion security: radio network, cameras, tape recordings, duck alarm, lockdown.
import { angleDiff, angleOf, dist, type V2 } from '../core/math';
import { CAMERAS } from './level/layout';
import type { OutfitId } from './level/types';
import { GatherBehavior, LockdownBehavior } from './npc/behaviors';
import type { Npc } from './npc/Npc';
import { OUTFITS } from './rules';
import type { RadioMsg, World } from './World';

export interface SecCam {
  id: string;
  pos: V2;
  base: number;
  sweep: number;
  period: number;
  range: number;
  fov: number;
  angle: number;
  meter: number;
  seeing: boolean;
  cooldown: number;
  /** What the camera currently flags ('' if nothing). */
  flag: string;
}

export interface TapeEntry {
  t: number;
  cam: string;
  outfit: OutfitId;
  what: string;
  severe: boolean;
}

export class Security {
  lockdown = false;
  lockdownAt = -1;
  announced = false;
  alarmArmed = true;
  alarmOn = false;
  alarmUntil = 0;
  camerasEnabled = true;
  tapes: TapeEntry[] = [];
  tapesReviewed = false;
  cams: SecCam[];
  radioLog: { t: number; from: string; text: string }[] = [];
  private lastIntruderRadio = new Map<string, number>();

  constructor() {
    this.cams = CAMERAS.map((c) => ({
      id: c.id,
      pos: { x: c.x, z: c.z },
      base: c.angle,
      sweep: c.sweep,
      period: c.period,
      range: c.range,
      fov: c.fov,
      angle: c.angle,
      meter: 0,
      seeing: false,
      cooldown: 0,
      flag: '',
    }));
  }

  camsPowered(w: World): boolean {
    return w.power.on('C') && this.camerasEnabled;
  }

  /** Is the operator at his desk, awake and looking at the monitors? */
  operatorWatching(w: World): Npc | null {
    const op = w.npc('operator');
    if (!op || !op.awake || !w.power.on('C')) return null;
    if (dist(op.pos, w.station('st_operator').pos) > 1.2) return null;
    if (op.behavior.prio > 58) return null;
    return op;
  }

  radio(w: World, from: Npc, msg: RadioMsg) {
    if (!from.radio || !from.awake) return;
    from.say(w, msg.text, 'radio', 3.2);
    this.radioLog.push({ t: w.time, from: from.name, text: msg.text });
    if (this.radioLog.length > 30) this.radioLog.shift();
    for (const n of w.npcs) {
      if (n === from || !n.radio || !n.awake || !n.active) continue;
      w.brain.onRadio(w, n, msg);
    }
    // The player can overhear radio chatter when close to any radio carrier.
    w.onRadioHeard(from, msg);
  }

  radioIntruder(w: World, from: Npc, outfit: OutfitId, pos: V2, why: string) {
    const key = outfit;
    const last = this.lastIntruderRadio.get(key) ?? -99;
    if (w.time - last < 12) return;
    this.lastIntruderRadio.set(key, w.time);
    const room = w.grid.roomAt(pos)?.name ?? '저택';
    const text = `침입자 발견! ${room}, ${OUTFITS[outfit].name} 차림이다! (${why})`;
    this.radio(w, from, { kind: 'intruder', text, outfit, pos });
    w.stats.compromised.add(outfit);
    w.events.emit('notify', { text: `무전: "${OUTFITS[outfit].name}" 차림이 수배되었다! 다른 옷으로 갈아입자.`, kind: 'danger' });
  }

  startLockdown(w: World, by: Npc) {
    if (this.lockdown) return;
    this.lockdown = true;
    this.lockdownAt = w.time;
    w.stats.lockdown = true;
    w.events.emit('lockdown', {});
    if (by.radio) this.radio(w, by, { kind: 'lockdown', text: '전원 봉쇄! 정문과 쪽문 폐쇄, 아무도 내보내지 마라!' });
    if (by.isGuard) w.brain.request(w, by, new LockdownBehavior(), true);
    // PA announcement needs power in the main house.
    if (w.power.on('B')) {
      this.announced = true;
      w.events.emit('notify', { text: '📢 "손님 여러분, 안전을 위해 모두 연회장으로 모여 주십시오!"', kind: 'danger' });
      for (const n of w.npcs) {
        if (n.role === 'guest' && n.awake && n.active) w.brain.request(w, n, new GatherBehavior());
      }
    } else {
      w.events.emit('notify', { text: '봉쇄가 시작됐지만 정전으로 안내 방송이 나가지 않았다.', kind: 'warn' });
    }
  }

  triggerAlarm(w: World) {
    if (this.alarmOn) return;
    this.alarmOn = true;
    this.alarmUntil = w.time + 45;
    w.stats.alarms++;
    w.events.emit('alarm', { on: true });
    w.emitNoise({ pos: { x: 36, z: 18 }, radius: 90, kind: 'alarm', source: 'case' });
  }

  stopAlarm(w: World) {
    if (!this.alarmOn) return;
    this.alarmOn = false;
    w.events.emit('alarm', { on: false });
  }

  reviewTapes(w: World, op: Npc) {
    this.tapesReviewed = true;
    if (!w.power.on('C')) return;
    const severe = this.tapes.filter((t) => t.severe);
    if (!severe.length) {
      op.say(w, '녹화 기록에는 별다른 게 없군...', 'thought', 2.6);
      return;
    }
    const outfits = [...new Set(severe.map((t) => t.outfit))];
    for (const o of outfits) {
      w.security.radio(w, op, { kind: 'intruder', text: `녹화 기록 확인! 범인은 ${OUTFITS[o].name} 차림이다!`, outfit: o });
      w.stats.compromised.add(o);
    }
    w.events.emit('notify', { text: '보안실이 녹화 기록을 확인했다! 찍힌 옷차림이 수배된다.', kind: 'danger' });
  }

  update(w: World, dt: number) {
    if (this.alarmOn) {
      if (w.time > this.alarmUntil || !w.power.on('C')) this.stopAlarm(w);
      else if (Math.floor(w.time) !== Math.floor(w.time - dt) && Math.floor(w.time) % 6 === 0)
        w.emitNoise({ pos: { x: 36, z: 18 }, radius: 90, kind: 'alarm', source: 'case' });
    }
    const powered = this.camsPowered(w);
    const p = w.player;
    const st = w.playerStatus;
    for (const c of this.cams) {
      c.angle = c.base + Math.sin((w.time * Math.PI * 2) / c.period) * c.sweep;
      c.cooldown = Math.max(0, c.cooldown - dt);
      c.seeing = false;
      c.flag = '';
      if (!powered) {
        c.meter = 0;
        continue;
      }
      if (p.hidden || p.gone) {
        c.meter = Math.max(0, c.meter - dt * 0.4);
        continue;
      }
      const d = dist(c.pos, p.pos);
      if (d > c.range) {
        c.meter = Math.max(0, c.meter - dt * 0.4);
        continue;
      }
      const a = angleOf({ x: p.pos.x - c.pos.x, z: p.pos.z - c.pos.z });
      if (Math.abs(angleDiff(c.angle, a)) > c.fov / 2 || w.lighting.at(p.pos) < 0.35 || !w.grid.los(c.pos, p.pos)) {
        c.meter = Math.max(0, c.meter - dt * 0.4);
        continue;
      }
      c.seeing = true;
      // What would a watching operator flag?
      const op = w.npc('operator');
      let rate = 0;
      let what = '';
      let severe = false;
      if (st.duckVisible) {
        rate = 3;
        what = '황금 오리를 들고 있다';
        severe = true;
      } else if (st.illegal) {
        rate = 2.5;
        what = st.illegal;
        severe = true;
      } else if (op && op.knowledge.compromised.has(st.outfit)) {
        rate = 1.6;
        what = '수배된 차림';
        severe = true;
      } else if (st.trespass && st.zone.startsWith('sec')) {
        rate = 0.9;
        what = '출입 제한 구역 침입';
      } else if (st.trespass) {
        rate = 0.45;
        what = '직원 구역에 수상한 사람';
      }
      if (rate <= 0) {
        c.meter = Math.max(0, c.meter - dt * 0.3);
        continue;
      }
      c.flag = what;
      c.meter = Math.min(1.2, c.meter + rate * dt * (1.4 - d / c.range));
      if (c.meter >= 1 && c.cooldown <= 0) {
        c.cooldown = 10;
        w.events.emit('sfx', { name: 'camera_beep', x: c.pos.x, z: c.pos.z });
        this.tapes.push({ t: w.time, cam: c.id, outfit: p.outfit, what, severe });
        w.stats.recorded++;
        const watcher = this.operatorWatching(w);
        if (watcher) {
          const room = w.grid.roomAt(p.pos)?.name ?? '저택';
          if (severe) {
            if (st.duckVisible) w.brain.learnTheft(w, watcher, 'saw');
            this.radioIntruder(w, watcher, p.outfit, { ...p.pos }, `카메라에 ${what}`);
          } else {
            const g = w.brain.nearestGuard(w, p.pos, watcher.id);
            this.radio(w, watcher, {
              kind: 'investigate',
              text: `카메라에 수상한 사람이 잡혔다. ${room}, ${OUTFITS[p.outfit].name} 차림. ${g ? g.name + ', 확인 바람.' : ''}`,
              pos: { ...p.pos },
              target: g?.id,
            });
          }
          w.events.emit('notify', { text: '📹 감시카메라에 찍혔다! 보안실이 지켜보고 있었다.', kind: 'danger' });
        } else {
          w.events.emit('notify', { text: '📹 감시카메라에 녹화됐다... (보안실이 비어 있어 아직 아무도 모른다)', kind: 'warn' });
        }
      }
    }
  }

  /** Wipe the recordings. */
  eraseTapes(w: World) {
    const n = this.tapes.length;
    this.tapes = [];
    w.stats.tapesErased += n;
  }
}
