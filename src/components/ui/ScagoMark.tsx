/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * <ScagoMark> — the SCAGO crescent + blood-drop emblem as an inline SVG so it
 * can be themed (gold / red / mono) and animated (a slow gold sheen sweep plus
 * a gentle glint on the drop) for a premium gala feel.
 *
 * Geometry is shared with src/lib/scagoMark.ts (SVG borders + canvas watermark)
 * so the mark is identical everywhere.
 */
import { useId } from 'react';
import { SCAGO_DROP_PATH, SCAGO_GEOM, type ScagoVariant } from '../../lib/scagoMark';

interface Props {
  size?: number;
  variant?: ScagoVariant;
  animated?: boolean;
  className?: string;
  title?: string;
}

const GOLD = [
  ['0%', '#B8860B'],
  ['32%', '#E8C766'],
  ['50%', '#FBF3D9'],
  ['70%', '#D4AF37'],
  ['100%', '#9A6F1C'],
];

export default function ScagoMark({
  size = 40,
  variant = 'gold',
  animated = false,
  className = '',
  title = 'SCAGO',
}: Props) {
  const uid = useId().replace(/:/g, '');
  const gid = `sg-${uid}`;
  const mid = `sm-${uid}`;
  const shid = `ss-${uid}`;
  const { outer: O, inner: I, drop: D } = SCAGO_GEOM;

  const stops =
    variant === 'red'
      ? [['0%', '#C81E33'], ['55%', '#B71B2E'], ['100%', '#8E1322']]
      : variant === 'mono'
        ? [['0%', '#FBF3D9'], ['100%', '#E9D9B8']]
        : GOLD;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          {stops.map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
        </linearGradient>

        <mask id={mid} maskUnits="userSpaceOnUse">
          <circle cx={O.cx} cy={O.cy} r={O.r} fill="#fff" />
          <circle cx={I.cx} cy={I.cy} r={I.r} fill="#000" />
        </mask>

        {animated && (
          <linearGradient id={shid} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#FFFDF2" stopOpacity="0.85" />
            <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="-1 0"
              to="1 0"
              dur="3.6s"
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes="0;1"
              keySplines="0.45 0 0.2 1"
            />
          </linearGradient>
        )}
      </defs>

      {/* crescent */}
      <circle cx={O.cx} cy={O.cy} r={O.r} fill={`url(#${gid})`} mask={`url(#${mid})`} />

      {/* drop */}
      <g transform={`translate(${D.cx},${D.cy}) scale(${D.scale}) rotate(${D.rot})`}>
        <path d={SCAGO_DROP_PATH} fill={`url(#${gid})`} />
        {animated && (
          <ellipse cx={-3.5} cy={-6} rx={2.4} ry={4} fill="#FFFDF2" opacity={0.0}>
            <animate
              attributeName="opacity"
              values="0;0.7;0"
              dur="3.6s"
              repeatCount="indefinite"
              keyTimes="0;0.5;1"
            />
          </ellipse>
        )}
      </g>

      {/* animated sheen sweep, clipped to the whole mark */}
      {animated && (
        <g mask={`url(#${mid})`}>
          <rect x="0" y="0" width="100" height="100" fill={`url(#${shid})`} />
        </g>
      )}
    </svg>
  );
}
