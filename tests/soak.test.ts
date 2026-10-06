import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/World';

const step = (w: World, seconds: number, dt = 1 / 30) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) w.update(dt);
};

describe('a quiet evening (no player interference)', () => {
  it('runs 15 minutes without errors, nobody gets alarmed, people keep moving', () => {
    const w = new World(42);
    // Keep the player out of the way on the street.
    const t0 = performance.now();
    const positions = new Map<string, { x: number; z: number }[]>();
    const behaviors = new Map<string, Set<string>>();
    for (let k = 0; k < 15 * 6; k++) {
      step(w, 10);
      for (const n of w.npcs) {
        const arr = positions.get(n.id) ?? [];
        arr.push({ ...n.pos });
        positions.set(n.id, arr);
        const b = behaviors.get(n.id) ?? new Set();
        b.add(n.behavior.name);
        behaviors.set(n.id, b);
      }
    }
    const ms = performance.now() - t0;
    // Everyone should have moved around at some point (except stationary jobs).
    const stationary = new Set(['bartender']);
    const idle: string[] = [];
    for (const [id, arr] of positions) {
      if (stationary.has(id)) continue;
      let travelled = 0;
      for (let i = 1; i < arr.length; i++) travelled += Math.hypot(arr[i].x - arr[i - 1].x, arr[i].z - arr[i - 1].z);
      if (travelled < 5) idle.push(`${id}(${travelled.toFixed(1)})`);
    }
    const hostile = [...behaviors].filter(([, b]) => b.has('chase') || b.has('report') || b.has('confront'));
    console.log('sim 15min took', ms.toFixed(0), 'ms; idle:', idle.join(', '));
    console.log('behaviours:', [...behaviors].map(([id, b]) => `${id}:${[...b].join('/')}`).join(' | '));
    console.log('spotted', w.stats.spotted, 'theftKnown', w.stats.theftKnownAt, 'lockdown', w.security.lockdown);
    expect(w.security.lockdown).toBe(false);
    expect(w.stats.theftKnownAt).toBe(-1);
    expect(hostile.map(([id]) => id)).toEqual([]);
    expect(idle).toEqual([]);
  });
});
