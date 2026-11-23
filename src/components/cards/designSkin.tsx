/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The reading view's design skin: a context carrying the card design's skin
 * (lib/designSkins.ts) from CardExperience down to the page and photo
 * components, and `DesignDecor`, the paper cut-outs tucked into the page's
 * corners. No design → no context → every template renders exactly as before.
 *
 * The cut-outs are flat paper shapes with a soft drop shadow, like the scene
 * art, and they sway a little (scenes.css `scene-sway`; softer and slower
 * under reduced motion, never still).
 */
import { createContext, useContext, type ReactElement } from 'react';
import type { CSSProperties } from 'react';
import { PHOTO_SHAPE_RADIUS, type DecorKind, type DesignSkin } from '../../lib/designSkins';
import './scenes/scenes.css';

export const DesignSkinContext = createContext<DesignSkin | null>(null);

export function useDesignSkin(): DesignSkin | null {
  return useContext(DesignSkinContext);
}

/** Inline style for a photo/video frame under the current skin (undefined = template default). */
export function useSkinFrameStyle(): CSSProperties | undefined {
  const skin = useDesignSkin();
  if (!skin) return undefined;
  const style: CSSProperties = { borderRadius: PHOTO_SHAPE_RADIUS[skin.photo] };
  if (skin.photo === 'deco') {
    // A formal mat: a hairline in the design's accent, set off the photo.
    style.outline = '1.5px solid rgba(var(--accent-rgb), 0.8)';
    style.outlineOffset = '6px';
  }
  return style;
}

/* ------------------------------------------------------------------ */
/* Paper primitives (drawn in a 140x140 box, the corner at 0,0)        */
/* ------------------------------------------------------------------ */

const r1 = (n: number) => Math.round(n * 10) / 10;

function Leaf({ x, y, l, w, deg, fill }: { x: number; y: number; l: number; w: number; deg: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${deg})`}>
      <path
        d={`M0 0 C${r1(w * 1.1)} ${r1(-l * 0.22)} ${r1(w * 0.9)} ${r1(-l * 0.78)} 0 ${-l} C${r1(-w * 0.9)} ${r1(-l * 0.78)} ${r1(-w * 1.1)} ${r1(-l * 0.22)} 0 0Z`}
        fill={fill}
      />
      <path d={`M0 0 L0 ${r1(-l * 0.9)}`} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
    </g>
  );
}

function Petals({ x, y, r, n, fill, center }: { x: number; y: number; r: number; n: number; fill: string; center: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: n }, (_, i) => (
        <ellipse key={i} cx="0" cy={-r * 0.55} rx={r * 0.42} ry={r * 0.6} fill={fill} transform={`rotate(${(i * 360) / n})`} />
      ))}
      <circle r={r * 0.28} fill={center} />
    </g>
  );
}

function StarShape({ x, y, r, n, fill, inner = 0.45 }: { x: number; y: number; r: number; n: number; fill: string; inner?: number }) {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 ? r * inner : r;
    return `${r1(x + Math.cos(a) * rr)},${r1(y + Math.sin(a) * rr)}`;
  }).join(' ');
  return <polygon points={pts} fill={fill} />;
}

function Snowflake({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={color} strokeWidth="2.4" strokeLinecap="round" fill="none">
      {[0, 60, 120].map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <path d={`M0 ${-r} L0 ${r}`} />
          <path d={`M-5 ${-r + 6} L0 ${-r + 11} L5 ${-r + 6} M-5 ${r - 6} L0 ${r - 11} L5 ${r - 6}`} />
        </g>
      ))}
    </g>
  );
}

function Rose({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[1, 0.72, 0.46].map((s, ri) => (
        <g key={s}>
          {Array.from({ length: 6 - ri }, (_, i) => (
            <ellipse
              key={i}
              cx="0"
              cy={-r * s * 0.5}
              rx={r * (0.5 - ri * 0.08)}
              ry={r * s * 0.55}
              fill={fill}
              transform={`rotate(${(i * 360) / (6 - ri) + ri * 23})`}
            />
          ))}
          <circle r={r * s * 0.62} fill={`rgba(0,0,0,${0.08 + ri * 0.07})`} />
        </g>
      ))}
    </g>
  );
}

function Marigold({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return <circle key={i} cx={Math.cos(a) * r * 0.55} cy={Math.sin(a) * r * 0.55} r={r * 0.5} fill={fill} />;
      })}
      <circle r={r * 0.32} fill="rgba(0,0,0,0.12)" />
    </g>
  );
}

function Balloon({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  return (
    <g>
      <path d={`M${x} ${y + r * 1.2} q${-6} 24 4 46`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" fill="none" />
      <ellipse cx={x} cy={y} rx={r} ry={r * 1.2} fill={fill} />
      <path d={`M${x - 3} ${y + r * 1.18} L${x + 3} ${y + r * 1.18} L${x} ${y + r * 1.4} Z`} fill={fill} />
      <ellipse cx={x - r * 0.35} cy={y - r * 0.45} rx={r * 0.22} ry={r * 0.36} fill="rgba(255,255,255,0.35)" transform={`rotate(-20 ${x - r * 0.35} ${y - r * 0.45})`} />
    </g>
  );
}

function Lantern({ x, y, r, fill, trim }: { x: number; y: number; r: number; fill: string; trim: string }) {
  return (
    <g>
      <path d={`M${x} 0 L${x} ${y - r}`} stroke={trim} strokeWidth="1.4" />
      <ellipse cx={x} cy={y} rx={r} ry={r * 0.85} fill={fill} />
      <path d={`M${x - r * 0.5} ${y - r * 0.8} L${x - r * 0.5} ${y + r * 0.8} M${x + r * 0.5} ${y - r * 0.8} L${x + r * 0.5} ${y + r * 0.8}`} stroke="rgba(0,0,0,0.15)" strokeWidth="1.4" />
      <rect x={x - r * 0.45} y={y - r * 1.02} width={r * 0.9} height={r * 0.22} fill={trim} />
      <rect x={x - r * 0.45} y={y + r * 0.8} width={r * 0.9} height={r * 0.22} fill={trim} />
      <path d={`M${x} ${y + r} L${x} ${y + r * 1.7}`} stroke={trim} strokeWidth="2.4" />
    </g>
  );
}

function Cloud({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M-40 10 C-46 -2 -34 -12 -24 -6 C-21 -20 -4 -22 2 -10 C8 -21 26 -19 28 -6 C40 -9 48 2 42 10 Z"
      fill={fill}
    />
  );
}

function Crescent({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  return <path d={`M${x + r * 0.2} ${y - r} A${r} ${r} 0 1 0 ${x + r * 0.6} ${y + r * 0.8} A${r * 0.8} ${r * 0.8} 0 1 1 ${x + r * 0.2} ${y - r} Z`} fill={fill} />;
}

function Fan({ x, y, r, deg, fill, rib }: { x: number; y: number; r: number; deg: number; fill: string; rib: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${deg})`}>
      <path d={`M0 0 L${-r} 0 A${r} ${r} 0 0 1 ${r} 0 Z`} fill={fill} />
      {Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI + (i / 6) * Math.PI;
        return <path key={i} d={`M0 0 L${r1(Math.cos(a) * r)} ${r1(Math.sin(a) * r)}`} stroke={rib} strokeWidth="1.6" />;
      })}
      <rect x="-3" y="0" width="6" height={r * 0.6} rx="2" fill={rib} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* One corner cluster per decor kind                                   */
/* ------------------------------------------------------------------ */

function cluster(kind: DecorKind, [a, b, c]: readonly [string, string, string]): ReactElement {
  switch (kind) {
    case 'wisteria':
      return (
        <>
          <Leaf x={8} y={6} l={46} w={10} deg={120} fill={b} />
          {[18, 42, 66].map((x, k) => (
            <g key={x}>
              {Array.from({ length: 7 - k * 2 }, (_, i) => (
                <circle key={i} cx={x + (i % 2 ? 4 : -4)} cy={10 + i * 11} r={7 - i * 0.6} fill={i % 2 ? a : c} />
              ))}
            </g>
          ))}
        </>
      );
    case 'balloons':
      return (
        <>
          <Balloon x={28} y={34} r={18} fill={a} />
          <Balloon x={62} y={22} r={14} fill={b} />
          <Balloon x={52} y={60} r={11} fill={c} />
        </>
      );
    case 'deco':
      return (
        <g fill="none" stroke={a} strokeWidth="1.6">
          {[34, 54, 74].map((rr) => (
            <path key={rr} d={`M${rr} 6 A${rr - 6} ${rr - 6} 0 0 1 6 ${rr}`} />
          ))}
          {Array.from({ length: 7 }, (_, i) => {
            const t = (i / 6) * (Math.PI / 2);
            return <path key={i} d={`M6 6 L${r1(6 + Math.cos(t) * 30)} ${r1(6 + Math.sin(t) * 30)}`} stroke={b} />;
          })}
          <circle cx="6" cy="6" r="5" fill={a} />
        </g>
      );
    case 'fans':
      return (
        <>
          <Fan x={36} y={38} r={30} deg={135} fill={a} rib={c} />
          <Fan x={58} y={20} r={20} deg={160} fill={b} rib={c} />
        </>
      );
    case 'stars':
      return (
        <>
          <StarShape x={24} y={24} r={14} n={4} fill={a} inner={0.3} />
          <StarShape x={58} y={16} r={8} n={4} fill={b} inner={0.3} />
          <StarShape x={18} y={60} r={9} n={4} fill={c} inner={0.3} />
          <circle cx="44" cy="44" r="2.4" fill={b} />
          <circle cx="76" cy="34" r="1.8" fill={a} />
        </>
      );
    case 'lanterns':
      return (
        <>
          <Lantern x={26} y={46} r={16} fill={a} trim={b} />
          <Lantern x={60} y={28} r={11} fill={b} trim={a} />
        </>
      );
    case 'clouds':
      return (
        <>
          <Cloud x={42} y={28} s={0.9} fill={a} />
          <Cloud x={30} y={60} s={0.6} fill={b} />
          <StarShape x={76} y={50} r={6} n={5} fill={c} />
        </>
      );
    case 'laurel':
      return (
        <>
          <path d="M6 84 Q8 8 84 6" stroke={b} strokeWidth="2" fill="none" />
          {Array.from({ length: 7 }, (_, i) => {
            const t = (i + 0.5) / 7;
            const x = (1 - t) * (1 - t) * 6 + 2 * (1 - t) * t * 8 + t * t * 84;
            const y = (1 - t) * (1 - t) * 84 + 2 * (1 - t) * t * 8 + t * t * 6;
            const deg = -t * 90;
            return (
              <g key={i}>
                <Leaf x={x} y={y} l={16} w={5} deg={deg - 40} fill={a} />
                <Leaf x={x} y={y} l={16} w={5} deg={deg + 40} fill={a} />
              </g>
            );
          })}
        </>
      );
    case 'palms':
      return (
        <>
          {[100, 130, 160, 190].map((deg, i) => (
            <g key={deg}>
              <Leaf x={6} y={6} l={86 - i * 8} w={9} deg={deg} fill={i % 2 ? b : a} />
            </g>
          ))}
          <circle cx="70" cy="72" r="5" fill={c} />
        </>
      );
    case 'snow':
      return (
        <>
          <Snowflake x={26} y={26} r={16} color={a} />
          <Snowflake x={64} y={18} r={9} color={b} />
          <Snowflake x={20} y={66} r={10} color={b} />
          <circle cx="52" cy="52" r="2.6" fill={c} />
        </>
      );
    case 'leaves':
      return (
        <>
          <Leaf x={4} y={4} l={70} w={18} deg={130} fill={a} />
          <Leaf x={4} y={4} l={62} w={16} deg={160} fill={b} />
          <Leaf x={4} y={4} l={52} w={14} deg={100} fill={b} />
          <Petals x={40} y={40} r={12} n={5} fill={c} center="#FFE08A" />
        </>
      );
    case 'roses':
      return (
        <>
          <Leaf x={30} y={34} l={34} w={10} deg={120} fill={b} />
          <Leaf x={34} y={30} l={34} w={10} deg={170} fill={b} />
          <Rose x={26} y={26} r={18} fill={a} />
          <Rose x={60} y={18} r={11} fill={c} />
        </>
      );
    case 'marigolds':
      return (
        <>
          {Array.from({ length: 6 }, (_, i) => (
            <Marigold key={`h${i}`} x={10 + i * 15} y={8 + Math.sin(i) * 3} r={8} fill={i % 2 ? a : b} />
          ))}
          {Array.from({ length: 4 }, (_, i) => (
            <Marigold key={`v${i}`} x={10} y={24 + i * 15} r={8} fill={i % 2 ? b : a} />
          ))}
          <path d="M10 84 l-4 12 l4 -3 l4 3 Z" fill={c} />
        </>
      );
    case 'crescent':
      return (
        <>
          <Crescent x={26} y={30} r={18} fill={a} />
          <StarShape x={62} y={20} r={9} n={8} fill={b} inner={0.72} />
          <StarShape x={24} y={68} r={6} n={8} fill={c} inner={0.72} />
        </>
      );
    case 'grasses':
      return (
        <>
          {Array.from({ length: 9 }, (_, i) => (
            <Leaf key={i} x={4} y={4} l={40 + ((i * 17) % 36)} w={3} deg={95 + i * 9} fill={i % 2 ? a : b} />
          ))}
          <Petals x={44} y={30} r={7} n={5} fill={c} center="#F4B942" />
          <Petals x={26} y={52} r={6} n={5} fill="#FFFFFF" center="#F4B942" />
        </>
      );
    default:
      return <></>;
  }
}

/** Things that hang from above (lanterns, garlands): top corner only, never upside down. */
const HANGS: ReadonlySet<DecorKind> = new Set(['lanterns', 'wisteria', 'marigolds']);
/** Things with an up (balloons, clouds, the moon): the bottom corner keeps them upright. */
const UPRIGHT: ReadonlySet<DecorKind> = new Set(['balloons', 'clouds', 'crescent', 'stars', 'snow']);

/**
 * The paper cut-outs in two opposite corners of a reading page (top-right,
 * bottom-left). Absolutely
 * positioned inside the page; the page's content sits above it.
 */
export function DesignDecor({ className = '' }: { className?: string }) {
  const skin = useDesignSkin();
  if (!skin) return null;
  const art = cluster(skin.decor, skin.colors);
  const corner = (key: string, style: CSSProperties, flip: string, delay: string) => (
    <svg
      key={key}
      aria-hidden
      viewBox="0 0 100 100"
      className="pointer-events-none absolute aspect-square w-[clamp(5.5rem,30%,8.5rem)] overflow-visible"
      style={{ ...style, filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.3))' }}
    >
      <g transform={flip}>
        <g className="scene-sway" style={{ transformOrigin: '0 0', animationDelay: delay }}>
          {art}
        </g>
      </g>
    </svg>
  );
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`} data-design-decor={skin.decor}>
      {/* Top-right and bottom-left: the top-left corner sits under the close button. */}
      {corner('tr', { right: 6, top: 6 }, 'translate(100 0) scale(-1 1)', '0s')}
      {!HANGS.has(skin.decor) &&
        corner('bl', { left: 6, bottom: 6 }, UPRIGHT.has(skin.decor) ? '' : 'translate(0 100) scale(1 -1)', '-3.1s')}
    </div>
  );
}
