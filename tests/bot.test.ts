// An "expert player" bot: walks with real input, only acts when nobody (and no camera) sees it.
import { describe, expect, it } from 'vitest';
import { dist, type V2 } from '../src/core/math';
import { seeQuality } from '../src/sim/npc/perception';
import { World } from '../src/sim/World';

const DT = 1 / 30;

class Bot {
  log: string[] = [];
  constructor(public w: World) {}
  get p() {
    return this.w.player;
  }
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      this.w.update(DT);
      if (this.w.ended === 'caught') throw new Error(`game ended: ${this.w.ended} (${this.w.stats.caughtBy} ${this.w.stats.caughtWhy}) @${this.w.time.toFixed(0)}s; log: ${this.log.slice(-6).join(' | ')}`);
    }
  }
  /** Nobody looks at the player and no powered camera sees them. */
  unseen(margin = 0): boolean {
    const w = this.w;
    for (const n of w.npcs) {
      if (!n.awake || !n.active) continue;
      if (seeQuality(w, n, this.p.pos) > 0) return false;
      if (margin > 0 && dist(n.pos, this.p.pos) < margin && w.grid.los(n.pos, this.p.pos)) return false;
    }
    // Cameras only matter while someone watches the monitors (recordings are a later problem).
    if (w.security.operatorWatching(w) && w.security.cams.some((c) => c.seeing)) return false;
    return !w.player.chasers.size;
  }
  waitUntil(cond: () => boolean, maxT: number, label: string): boolean {
    let t = 0;
    if (this.w.ended === 'escaped') return true;
    this.p.input = { x: 0, z: 0 };
    while (t < maxT) {
      if (cond()) return true;
      this.step();
      t += DT;
    }
    this.log.push(`timeout waiting: ${label}`);
    return false;
  }
  walkTo(target: V2, crouch = false, maxT = 90): boolean {
    const w = this.w;
    const p = this.p;
    p.crouching = crouch;
    const agent = () => ({ opens: true, keys: p.keys(), crawl: crouch });
    let path = w.grid.findPath(p.pos, target, agent());
    if (!path) {
      this.log.push(`no path to ${target.x},${target.z}`);
      return false;
    }
    let i = 0;
    let t = 0;
    let stuckT = 0;
    let last = { ...p.pos };
    while (t < maxT) {
      if (dist(p.pos, target) < 0.35) {
        p.input = { x: 0, z: 0 };
        return true;
      }
      while (i < path.length - 1 && dist(p.pos, path[i]) < 0.35) i++;
      const wp = path[i];
      const l = Math.hypot(wp.x - p.pos.x, wp.z - p.pos.z) || 1;
      p.input = { x: (wp.x - p.pos.x) / l, z: (wp.z - p.pos.z) / l };
      this.step();
      t += DT;
      stuckT += DT;
      if (stuckT > 1.5) {
        if (dist(last, p.pos) < 0.25) {
          const np = w.grid.findPath(p.pos, target, agent());
          if (np) {
            path = np;
            i = 0;
          }
        }
        last = { ...p.pos };
        stuckT = 0;
      }
    }
    p.input = { x: 0, z: 0 };
    this.log.push(`walk timeout to ${target.x},${target.z}`);
    return false;
  }
  /** Get through a door: wait until nobody is around, then pick it (or just walk through if open). */
  door(id: string): boolean {
    const d = this.w.door(id);
    if (!this.waitUntil(() => this.unseen(1.5) && !this.w.someoneInDoorway(d, 'player'), 240, `door ${id} clear`)) return false;
    if (d.open || !d.locked) return true;
    return this.act('pick', 'door:' + id);
  }
  act(actionId: string, targetId?: string, needUnseen = true, maxWait = 240): boolean {
    const w = this.w;
    const find = () =>
      w.options.findIndex((o) => o.action.id === actionId && !o.action.disabled && (!targetId || o.target?.id === targetId || o.item?.type === targetId));
    for (let attempt = 0; attempt < 6; attempt++) {
      if (needUnseen && !this.waitUntil(() => this.unseen(1.5), maxWait, `unseen for ${actionId}`)) return false;
      this.step();
      const i = find();
      if (i < 0) {
        this.log.push(`no option ${actionId}/${targetId}: ${w.options.map((o) => o.action.id + (o.action.disabled ? '(x)' : '')).join(',')}`);
        return false;
      }
      w.optionIdx = i;
      w.activateOption();
      const a = w.player.action;
      let ok = true;
      while (w.player.action) {
        // Abort if someone turns towards us mid-crime.
        if (needUnseen && a?.illegal && !this.unseen()) {
          w.player.cancelAction(w);
          ok = false;
          break;
        }
        this.step();
      }
      if (ok) {
        this.log.push(`did ${actionId}@${w.time.toFixed(0)}`);
        return true;
      }
      this.log.push(`aborted ${actionId}`);
      this.step(30);
    }
    return false;
  }
}

describe('an expert player can beat the mansion', () => {
  it('quiet route: crawl gap, bath window, shed paint, fake duck swap via the study secret door, gift box, boat', () => {
    const w = new World(1234);
    const b = new Bot(w);
    const ok = (v: boolean, what: string) => expect(v, `${what} — ${b.log.slice(-5).join(' | ')}`).toBe(true);
    // 1. In through the crawl gap.
    ok(b.walkTo({ x: 68.5, z: 60.6 }), 'reach gap');
    ok(b.walkTo({ x: 68.5, z: 57.5 }, true), 'crawl through');
    w.player.crouching = false;
    // 2. Bath window.
    ok(b.walkTo({ x: 62.5, z: 44.5 }), 'east path');
    ok(b.walkTo({ x: 60.8, z: 39.5 }), 'under bath window');
    ok(b.act('climb'), 'climb in');
    // 3. Rubber duck from the tub (pockets: invisible).
    ok(b.walkTo({ x: 57.5, z: 40.6 }), 'tub');
    ok(b.act('pick', 'rubber_duck', false), 'take rubber duck');
    // 4. A gift box from the foyer: a guest carrying a present looks perfectly normal.
    ok(b.walkTo({ x: 54, z: 33 }), 'lounge');
    ok(b.walkTo({ x: 44, z: 40 }), 'east hall');
    ok(b.walkTo({ x: 33.7, z: 37 }), 'gift table');
    ok(b.act('pick', 'gift_box', false), 'take gift box');
    // 5. Gold paint from the locked shed.
    ok(b.walkTo({ x: 37, z: 31 }), 'ballroom');
    ok(b.walkTo({ x: 44, z: 26.5 }), 'ballroom east arch');
    ok(b.walkTo({ x: 47, z: 23.5 }), 'gallery hall east');
    ok(b.walkTo({ x: 54, z: 15 }), 'conservatory');
    ok(b.walkTo({ x: 4.5, z: 9 }), 'shed door');
    ok(b.door('d_shed'), 'get into the shed');
    ok(b.walkTo({ x: 3.4, z: 5.2 }), 'in shed');
    ok(b.act('pick', 'gold_paint', false), 'take paint');
    // 6. Into the study from the east end of the gallery hall.
    ok(b.walkTo({ x: 54, z: 15 }), 'conservatory again');
    ok(b.walkTo({ x: 47, z: 23.5 }), 'gallery hall east');
    ok(b.walkTo({ x: 44.5, z: 22.7 }), 'study door');
    ok(b.door('d_study'), 'get into the study');
    ok(b.walkTo({ x: 44.5, z: 21.0 }), 'in study');
    // Close the door behind us: an open door invites a look.
    w.player.facing = 0;
    ok(b.act('close', 'door:d_study', false), 'close study door');
    ok(b.walkTo({ x: 44.5, z: 20.4 }), 'study centre');
    w.dropHeld();
    ok(b.act('paint', 'self'), 'paint the duck');
    expect(w.player.hand?.type).toBe('fake_duck');
    ok(b.walkTo({ x: 41.7, z: 17.5 }), 'secret door');
    ok(b.door('d_study_gallery'), 'secret door');
    // 7. Swap when the camera looks away.
    ok(b.walkTo({ x: 37.6, z: 19.0 }), 'next to case');
    ok(b.act('swap', 'case'), 'swap');
    expect(w.player.hand?.type).toBe('golden_duck');
    expect(w.security.alarmOn).toBe(false);
    // 8. Back to the study, duck into the gift box, and stroll out to the dock.
    ok(b.walkTo({ x: 41.7, z: 17.5 }), 'back to study');
    ok(b.walkTo({ x: 44.5, z: 20.3 }), 'by the gift box');
    ok(b.act('putin', 'gift_box'), 'duck into the box');
    expect(w.player.hand?.type).toBe('gift_box');
    expect(w.player.hasGoldenDuck()).toBe(true);
    ok(b.door('d_study'), 'study door clear');
    ok(b.walkTo({ x: 44.5, z: 22.7 }), 'study exit');
    ok(b.walkTo({ x: 47, z: 23.5 }), 'gallery hall east');
    ok(b.walkTo({ x: 54, z: 15 }), 'conservatory');
    ok(b.walkTo({ x: 61, z: 4.6 }), 'dock');
    ok(b.walkTo({ x: 61, z: 1.8 }), 'boat');
    ok(b.act('row', 'boat', false), 'row away');
    expect(w.ended).toBe('escaped');
    console.log('bot escaped at', w.time.toFixed(0), 's; spotted', w.stats.spotted, 'theft known', w.stats.theftKnownAt, 'tapes', w.security.tapes.length);
  });
});
