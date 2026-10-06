// Headless shot probe: runs a shot exactly like the engine does (same setup, same sub-stepping,
// same skips) and prints what happens on which trailer frame. Usage: vite-node tools/probe.ts <shotId|all> [filter]
import { SHOTS } from '../src/shots';
import type { ShotCtx } from '../src/engine';

const FPS = 30, SUB = 2;
const which = process.argv[2] ?? 'all';
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
for (const shot of SHOTS) {
  if (which !== 'all' && !shot.id.startsWith(which)) continue;
  const { World } = await import('../../src/sim/World');
  const w = new World(shot.seed);
  const s: Record<string, unknown> = {};
  shot.setup?.(w, s);
  const ctx = { lt: 0, dt: 1 / FPS, w, view: null as never, s, simStart: w.time } as ShotCtx;
  let T = shot.start;
  const out: string[] = [];
  const log = (m: string) => { if (!filter || filter.test(m)) out.push(`${T.toFixed(2)} (sim ${w.time.toFixed(2)}) ${m}`); };
  w.events.on('bark', (e) => log(`BARK ${e.id}(${e.kind}): ${e.text}`));
  w.events.on('todo', (e) => log(`TODO ${e.id}`));
  w.events.on('escaped', (e) => log(`ESCAPED ${e.route}`));
  w.events.on('caught', (e) => log(`CAUGHT by ${e.by}`));
  w.events.on('sfx', (e) => { if (['power_down', 'gulp', 'thud', 'snore', 'zip', 'whistle', 'pocket', 'fireworks_launch', 'fireworks_boom', 'pickup', 'flush', 'alert', 'radio'].includes(e.name)) log(`SFX ${e.name}`); });
  w.events.on('fx', (e) => log(`FX ${e.kind} @${e.x.toFixed(1)},${e.z.toFixed(1)}`));
  let script = shot.script ? shot.script(w, ctx) : null;
  const frames = Math.round((shot.end - shot.start) * FPS);
  let lastBeh = '';
  for (let f = 0; f < frames; f++) {
    const lt = f / FPS;
    T = shot.start + lt;
    ctx.lt = lt;
    const ts = Math.max(0, shot.timeScale?.(lt, ctx) ?? 1);
    const simDt = (1 / FPS) * ts / SUB;
    if (lt > 1e-6 && simDt > 0) for (let i = 0; i < SUB; i++) {
      if (script) {
        const r = script.next();
        if (r.done) script = null;
        else if ((r.value as unknown) && typeof (r.value as unknown) === 'object' && 'skip' in (r.value as unknown as object)) {
          const end = w.time + (r.value as unknown as { skip: number }).skip;
          while (w.time < end) w.update(1 / 30);
          log('--- skip ---');
        }
      }
      w.update(simDt);
      shot.each?.(ctx);
    }
    const p = w.player;
    const beh = `player ${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)} act:${p.action?.id ?? '-'} hand:${p.hand?.type ?? '-'} hidden:${!!p.hidden} chasers:${p.chasers.size}`;
    if (f % 15 === 0 || beh.split(' act')[1] !== lastBeh.split(' act')[1]) { log(beh); lastBeh = beh; }
  }
  console.log(`=== ${shot.id} [${shot.start}–${shot.end}] ===\n` + out.join('\n'));
}
