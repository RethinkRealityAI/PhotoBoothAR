/**
 * Renders the brand v2 site icons + share card into public/:
 *   favicon.svg (hand-drawn B mark, no font dependency), favicon.ico (32 px PNG-in-ICO),
 *   apple-touch-icon.png (180), icon-192.png, icon-512.png, og.jpg (1280×720).
 *
 * The art is the /beamy dusk field (steel blue → indigo → mauve-rose, the
 * --pf-* tokens in src/styles/platform.css), the Bricolage wordmark and Beamy
 * (src/assets/sales/beamy.webp). Run after a brand change:
 *   node scripts/render-brand-icons.mjs
 * Needs a Chromium: PW_CHROMIUM=/path (defaults to /opt/pw-browsers/chromium).
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (f) => path.join(ROOT, 'public', f);
const b64 = (f) => readFileSync(path.join(ROOT, f)).toString('base64');

// 32-unit grid. Field = the platform dusk; B = a chunky geometric mark in
// the Bricolage spirit, drawn as paths so it renders the same in every tab.
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs>
<linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5A7FCB"/><stop offset=".55" stop-color="#2E2C7A"/><stop offset="1" stop-color="#9A68A8"/></linearGradient>
<radialGradient id="g" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#D4D6FF" stop-opacity=".55"/><stop offset="1" stop-color="#D4D6FF" stop-opacity="0"/></radialGradient>
</defs>
<rect width="32" height="32" rx="8" fill="url(#f)"/>
<rect width="32" height="32" rx="8" fill="url(#g)"/>
<mask id="b"><rect width="32" height="32" fill="#000"/>
<path fill="#FFF" d="M9.5 6.5H16.5A4.5 4.5 0 0 1 16.5 15.5H9.5Z M9.5 14.8H17.5A5.35 5.35 0 0 1 17.5 25.5H9.5Z"/>
<path fill="#000" d="M13 9.6H16.2A1.8 1.8 0 0 1 16.2 13.2H13Z M13 16.3H17A3.05 3.05 0 0 1 17 22.4H13Z"/>
</mask>
<rect width="32" height="32" fill="#FFFFFF" mask="url(#b)"/>
</svg>
`;

const FONT = `@font-face{font-family:'Bricolage';font-weight:200 800;src:url(data:font/woff2;base64,${b64('public/fonts/bricolage-grotesque-var-latin.woff2')}) format('woff2');}
@font-face{font-family:'Geist';font-weight:100 900;src:url(data:font/woff2;base64,${b64('public/fonts/geist-var-latin.woff2')}) format('woff2');}`;

const FIELD = `background-color:#262566;background-image:
radial-gradient(42% 46% at 58% 46%, rgba(22,20,76,.82), transparent 72%),
radial-gradient(58% 70% at 4% 26%, rgba(78,118,194,.88), transparent 70%),
radial-gradient(36% 40% at 34% 18%, rgba(96,132,206,.5), transparent 70%),
radial-gradient(52% 62% at 100% 100%, rgba(140,92,160,.82), transparent 72%),
radial-gradient(40% 50% at 96% 40%, rgba(204,120,150,.4), transparent 72%),
radial-gradient(44% 40% at 86% 104%, rgba(255,170,132,.26), transparent 74%);`;

const OG_HTML = `<!doctype html><html><head><style>${FONT}
*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;overflow:hidden;${FIELD};font-family:Geist,sans-serif;color:#fff;position:relative}
.card{position:absolute;left:84px;top:118px;width:640px;padding:52px 56px 54px;border-radius:36px;
 background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.07));
 border:1px solid rgba(255,255,255,.28);box-shadow:0 30px 80px -30px rgba(10,8,50,.7),inset 0 1px 0 rgba(255,255,255,.35)}
.mark{font-family:Bricolage;font-weight:760;font-size:34px;letter-spacing:-.035em;opacity:.95}
h1{margin-top:30px;font-family:Bricolage;font-size:76px;line-height:.98;letter-spacing:-.04em;font-weight:330}
h1 b{font-weight:780;display:block}
p{margin-top:26px;font-size:25px;line-height:1.38;color:rgba(255,255,255,.86);max-width:30ch}
.pill{display:inline-block;margin-top:34px;padding:15px 30px;border-radius:999px;background:#D4D6FF;color:#1F1D5C;font-weight:650;font-size:21px;box-shadow:0 0 40px -6px rgba(212,214,255,.8)}
.glow{position:absolute;right:120px;top:150px;width:460px;height:460px;border-radius:50%;background:radial-gradient(closest-side,rgba(212,214,255,.42),transparent)}
.beamy{position:absolute;right:96px;top:196px;width:470px}
.url{position:absolute;right:84px;bottom:52px;font-size:20px;color:rgba(255,255,255,.75);letter-spacing:.01em}
</style></head><body>
<div class="glow"></div>
<img class="beamy" src="data:image/webp;base64,${b64('src/assets/sales/beamy.webp')}">
<div class="card"><div class="mark">Beamwall</div>
<h1>Your immersive <b>photo booth</b></h1>
<p>Guests scan, snap in AR, and every shot beams to your live wall.</p>
<span class="pill">Free to start</span></div>
<div class="url">beamwall.app</div>
</body></html>`;

const iconHtml = (px) => `<!doctype html><html><head><style>*{margin:0}body{width:${px}px;height:${px}px;background:transparent}svg{width:${px}px;height:${px}px;display:block}</style></head><body>${FAVICON_SVG}</body></html>`;

/** ICO with one embedded PNG (supported by every browser since Vista-era IE). */
function pngToIco(png, size) {
  const h = Buffer.alloc(22);
  h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  h.writeUInt8(size, 6); h.writeUInt8(size, 7); h.writeUInt8(0, 8); h.writeUInt8(0, 9);
  h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12); h.writeUInt32LE(png.length, 14); h.writeUInt32LE(22, 18);
  return Buffer.concat([h, png]);
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
try {
  writeFileSync(pub('favicon.svg'), FAVICON_SVG);
  for (const [file, px, opaque] of [['apple-touch-icon.png', 180, true], ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['__ico.png', 32, false]]) {
    const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
    // iOS masks the touch icon itself and paints transparency black: give it the full square.
    const html = opaque ? iconHtml(px).replace('rx="8"', 'rx="0"').replace('rx="8"', 'rx="0"') : iconHtml(px);
    await page.setContent(html);
    const png = await page.screenshot({ omitBackground: !opaque, type: 'png' });
    if (file === '__ico.png') writeFileSync(pub('favicon.ico'), pngToIco(png, 32));
    else writeFileSync(pub(file), png);
    await page.close();
  }
  const og = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await og.setContent(OG_HTML);
  await og.evaluate(() => document.fonts.ready);
  writeFileSync(pub('og.jpg'), await og.screenshot({ type: 'jpeg', quality: 86 }));
} finally {
  await browser.close();
}
console.log('wrote favicon.svg favicon.ico apple-touch-icon.png icon-192.png icon-512.png og.jpg');
