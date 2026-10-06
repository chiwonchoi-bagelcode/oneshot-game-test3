import { harness, walkTo, wait, runUntil } from './proto';
const h = harness(7, ['doorman', 'late_guest']);
const { w } = h;
runUntil(w, () => w.time > 30);
h.log.length = 0;
console.log('player at', w.player.pos);
h.run((function* () {
  yield* walkTo(w, { x: 37, z: 60.4 });
  yield* walkTo(w, { x: 37, z: 58.6 });
  yield* wait(w, 4);
})());
h.flush();
console.log('player', w.player.pos, 'chasers', w.player.chasers.size);
