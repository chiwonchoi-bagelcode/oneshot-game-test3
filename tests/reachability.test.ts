import { describe, expect, it } from 'vitest';
import { dist, type V2 } from '../src/core/math';
import { World } from '../src/sim/World';

/** Steer the player along a path (real movement, collisions and door auto-open). */
function walkTo(w: World, target: V2, opts: { crouch?: boolean; maxTime?: number; tol?: number } = {}): boolean {
  const p = w.player;
  p.crouching = !!opts.crouch;
  const agent = { opens: true, keys: p.keys(), crawl: !!opts.crouch };
  let path = w.grid.findPath(p.pos, target, agent);
  if (!path) return false;
  let i = 0;
  const dt = 1 / 30;
  const maxT = opts.maxTime ?? 120;
  let t = 0;
  let stuck = 0;
  let last = { ...p.pos };
  while (t < maxT) {
    if (dist(p.pos, target) < (opts.tol ?? 0.4)) {
      p.input = { x: 0, z: 0 };
      return true;
    }
    while (i < path.length - 1 && dist(p.pos, path[i]) < 0.35) i++;
    const wp = path[i];
    const dx = wp.x - p.pos.x;
    const dz = wp.z - p.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    p.input = { x: dx / l, z: dz / l };
    w.update(dt);
    t += dt;
    stuck += dt;
    if (stuck > 2) {
      if (dist(last, p.pos) < 0.3) {
        path = w.grid.findPath(p.pos, target, agent);
        if (!path) return false;
        i = 0;
      }
      last = { ...p.pos };
      stuck = 0;
    }
  }
  p.input = { x: 0, z: 0 };
  return false;
}

describe('everything is reachable', () => {
  it('every interactable offers its actions when the player stands next to it', () => {
    const w = new World(1);
    for (const n of w.npcs) n.active = false;
    const missing: string[] = [];
    for (const it of w.interactables) {
      if (it.id.startsWith('npc:') || it.id === 'self') continue;
      const pos = it.pos(w);
      // Try free cells around the target until one offers this interactable.
      let ok = false;
      for (let r = 0; r <= 2 && !ok; r++) {
        for (let dz = -r; dz <= r && !ok; dz++) {
          for (let dx = -r; dx <= r && !ok; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const cx = Math.floor(pos.x) + dx;
            const cz = Math.floor(pos.z) + dz;
            if (w.grid.isBlockedCell(cx, cz)) continue;
            w.player.pos = { x: cx + 0.5, z: cz + 0.5 };
            w.player.facing = Math.atan2(pos.x - w.player.pos.x, pos.z - w.player.pos.z);
            w.update(1 / 60);
            if (w.options.some((o) => o.target?.id === it.id)) ok = true;
          }
        }
      }
      if (!ok) missing.push(it.id);
    }
    expect(missing).toEqual([]);
  });

  it('the player can physically walk the main routes (doors, crawl gap, bath window)', () => {
    const w = new World(2);
    for (const n of w.npcs) n.active = false;
    // Street -> crawl gap (must crouch) -> front yard
    expect(walkTo(w, { x: 68.5, z: 60.5 })).toBe(true);
    // Standing up you can't squeeze through the hedge...
    w.player.input = { x: 0, z: -1 };
    for (let i = 0; i < 60; i++) w.update(1 / 30);
    expect(w.player.pos.z).toBeGreaterThan(59);
    // ...but crouching you can.
    expect(walkTo(w, { x: 68.5, z: 57.5 }, { crouch: true, maxTime: 10 })).toBe(true);
    w.player.crouching = false;
    // East garden to the broken bath window, climb in
    expect(walkTo(w, { x: 60.8, z: 39.5 })).toBe(true);
    w.update(1 / 60);
    const climb = w.options.findIndex((o) => o.action.id === 'climb');
    expect(climb).toBeGreaterThanOrEqual(0);
    w.optionIdx = climb;
    w.activateOption();
    for (let i = 0; i < 90; i++) w.update(1 / 60);
    expect(w.grid.roomAt(w.player.pos)?.id).toBe('bath');
    // Through the lounge and ballroom to the gallery hall, the kitchen and the staff areas
    for (const t of [
      { x: 54, z: 29 },
      { x: 36, z: 30 },
      { x: 38, z: 23.5 },
      { x: 25, z: 30 },
      { x: 18, z: 38 },
      { x: 15.5, z: 25 },
      { x: 20, z: 20.5 },
      { x: 5, z: 30 },
      { x: 40, z: 9 },
      { x: 61, z: 2 },
    ]) {
      expect(walkTo(w, t), `walk to ${t.x},${t.z} from ${w.player.pos.x.toFixed(1)},${w.player.pos.z.toFixed(1)}`).toBe(true);
    }
  });

  it('with the gallery key, the player can walk into the gallery and to the case', () => {
    const w = new World(3);
    for (const n of w.npcs) n.active = false;
    w.givePlayer('key_gallery');
    w.player.pos = { x: 36, z: 30 };
    // The door is locked: walking into it does nothing, so use the key.
    expect(walkTo(w, { x: 36, z: 23.4 })).toBe(true);
    w.player.facing = Math.PI;
    w.update(1 / 60);
    const i = w.options.findIndex((o) => o.action.id === 'unlock');
    expect(i).toBeGreaterThanOrEqual(0);
    w.optionIdx = i;
    w.activateOption();
    for (let k = 0; k < 60; k++) w.update(1 / 60);
    expect(w.door('d_gallery').open).toBe(true);
    expect(walkTo(w, { x: 36, z: 19.3 })).toBe(true);
  });
});
