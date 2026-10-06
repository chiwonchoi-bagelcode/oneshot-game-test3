import { World } from '../../../src/sim/World';
const w = new World(Number(process.argv[2] ?? 7));
w.player.gone = true;
let lastS = '';
for (let i = 0; i < 30 * 200; i++) {
  w.update(1 / 30);
  const dancers = w.npcs.filter((n) => n.action === 'dance' && w.grid.roomAt(n.pos)?.id === 'ballroom').map((n) => n.id);
  const pianist = w.npc('pianist')!.action;
  const host = w.npc('host')!; const hr = w.grid.roomAt(host.pos)?.id;
  const inBall = w.npcs.filter((n) => n.role === 'guest' && w.grid.roomAt(n.pos)?.id === 'ballroom').length;
  const s = `${dancers.join(',')} | piano:${pianist} | host:${hr} | guestsBall:${inBall}`;
  if (s !== lastS) { lastS = s; console.log(w.time.toFixed(1), s); }
}
