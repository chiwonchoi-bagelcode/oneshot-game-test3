import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/Grid';
import { HIDE_SPOTS, NPCS, SPOTS, STATIONS } from '../src/sim/level/content';
import { DOORS } from '../src/sim/level/layout';
import { World } from '../src/sim/World';

describe('mansion layout', () => {
  const grid = new Grid();

  it('doors sit on real walls between two different areas', () => {
    for (const d of DOORS) {
      for (let t = d.from; t < d.to; t++) {
        const a = d.axis === 'h' ? { x: t + 0.5, z: d.at - 0.5 } : { x: d.at - 0.5, z: t + 0.5 };
        const b = d.axis === 'h' ? { x: t + 0.5, z: d.at + 0.5 } : { x: d.at + 0.5, z: t + 0.5 };
        const ra = grid.roomAt(a)?.id;
        const rb = grid.roomAt(b)?.id;
        expect(ra, `${d.id} side a`).toBeDefined();
        expect(rb, `${d.id} side b`).toBeDefined();
        expect(ra === rb, `${d.id} joins ${ra} and ${rb}`).toBe(false);
        expect(grid.isBlockedCell(Math.floor(a.x), Math.floor(a.z)), `${d.id} blocked at side a`).toBe(false);
        expect(grid.isBlockedCell(Math.floor(b.x), Math.floor(b.z)), `${d.id} blocked at side b`).toBe(false);
      }
    }
  });

  it('stations, chat slots, hide exits and npc spawns are on free cells', () => {
    const bad: string[] = [];
    const free = (x: number, z: number) => !grid.isBlockedCell(Math.floor(x), Math.floor(z));
    for (const s of STATIONS) if (!s.id.endsWith('_look') && !free(s.x, s.z)) bad.push('station ' + s.id);
    for (const s of SPOTS) {
      for (let i = 0; i < s.slots; i++) {
        const a = (i / s.slots) * Math.PI * 2 + 0.4;
        const r = s.r ?? 0.85;
        const x = s.x + Math.sin(a) * r;
        const z = s.z + Math.cos(a) * r;
        if (!free(x, z)) bad.push(`spot ${s.id}#${i}`);
      }
    }
    for (const h of HIDE_SPOTS) if (!free(h.exit.x, h.exit.z)) bad.push('hide exit ' + h.id);
    for (const n of NPCS) if (!free(n.start.x, n.start.z)) bad.push('npc ' + n.id);
    expect(bad).toEqual([]);
  });

  it('every station is reachable for a guard with all keys', () => {
    const agent = { opens: true, keys: new Set(['key_gallery', 'key_study', 'key_elec', 'key_shed'] as const), zones: null };
    const from = { x: 36.5, z: 40.5 };
    const bad: string[] = [];
    for (const s of STATIONS) {
      if (s.id.endsWith('_look')) continue;
      const p = grid.findPath(from, { x: s.x, z: s.z }, agent as never);
      if (!p) bad.push(s.id);
    }
    expect(bad).toEqual([]);
  });

  it('the player can walk from the street into the front yard but not through walls', () => {
    const agent = { opens: false, keys: null, crawl: false };
    expect(grid.findPath({ x: 52.5, z: 62 }, { x: 36, z: 48 }, agent)).not.toBeNull();
    // Gallery is locked: no path without keys.
    expect(grid.findPath({ x: 36, z: 30 }, { x: 36, z: 16 }, { opens: true, keys: null })).toBeNull();
  });

  it('line of sight is blocked by walls and closed doors', () => {
    expect(grid.los({ x: 36, z: 30 }, { x: 36, z: 40 })).toBe(true); // ballroom -> foyer archway
    expect(grid.los({ x: 36, z: 23.5 }, { x: 36, z: 18 })).toBe(false); // closed gallery door
    expect(grid.los({ x: 20, z: 16 }, { x: 20, z: 25 })).toBe(false); // security room -> staff room
  });

  it('world constructs and initial state is sane', () => {
    const w = new World(1);
    expect(w.npcs.length).toBeGreaterThan(25);
    expect(w.caseItem?.type).toBe('golden_duck');
    expect(w.player.outfit).toBe('guest');
  });
});
