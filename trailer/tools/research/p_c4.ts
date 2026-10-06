import { harness, walkTo, wait, runUntil, act, teleport, dist } from './proto';
const h = harness(Number(process.argv[2] ?? 7), ['operator', 'chief']);
const { w } = h;
runUntil(w, () => w.time > 100);
w.givePlayer('sleeping_pills');
teleport(w, { x: 13.4, z: 24.3 }, -Math.PI / 2);
h.log.length = 0;
h.run((function* () {
  const ok = yield* act(w, 'spike_sleeping_pills', 'coffee');
  console.log('spiked', ok, w.time.toFixed(2));
  w.player.gone = true;
  yield* wait(w, 60);
})());
h.flush();
const op = w.npc('operator')!;
console.log(op.pos, op.pose, op.sleepKind);
