import { harness, walkTo, wait, runUntil, act, teleport, dist } from './proto';
const h = harness(7, ['gallery_guard']);
const { w } = h;
runUntil(w, () => w.time > 95);
w.givePlayer('laxative');
teleport(w, { x: 27.5, z: 23.9 }, Math.PI);
h.log.length = 0;
h.run((function* () {
  const ok = yield* act(w, 'spike_laxative', 'cooler');
  console.log('spiked', ok, w.time.toFixed(2));
  w.player.gone = true;
  yield* wait(w, 40);
})());
h.flush();
