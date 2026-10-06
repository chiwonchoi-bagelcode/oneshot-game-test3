// Contact sheets: node tools/sheet.mjs <stillsdir> <outdir> [perSheet=16] [cols=4] [from] [to]
import { chromium } from '../../node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const [inDir, outDir, per = '16', cols = '4', from = '0', to = '999'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
const files = fs.readdirSync(inDir).filter((f) => f.endsWith('.png')).sort()
  .map((f) => ({ f, t: Number(f.slice(1, 6)) / 30 })).filter((x) => x.t >= Number(from) && x.t <= Number(to));
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const C = Number(cols), W = 480 * C;
const page = await b.newPage({ viewport: { width: W, height: 300 } });
for (let s = 0; s * Number(per) < files.length; s++) {
  const chunk = files.slice(s * Number(per), (s + 1) * Number(per));
  const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${C},480px);gap:2px">${chunk.map((x) => `<div style="position:relative"><img src="file://${path.resolve(inDir, x.f)}" style="width:480px;height:270px;display:block"><b style="position:absolute;right:4px;bottom:4px;background:#000a;color:#ff0;font:bold 18px sans-serif;padding:1px 4px">${x.t.toFixed(2)}</b></div>`).join('')}</body>`;
  fs.writeFileSync('/tmp/_sheet.html', html);
  await page.goto('file:///tmp/_sheet.html');
  await page.waitForLoadState('load');
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: W, height: h });
  await page.screenshot({ path: path.join(outDir, `sheet_${String(s).padStart(2, '0')}.png`) });
}
await b.close();
console.log('sheets', Math.ceil(files.length / Number(per)));
