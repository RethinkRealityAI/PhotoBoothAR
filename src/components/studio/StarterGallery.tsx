/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StarterGallery — the studio's empty state.
 *
 * What used to be here: a single chip reading "Add a frame or sticker", shown
 * only when the scene had no overlays AND no filter — a condition a brand-new
 * draft never meets, because initialDraft('shader') pre-fills the filter slot.
 * So in practice a first-time host opened onto a bare camera feed with no
 * guidance at all, and the quickest route to something that looked designed was
 * the AI Director, i.e. spending credits before seeing a single result.
 *
 * Now: shipped starter scenes, one click each, composed entirely from assets
 * already bundled in the app (see src/lib/studio/starterScenes.ts) — zero
 * credits, zero network. The "add something yourself" path is kept right beside
 * them for the host who already knows what they want.
 */
import { useReducedMotion } from 'motion/react';
import { Plus, Sparkles } from 'lucide-react';
import { STARTER_SCENES, buildStarterDraft } from '../../lib/studio/starterScenes';
import type { StudioDraft } from '../../lib/studio/state';

interface Props {
  /** Receives a complete, unsaved draft to LOAD. */
  onPick: (draft: StudioDraft) => void;
  /** Opens the Assets dock (a drawer below lg) for the build-it-yourself path. */
  onOpenAssets?: () => void;
}

export default function StarterGallery({ onPick, onOpenAssets }: Props) {
  const reduced = useReducedMotion() ?? false;

  return (
    <div
      data-testid="studio-starter-gallery"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-3 sm:p-5 overflow-y-auto hide-scrollbar"
    >
      {/* A scrim, because this sits directly on the LIVE CAMERA. Without it the
          copy and the card blurbs have to survive whatever the host's room
          happens to look like — a bright window turns the whole gallery
          unreadable. Purely presentational, so it never eats a click. */}
      <div className="absolute inset-0 bg-brand-bg/75 backdrop-blur-[2px] pointer-events-none" aria-hidden />

      <div className="relative w-full max-w-[22rem] flex flex-col gap-2.5">
        <div className="text-center">
          <p className="font-label text-[9px] uppercase tracking-widest text-accent-2 flex items-center justify-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Start with a look
          </p>
          <p className="font-sans text-[11px] text-brand-muted/60 leading-snug mt-1 px-2">
            Ready-made scenes built from the studio library. Free, instant, and yours to change.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {STARTER_SCENES.map((s, i) => {
            const draft = buildStarterDraft(s.id);
            // A preset whose assets somehow did not resolve is hidden rather
            // than offered as a card that loads an empty scene.
            if (!draft) return null;
            return (
              <button
                key={s.id}
                onClick={() => onPick(draft)}
                title={s.blurb}
                className="pressable group relative text-left rounded-xl overflow-hidden liquid-glass-raised border border-white/10 hover:border-accent/40 transition-colors"
                style={reduced ? undefined : { animation: `rise-in 320ms ${i * 40}ms both` }}
              >
                <div
                  className="h-11 w-full"
                  style={{ background: `linear-gradient(135deg, ${s.swatch[0]} 0%, ${s.swatch[1]} 100%)` }}
                  aria-hidden
                />
                <div className="px-2 py-1.5">
                  <p className="font-sans text-[11px] font-medium text-brand-fg truncate group-hover:text-accent-2 transition-colors">
                    {s.name}
                  </p>
                  <p className="font-sans text-[9px] text-brand-muted/50 leading-tight line-clamp-2">{s.blurb}</p>
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={onOpenAssets}
          className="pressable flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[10px] font-label uppercase tracking-widest text-brand-muted/60 hover:text-brand-fg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Or build your own
        </button>
      </div>
    </div>
  );
}
