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
import { useState } from 'react';
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
  /** Previews that failed to load — the card falls back to its swatch gradient
   *  rather than showing a broken-image glyph over the live camera. */
  const [broken, setBroken] = useState<Record<string, true>>({});

  return (
    <div
      data-testid="studio-starter-gallery"
      // Vertical padding clears the stage's own floating chrome: the
      // 2D/3D/Preview switcher rides the top band and the tracker/camera
      // status chips ride the bottom one, and at phone height they landed on
      // top of this gallery's header and its last row of cards.
      // `m-auto` on the inner block rather than `justify-center` here: a
      // centred flex child that outgrows its scroll container has its overflow
      // clipped at the TOP, which on a phone hid the gallery's own heading
      // behind the stage's mode switcher. Auto margins centre it when it fits
      // and leave it scrollable from the top when it does not.
      className="absolute inset-0 z-10 flex flex-col items-center gap-2 overflow-y-auto hide-scrollbar px-3 pb-14 pt-12 sm:px-5"
    >
      {/* A scrim, because this sits directly on the LIVE CAMERA. Without it the
          copy and the card blurbs have to survive whatever the host's room
          happens to look like — a bright window turns the whole gallery
          unreadable. Purely presentational, so it never eats a click. */}
      <div className="absolute inset-0 bg-brand-bg/75 backdrop-blur-[2px] pointer-events-none" aria-hidden />

      <div className="relative m-auto w-full max-w-[22rem] sm:max-w-[24rem] flex flex-col gap-2.5">
        <div className="text-center">
          <p className="font-label text-[9px] uppercase tracking-widest text-accent-2 flex items-center justify-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Start with a look
          </p>
          {/* One line on purpose: at phone height every wrapped line of this
              paragraph costs a row of cards its place on screen. */}
          <p className="font-sans text-[11px] text-brand-muted/60 leading-snug mt-1 px-2">
            Each card is a real shot from that scene.
          </p>
        </div>

        {/* Three columns of 9:16 cards: the booth's own format, so a card
            previews the actual output shape, and all seven looks fit without
            scrolling on a phone-sized stage. The build-your-own tile fills the
            last row's remaining span, so the grid closes as a rectangle. */}
        <div className="grid grid-cols-3 gap-1">
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
                aria-label={`${s.name} — ${s.blurb}`}
                className="pressable group relative aspect-[9/16] overflow-hidden rounded-xl border border-white/10 hover:border-accent/50 transition-colors"
                style={{
                  // Doubles as the loading tint and the fallback if the preview
                  // ever fails: the card is never a blank hole.
                  background: `linear-gradient(135deg, ${s.swatch[0]} 0%, ${s.swatch[1]} 100%)`,
                  ...(reduced ? {} : { animation: `rise-in 320ms ${i * 40}ms both` }),
                }}
              >
                {!broken[s.id] && (
                  <img
                    src={s.preview}
                    alt=""
                    decoding="async"
                    onError={() => setBroken((b) => ({ ...b, [s.id]: true }))}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1.5 pb-1.5 pt-6">
                  <p className="truncate text-left font-sans text-[10px] font-medium leading-tight text-white">
                    {s.name}
                  </p>
                </div>
              </button>
            );
          })}

          <button
            onClick={onOpenAssets}
            // self-center + a fixed height: left to stretch it inherited the
            // 9:16 row height and read as a giant empty panel next to the
            // cards, rather than the secondary action it is.
            className="pressable col-span-2 flex h-12 items-center justify-center gap-1.5 self-center rounded-xl border border-dashed border-white/15 bg-white/[0.04] text-[10px] font-label uppercase tracking-widest text-brand-muted/60 transition-colors hover:bg-white/[0.08] hover:text-brand-fg"
          >
            <Plus className="w-3.5 h-3.5" /> Or build your own
          </button>
        </div>
      </div>
    </div>
  );
}
