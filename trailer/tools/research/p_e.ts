import { harness, walkTo, wait, runUntil, act, teleport, dist, waitUntil } from './proto';
const h = harness(7, ['host', 'chief', 'gallery_guard', 'patrol_in', 'patrol_back']);
const { w } = h;
const op = w.npc('operator')!;
runUntil(w, () => w.time > 270 && dist(op.pos, w.station('st_coffee').pos) < 2);
console.log('coffee at', w.time.toFixed(1));
w.givePlayer('fake_duck');
teleport(w, { x: 37.6, z: 19.0 }, -Math.PI / 2);
const r1 = h.run((function* () { return yield* act(w, 'swap', 'case'); })());
console.log('swap', r1, w.player.hand?.type, 'alarm', w.security.alarmOn);
const box = w.items.find((i) => i.type === 'gift_box' && i.state === 'ground')!;
w.putHeldInto(box); const r2 = true;
console.log('box', r2, w.player.hand?.type, w.player.hasGoldenDuck());
// stroll to the conservatory and wait there
teleport(w, JSON.parse(process.argv[5] ?? '{"x":54,"z":19.5}'));
h.log.length = 0;
runUntil(w, () => w.time > 325);
const mode = process.argv[2] ?? 'stand';
h.run((function* () {
  yield* waitUntil(w, () => w.time > 357.3);
  if (mode === 'stand') { yield* wait(w, 30); return; }
  if (mode === 'lure') {
    const g = w.npc('patrol_back')!;
    w.player.crouching = true;
    yield* waitUntil(w, () => w.time > 365);
    console.log('guard', g.behavior.name, g.pos.x.toFixed(1), g.pos.z.toFixed(1), 'player', w.player.pos, 'seen', [...w.player.noticedBy.entries()]);
    w.whistle();
    for (let i = 0; i < 12; i++) { yield* wait(w, 0.5); console.log(w.time.toFixed(1), g.behavior.name, g.pos.x.toFixed(1), g.pos.z.toFixed(1)); }
    return;
  }
})());
h.flush();
console.log('player', w.player.pos, w.ended, w.stats.theftKnownAt, w.stats.theftKnownHow, w.npc('operator')!.pos);
