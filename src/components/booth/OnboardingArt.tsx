/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OnboardingArt — bespoke gold line-art illustrations for the first-launch
 * onboarding modal. One component per step, rendered as inline SVG with
 * champagne/gold strokes and subtle fills on a transparent background. Gentle
 * SMIL twinkles + floats add a little delight without weighing down the DOM.
 *
 * Palette is hard-coded to the gala gold scale (matching index.css @theme) so
 * the art is identical wherever it renders, independent of Tailwind classes.
 *
 * Each illustration shares a `<defs>`-free, self-contained structure and a
 * common ~148px artboard. Export is a typed map keyed by step index so
 * Onboarding.tsx can simply render `Art[step]`.
 */
import type { ComponentType, ReactNode } from 'react';

/* Gala gold palette (mirrors --color-gold-* / --color-champagne in index.css) */
const GOLD = '#D4AF37'; // primary metallic gold
const GOLD_HI = '#F0DC9A'; // foil highlight
const GOLD_LO = '#A67C1F'; // deep gold
const CHAMP = '#E9D9B8'; // champagne

interface ArtProps {
  size?: number;
  className?: string;
}

/** Shared SVG wrapper: square artboard, transparent bg, overflow visible for glows. */
function Frame({
  size = 148,
  className,
  children,
}: ArtProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
      fill="none"
      style={{ overflow: 'visible' }}
    >
      {children}
    </svg>
  );
}

/** A reusable twinkling 4-point sparkle. */
function Sparkle({
  x,
  y,
  r = 6,
  delay = '0s',
  dur = '2.6s',
  color = GOLD_HI,
}: {
  x: number;
  y: number;
  r?: number;
  delay?: string;
  dur?: string;
  color?: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M0 ${-r} C ${r * 0.18} ${-r * 0.18} ${r * 0.18} ${-r * 0.18} ${r} 0 C ${r * 0.18} ${r * 0.18} ${r * 0.18} ${r * 0.18} 0 ${r} C ${-r * 0.18} ${r * 0.18} ${-r * 0.18} ${r * 0.18} ${-r} 0 C ${-r * 0.18} ${-r * 0.18} ${-r * 0.18} ${-r * 0.18} 0 ${-r} Z`}
        fill={color}
      >
        <animate
          attributeName="opacity"
          values="0.2;1;0.2"
          dur={dur}
          begin={delay}
          repeatCount="indefinite"
        />
        <animateTransform
          attributeName="transform"
          type="scale"
          values="0.6;1.1;0.6"
          dur={dur}
          begin={delay}
          repeatCount="indefinite"
          additive="sum"
        />
      </path>
    </g>
  );
}

/* ----------------------------------------------------------------- */
/* 1 · Choose Your Look — a face inside an ornate frame with sparkles  */
/* ----------------------------------------------------------------- */
function ArtChooseLook({ size, className }: ArtProps) {
  return (
    <Frame size={size} className={className}>
      {/* ornate portrait frame */}
      <rect
        x="40"
        y="28"
        width="80"
        height="100"
        rx="40"
        stroke={GOLD}
        strokeWidth="2"
        opacity="0.9"
      />
      <rect
        x="46"
        y="34"
        width="68"
        height="88"
        rx="34"
        stroke={GOLD_LO}
        strokeWidth="1"
        opacity="0.55"
      />
      {/* face */}
      <circle cx="80" cy="74" r="26" stroke={CHAMP} strokeWidth="1.6" />
      {/* eyes */}
      <path d="M70 70 q4 -5 8 0" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      <path d="M82 70 q4 -5 8 0" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      {/* smile */}
      <path d="M71 84 q9 9 18 0" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      {/* glamour glints on the cheeks */}
      <circle cx="68" cy="80" r="2.2" fill={GOLD_HI} opacity="0.7" />
      <circle cx="92" cy="80" r="2.2" fill={GOLD_HI} opacity="0.7" />
      {/* sparkles */}
      <Sparkle x={48} y={48} r={7} delay="0s" />
      <Sparkle x={114} y={56} r={5} delay="0.6s" color={GOLD} />
      <Sparkle x={120} y={104} r={6} delay="1.1s" />
      <Sparkle x={42} y={108} r={4.5} delay="0.3s" color={CHAMP} />
    </Frame>
  );
}

/* ----------------------------------------------------------------- */
/* 2 · Flip & 3D — a phone mid-flip with a crown floating onto a head  */
/* ----------------------------------------------------------------- */
function ArtFlip3D({ size, className }: ArtProps) {
  return (
    <Frame size={size} className={className}>
      {/* flip arc */}
      <path
        d="M40 118 A 50 50 0 0 1 120 118"
        stroke={GOLD_LO}
        strokeWidth="1.4"
        strokeDasharray="3 6"
        opacity="0.6"
      />
      <path d="M118 112 l4 8 -9 1 z" fill={GOLD_LO} opacity="0.7" />

      {/* phone, gently flipping (perspective via scaleX) */}
      <g transform="translate(80 96)">
        <g>
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1 1;0.18 1;1 1"
            keyTimes="0;0.5;1"
            dur="4s"
            repeatCount="indefinite"
            additive="sum"
          />
          <rect
            x="-22"
            y="-32"
            width="44"
            height="64"
            rx="9"
            stroke={GOLD}
            strokeWidth="2"
            fill="rgba(212,175,55,0.05)"
          />
          <rect x="-16" y="-25" width="32" height="44" rx="4" stroke={CHAMP} strokeWidth="1" opacity="0.55" />
          {/* camera lens on the back */}
          <circle cx="0" cy="-15" r="4" stroke={GOLD_HI} strokeWidth="1.6" />
          <circle cx="0" cy="-15" r="1.4" fill={GOLD_HI} />
          {/* home dot */}
          <circle cx="0" cy="25" r="2" fill={GOLD} opacity="0.7" />
        </g>
      </g>

      {/* head silhouette */}
      <g transform="translate(120 86)">
        <circle cx="0" cy="14" r="13" stroke={CHAMP} strokeWidth="1.6" />
        <path d="M-15 40 q15 -16 30 0" stroke={CHAMP} strokeWidth="1.6" fill="none" />
        {/* floating 3D crown that drifts down onto the head */}
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 -14;0 -2;0 -14"
            dur="3.4s"
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.5;1"
            keySplines="0.45 0 0.2 1;0.45 0 0.2 1"
          />
          <path
            d="M-13 4 L-13 -8 L-6 -2 L0 -12 L6 -2 L13 -8 L13 4 Z"
            stroke={GOLD}
            strokeWidth="2"
            strokeLinejoin="round"
            fill="rgba(240,220,154,0.12)"
          />
          <circle cx="-13" cy="-8" r="1.8" fill={GOLD_HI} />
          <circle cx="0" cy="-12" r="2" fill={GOLD_HI} />
          <circle cx="13" cy="-8" r="1.8" fill={GOLD_HI} />
          <line x1="-13" y1="4" x2="13" y2="4" stroke={GOLD_HI} strokeWidth="1.4" />
        </g>
      </g>

      <Sparkle x={44} y={50} r={5} delay="0.4s" />
      <Sparkle x={138} y={120} r={4.5} delay="1s" color={GOLD} />
    </Frame>
  );
}

/* ----------------------------------------------------------------- */
/* 3 · Photo or Video — a camera body paired with a spinning film reel */
/* ----------------------------------------------------------------- */
function ArtPhotoVideo({ size, className }: ArtProps) {
  return (
    <Frame size={size} className={className}>
      {/* camera body */}
      <g transform="translate(58 86)">
        <path
          d="M-34 -8 h14 l5 -8 h18 l5 8 h14 a6 6 0 0 1 6 6 v28 a6 6 0 0 1 -6 6 h-56 a6 6 0 0 1 -6 -6 v-28 a6 6 0 0 1 6 -6 z"
          stroke={GOLD}
          strokeWidth="2"
          strokeLinejoin="round"
          fill="rgba(212,175,55,0.05)"
        />
        {/* lens */}
        <circle cx="0" cy="14" r="14" stroke={CHAMP} strokeWidth="1.6" />
        <circle cx="0" cy="14" r="8" stroke={GOLD} strokeWidth="2" />
        <circle cx="0" cy="14" r="3" fill={GOLD_HI}>
          <animate attributeName="opacity" values="0.5;1;0.5" dur="2.4s" repeatCount="indefinite" />
        </circle>
        {/* shutter flash dot */}
        <circle cx="26" cy="-4" r="2.4" fill={GOLD_HI}>
          <animate attributeName="opacity" values="0.2;1;0.2" dur="1.8s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* film / video reel, slowly rotating */}
      <g transform="translate(116 56)">
        <g>
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0"
            to="360"
            dur="9s"
            repeatCount="indefinite"
          />
          <circle cx="0" cy="0" r="22" stroke={GOLD} strokeWidth="2" fill="rgba(212,175,55,0.04)" />
          <circle cx="0" cy="0" r="5" stroke={GOLD_HI} strokeWidth="1.6" />
          {[0, 60, 120, 180, 240, 300].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <circle
                key={a}
                cx={Math.cos(rad) * 13}
                cy={Math.sin(rad) * 13}
                r="3.4"
                stroke={CHAMP}
                strokeWidth="1.4"
              />
            );
          })}
        </g>
        {/* film strip tail */}
        <path
          d="M0 22 q-6 18 -22 26"
          stroke={GOLD_LO}
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.5"
        />
        <path
          d="M0 22 q-6 18 -22 26"
          stroke={GOLD_HI}
          strokeWidth="1"
          strokeDasharray="2 5"
          opacity="0.8"
        />
      </g>

      <Sparkle x={40} y={44} r={5} delay="0.2s" />
      <Sparkle x={138} y={108} r={4.5} delay="0.9s" color={GOLD} />
    </Frame>
  );
}

/* ----------------------------------------------------------------- */
/* 4 · Send & Shine — a photo beaming up onto a lit gallery wall       */
/* ----------------------------------------------------------------- */
function ArtSendShine({ size, className }: ArtProps) {
  return (
    <Frame size={size} className={className}>
      {/* gallery wall: three frames */}
      <g opacity="0.6">
        <rect x="34" y="22" width="28" height="22" rx="2" stroke={GOLD_LO} strokeWidth="1.4" />
        <rect x="98" y="22" width="28" height="22" rx="2" stroke={GOLD_LO} strokeWidth="1.4" />
      </g>
      {/* hero frame that just lit up */}
      <rect x="64" y="18" width="32" height="28" rx="2" stroke={GOLD} strokeWidth="2" fill="rgba(212,175,55,0.06)">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2.8s" repeatCount="indefinite" />
      </rect>
      <path d="M68 40 l7 -8 5 5 4 -5 4 8 z" fill={GOLD_HI} opacity="0.8" />
      <circle cx="72" cy="26" r="2.4" fill={GOLD_HI} />

      {/* beam of light lifting the photo upward */}
      <path
        d="M64 116 L96 116 L86 56 L74 56 Z"
        fill={GOLD_HI}
        opacity="0.1"
      >
        <animate attributeName="opacity" values="0.04;0.16;0.04" dur="2.8s" repeatCount="indefinite" />
      </path>

      {/* the rising photo print */}
      <g transform="translate(80 104)">
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 6;0 -4;0 6"
            dur="3.2s"
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.5;1"
            keySplines="0.45 0 0.2 1;0.45 0 0.2 1"
          />
          <rect x="-18" y="-16" width="36" height="40" rx="2" stroke={GOLD} strokeWidth="2" fill="rgba(20,15,9,0.5)" />
          <rect x="-18" y="14" width="36" height="10" fill="rgba(233,217,184,0.12)" />
          {/* little portrait inside */}
          <circle cx="0" cy="-2" r="7" stroke={CHAMP} strokeWidth="1.4" />
          <path d="M-9 14 q9 -10 18 0" stroke={CHAMP} strokeWidth="1.4" fill="none" />
        </g>
      </g>

      <Sparkle x={50} y={70} r={5} delay="0.3s" />
      <Sparkle x={112} y={78} r={6} delay="0.8s" />
      <Sparkle x={120} y={120} r={4.5} delay="1.3s" color={GOLD} />
    </Frame>
  );
}

/* ----------------------------------------------------------------- */
/* 5 · Take the Challenge — a trophy crowned with stars + a leader bar */
/* ----------------------------------------------------------------- */
function ArtChallenge({ size, className }: ArtProps) {
  return (
    <Frame size={size} className={className}>
      {/* radiant burst behind the trophy */}
      <g opacity="0.5" stroke={GOLD_LO} strokeWidth="1.2" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const rad = (a * Math.PI) / 180;
          const cx = 80;
          const cy = 66;
          return (
            <line
              key={a}
              x1={cx + Math.cos(rad) * 30}
              y1={cy + Math.sin(rad) * 30}
              x2={cx + Math.cos(rad) * 40}
              y2={cy + Math.sin(rad) * 40}
            >
              <animate attributeName="opacity" values="0.2;0.8;0.2" dur="3s" begin={`${a / 360}s`} repeatCount="indefinite" />
            </line>
          );
        })}
      </g>

      {/* trophy cup */}
      <g transform="translate(80 0)">
        <path
          d="M-18 36 h36 v8 a18 18 0 0 1 -36 0 z"
          stroke={GOLD}
          strokeWidth="2"
          strokeLinejoin="round"
          fill="rgba(212,175,55,0.08)"
        />
        {/* handles */}
        <path d="M-18 38 q-12 2 -12 -10 q0 -8 8 -8" stroke={GOLD} strokeWidth="2" fill="none" />
        <path d="M18 38 q12 2 12 -10 q0 -8 -8 -8" stroke={GOLD} strokeWidth="2" fill="none" />
        {/* stem + base */}
        <path d="M-5 60 h10 v8 h-10 z" stroke={GOLD} strokeWidth="2" fill="rgba(212,175,55,0.08)" />
        <path d="M-13 70 h26 l-3 8 h-20 z" stroke={GOLD} strokeWidth="2" strokeLinejoin="round" fill="rgba(212,175,55,0.08)" />
        {/* star on the cup */}
        <path
          d="M0 40 l3 6 6.5 1 -4.5 4.5 1 6.5 -6 -3 -6 3 1 -6.5 -4.5 -4.5 6.5 -1 z"
          fill={GOLD_HI}
        >
          <animate attributeName="opacity" values="0.6;1;0.6" dur="2.4s" repeatCount="indefinite" />
        </path>
      </g>

      {/* leaderboard podium bars rising under the trophy */}
      <g transform="translate(80 132)">
        <rect x="-34" y="-12" width="18" height="12" rx="1.5" stroke={GOLD_LO} strokeWidth="1.6" fill="rgba(212,175,55,0.05)" />
        <rect x="-9" y="-22" width="18" height="22" rx="1.5" stroke={GOLD} strokeWidth="2" fill="rgba(212,175,55,0.1)" />
        <rect x="16" y="-16" width="18" height="16" rx="1.5" stroke={GOLD_LO} strokeWidth="1.6" fill="rgba(212,175,55,0.05)" />
        {/* #1 marker */}
        <text x="0" y="-8" textAnchor="middle" fontSize="10" fontWeight="700" fill={GOLD_HI} fontFamily="serif">
          1
        </text>
      </g>

      {/* crowning twinkles */}
      <Sparkle x={52} y={28} r={6} delay="0s" />
      <Sparkle x={110} y={30} r={5} delay="0.7s" color={GOLD} />
      <Sparkle x={120} y={70} r={4.5} delay="1.2s" />
    </Frame>
  );
}

/** Typed map keyed by step index, so Onboarding renders `Art[step]`. */
export const Art: ReadonlyArray<ComponentType<ArtProps>> = [
  ArtChooseLook,
  ArtFlip3D,
  ArtPhotoVideo,
  ArtSendShine,
  ArtChallenge,
];

export default Art;
