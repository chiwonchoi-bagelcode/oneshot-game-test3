import { World } from '../../../src/sim/World';
import { dist } from '../../../src/core/math';
const seed = Number(process.argv[2] ?? 7);
const w = new World(seed);
w.player.gone = true; // spectator
const log: string[] = [];
w.events.on('bark', (e) => { if (['host','operator','gallery_guard','chief','gardener','butler','late_guest','doorman'].includes(e.id)) log.push(`${w.time.toFixed(1)} ${e.id}: ${e.text}`); });
const t0 = performance.now();
let lastOp = '';
for (let i = 0; i < 30 * 420; i++) {
  w.update(1 / 30);
  const op = w.npc('operator')!;
  const s = op.behavior.name + ':' + (dist(op.pos, w.station('st_coffee').pos) < 2 ? 'coffee' : '');
  if (s !== lastOp) { lastOp = s; log.push(`${w.time.toFixed(1)} [op] ${s}`); }
}
console.log(log.join('\n'));
console.log('sim ms', (performance.now() - t0).toFixed(0));
