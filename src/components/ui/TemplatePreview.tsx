/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TemplatePreview — a live 9:16 "this is your event" card for a chosen event
 * template. It applies the template's theme tokens inline (so descendants —
 * including the real ambient background component — recolour to the template),
 * places a soft subject, and overlays the template's frame. Because the
 * backgrounds read only CSS vars and size with container-query units, this is a
 * faithful, miniature version of the real booth look.
 */
import type { CSSProperties } from 'react';
import { BORDER_MAP, toDataUrl } from '../../lib/borders';
import { resolveBackgroundTemplate } from '../theme/backgrounds';
import { accentThemePatch, type EventTemplate } from '../../lib/eventTemplates';

interface Props {
  template: EventTemplate;
  /** Optional name to show subtly at the base. */
  eventName?: string;
  /** Optional '#RRGGBB' accent override — live re-accents the whole preview. */
  accent?: string | null;
  className?: string;
}

export default function TemplatePreview({ template, eventName, accent, className = '' }: Props) {
  const Bg = resolveBackgroundTemplate(template.background).component;
  const border = BORDER_MAP[template.frameId];
  const frameUrl = border ? toDataUrl(border.svg) : null;

  const themeStyle = {
    ...template.themeVars,
    ...(accent ? accentThemePatch(accent) : {}),
    background: 'var(--color-brand-bg)',
    border: '1px solid rgba(var(--accent-rgb),0.28)',
  } as CSSProperties;

  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] ${className}`} style={themeStyle}>
      <Bg density={14} sparkle={0.6} />

      {/* Soft subject so the frame frames something. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(68% 42% at 50% 37%, rgba(var(--accent-rgb),0.16), transparent 72%)' }}
      />
      <div
        className="absolute left-1/2 top-[37%] -translate-x-1/2 -translate-y-1/2 w-[44%] aspect-square rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle at 50% 38%, rgba(255,255,255,0.16), rgba(255,255,255,0.02) 68%)' }}
      />

      {frameUrl && (
        <img src={frameUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" />
      )}

      {eventName && (
        <div className="absolute inset-x-0 bottom-2.5 flex justify-center px-3 pointer-events-none">
          <span
            className="font-serif italic text-[13px] leading-tight text-center line-clamp-1"
            style={{ color: 'var(--color-brand-fg)', textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}
          >
            {eventName}
          </span>
        </div>
      )}
    </div>
  );
}
