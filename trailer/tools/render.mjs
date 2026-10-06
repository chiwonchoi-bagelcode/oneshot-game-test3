// Usage: node tools/render.mjs [--from s] [--to s] [--step n] [--stills dir] [--video out.mp4] [--audio out.wav]
import { chromium } from '../../node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]] : a), []));
const url = args.url ?? 'http://localhost:5310/';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[')) console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.trailer);
await page.evaluate(() => window.trailer.ready);
const fps = await page.evaluate(() => window.trailer.fps);
const total = await page.evaluate(() => window.trailer.frames);
const from = Math.round(Number(args.from ?? 0) * fps);
const to = Math.min(total, Math.round(Number(args.to ?? total / fps) * fps));
const step = Number(args.step ?? 1);
let ff = null;
if (args.video) {
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', args.preset ?? 'medium', '-crf', String(args.crf ?? 16), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', args.video], { stdio: ['pipe', 'inherit', 'inherit'] });
}
if (args.stills) fs.mkdirSync(args.stills, { recursive: true });
const t0 = Date.now();
// Frames must be simulated in order, from 0 — even when we only capture a sub-range.
for (let f = 0; f < to; f++) {
  await page.evaluate((f) => window.trailer.renderFrame(f), f);
  if (f < from || (f - from) % step) continue;
  const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  if (ff) { if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)); }
  if (args.stills) fs.writeFileSync(path.join(args.stills, `f${String(f).padStart(5, '0')}.png`), buf);
  if (f % 30 === 0) process.stdout.write(`frame ${f}/${to} (${((Date.now() - t0) / 1000).toFixed(0)}s, shot ${await page.evaluate((t) => window.trailer.shotAt(t), f / fps)})\n`);
}
if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
if (args.audio) {
  const size = await page.evaluate(() => window.trailer.renderAudio());
  const chunks = [];
  for (let o = 0; o < size; o += 4 * 1024 * 1024) chunks.push(Buffer.from(await page.evaluate(([o, n]) => window.trailer.audioChunk(o, n), [o, 4 * 1024 * 1024]), 'base64'));
  fs.writeFileSync(args.audio, Buffer.concat(chunks));
  console.log('audio written', args.audio, size);
}
console.log('done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await b.close();
