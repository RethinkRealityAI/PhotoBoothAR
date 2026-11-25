/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Put us on the cover": the up-to-three names a magazine cover Frame prints
 * as its cover stars. Asked once when a guest first picks a cover (Skip is
 * remembered); the booth's name chip opens it again to change the names, so
 * the next group on a shared phone can put themselves on it.
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { COVER_MAX_GUESTS, COVER_NAME_MAX, normalizeNames } from '../../lib/cover/spec';

export interface CoverNamesSheetProps {
  /** Names already on the cover (prefilled). */
  initial: readonly string[];
  /** "Wedding cover", for the copy. */
  coverName: string;
  onSave: (names: string[]) => void;
  onSkip: () => void;
}

export default function CoverNamesSheet({ initial, coverName, onSave, onSkip }: CoverNamesSheetProps) {
  const [names, setNames] = useState<string[]>(() => (initial.length > 0 ? [...initial] : ['']));
  const cleaned = normalizeNames(names, COVER_MAX_GUESTS);
  const set = (i: number, v: string) => setNames((n) => n.map((x, j) => (j === i ? v.slice(0, COVER_NAME_MAX) : x)));

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-noir-900/70 backdrop-blur-sm px-4 pb-safe-bottom [--safe-bottom:1.5rem]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-names-title"
        className="w-full max-w-sm liquid-glass rounded-3xl px-6 py-6 text-center"
      >
        <h3 id="cover-names-title" className="font-serif text-2xl text-ivory mb-1">Put yourselves on the cover</h3>
        <p className="font-sans text-[13px] text-champagne/60 leading-relaxed mb-5">
          Up to {COVER_MAX_GUESTS} names, printed big on the {coverName.toLowerCase()}. Skip it and the cover keeps its own headline.
        </p>
        <div className="flex flex-col gap-2.5 mb-4">
          {names.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                autoFocus={i === 0}
                value={n}
                onChange={(e) => set(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && cleaned.length > 0) onSave(cleaned); }}
                placeholder={i === 0 ? 'Your name' : 'Another name'}
                aria-label={`Name ${i + 1}`}
                autoComplete="off"
                className="min-w-0 flex-1 text-center bg-noir-800/70 border border-gold-400/25 rounded-xl px-4 py-3 font-sans text-base text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/60 transition-colors"
              />
              {names.length > 1 && (
                <button
                  type="button"
                  onClick={() => setNames((all) => all.filter((_, j) => j !== i))}
                  aria-label={`Remove name ${i + 1}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-champagne/70 hover:text-ivory"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {names.length < COVER_MAX_GUESTS && (
            <button
              type="button"
              onClick={() => setNames((all) => [...all, ''])}
              className="mx-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 font-sans text-[13px] text-gold-300 hover:text-ivory"
            >
              <Plus className="h-4 w-4" aria-hidden /> Add another name
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 min-h-11 glass rounded-xl px-4 py-3 font-label uppercase tracking-luxe text-[11px] text-champagne/60 hover:text-ivory transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onSave(cleaned)}
            disabled={cleaned.length === 0}
            className="flex-1 min-h-11 bg-foil glow-accent text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 py-3 hover:brightness-110 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Put us on it
          </button>
        </div>
      </div>
    </div>
  );
}
