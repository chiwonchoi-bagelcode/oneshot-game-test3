import { harness, walkTo, wait, runUntil, act, teleport, dist } from './proto';
const h = harness(7, ['chef', 'chief', 'butler']);
const { w } = h;
// find empty staff room time
const empty = () => !w.npcs.some((n) => n.active && w.grid.roomAt(n.pos)?.id === 'staffroom');
const t = runUntil(w, () => w.time > 40 && empty());
console.log('staffroom empty at', t);
teleport(w, { x: 16, z: 24.5 });
h.log.length = 0;
h.run((function* () {
  yield* walkTo(w, { x: 17.6, z: 23.5 });
  w.player.facing = Math.PI / 2;
  const ok = yield* act(w, 'take_waiter', 'locker_waiter');
  console.log('changed', ok, w.player.outfit, w.time.toFixed(2));
})());
h.flush();
// now waiter with tray in ballroom
const tray = w.items.find((i) => i.type === 'tray')!;
teleport(w, { x: 23, z: 36.5 });
h.run((function* () {
  yield* walkTo(w, { x: 22.9, z: 36.0 });
  w.player.facing = Math.PI / 2;
  const ok = yield* act(w, 'pick', 'tray');
  console.log('tray', ok, w.player.hand?.type);
  yield* walkTo(w, { x: 25, z: 40.5 });
  yield* walkTo(w, { x: 34, z: 33.5 });
  yield* walkTo(w, { x: 41, z: 30.5 });
  console.log('at', w.time.toFixed(1));
})());
h.flush();
console.log('chief at', w.npc('chief')!.pos, 'noticed', [...w.player.noticedBy.entries()]);
