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
import { buildStarterDraft, offeredStarterScenes, starterPropUrl } from '../../lib/studio/starterScenes';
import { preloadModel } from '../../lib/glbCache';
import type { StudioDraft } from '../../lib/studio/state';

/**
 * Warm a scene's bundled GLB prop through the SHARED cache, so the piece is
 * already decoded when the draft mounts it. Without this the host picks a look
 * and watches a head with nothing on it for as long as the fetch takes — the
 * Model component renders null until its load resolves, with no spinner of its
 * own. Fire-and-forget: a failed warm just means the normal load path runs.
 */
function warmProp(url: string | null) {
  if (!url) return;
  void preloadModel(url).catch(() => {});
}

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
      <div className="absolute inset-0 bg-brand-bg/80 backdrop-blur-md pointer-events-none" aria-hidden />

      <div className="relative m-auto w-full max-w-[22rem] sm:max-w-[24rem] flex flex-col gap-3">
        <div className="flex items-center gap-2.5 px-0.5">
          <span className="rim-glint flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-2" aria-hidden>
            <Sparkles className="w-4 h-4" />
          </span>
          {/* One line each on purpose: at phone height every wrapped line here
              costs a row of cards its place on screen. */}
          <div className="min-w-0 text-left">
            <h2 className="font-serif text-[17px] leading-tight text-brand-fg">Start with a look</h2>
            <p className="font-sans text-[12px] text-brand-muted/80 leading-snug truncate">
              Free and ready to go. Tap one, then make it yours.
            </p>
          </div>
        </div>

        {/* Three columns of 9:16 cards: the booth's own format, so a card
            previews the actual output shape, and all seven looks fit without
            scrolling on a phone-sized stage. The build-your-own tile fills the
            last row's remaining span, so the grid closes as a rectangle. */}
        <div className="grid grid-cols-3 gap-2">
          {offeredStarterScenes().map((s, i) => {
            const draft = buildStarterDraft(s.id);
            // A preset whose assets somehow did not resolve is hidden rather
            // than offered as a card that loads an empty scene.
            if (!draft) return null;
            return (
              <button
                key={s.id}
                onClick={() => { warmProp(starterPropUrl(s)); onPick(draft); }}
                // Hover/touch-start is the earliest honest signal of intent, and
                // buys the fetch a head start before the click commits.
                onPointerEnter={() => warmProp(starterPropUrl(s))}
                title={s.blurb}
                aria-label={`${s.name} — ${s.blurb}`}
                className="rim-glint pressable group relative aspect-[9/16] overflow-hidden rounded-2xl shadow-[0_14px_28px_-16px_rgba(10,8,40,0.8)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
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
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-2 pt-8">
                  <p className="truncate text-left font-sans text-[12px] font-semibold leading-tight text-white">
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
            className="glass pressable col-span-2 flex min-h-12 items-center justify-center gap-1.5 self-center rounded-2xl text-[13px] font-medium text-brand-fg/90 transition-colors hover:text-brand-fg"
          >
            <Plus className="w-3.5 h-3.5" /> Or build your own
          </button>
        </div>
      </div>
    </div>
  );
}
