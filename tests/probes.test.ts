import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';

const wander = (w: World, room: string, seconds: number) => {
  const cells = w.grid.roomCells(room);
  let t = 0;
  let target = cells[0];
  while (t < seconds) {
    if (Math.hypot(w.player.pos.x - target.x, w.player.pos.z - target.z) < 0.6 || w.rng.next() < 0.004) target = cells[Math.floor(w.rng.next() * cells.length)];
    const dx = target.x - w.player.pos.x;
    const dz = target.z - w.player.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    w.player.input = { x: dx / l, z: dz / l };
    w.update(1 / 30);
    t += 1 / 30;
  }
  w.player.input = { x: 0, z: 0 };
};

describe('blending in', () => {
  it('a legitimate guest can mingle in the ballroom for minutes without trouble', () => {
    const w = new World(61);
    w.player.legit = true;
    w.player.pos = { x: 36, z: 30 };
    wander(w, 'ballroom', 180);
    expect(w.stats.spotted).toBe(0);
    expect(w.stats.confrontations).toBe(0);
  });

  it('a waiter can walk through the lounge and dining room without trouble', () => {
    const w = new World(67);
    w.player.outfit = 'waiter';
    w.player.pos = { x: 54, z: 30 };
    wander(w, 'lounge', 60);
    w.player.pos = { x: 30, z: 39 };
    wander(w, 'dining', 60);
    expect(w.stats.spotted).toBe(0);
  });

  it('a guest wandering the kitchen gets told off (and possibly reported), not ignored', () => {
    const w = new World(71);
    w.player.legit = true;
    w.player.pos = { x: 18, z: 38 };
    wander(w, 'kitchen', 40);
    const complained = w.stats.confrontations > 0 || w.npcs.some((n) => n.knowledge.toldAt > 0 || n.behavior.name === 'report');
    expect(complained).toBe(true);
  });
});
