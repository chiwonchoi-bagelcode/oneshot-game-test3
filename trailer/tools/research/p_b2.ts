import { harness, walkTo, wait, runUntil, act } from './proto';
const h = harness(7, ['doorman', 'patrol_front']);
const { w } = h;
runUntil(w, () => w.time > 30);
h.log.length = 0;
h.run((function* () {
  yield* walkTo(w, { x: 68.5, z: 60.6 });
  console.log('t at gap', w.time.toFixed(2));
  yield* walkTo(w, { x: 68.5, z: 57.6 }, { crouch: true });
  console.log('t through', w.time.toFixed(2), w.player.pos);
  w.player.crouching = false;
  yield* walkTo(w, { x: 67.5, z: 57.6 });
  const ok = yield* act(w, 'hide', 'hide:h_bush_gap');
  console.log('hid', ok, w.time.toFixed(2));
  yield* wait(w, 2);
})());
h.flush();
// patrol_front schedule near gap
