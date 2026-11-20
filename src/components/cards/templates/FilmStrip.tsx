/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FilmStrip card template — one long reel of frosted film; every
 * contribution is a frame. The Beamwall twist: light runs down the sprocket
 * rails like a projector's beam threading the film, and the frame you are on
 * is lit from its rim.
 *
 * Progress model (see ./types.ts): the whole strip renders unconditionally as
 * a pure function of its props; `index` marks the ACTIVE frame. In the
 * interactive viewer a scroll effect keeps the active frame in view (free
 * scrolling stays available); a frame renderer can ignore that side effect,
 * because the DOM for a given `index` is deterministic.
 */
import { useEffect, useRef } from 'react';
import { clampIndex, type CardTemplateProps } from './types';
import CardOrnament from './cardOrnament';
import { ShimmerRim } from './cardChrome';
import {
  ClosingContent,
  ContributionMedia,
  CoverArch,
  CoverTitle,
  Message,
  NoteCard,
  OpenButton,
  PageMark,
  Pager,
  Signature,
  TiltSheen,
} from './cardParts';

/** Sprocket holes: a repeating gradient — cheap and resolution-independent. */
const RAIL_HOLES: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(to bottom, transparent 0, transparent 8px, rgba(255,255,255,0.16) 8px, rgba(255,255,255,0.16) 20px, transparent 20px)',
  backgroundSize: '12px 28px',
  backgroundRepeat: 'repeat-y',
  backgroundPosition: 'center top',
};

function Rail({ side, reducedMotion }: { side: 'left' | 'right'; reducedMotion: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute top-0 bottom-0 w-7 ${side === 'left' ? 'left-0' : 'right-0'}`}
      style={{
        boxShadow:
          side === 'left'
            ? 'inset -1px 0 0 rgba(255,255,255,0.14)'
            : 'inset 1px 0 0 rgba(255,255,255,0.14)',
      }}
      aria-hidden
    >
      <div className="absolute inset-0" style={RAIL_HOLES} />
      {/* The light threading the film. */}
      <div
        className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, transparent, rgba(var(--accent-rgb),0.95) 45%, rgba(255,226,176,0.95) 52%, transparent)',
          backgroundSize: '100% 22%',
          backgroundRepeat: 'no-repeat',
          filter: 'drop-shadow(0 0 6px rgba(var(--accent-rgb),0.9))',
          opacity: reducedMotion ? 0.45 : 1,
          animation: `bw-reel-run ${reducedMotion ? 22 : 9}s linear ${side === 'left' ? 0 : -4.5}s infinite`,
        }}
      />
    </div>
  );
}

function Frame({
  active,
  reducedMotion,
  frameRef,
  children,
  ornament = false,
  sheen = false,
}: {
  active: boolean;
  reducedMotion: boolean;
  frameRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
  ornament?: boolean;
  sheen?: boolean;
}) {
  return (
    <div
      ref={frameRef}
      className={`relative overflow-hidden rounded-[1.4rem] px-6 py-9 text-center transition-[opacity,box-shadow] ${
        reducedMotion ? '' : 'duration-500'
      } ${active ? 'opacity-100' : 'opacity-75'}`}
      style={{
        background: 'rgba(255,255,255,0.07)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(var(--accent-rgb),0.7), inset 0 1px 0 rgba(255,255,255,0.4), 0 0 46px -8px rgba(var(--accent-rgb),0.55)'
          : 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.18)',
      }}
    >
      {sheen && <TiltSheen reducedMotion={reducedMotion} />}
      {ornament && <CardOrnament density="full" reducedMotion={reducedMotion} />}
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  );
}

export default function FilmStrip({
  card,
  contributions,
  index,
  onNext,
  onPrev,
  reducedMotion = false,
}: CardTemplateProps) {
  const active = clampIndex(index, contributions);
  const total = contributions.length + 2;
  const frameRefs = useRef<(HTMLDivElement | null)[]>([]);
  const interactive = onNext !== undefined || onPrev !== undefined;

  // Interactive convenience only: keep the active frame in view.
  useEffect(() => {
    const el = frameRefs.current[active];
    el?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }, [active, reducedMotion]);

  const setFrameRef = (i: number) => (el: HTMLDivElement | null) => {
    frameRefs.current[i] = el;
  };

  return (
    <div className="relative flex h-full w-full flex-col">
      <style>{'@keyframes bw-reel-run{from{background-position:0 -30%}to{background-position:0 130%}}'}</style>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-1.5" style={{ scrollbarWidth: 'none' }}>
        <div
          className="relative mx-auto min-h-full max-w-[30rem] rounded-[1.8rem] px-9 py-7"
          style={{
            background: 'rgba(36, 32, 112, 0.32)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12), 0 30px 80px -40px rgba(10,8,40,0.9)',
            backdropFilter: 'blur(16px) saturate(125%)',
            WebkitBackdropFilter: 'blur(16px) saturate(125%)',
          }}
        >
          <ShimmerRim radius="1.8rem" lapS={11} reducedMotion={reducedMotion} />
          <Rail side="left" reducedMotion={reducedMotion} />
          <Rail side="right" reducedMotion={reducedMotion} />

          <div className="relative flex flex-col gap-5">
            {/* Cover frame (index 0) */}
            <Frame active={active === 0} reducedMotion={reducedMotion} frameRef={setFrameRef(0)} ornament sheen>
              <div className="py-10">
                <CoverArch
                  card={card}
                  contributions={contributions}
                  reducedMotion={reducedMotion}
                  width="clamp(150px, 42vw, 220px)"
                  className="mb-8"
                />
                <CoverTitle card={card} contributions={contributions} size="md" />
                <div className="mt-7">
                  <OpenButton onClick={onNext} label="Start the reel" reducedMotion={reducedMotion} />
                </div>
              </div>
            </Frame>

            {/* Contribution frames (index 1..N) */}
            {contributions.map((c, i) => (
              <Frame key={c.id} active={active === i + 1} reducedMotion={reducedMotion} frameRef={setFrameRef(i + 1)}>
                <PageMark n={i + 1} of={contributions.length} />
                {c.mediaType === 'text' || !c.url ? (
                  <NoteCard c={c} className="mt-4" />
                ) : (
                  <>
                    <ContributionMedia c={c} reducedMotion={reducedMotion} className="mt-4 aspect-[4/5] w-full" />
                    <Message message={c.message} className="mt-5" />
                    <Signature name={c.contributorName} className="mt-4" />
                  </>
                )}
              </Frame>
            ))}

            {/* End frame (index N+1) */}
            <Frame
              active={active === total - 1}
              reducedMotion={reducedMotion}
              frameRef={setFrameRef(total - 1)}
              ornament
            >
              <div className="py-12">
                <ClosingContent card={card} contributions={contributions} scratch={interactive} />
              </div>
            </Frame>
          </div>
        </div>
      </div>

      {(onPrev || onNext) && (
        <Pager page={active} total={total} onPrev={onPrev} onNext={onNext} noun="frame" className="shrink-0 pb-1 pt-3" />
      )}
    </div>
  );
}
