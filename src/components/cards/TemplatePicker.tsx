/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TemplatePicker — how a host chooses the keepsake style.
 *
 * HOST-ONLY on purpose: guests contributing to a card never see this, so a
 * keepsake reads as one designed object instead of a per-contributor mix. It
 * replaces a bare <select> of ids — a host picking "storybook" vs "filmstrip"
 * from a dropdown had no idea what either meant, so the choice was effectively
 * random. Each option shows a miniature of the actual layout.
 *
 * The miniatures are hand-drawn CSS rather than a live render of the template:
 * a real render needs contributions (a brand-new card has none) and would drag
 * media loading into a settings panel. They only have to communicate SHAPE.
 */
import { CARD_TEMPLATES, type CardTemplateDef } from './templates/registry';

/** Miniature of the page shape each template produces. */
function TemplateMini({ id, active }: { id: string; active: boolean }) {
  const ink = active ? 'rgba(var(--accent-rgb),0.85)' : 'rgba(169,180,204,0.4)';
  const soft = active ? 'rgba(var(--accent-rgb),0.28)' : 'rgba(169,180,204,0.16)';

  if (id === 'filmstrip') {
    return (
      <span className="flex h-full w-full items-center justify-center gap-[3px] px-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-[70%] flex-1 rounded-[2px]"
            style={{ background: i === 1 ? ink : soft }}
          />
        ))}
      </span>
    );
  }
  if (id === 'constellation') {
    // Tiles scattered on a sphere, joined by threads of light.
    const stars: Array<[number, number, number]> = [
      [18, 30, 1], [40, 18, 0.8], [62, 34, 1.2], [82, 20, 0.7], [30, 66, 0.9], [56, 72, 1], [78, 60, 0.8],
    ];
    const threads: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 2], [5, 6], [6, 3]];
    return (
      <svg viewBox="0 0 100 90" className="h-full w-full" aria-hidden>
        {threads.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={stars[a][0]}
            y1={stars[a][1]}
            x2={stars[b][0]}
            y2={stars[b][1]}
            stroke={ink}
            strokeWidth="0.8"
            opacity="0.7"
          />
        ))}
        {stars.map(([x, y, k], i) => (
          <rect
            key={i}
            x={x - 5 * k}
            y={y - 6.5 * k}
            width={10 * k}
            height={13 * k}
            rx={2}
            fill={i === 2 ? ink : soft}
            stroke={ink}
            strokeWidth="0.6"
          />
        ))}
      </svg>
    );
  }
  if (id === 'polaroid') {
    // Two tilted prints with wide bottom lips.
    return (
      <span className="relative flex h-full w-full items-center justify-center" aria-hidden>
        {[-9, 7].map((r, i) => (
          <span
            key={r}
            className="absolute h-[78%] w-[30%] rounded-[2px] p-[3px] pb-[9px]"
            style={{ background: i === 1 ? ink : soft, transform: `translateX(${i === 0 ? -22 : 22}%) rotate(${r}deg)` }}
          >
            <span className="block h-full w-full rounded-[1px]" style={{ background: 'rgba(5,6,11,0.55)' }} />
          </span>
        ))}
      </span>
    );
  }
  if (id === 'carousel') {
    // A ring seen at an angle: the front card upright, its neighbours receding.
    return (
      <span className="flex h-full w-full items-end justify-center gap-1 px-2 pb-2" aria-hidden>
        {[0.45, 0.7, 1, 0.7, 0.45].map((h, i) => (
          <span
            key={i}
            className="w-[9px] rounded-[2px]"
            style={{ height: `${h * 70}%`, background: h === 1 ? ink : soft, opacity: 0.35 + h * 0.65 }}
          />
        ))}
      </span>
    );
  }
  // storybook (and any future page-turn style): a spread with a text column.
  return (
    <span className="flex h-full w-full items-center justify-center gap-1.5 px-3" aria-hidden>
      <span className="h-[74%] flex-1 rounded-[3px]" style={{ background: soft }} />
      <span className="flex h-[74%] flex-1 flex-col justify-center gap-[3px]">
        <span className="h-[3px] w-full rounded-full" style={{ background: ink }} />
        <span className="h-[2px] w-[80%] rounded-full" style={{ background: soft }} />
        <span className="h-[2px] w-[60%] rounded-full" style={{ background: soft }} />
      </span>
    </span>
  );
}

export interface TemplatePickerProps {
  value: string;
  onChange: (id: string) => void;
  /** Shown while a change is being saved, to disable double-clicks. */
  busy?: boolean;
  /** Marks one option as the event's default. */
  defaultId?: string;
  idPrefix?: string;
}

export default function TemplatePicker({
  value, onChange, busy = false, defaultId, idPrefix = 'tpl',
}: TemplatePickerProps) {
  return (
    <div role="radiogroup" aria-label="Keepsake style" className="grid grid-cols-2 gap-2.5">
      {CARD_TEMPLATES.map((t: CardTemplateDef) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            id={`${idPrefix}-${t.id}`}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={busy}
            onClick={() => !active && onChange(t.id)}
            className="group flex flex-col gap-2 rounded-2xl p-3 text-left transition-all disabled:opacity-50"
            style={{
              background: active ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${active ? 'rgba(var(--accent-rgb),0.55)' : 'rgba(169,180,204,0.18)'}`,
              boxShadow: active ? '0 0 24px -10px rgba(var(--accent-rgb),0.7)' : 'none',
            }}
          >
            <span
              className="block h-14 w-full overflow-hidden rounded-lg"
              style={{ background: 'rgba(5,6,11,0.5)' }}
            >
              <TemplateMini id={t.id} active={active} />
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="font-serif text-[14px] font-medium"
                style={{ color: active ? 'var(--color-accent)' : 'var(--color-brand-fg)' }}
              >
                {t.name}
              </span>
              {defaultId === t.id && (
                <span className="rounded-full bg-white/10 px-1.5 text-[12px] text-brand-muted/80">Default</span>
              )}
            </span>
            <span className="font-sans text-[12px] leading-snug text-brand-muted/80">{t.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
