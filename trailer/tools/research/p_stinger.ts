import { harness, walkTo, wait, runUntil, act, teleport, dist, waitUntil } from './proto';
const h = harness(7, ['late_guest', 'doorman']);
const { w } = h;
runUntil(w, () => w.time > 40);
teleport(w, { x: 55.5, z: 61.3 }, -Math.PI / 2);
h.log.length = 0;
h.run((function* () {
  const lg = w.npc('late_guest')!;
  console.log('lg facing', lg.facing.toFixed(2), lg.pos);
  const ok = yield* act(w, 'pick', 'npc:late_guest');
  console.log('picked', ok, w.time.toFixed(2), w.player.hasItem('invitation'));
  yield* walkTo(w, { x: 66, z: 62 });
  w.player.gone = true;
  yield* wait(w, 70);
})());
h.flush();
