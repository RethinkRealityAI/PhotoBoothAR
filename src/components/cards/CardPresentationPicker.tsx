/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CardPresentationPicker — "How it arrives": the host's choice of OPENING
 * (the reveal on /c/:publicId), CARD STYLE (the template), EMAIL STYLE and
 * COLOURS for one keepsake card. Host-only, like TemplatePicker: guests never
 * choose any of this.
 *
 * Every option is a picture first. The opening tiles each carry a small
 * hand-drawn SVG of the moment (an envelope with its seal, a bow, parting
 * drapes…) because a host choosing between seven names they have never seen
 * animate would be choosing at random; the email tiles are wireframes of the
 * actual layouts card-publish/email.ts sends.
 *
 * The closed sets, labels and descriptions all come from
 * lib/cardPresentation.ts — this file only draws them.
 *
 * Also exports the compact chip rows the full-screen preview uses to flip the
 * same options live (PresentationChips).
 */
import { useId, type ReactNode } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import {
  CARD_EMAIL_STYLE_OPTIONS,
  CARD_LOOK_OPTIONS,
  CARD_REVEAL_OPTIONS,
  type CardEmailStyleId,
  type CardLookId,
  type CardPresentation,
  type CardRevealId,
} from '../../lib/cardPresentation';
import { CARD_DESIGNS, cardDesign, designAssets, type CardDesignChoice } from '../../lib/cardDesigns';
import type { CardUnlock } from '../../lib/cardPresentation';
import TemplatePicker from './TemplatePicker';
import { CARD_TEMPLATES } from './templates/registry';

/** The one warm light (brand v2 --bw-core). Illustrations only. */
const CORE = '#FFC56B';

/* ------------------------------------------------------------------ */
/* Illustrations                                                       */
/* ------------------------------------------------------------------ */

function RevealArt({ id, active }: { id: CardRevealId; active: boolean }) {
  const ink = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.62)';
  const soft = active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)';
  const glow = active ? CORE : 'rgba(255,197,107,0.7)';
  const common = { fill: 'none', stroke: ink, strokeWidth: 1.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  let art: ReactNode;
  switch (id) {
    case 'envelope':
      art = (
        <>
          <rect x="14" y="7" width="36" height="34" rx="3" fill={soft} {...common} />
          <path d="M14 8 L32 25 L50 8" {...common} />
          <path d="M14 40 L32 27 L50 40" {...common} strokeOpacity={0.6} />
          <circle cx="32" cy="25.5" r="7" fill={glow} opacity={0.25} />
          <circle cx="32" cy="25.5" r="4.2" fill={glow} />
        </>
      );
      break;
    case 'ribbon':
      art = (
        <>
          <rect x="13" y="7" width="38" height="34" rx="3" fill={soft} {...common} />
          <rect x="30" y="7" width="4" height="34" fill={ink} opacity={0.5} />
          <rect x="13" y="22" width="38" height="4" fill={ink} opacity={0.5} />
          <path d="M32 24 C24 14 18 18 22 24 C18 30 24 32 32 24 Z" fill={glow} opacity={0.85} />
          <path d="M32 24 C40 14 46 18 42 24 C46 30 40 32 32 24 Z" fill={glow} opacity={0.85} />
          <path d="M31 25 L26 36 M33 25 L38 36" stroke={glow} strokeWidth={1.6} strokeLinecap="round" />
        </>
      );
      break;
    case 'curtain':
      art = (
        <>
          <rect x="24" y="12" width="16" height="22" rx="2" fill={glow} opacity={0.9} transform="rotate(-6 32 23)" />
          <path d="M32 6 L32 4" stroke={glow} strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
          <path d="M22 9 L20 7 M42 9 L44 7" stroke={glow} strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
          <path d="M6 4 L20 4 C18 16 22 30 16 42 L6 42 Z" fill={soft} {...common} />
          <path d="M58 4 L44 4 C46 16 42 30 48 42 L58 42 Z" fill={soft} {...common} />
          <path d="M11 6 C10 18 13 30 10 41 M53 6 C54 18 51 30 54 41" {...common} strokeOpacity={0.45} />
        </>
      );
      break;
    case 'airplane':
      art = (
        <>
          <path d="M6 36 C14 34 18 30 22 27" stroke={ink} strokeWidth={1.3} strokeDasharray="2 3" fill="none" strokeLinecap="round" opacity={0.55} />
          <path d="M24 26 L56 8 L42 38 L36 28 Z" fill={soft} {...common} />
          <path d="M56 8 L36 28 L34 36 L38 30" {...common} />
          <circle cx="56" cy="8" r="2.4" fill={glow} />
        </>
      );
      break;
    case 'stardust':
      art = (
        <>
          <rect x="25" y="14" width="14" height="20" rx="2" fill={soft} {...common} />
          {[
            [10, 10, 1.6], [16, 34, 1.2], [8, 24, 1], [50, 8, 1.4], [56, 22, 1.8], [48, 38, 1.2],
            [20, 6, 1], [42, 4, 1], [14, 18, 2.2], [52, 30, 1], [36, 40, 1.4], [22, 40, 1],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={i % 3 === 0 ? glow : ink} opacity={i % 2 === 0 ? 0.95 : 0.6} />
          ))}
          <path d="M14 18 C20 22 22 24 25 24 M50 8 C46 12 42 14 39 16" stroke={glow} strokeWidth={1} fill="none" opacity={0.55} strokeLinecap="round" />
        </>
      );
      break;
    case 'papercut':
      art = (
        <>
          <circle cx="45" cy="13" r="5" fill={glow} />
          <path d="M4 30 C14 22 22 24 30 30 C38 24 48 20 60 28 L60 42 L4 42 Z" fill={ink} opacity={0.25} />
          <path d="M4 34 C12 28 20 30 28 36 C36 30 46 28 60 34 L60 42 L4 42 Z" fill={ink} opacity={0.45} />
          <path d="M4 39 C16 34 30 34 40 39 C48 36 54 36 60 38 L60 42 L4 42 Z" fill={ink} opacity={0.8} />
          <ellipse cx="18" cy="14" rx="4" ry="5" fill="none" stroke={ink} strokeWidth={1.3} />
          <path d="M18 19 L18 26" stroke={ink} strokeWidth={1} opacity={0.6} />
        </>
      );
      break;
    default: // 'none'
      art = (
        <>
          <rect x="18" y="6" width="28" height="36" rx="3" fill={soft} {...common} />
          <rect x="22" y="10" width="20" height="13" rx="1.5" fill={glow} opacity={0.75} />
          <path d="M22 28 L42 28 M22 32 L38 32 M22 36 L34 36" {...common} strokeOpacity={0.6} />
        </>
      );
  }
  return (
    <svg viewBox="0 0 64 46" className="h-full w-full" aria-hidden>
      {art}
    </svg>
  );
}

/** Wireframes of the three layouts card-publish/email.ts sends. */
function EmailArt({ id, active }: { id: CardEmailStyleId; active: boolean }) {
  const ink = active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.6)';
  const soft = active ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.13)';
  const glow = active ? CORE : 'rgba(255,197,107,0.7)';
  return (
    <svg viewBox="0 0 60 78" className="h-full w-full" aria-hidden>
      <rect x="4" y="3" width="52" height="72" rx="6" fill="none" stroke={ink} strokeOpacity={0.45} strokeWidth={0.8} />
      <rect x="6" y="5" width="48" height="68" rx="5" fill="none" stroke={ink} strokeOpacity={0.25} strokeWidth={0.6} />
      {id === 'glow' && (
        <>
          <rect x="26" y="11" width="8" height="1.2" rx="0.6" fill={glow} />
          <rect x="15" y="16" width="30" height="4" rx="2" fill={ink} />
          <rect x="21" y="23" width="18" height="1.8" rx="0.9" fill={ink} opacity={0.5} />
          <rect x="11" y="29" width="23" height="24" rx="3" fill={soft} />
          <rect x="36" y="29" width="13" height="11" rx="2.5" fill={soft} />
          <rect x="36" y="42" width="13" height="11" rx="2.5" fill={soft} />
          <rect x="20" y="59" width="20" height="6" rx="3" fill={ink} />
        </>
      )}
      {id === 'sealed' && (
        <>
          <rect x="15" y="10" width="30" height="4" rx="2" fill={ink} />
          <rect x="13" y="19" width="34" height="36" rx="3" fill={soft} />
          <path d="M13 20 L30 35 L47 20 M13 54 L30 39 L47 54" stroke={glow} strokeWidth={0.8} fill="none" opacity={0.85} />
          <circle cx="30" cy="37" r="6" fill={glow} opacity={0.3} />
          <circle cx="30" cy="37" r="3.6" fill={glow} />
          <rect x="20" y="60" width="20" height="6" rx="3" fill={ink} />
        </>
      )}
      {id === 'spotlight' && (
        <>
          <rect x="9" y="8" width="42" height="46" rx="4" fill={soft} />
          <path d="M9 40 L51 40 L51 50 Q51 54 47 54 L13 54 Q9 54 9 50 Z" fill="rgba(10,8,34,0.45)" />
          <rect x="13" y="42" width="24" height="3.4" rx="1.7" fill={ink} />
          <rect x="13" y="47.5" width="16" height="1.8" rx="0.9" fill={ink} opacity={0.6} />
          <rect x="13" y="38" width="6" height="1" rx="0.5" fill={glow} />
          <rect x="20" y="60" width="20" height="6" rx="3" fill={ink} />
        </>
      )}
    </svg>
  );
}

function LookSwatch({ id, eventAccent, eventBg }: { id: CardLookId; eventAccent: string | null; eventBg: string | null }) {
  const dusk = 'linear-gradient(135deg, #4A70BA 0%, #33318A 55%, #805EA0 100%)';
  const event = eventAccent ? `linear-gradient(135deg, ${eventBg ?? '#1A1740'} 0%, ${eventBg ?? '#1A1740'} 45%, ${eventAccent} 100%)` : dusk;
  const bg = id === 'beamwall' ? dusk : id === 'event' ? event : `linear-gradient(90deg, #33318A 50%, ${eventAccent ?? '#D4D6FF'} 50%)`;
  return (
    <span
      aria-hidden
      className="block h-6 w-6 shrink-0 rounded-full"
      style={{ backgroundImage: bg, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)' }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Pickers                                                             */
/* ------------------------------------------------------------------ */

function GroupHeading({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h5 id={id} className="font-sans text-[13px] font-semibold text-brand-fg">{title}</h5>
      {hint && <span className="font-sans text-[12px] text-brand-muted/70">{hint}</span>}
    </div>
  );
}

function SelectedNote({ children }: { children: ReactNode }) {
  return <p className="mt-2.5 font-sans text-[13px] leading-relaxed text-brand-muted/85">{children}</p>;
}

/**
 * The illustrated design gallery. Each tile is the design itself (its scene
 * with the gateway pulled aside), because a host picks a look by seeing it.
 * "Classic" (no design) stays first so the old behaviour is one tap away.
 */
export function DesignPicker({
  value, onChange, disabled = false,
}: { value: CardDesignChoice; onChange: (id: CardDesignChoice) => void; disabled?: boolean }) {
  const headingId = useId();
  const selected = value === 'none' ? null : cardDesign(value);
  return (
    <div>
      <GroupHeading id={headingId} title="Design" hint="An illustrated scene for the occasion" />
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1.5 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-6"
      >
        <button
          type="button"
          role="radio"
          aria-checked={value === 'none'}
          disabled={disabled}
          onClick={() => value !== 'none' && onChange('none')}
          className={`pressable liquid-glass flex w-[7.5rem] shrink-0 snap-start flex-col gap-1.5 rounded-2xl p-2 text-left transition disabled:opacity-50 sm:w-auto ${value === 'none' ? 'is-selected' : ''}`}
        >
          <span className="relative block aspect-[3/5] w-full overflow-hidden rounded-xl bg-[rgba(16,14,58,0.35)] p-4">
            <RevealArt id="none" active={value === 'none'} />
          </span>
          <span className="font-sans text-[13px] font-semibold leading-tight text-brand-fg">Classic</span>
          <span className="font-sans text-[12px] leading-snug text-brand-muted/75">Your opening and colours</span>
        </button>
        {CARD_DESIGNS.map((d) => {
          const on = d.id === value;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => !on && onChange(d.id)}
              className={`pressable liquid-glass flex w-[7.5rem] shrink-0 snap-start flex-col gap-1.5 rounded-2xl p-2 text-left transition disabled:opacity-50 sm:w-auto ${on ? 'is-selected' : ''}`}
            >
              <span className="relative block aspect-[3/5] w-full overflow-hidden rounded-xl" style={{ backgroundColor: d.palette.bg }}>
                <img
                  src={designAssets(d.id).thumb}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </span>
              <span className="font-sans text-[13px] font-semibold leading-tight text-brand-fg">{d.label}</span>
              <span className="line-clamp-2 font-sans text-[12px] leading-snug text-brand-muted/75">{d.goodFor}</span>
            </button>
          );
        })}
      </div>
      <SelectedNote>
        {selected
          ? `${selected.description} It opens its own way and sets the card's colours.`
          : 'No illustrated scene: the card uses the opening and colours you pick below.'}
      </SelectedNote>
    </div>
  );
}

export function RevealPicker({
  value, onChange, disabled = false, design = 'none', unlock = 'design', onDesignOpening,
}: {
  value: CardRevealId;
  onChange: (id: CardRevealId) => void;
  disabled?: boolean;
  design?: CardDesignChoice;
  unlock?: CardUnlock;
  /** With a design: its own opening, the initials, or none, in one write. */
  onDesignOpening?: (patch: { reveal?: CardRevealId; unlock?: CardUnlock }) => void;
}) {
  const headingId = useId();
  const selected = CARD_REVEAL_OPTIONS.find((o) => o.id === value) ?? CARD_REVEAL_OPTIONS[0];
  if (design !== 'none') {
    // The design opens itself; the only choice left is whether to open at all.
    const off = value === 'none';
    const pick = (o: { reveal: CardRevealId; unlock: CardUnlock }) =>
      onDesignOpening ? onDesignOpening(o) : onChange(o.reveal);
    const options = [
      { id: 'design', label: `${cardDesign(design).label} opening`, on: !off && unlock !== 'initials', set: { reveal: 'envelope' as CardRevealId, unlock: 'design' as CardUnlock } },
      ...(onDesignOpening
        ? [{ id: 'initials', label: 'Trace their initials', on: !off && unlock === 'initials', set: { reveal: 'envelope' as CardRevealId, unlock: 'initials' as CardUnlock } }]
        : []),
      { id: 'none', label: 'Straight to the card', on: off, set: { reveal: 'none' as CardRevealId, unlock } },
    ];
    return (
      <div>
        <GroupHeading id={headingId} title="Opening" hint="The moment the link opens" />
        <div role="radiogroup" aria-labelledby={headingId} className={`grid gap-2 ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={o.on}
              disabled={disabled}
              onClick={() => !o.on && pick(o.set)}
              className={`pressable liquid-glass min-h-11 rounded-2xl px-3 py-2 text-left font-sans text-[13px] font-semibold text-brand-fg transition disabled:opacity-50 ${o.on ? 'is-selected' : ''}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <SelectedNote>
          {off
            ? 'The card is on screen the second the link opens, over the design’s scene.'
            : unlock === 'initials'
              ? 'Their initials hang over the closed scene in its own lettering. Tracing them with a finger opens it (there is always a tap to open too).'
              : 'They open it the design’s own way, it opens onto the scene, then the card arrives.'}
        </SelectedNote>
      </div>
    );
  }
  return (
    <div>
      <GroupHeading id={headingId} title="Opening" hint="The moment the link opens" />
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1.5 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {CARD_REVEAL_OPTIONS.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => !on && onChange(o.id)}
              className={`pressable liquid-glass flex w-[9.5rem] shrink-0 snap-start flex-col gap-1.5 rounded-2xl p-2.5 text-left transition disabled:opacity-50 sm:w-auto ${on ? 'is-selected' : ''}`}
            >
              <span className="relative block h-16 w-full overflow-hidden rounded-xl bg-[rgba(16,14,58,0.35)] px-3 py-2">
                <RevealArt id={o.id} active={on} />
                {o.tier === 'premium' && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-white/15 px-1.5 py-[1px] font-sans text-[10px] font-semibold leading-4 text-white">
                    3D
                  </span>
                )}
              </span>
              <span className="font-sans text-[13px] font-semibold leading-tight text-brand-fg">{o.label}</span>
              <span className="font-sans text-[12px] leading-snug text-brand-muted/75">{o.goodFor}</span>
            </button>
          );
        })}
      </div>
      <SelectedNote>{selected.description}</SelectedNote>
    </div>
  );
}

export function EmailStylePicker({
  value, onChange, disabled = false,
}: { value: CardEmailStyleId; onChange: (id: CardEmailStyleId) => void; disabled?: boolean }) {
  const headingId = useId();
  const selected = CARD_EMAIL_STYLE_OPTIONS.find((o) => o.id === value) ?? CARD_EMAIL_STYLE_OPTIONS[0];
  return (
    <div>
      <GroupHeading id={headingId} title="Email style" hint="What lands in their inbox" />
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-3 gap-2.5">
        {CARD_EMAIL_STYLE_OPTIONS.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => !on && onChange(o.id)}
              className={`pressable liquid-glass flex min-h-11 flex-col items-center gap-1.5 rounded-2xl p-2.5 transition disabled:opacity-50 ${on ? 'is-selected' : ''}`}
            >
              <span className="block h-20 w-16">
                <EmailArt id={o.id} active={on} />
              </span>
              <span className="font-sans text-[13px] font-semibold text-brand-fg">{o.label}</span>
            </button>
          );
        })}
      </div>
      <SelectedNote>{selected.description}</SelectedNote>
    </div>
  );
}

export function LookPicker({
  value, onChange, disabled = false, eventAccent, eventBg,
}: {
  value: CardLookId;
  onChange: (id: CardLookId) => void;
  disabled?: boolean;
  /** The event's accent (theme snapshot) for the swatches; null = none set. */
  eventAccent: string | null;
  eventBg: string | null;
}) {
  const headingId = useId();
  const selected = CARD_LOOK_OPTIONS.find((o) => o.id === value) ?? CARD_LOOK_OPTIONS[0];
  return (
    <div>
      <GroupHeading id={headingId} title="Colours" />
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {CARD_LOOK_OPTIONS.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => !on && onChange(o.id)}
              className={`pressable liquid-glass flex min-h-11 items-center gap-2.5 rounded-2xl px-3 py-2 text-left transition disabled:opacity-50 ${on ? 'is-selected' : ''}`}
            >
              <LookSwatch id={o.id} eventAccent={eventAccent} eventBg={eventBg} />
              <span className="font-sans text-[13px] font-semibold text-brand-fg">{o.label}</span>
            </button>
          );
        })}
      </div>
      <SelectedNote>{selected.description}</SelectedNote>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The "How it arrives" section                                        */
/* ------------------------------------------------------------------ */

export interface CardPresentationSectionProps {
  presentation: CardPresentation;
  template: string;
  defaultTemplate: string;
  onChange: (patch: Partial<Pick<CardPresentation, 'reveal' | 'email' | 'look' | 'design' | 'unlock'>>) => void;
  onTemplateChange: (id: string) => void;
  onPreview: () => void;
  /** A presentation write is in flight (the UI already shows the new pick). */
  saving: boolean;
  /** A template write is in flight (TemplatePicker disables itself). */
  templateBusy: boolean;
  published: boolean;
  eventAccent: string | null;
  eventBg: string | null;
  idPrefix: string;
}

export default function CardPresentationSection({
  presentation, template, defaultTemplate, onChange, onTemplateChange, onPreview, saving, templateBusy,
  published, eventAccent, eventBg, idPrefix,
}: CardPresentationSectionProps) {
  return (
    <section className="liquid-glass rounded-3xl p-4 sm:p-5" aria-labelledby={`${idPrefix}-title`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id={`${idPrefix}-title`} className="font-serif text-lg leading-tight text-brand-fg">How it arrives</h4>
          <p className="mt-1 flex items-center gap-1.5 font-sans text-[12px] text-brand-muted/75">
            {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            <span aria-live="polite">
              {saving ? 'Saving…' : published ? 'Saved as you pick. Applies to everyone with the link.' : 'Saved as you pick.'}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onPreview}
          className="pressable liquid-glass-raised flex min-h-11 items-center gap-2 rounded-full px-5 font-sans text-[13px] font-semibold text-brand-fg"
        >
          <Eye className="h-4 w-4" aria-hidden /> Preview
        </button>
      </div>

      <div className="flex flex-col gap-6">
        <DesignPicker value={presentation.design} onChange={(design) => onChange({ design })} />
        <RevealPicker
          value={presentation.reveal}
          design={presentation.design}
          unlock={presentation.unlock}
          onDesignOpening={(patch) => onChange(patch)}
          onChange={(reveal) => onChange({ reveal })}
        />
        <div>
          <GroupHeading id={`${idPrefix}-style`} title="Card style" hint="How the messages are laid out" />
          <TemplatePicker
            value={template}
            onChange={onTemplateChange}
            busy={templateBusy}
            defaultId={defaultTemplate}
            idPrefix={`${idPrefix}-tpl`}
          />
        </div>
        {presentation.design === 'none' ? (
          <EmailStylePicker value={presentation.email} onChange={(email) => onChange({ email })} />
        ) : (
          <div>
            <GroupHeading id={`${idPrefix}-email`} title="Email" />
            <p className="font-sans text-[13px] leading-relaxed text-brand-muted/85">
              The email opens on the {cardDesign(presentation.design).label} scene, in its colours. Pick Classic above
              to choose your own style.
            </p>
          </div>
        )}
        {presentation.design === 'none' ? (
          <LookPicker
            value={presentation.look}
            onChange={(look) => onChange({ look })}
            eventAccent={eventAccent}
            eventBg={eventBg}
          />
        ) : (
          <div>
            <GroupHeading id={`${idPrefix}-colours`} title="Colours" />
            <p className="font-sans text-[13px] leading-relaxed text-brand-muted/85">
              Set by the {cardDesign(presentation.design).label} design. Pick Classic above to use your own.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Compact chips — the preview's live option bar                        */
/* ------------------------------------------------------------------ */

export type PreviewAxis = 'design' | 'reveal' | 'template' | 'look';

export const PREVIEW_AXES: readonly { id: PreviewAxis; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'reveal', label: 'Opening' },
  { id: 'template', label: 'Card style' },
  { id: 'look', label: 'Colours' },
];

export function PresentationChips({
  axis, design, reveal, template, look, onDesign, onReveal, onTemplate, onLook,
}: {
  axis: PreviewAxis;
  design: CardDesignChoice;
  reveal: CardRevealId;
  template: string;
  look: CardLookId;
  onDesign: (id: CardDesignChoice) => void;
  onReveal: (id: CardRevealId) => void;
  onTemplate: (id: string) => void;
  onLook: (id: CardLookId) => void;
}) {
  const items: { id: string; label: string; badge?: string }[] =
    axis === 'design'
      ? [{ id: 'none', label: 'Classic' }, ...CARD_DESIGNS.map((d) => ({ id: d.id, label: d.label }))]
      : axis === 'reveal'
      ? CARD_REVEAL_OPTIONS.map((o) => ({ id: o.id, label: o.label, badge: o.tier === 'premium' ? '3D' : undefined }))
      : axis === 'template'
        ? CARD_TEMPLATES.map((t) => ({ id: t.id, label: t.name }))
        : CARD_LOOK_OPTIONS.map((o) => ({ id: o.id, label: o.label }));
  const value = axis === 'design' ? design : axis === 'reveal' ? reveal : axis === 'template' ? template : look;
  const pick = (id: string) => {
    if (axis === 'design') onDesign(id as CardDesignChoice);
    else if (axis === 'reveal') onReveal(id as CardRevealId);
    else if (axis === 'template') onTemplate(id);
    else onLook(id as CardLookId);
  };
  const label = PREVIEW_AXES.find((a) => a.id === axis)?.label ?? '';
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && pick(it.id)}
            className={`pressable flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 font-sans text-[13px] font-medium transition ${
              on ? 'is-selected text-brand-fg' : 'liquid-glass text-brand-muted hover:text-brand-fg'
            }`}
          >
            {it.label}
            {it.badge && (
              <span className="rounded-full bg-white/15 px-1.5 font-sans text-[10px] font-semibold leading-4 text-white">{it.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
