import { harness, walkTo, wait, runUntil, act, teleport, dist } from './proto';
const which = process.argv[2] ?? 'breaker_main';
const h = harness(7, ['chief', 'operator', 'electrician', 'patrol_in', 'gallery_guard', 'host']);
const { w } = h;
runUntil(w, () => w.time > 60);
teleport(w, { x: 14.5, z: 15.3 }, Math.PI);
h.log.length = 0;
h.run((function* () {
  const ok = yield* act(w, which, 'fusebox');
  console.log('breaker', ok, w.time.toFixed(2), w.power.on('B'));
  yield* wait(w, 8);
})());
h.flush();
const fl = w.npcs.filter((n) => n.flashlightOn).map((n) => n.id);
console.log('flashlights', fl);
