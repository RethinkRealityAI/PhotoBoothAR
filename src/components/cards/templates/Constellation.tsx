/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Constellation card template — every photo and video floating in 3D around
 * you, joined by threads of light like a star map. Drag to explore, tap one
 * to bring it close.
 *
 * Progress model (see ./types.ts): a PURE function of `index`.
 *   0       = the overview, the title floating at the centre of the stars
 *   1..N    = the camera flies to contribution N-1; its words in a caption
 *   N + 1   = the closing overview, everyone named at the centre
 * Tapping a tile stays inside that contract: it calls onNext/onPrev as many
 * times as it takes to reach that tile's index, so the viewer's `index`
 * remains the one source of truth (and the pager agrees with the camera).
 *
 * The scene (constellationScene.tsx: three.js via R3F) is React.lazy-loaded,
 * so cards in any other style never download it. No WebGL — or a context
 * that dies and does not come back — renders the Storybook pages instead,
 * so the keepsake always opens.
 */
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { hasWebGL } from '../../carousel/PhotoCarousel';
import { clampIndex, pageCount, type CardTemplateProps } from './types';
import Storybook from './Storybook';
import { ShimmerRim } from './cardChrome';
import { readCardPalette, type NotePalette } from './noteCanvas';
import {
  ClosingContent,
  CoverTitle,
  Message,
  OpenButton,
  PageMark,
  Pager,
  Signature,
} from './cardParts';

const ConstellationScene = lazy(() => import('./constellationScene'));

export default function Constellation(props: CardTemplateProps) {
  const { card, contributions, index, onNext, onPrev, reducedMotion = false } = props;
  const total = pageCount(contributions);
  const page = clampIndex(index, contributions);
  const isCover = page === 0;
  const isEnd = page === total - 1;
  const focus = !isCover && !isEnd ? page - 1 : null;
  const active = focus === null ? null : contributions[focus];
  const interactive = onNext !== undefined || onPrev !== undefined;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [palette, setPalette] = useState<NotePalette | null>(null);
  const [failed, setFailed] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [soundOn, setSoundOn] = useState(false);

  // The live semantic tokens at this element — the event look repaints the
  // stars, threads and notes without a code path of its own.
  useLayoutEffect(() => {
    setPalette(readCardPalette(rootRef.current));
  }, []);

  // A new page starts silent.
  useEffect(() => setSoundOn(false), [page]);

  const onVideo = useCallback((el: HTMLVideoElement | null) => setVideo(el), []);
  const onFail = useCallback(() => setFailed(true), []);

  // Tap → walk the index there through the contract's own handlers.
  const pageRef = useRef(page);
  pageRef.current = page;
  const onSelect = useCallback(
    (i: number) => {
      const steps = i + 1 - pageRef.current;
      for (let k = 0; k < Math.abs(steps); k++) {
        if (steps > 0) onNext?.();
        else onPrev?.();
      }
    },
    [onNext, onPrev],
  );

  const toggleSound = () => {
    if (video === null) return;
    if (soundOn) {
      video.muted = true;
      setSoundOn(false);
      return;
    }
    video.muted = false;
    video.currentTime = 0;
    void video
      .play()
      .then(() => setSoundOn(true))
      .catch(() => {
        video.muted = true;
      });
  };

  if (failed || !hasWebGL() || contributions.length === 0) return <Storybook {...props} />;

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      {/* The scene, edge to edge (past the reading column's padding). */}
      <div className="absolute -inset-x-3 -top-3 bottom-0 sm:-inset-x-6">
        <Suspense
          fallback={
            <div
              className="h-full w-full"
              style={{ background: 'radial-gradient(40% 30% at 50% 50%, rgba(var(--accent-rgb),0.25), transparent 70%)' }}
            />
          }
        >
          {palette !== null && (
            <ConstellationScene
              contributions={contributions}
              focus={focus}
              palette={palette}
              reducedMotion={reducedMotion}
              onSelect={onSelect}
              onVideo={onVideo}
              onFail={onFail}
            />
          )}
        </Suspense>
      </div>

      {/* DOM layer: copy and controls. pointer-events-none so the scene stays
          draggable; the interactive bits opt back in. */}
      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col items-center px-1 pb-1 text-center">
        <div className="flex min-h-[2.75rem] items-center">
          {focus !== null ? (
            <PageMark n={focus + 1} of={contributions.length} />
          ) : (
            isCover && <p className="text-[12px] text-brand-fg/60">Drag to explore · tap a photo to bring it close</p>
          )}
        </div>

        <div className="flex w-full flex-1 items-center justify-center">
          {isCover && (
            <div className="relative px-2">
              {/* A pool of shade behind the title so it reads over the tiles. */}
              <div
                className="pointer-events-none absolute -inset-x-10 -inset-y-12"
                style={{
                  background:
                    'radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, var(--color-brand-bg) 85%, transparent), transparent 75%)',
                }}
                aria-hidden
              />
              <div className="relative">
                <CoverTitle card={card} contributions={contributions} size="md" />
              </div>
            </div>
          )}
          {isEnd && (
            <div className="liquid-glass pointer-events-auto w-full max-w-md rounded-[1.8rem] px-6 py-8">
              <ShimmerRim radius="1.8rem" lapS={9} reducedMotion={reducedMotion} />
              <ClosingContent card={card} contributions={contributions} scratch={interactive} />
            </div>
          )}
        </div>

        <div className="flex w-full flex-col items-center gap-3">
          {isCover && (
            <div className="pointer-events-auto">
              <OpenButton onClick={onNext} label="Fly through the stars" reducedMotion={reducedMotion} />
            </div>
          )}
          {active && (
            <div className="liquid-glass pointer-events-auto w-full max-w-md rounded-[1.6rem] px-5 py-4">
              <ShimmerRim radius="1.6rem" lapS={9} reducedMotion={reducedMotion} />
              {/* A written note is painted on its tile in full; repeat only the signature. */}
              {active.mediaType !== 'text' && <Message message={active.message} />}
              <div className={`${active.mediaType !== 'text' ? 'mt-2' : ''} flex items-center justify-center gap-3`}>
                <Signature name={active.contributorName} />
                {active.mediaType === 'video' && video !== null && (
                  <button
                    type="button"
                    onClick={toggleSound}
                    aria-pressed={soundOn}
                    className="bw-cta relative inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[13px] font-medium text-brand-fg"
                    style={{
                      background: 'rgba(var(--accent-rgb),0.18)',
                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35), 0 0 18px -6px rgba(var(--accent-rgb),0.9)',
                    }}
                  >
                    {soundOn ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
                    {soundOn ? 'Mute' : 'Play with sound'}
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="pointer-events-auto">
            <Pager page={page} total={total} onPrev={onPrev} onNext={onNext} />
          </div>
        </div>
      </div>
    </div>
  );
}
