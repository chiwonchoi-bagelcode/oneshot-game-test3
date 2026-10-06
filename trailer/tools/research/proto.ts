// Prototype harness: run a scenario headless and log what happens (barks, behaviours, todos).
import { World } from '../../../src/sim/World';
import { dist } from '../../../src/core/math';
import { act, fastForward, runUntil, teleport, wait, walkTo, waitUntil, face, type Script } from '../../src/bot';

export function harness(seed: number, watch: string[] = []) {
  const w = new World(seed);
  const log: string[] = [];
  const T = () => w.time.toFixed(2);
  w.events.on('bark', (e) => log.push(`${T()} BARK ${e.id}(${e.kind}): ${e.text}`));
  w.events.on('notify', (e) => log.push(`${T()} NOTE ${e.text}`));
  w.events.on('todo', (e) => log.push(`${T()} TODO ${e.id}`));
  w.events.on('sfx', (e) => { if (!['step','step_grass','step_run','door_open','door_close'].includes(e.name)) log.push(`${T()} SFX ${e.name}`); });
  const last = new Map<string, string>();
  const tick = () => {
    for (const id of watch) {
      const n = w.npc(id); if (!n) continue;
      const s = `${n.behavior.name} ${n.awake ? '' : 'ASLEEP'} @${n.pos.x.toFixed(1)},${n.pos.z.toFixed(1)}`;
      const k = n.behavior.name + n.awake;
      if (last.get(id) !== k) { last.set(id, k); log.push(`${T()} BEH ${id}: ${s}`); }
    }
  };
  const run = (s: Script, maxSec = 600) => {
    const end = w.time + maxSec; let r = s.next();
    while (!r.done && w.time < end) { w.update(1 / 60); tick(); r = s.next(); }
    return r.value;
  };
  const sim = (sec: number) => { const end = w.time + sec; while (w.time < end) { w.update(1 / 60); tick(); } };
  return { w, log, run, sim, flush: () => { console.log(log.join('\n')); log.length = 0; } };
}
export { act, fastForward, runUntil, teleport, wait, walkTo, waitUntil, face, dist };
