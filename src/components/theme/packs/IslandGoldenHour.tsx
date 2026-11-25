/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Island Golden Hour" — the theme pack backdrop (lib/themePacks): a
 * layered paper-cut island at sunset. Back to front: the dusk sky, a few
 * early stars, the sun with its cut-paper halo rings, drifting clouds and
 * gulls, a far volcanic island, the sea with the sun's path of glints, three
 * scalloped wave bands, two headlands with palms, and tropical flowers
 * (hibiscus, frangipani) and torn banana leaves in the corners.
 *
 * Molten-metal palette over a warm sunset: gold, copper and bronze lit by
 * the sun, verdigris in the sea and the leaves, ivory frangipani. Red is
 * reserved (the couple's Edo coral), so the hibiscus is cut from copper.
 *
 * Every shape is a crisp vector built by lib/paperCut (straight scissor
 * cuts), each layer casts a soft shadow onto the one behind it, and a fine
 * grain sits over everything — that, not detail, is what reads as paper.
 *
 * Sized with container units (the root is a size container), so the SAME
 * component paints a full page, the live wall and the host's thumbnail.
 * Motion is CSS only (styles/themePacks.css), transform/opacity only, and
 * holds still under prefers-reduced-motion and in the compact thumbnail.
 */
import { useId } from 'react';
import { leaf, palmFrond, palmTrunk, tornLeaf, waveBand, type Pt } from '../../../lib/paperCut';

/* ── Geometry, built once at module load (pure, deterministic) ─────────── */

const PALM_CROWN: Pt = [250, 190];
const PALM_TRUNK = palmTrunk([150, 720], PALM_CROWN, -34, 34, 15, 16);
/** [angle°, length, droop, leaflet width] — the back fronds first. */
const FRONDS_BACK: [number, number, number, number][] = [
  [-150, 185, 30, 30], [-100, 165, 6, 26], [-58, 180, 18, 28], [10, 190, 84, 28], [160, 150, 96, 24],
];
const FRONDS_FRONT: [number, number, number, number][] = [
  [-176, 200, 78, 32], [-128, 198, 28, 32], [-80, 172, 8, 28], [-32, 210, 46, 33], [-4, 196, 96, 30], [34, 156, 104, 26], [128, 140, 98, 24],
];
const frondPaths = (list: typeof FRONDS_BACK) => list.map(([a, l, d, w]) => palmFrond(PALM_CROWN, a, l, d, w, 12));
const BACK_FRONDS = frondPaths(FRONDS_BACK);
const FRONT_FRONDS = frondPaths(FRONDS_FRONT);

const WAVE_BACK = waveBand(1600, 260, 70, 24, 230, 0.15);
const WAVE_MID = waveBand(1600, 260, 76, 22, 186, 0.55);
const WAVE_FRONT = waveBand(1600, 260, 64, 18, 150, 0.85);

const FAR_ISLAND =
  'M0,220L0,176C70,168 130,150 190,150C250,150 290,132 340,118C390,104 420,70 470,48C505,33 540,38 575,62C610,86 640,104 690,112C740,120 780,116 830,128C880,140 920,150 990,146C1050,142 1100,130 1160,136C1230,143 1290,160 1360,164C1440,168 1520,166 1600,170L1600,220Z';
const HEADLAND =
  'M0,400L0,138C46,120 104,104 168,108C236,112 290,138 336,178C384,220 420,268 470,310C520,350 566,380 600,400Z';

const HIBISCUS_PETAL =
  'M0,0C-20,-8 -46,-32 -38,-58C-32,-76 -13,-81 -4,-70C-1,-77 3,-78 6,-72C15,-82 36,-75 40,-56C46,-32 20,-8 0,0Z';
const FRANGI_PETAL = 'M0,0C11,-6 32,-26 28,-51C24,-69 5,-72 -6,-60C-15,-47 -9,-19 0,0Z';
const CLOUD =
  'M12,84C0,84 -2,62 18,60C14,40 40,28 60,42C68,16 108,10 124,36C136,20 168,20 178,44C196,32 230,38 230,60C252,54 276,64 272,84Z';

const STARS: [number, number, number][] = [
  [8, 6, 1], [22, 13, 0.7], [37, 5, 0.85], [63, 9, 0.7], [78, 4, 1], [91, 14, 0.8], [52, 16, 0.6], [14, 22, 0.6],
];
const GLINTS = [0.62, 0.46, 0.78, 0.38, 0.6, 0.3, 0.5, 0.24, 0.36];

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Hibiscus({ x, y, s, rot, ids }: { x: number; y: number; s: number; rot: number; ids: Ids }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      {[0, 72, 144, 216, 288].map((a, i) => (
        <path
          key={a}
          d={HIBISCUS_PETAL}
          transform={`rotate(${a}) scale(${i % 2 === 0 ? 1 : 0.94})`}
          fill={`url(#${ids.hibiscus})`}
          stroke="#FFD7A0"
          strokeOpacity={0.4}
          strokeWidth={1}
        />
      ))}
      <circle r={9} fill="#5A2210" />
      <path d="M0,0C6,-20 14,-40 30,-60" stroke="#F3C24E" strokeWidth={3} fill="none" strokeLinecap="round" />
      {[[30, -60], [36, -55], [25, -66], [34, -66], [38, -61]].map(([cx, cy]) => (
        <circle key={`${cx}${cy}`} cx={cx} cy={cy} r={3.4} fill="#FFE08A" />
      ))}
    </g>
  );
}

function Frangipani({ x, y, s, rot, ids }: { x: number; y: number; s: number; rot: number; ids: Ids }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <path key={a} d={FRANGI_PETAL} transform={`rotate(${a})`} fill={`url(#${ids.frangi})`} stroke="#8A5320" strokeOpacity={0.22} strokeWidth={1} />
      ))}
      <circle r={5} fill="#E9A83A" />
    </g>
  );
}

function Leaf({ o, a, l, w, ids }: { o: Pt; a: number; l: number; w: number; ids: Ids }) {
  const tip: Pt = [o[0] + Math.cos((a * Math.PI) / 180) * l * 0.92, o[1] + Math.sin((a * Math.PI) / 180) * l * 0.92];
  return (
    <g>
      <path d={leaf(o, a, l, w)} fill={`url(#${ids.leaf})`} />
      <path d={`M${o[0]},${o[1]}L${tip[0].toFixed(1)},${tip[1].toFixed(1)}`} stroke="#9FD3BF" strokeOpacity={0.5} strokeWidth={1.4} />
    </g>
  );
}

interface Ids {
  sky: string; sun: string; far: string; land: string; trunk: string; frond: string; frondBack: string;
  w1: string; w2: string; w3: string; hibiscus: string; frangi: string; leaf: string; banana: string; cloud: string;
}

/* ── The scene ──────────────────────────────────────────────────────────── */

export default function IslandGoldenHour({ compact = false }: { compact?: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids: Ids = {
    sky: `${uid}sky`, sun: `${uid}sun`, far: `${uid}far`, land: `${uid}land`, trunk: `${uid}trunk`,
    frond: `${uid}frond`, frondBack: `${uid}frondb`, w1: `${uid}w1`, w2: `${uid}w2`, w3: `${uid}w3`,
    hibiscus: `${uid}hib`, frangi: `${uid}fra`, leaf: `${uid}leaf`, banana: `${uid}ban`, cloud: `${uid}cloud`,
  };

  const palm = (side: 'l' | 'r') => (
    <svg className={`ig-layer ig-palm ig-palm-${side}`} viewBox="0 0 420 720" preserveAspectRatio="xMidYMax meet">
      <g className="ig-sway" style={{ transformOrigin: `${PALM_CROWN[0]}px ${PALM_CROWN[1]}px` }}>
        {BACK_FRONDS.map((d, i) => <path key={i} d={d} fill={`url(#${ids.frondBack})`} />)}
      </g>
      <path d={PALM_TRUNK.outline} fill={`url(#${ids.trunk})`} />
      <path d={PALM_TRUNK.rings} stroke="#1C0F07" strokeOpacity={0.7} strokeWidth={2.2} fill="none" />
      <g className="ig-sway ig-sway-b" style={{ transformOrigin: `${PALM_CROWN[0]}px ${PALM_CROWN[1]}px` }}>
        {FRONT_FRONDS.map((d, i) => (
          <path key={i} d={d} fill={`url(#${ids.frond})`} stroke="#E9A24E" strokeOpacity={0.45} strokeWidth={1.2} />
        ))}
        <circle cx={242} cy={202} r={11} fill="#4A2A14" />
        <circle cx={258} cy={206} r={10} fill="#5A3418" />
        <circle cx={250} cy={214} r={9.5} fill="#3E2210" />
      </g>
    </svg>
  );

  return (
    <div data-tp-backdrop="island-golden-hour" data-compact={compact ? '' : undefined} className="tp-backdrop" aria-hidden>
      <div className="ig-stage">
        <svg width="0" height="0" className="absolute" focusable="false">
          <defs>
            <radialGradient id={ids.sun} cx="50%" cy="46%" r="54%">
              <stop offset="0" stopColor="#FFF6D6" />
              <stop offset="0.45" stopColor="#FFE29A" />
              <stop offset="0.82" stopColor="#F8BE5C" />
              <stop offset="1" stopColor="#EE9C3C" />
            </radialGradient>
            <linearGradient id={ids.far} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8A4A38" />
              <stop offset="1" stopColor="#4A2630" />
            </linearGradient>
            <linearGradient id={ids.land} x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0" stopColor="#A2683A" />
              <stop offset="0.45" stopColor="#6E4022" />
              <stop offset="1" stopColor="#3A2010" />
            </linearGradient>
            <linearGradient id={ids.trunk} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#2A170B" />
              <stop offset="0.55" stopColor="#5E3A1E" />
              <stop offset="1" stopColor="#2E1A0C" />
            </linearGradient>
            <linearGradient id={ids.frond} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3C3A22" />
              <stop offset="1" stopColor="#1E2116" />
            </linearGradient>
            <linearGradient id={ids.frondBack} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#22261A" />
              <stop offset="1" stopColor="#141710" />
            </linearGradient>
            <linearGradient id={ids.w1} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6FAE98" />
              <stop offset="0.5" stopColor="#3D7E72" />
              <stop offset="1" stopColor="#2A5E57" />
            </linearGradient>
            <linearGradient id={ids.w2} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3F8577" />
              <stop offset="1" stopColor="#1E4C48" />
            </linearGradient>
            <linearGradient id={ids.w3} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#245A54" />
              <stop offset="1" stopColor="#10302D" />
            </linearGradient>
            <radialGradient id={ids.hibiscus} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="82">
              <stop offset="0" stopColor="#5E2410" />
              <stop offset="0.24" stopColor="#A6461F" />
              <stop offset="0.6" stopColor="#E3843F" />
              <stop offset="1" stopColor="#F9C47E" />
            </radialGradient>
            <radialGradient id={ids.frangi} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="70">
              <stop offset="0" stopColor="#EFAA34" />
              <stop offset="0.3" stopColor="#FBDE98" />
              <stop offset="0.56" stopColor="#FFF4E0" />
              <stop offset="1" stopColor="#FFFCF4" />
            </radialGradient>
            <linearGradient id={ids.leaf} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5FA893" />
              <stop offset="1" stopColor="#285A52" />
            </linearGradient>
            <linearGradient id={ids.banana} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#4C957F" />
              <stop offset="0.6" stopColor="#2B6159" />
              <stop offset="1" stopColor="#173C37" />
            </linearGradient>
            <linearGradient id={ids.cloud} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#E6995F" />
              <stop offset="1" stopColor="#A2482E" />
            </linearGradient>
          </defs>
        </svg>

        {/* The dusk sky and its first stars. */}
        <div className="ig-sky" />
        <div className="ig-stars">
          {STARS.map(([x, y, s], i) => (
            <svg key={i} viewBox="-10 -10 20 20" style={{ left: `${x}%`, top: `${y}%`, ['--s' as string]: s, ['--d' as string]: `${-i * 1.3}s` }}>
              <path d="M0,-10L2,-2L10,0L2,2L0,10L-2,2L-10,0L-2,-2Z" fill="#FFE3A3" />
            </svg>
          ))}
        </div>

        {/* The sun: three cut-paper halo rings behind the disc. */}
        <div className="ig-sun-wrap">
          <span className="ig-ring ig-ring-3" />
          <span className="ig-ring ig-ring-2" />
          <span className="ig-ring ig-ring-1" />
          <svg className="ig-sun" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill={`url(#${ids.sun})`} /></svg>
        </div>

        <svg className="ig-layer ig-cloud ig-cloud-1" viewBox="-4 0 282 90"><path d={CLOUD} fill={`url(#${ids.cloud})`} /></svg>
        <svg className="ig-layer ig-cloud ig-cloud-2" viewBox="-4 0 282 90"><path d={CLOUD} fill={`url(#${ids.cloud})`} transform="translate(276 0) scale(-1 1)" /></svg>
        <svg className="ig-layer ig-cloud ig-cloud-3" viewBox="-4 0 282 90"><path d={CLOUD} fill={`url(#${ids.cloud})`} /></svg>

        <svg className="ig-birds" viewBox="0 0 120 50">
          {[[0, 20, 1], [34, 6, 0.8], [62, 26, 0.65]].map(([x, y, s]) => (
            <path key={x} d="M0,6Q6,-1 12,6Q18,-1 24,6" transform={`translate(${x} ${y}) scale(${s})`} stroke="#2A120C" strokeWidth={2.4} fill="none" strokeLinecap="round" />
          ))}
        </svg>

        <svg className="ig-layer ig-far" viewBox="0 0 1600 220" preserveAspectRatio="xMidYMax slice">
          <path d={FAR_ISLAND} fill={`url(#${ids.far})`} stroke="#F2A35A" strokeOpacity={0.55} strokeWidth={2} />
        </svg>

        {/* The sea, and the sun's road of glints across it. */}
        <div className="ig-sea" />
        <div className="ig-glints">
          {GLINTS.map((w, i) => (
            <span key={i} style={{ width: `${w * 100}%`, ['--d' as string]: `${-i * 0.7}s` }} />
          ))}
        </div>

        <svg className="ig-layer ig-wave ig-wave-1" viewBox="0 0 1600 260" preserveAspectRatio="xMidYMin slice">
          <path d={WAVE_BACK} fill={`url(#${ids.w1})`} stroke="#B5DCC9" strokeOpacity={0.6} strokeWidth={2} />
        </svg>

        <svg className="ig-layer ig-headland ig-headland-l" viewBox="0 0 600 400" preserveAspectRatio="xMinYMax meet">
          <path d={HEADLAND} fill={`url(#${ids.land})`} stroke="#F0AC5E" strokeOpacity={0.6} strokeWidth={2} />
        </svg>
        <svg className="ig-layer ig-headland ig-headland-r" viewBox="0 0 600 400" preserveAspectRatio="xMinYMax meet">
          <path d={HEADLAND} fill={`url(#${ids.land})`} stroke="#F0AC5E" strokeOpacity={0.6} strokeWidth={2} />
        </svg>
        {palm('l')}
        {palm('r')}

        <svg className="ig-layer ig-wave ig-wave-2" viewBox="0 0 1600 260" preserveAspectRatio="xMidYMin slice">
          <path d={WAVE_MID} fill={`url(#${ids.w2})`} stroke="#8DCAB6" strokeOpacity={0.55} strokeWidth={2} />
        </svg>
        <svg className="ig-layer ig-wave ig-wave-3" viewBox="0 0 1600 260" preserveAspectRatio="xMidYMin slice">
          <path d={WAVE_FRONT} fill={`url(#${ids.w3})`} stroke="#6DB3A0" strokeOpacity={0.5} strokeWidth={2} />
        </svg>

        {/* Corner flora: hibiscus top-left, frangipani top-right, and a
            foreground of torn banana leaves with flowers in both low corners. */}
        <svg className="ig-layer ig-flora ig-flora-tl" viewBox="0 0 300 300">
          <Leaf o={[40, 40]} a={58} l={190} w={34} ids={ids} />
          <Leaf o={[30, 60]} a={22} l={170} w={30} ids={ids} />
          <Leaf o={[60, 20]} a={86} l={130} w={26} ids={ids} />
          <Hibiscus x={112} y={108} s={1} rot={-14} ids={ids} />
          <Hibiscus x={44} y={186} s={0.62} rot={40} ids={ids} />
        </svg>
        <svg className="ig-layer ig-flora ig-flora-tr" viewBox="0 0 300 300">
          <Leaf o={[260, 30]} a={128} l={190} w={32} ids={ids} />
          <Leaf o={[280, 60]} a={160} l={160} w={28} ids={ids} />
          <Frangipani x={190} y={96} s={1.05} rot={10} ids={ids} />
          <Frangipani x={250} y={170} s={0.8} rot={-30} ids={ids} />
          <Frangipani x={126} y={50} s={0.7} rot={50} ids={ids} />
        </svg>
        <svg className="ig-layer ig-flora ig-flora-bl" viewBox="0 0 420 360" preserveAspectRatio="xMinYMax meet">
          <path d={tornLeaf([10, 370], -62, 330, 40, 62, 10)} fill={`url(#${ids.banana})`} />
          <path d={tornLeaf([-10, 330], -22, 300, 60, 52, 9)} fill={`url(#${ids.banana})`} />
          <Leaf o={[60, 360]} a={-40} l={170} w={34} ids={ids} />
          <Hibiscus x={150} y={262} s={1.05} rot={12} ids={ids} />
          <Frangipani x={60} y={250} s={0.85} rot={-12} ids={ids} />
          <Hibiscus x={250} y={330} s={0.7} rot={-30} ids={ids} />
        </svg>
        <svg className="ig-layer ig-flora ig-flora-br" viewBox="0 0 420 360" preserveAspectRatio="xMaxYMax meet">
          <path d={tornLeaf([420, 370], -118, 320, 40, 60, 10)} fill={`url(#${ids.banana})`} />
          <path d={tornLeaf([440, 320], -158, 290, 70, 50, 9)} fill={`url(#${ids.banana})`} />
          <Leaf o={[360, 362]} a={-140} l={160} w={32} ids={ids} />
          <Frangipani x={292} y={262} s={1.1} rot={20} ids={ids} />
          <Hibiscus x={366} y={268} s={0.8} rot={-40} ids={ids} />
          <Frangipani x={200} y={330} s={0.75} rot={-8} ids={ids} />
        </svg>

        <div className="ig-grain" />
        <div className="ig-shade" />
      </div>
    </div>
  );
}
