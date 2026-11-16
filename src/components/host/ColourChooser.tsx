/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ColourChooser — the event colour: curated swatches (a custom colour leads
 * the row so the current pick is always visibly selected), a free colour
 * picker, "Keep the style's colours", and the instant, free "Build a whole
 * look from my colour" switch (themeDerive.deriveTheme — no AI call).
 */
import { Check, Palette } from 'lucide-react';
import { accentOptionsFor } from '../../lib/eventDesigner';
import { normalizeHex } from '../../lib/themeDerive';

interface Props {
  accent: string | null;
  onAccent: (hex: string | null) => void;
  derivedLook: boolean;
  onDerivedLook: (on: boolean) => void;
  label?: string;
}

export default function ColourChooser({ accent, onAccent, derivedLook, onDerivedLook, label = 'Colour' }: Props) {
  const current = normalizeHex(accent);
  const options = accentOptionsFor(current);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-label uppercase tracking-luxe ui-caption text-brand-muted/70">{label}</legend>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label}>
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          onClick={() => onAccent(null)}
          className={`inline-flex min-h-[44px] items-center rounded-full border px-3 text-[12px] transition ${
            current === null ? 'border-[color:var(--color-accent)] text-brand-fg' : 'border-white/10 text-brand-muted hover:text-brand-fg'
          }`}
        >
          Style’s colours
        </button>
        {options.map((hex) => {
          const on = hex.toUpperCase() === current;
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`Colour ${hex}`}
              onClick={() => onAccent(hex)}
              className={`relative grid h-11 w-11 place-items-center rounded-full border-2 transition ${on ? 'border-white' : 'border-transparent hover:border-white/40'}`}
            >
              <span className="h-8 w-8 rounded-full" style={{ background: hex }} aria-hidden />
              {on && <Check className="absolute h-4 w-4 text-white drop-shadow" aria-hidden />}
            </button>
          );
        })}
        <label className="relative grid h-11 w-11 cursor-pointer place-items-center rounded-full border-2 border-dashed border-white/25 hover:border-white/50" title="Any colour">
          <Palette className="h-4 w-4 text-brand-muted" aria-hidden />
          <span className="sr-only">Pick any colour</span>
          <input
            type="color"
            value={(current ?? '#D4AF37').toLowerCase()}
            onChange={(e) => onAccent(normalizeHex(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <label className={`flex min-h-[44px] items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2 ${current ? 'cursor-pointer' : 'opacity-50'}`}>
        <input
          type="checkbox"
          checked={derivedLook && current !== null}
          disabled={current === null}
          onChange={(e) => onDerivedLook(e.target.checked)}
          className="h-5 w-5 accent-[color:var(--color-accent)]"
        />
        <span className="font-sans ui-caption leading-relaxed text-brand-muted/80">
          <span className="text-brand-fg">Build a whole look from my colour.</span> Backgrounds and text are made to match — always readable, instant and free.
        </span>
      </label>
    </fieldset>
  );
}
