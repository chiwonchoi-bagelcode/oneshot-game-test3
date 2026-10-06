// What an NPC can see. Vision depends on view direction, distance, light level,
// walls/closed doors/tall furniture and (at night) flashlights.
import { angleDiff, angleOf, clamp, dist, type V2 } from '../../core/math';
import type { World } from '../World';
import type { Npc, Role, SusReason } from './Npc';

export const VISION: Record<Role, { range: number; half: number }> = {
  guard: { range: 13.5, half: 1.0 },
  staff: { range: 10, half: 0.95 },
  guest: { range: 8.5, half: 0.9 },
  host: { range: 9.5, half: 0.95 },
};

export const FLASH = { range: 10, half: 0.42 };

export function lightFactor(light: number): number {
  return clamp((light - 0.12) / 0.72, 0.2, 1);
}

export interface SeeOpts {
  /** Target is small/low (crouching player). */
  crouch?: boolean;
  /** Ignore FOV (e.g. object right in front). */
  range?: number;
  /** Only need to see a bright/obvious thing (duck sparkles): easier in the dark. */
  bright?: boolean;
}

/**
 * How well can npc see point p right now? 0 = not at all, ~0.45 = out of the corner of the eye
 * (peripheral vision: shorter range), 1 = clearly.
 */
export function seeQuality(w: World, n: Npc, p: V2, o: SeeOpts = {}): number {
  if (!n.awake || !n.active) return 0;
  const d = dist(n.pos, p);
  const vis = VISION[n.role];
  let range = o.range ?? vis.range;
  if (n.knowledge.wary > 0) range *= 1.15;
  if (d > range * 1.15 + 0.5) return 0;
  const a = angleOf({ x: p.x - n.pos.x, z: p.z - n.pos.z });
  const off = Math.abs(angleDiff(n.viewAngle, a));
  let quality = 1;
  if (off > vis.half) {
    // Very close people are sensed even at the edge of vision, but not directly behind.
    if (d <= 0.9 && off <= 2.0) quality = 1;
    else if (off <= vis.half + 0.75) quality = 0.45;
    else return 0;
  }
  let light = w.lighting.at(p);
  if (n.flashlightOn && d < FLASH.range && off < FLASH.half) light = 1.1;
  let lf = lightFactor(light);
  if (o.bright) lf = Math.max(lf, 0.6);
  let eff = range * lf * (quality < 1 ? 0.45 : 1);
  if (o.crouch) eff *= lf < 0.6 ? 0.65 : 0.85;
  if (d > eff) return 0;
  return w.grid.los(n.pos, p) ? quality : 0;
}

/** Can npc see point p right now (clearly or out of the corner of the eye)? */
export function canSee(w: World, n: Npc, p: V2, o: SeeOpts = {}): boolean {
  return seeQuality(w, n, p, o) > 0;
}

/** Per-second suspicion rate this npc would gain from seeing the player, with reason. */
export function evaluatePlayer(w: World, n: Npc, d: number): { rate: number; reason: SusReason; text: string } {
  const st = w.playerStatus;
  const k = n.knowledge;
  const vis = VISION[n.role];
  const df = clamp(1.7 - d / vis.range, 0.35, 1.7);
  const g = n.isGuard;
  const staff = n.role === 'staff' || n.role === 'host';
  let best: { rate: number; reason: SusReason; text: string } = { rate: 0, reason: 'none', text: '' };
  const sev = (r: SusReason) =>
    ({ none: 0, behavior: 1, item: 2, lockdown: 3, trespass: 4, uninvited: 5, disguise: 6, recognized: 7, crime: 8, duck: 9 })[r];
  const consider = (rate: number, reason: SusReason, text: string) => {
    if (rate <= 0) return;
    if (sev(reason) > sev(best.reason) || (sev(reason) === sev(best.reason) && rate > best.rate)) best = { rate, reason, text };
  };

  if (st.duckVisible) consider(3.6, 'duck', '황금 오리를 들고 있다!');
  if (st.illegal) consider(3.0, 'crime', st.illegal);
  if (k.compromised.has(st.outfit) && d < 13) consider(2.6, 'recognized', '아까 그 수상한 사람이다!');

  if (n.enforces.has(st.outfit) && d < 5.5) {
    if (st.outfit === 'guest') {
      if (!st.legit && !st.inStreet) consider(1.1, 'uninvited', '초대 명단에 없는 사람 같은데?');
    } else if (!(st.outfit === 'electrician' && w.power.anyOff() && n.job !== 'electrician')) {
      consider(1.0, 'disguise', '처음 보는 얼굴인데?');
    }
  }

  const forgiven = (r: SusReason) => k.forgiven && k.forgiven.outfit === st.outfit && k.forgiven.reason === r && w.time - k.forgiven.t < 25;

  if (st.trespass && !forgiven('trespass')) {
    const secure = st.zone.startsWith('sec');
    const rate = secure ? (g ? 1.15 : staff ? 0.6 : 0.3) : g ? 0.75 : staff ? 0.45 : 0.08;
    consider(rate, 'trespass', secure ? '출입 제한 구역에 들어와 있다' : '직원 구역에 손님이?');
  }
  if (st.oddItem && !forgiven('item')) consider(g ? 0.55 : staff ? 0.25 : 0.1, 'item', '이상한 물건을 들고 있다');
  if (st.running && st.indoor && !forgiven('behavior')) consider(g ? 0.32 : staff ? 0.18 : 0.08, 'behavior', '실내에서 뛰어다닌다');
  if (st.crouching && d < 7 && !forgiven('behavior')) consider(g ? 0.4 : 0.22, 'behavior', '살금살금 수상하게 움직인다');
  if (g && w.security.lockdown && st.lockdownViolation && !forgiven('lockdown')) consider(0.9, 'lockdown', '봉쇄 중에 돌아다닌다');

  let rate = best.rate;
  if (best.reason !== 'duck' && best.reason !== 'crime') rate *= df;
  else rate *= Math.max(1, df);
  if (k.wary > 0) rate *= 1.4;
  // Busy people pay less attention to mild oddities.
  if (sev(best.reason) <= 4 && (n.action === 'piano' || n.action === 'cook' || n.talkUntil > w.time)) rate *= 0.7;
  return { rate, reason: best.reason, text: best.text };
}
