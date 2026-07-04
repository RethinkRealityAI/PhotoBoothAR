/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FilmStrip card template — a vertical film strip with sprocket-hole rails;
 * every contribution is a frame. Dark, premium, theme-neutral styling.
 *
 * Progress model (see ./types.ts): the whole strip renders unconditionally as
 * a pure function of its props; `index` marks the ACTIVE frame (highlight
 * ring). In the interactive viewer a scroll effect keeps the active frame in
 * view (and free scrolling remains available); a frame renderer can ignore
 * the scroll side-effect entirely and derive its crop from `index` /
 * `frameProgress`, because the DOM output for a given `index` is
 * deterministic.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { clampIndex, type CardTemplateProps } from './types';

/** Sprocket-hole rail as a repeating gradient — cheap and resolution-independent. */
const RAIL_STYLE: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, transparent 0px, transparent 7px, rgba(250,246,239,0.16) 7px, rgba(250,246,239,0.16) 19px, transparent 19px, transparent 26px)',
  backgroundSize: '55% 26px',
  backgroundRepeat: 'repeat-y',
  backgroundPosition: 'center top',
};

function Frame({
  active,
  reducedMotion,
  frameRef,
  children,
}: {
  active: boolean;
  reducedMotion: boolean;
  frameRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={frameRef}
      className={`relative rounded-lg border bg-noir-900/70 px-5 py-6 text-center transition-all ${
        reducedMotion ? '' : 'duration-300'
      } ${active ? 'border-gold-400/60 shadow-[0_0_36px_rgba(212,175,55,0.18)]' : 'border-white/10 opacity-80'}`}
    >
      {children}
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
  const frameRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Interactive convenience only: keep the active frame in view. Static/frame
  // renderers get identical markup without depending on this effect.
  useEffect(() => {
    const el = frameRefs.current[active];
    el?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }, [active, reducedMotion]);

  const setFrameRef = (i: number) => (el: HTMLDivElement | null) => {
    frameRefs.current[i] = el;
  };

  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div className="relative mx-auto max-w-md min-h-full bg-noir-900/90 border-x border-white/10">
        {/* sprocket rails */}
        <div className="absolute left-0 top-0 bottom-0 w-8 border-r border-white/10" style={RAIL_STYLE} aria-hidden />
        <div className="absolute right-0 top-0 bottom-0 w-8 border-l border-white/10" style={RAIL_STYLE} aria-hidden />

        <div className="relative px-12 py-8 flex flex-col gap-6">
          {/* Cover frame (index 0) */}
          <Frame active={active === 0} reducedMotion={reducedMotion} frameRef={setFrameRef(0)}>
            {card.eventName && (
              <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">{card.eventName}</p>
            )}
            <h1 className="mt-3 font-serif italic text-3xl leading-tight text-foil-static">{card.title}</h1>
            {card.recipientName && (
              <p className="mt-3 font-sans text-sm text-brand-muted/80">for {card.recipientName}</p>
            )}
            <p className="mt-5 font-label uppercase tracking-luxe text-[8px] text-brand-muted/50">
              {contributions.length} {contributions.length === 1 ? 'frame' : 'frames'} · scroll the reel
            </p>
          </Frame>

          {/* Contribution frames (index 1..N) */}
          {contributions.map((c, i) => (
            <Frame key={c.id} active={active === i + 1} reducedMotion={reducedMotion} frameRef={setFrameRef(i + 1)}>
              {c.mediaType === 'photo' && c.url && (
                <img
                  src={c.url}
                  alt={c.contributorName ? `From ${c.contributorName}` : 'Contribution'}
                  className="w-full rounded-md object-cover max-h-80"
                  loading="lazy"
                />
              )}
              {c.mediaType === 'video' && c.url && (
                <video src={c.url} controls playsInline preload="metadata" className="w-full rounded-md max-h-80" />
              )}
              {c.message && (
                <p className={`mt-4 font-serif italic leading-relaxed text-brand-fg/90 ${c.mediaType === 'text' ? 'text-lg' : 'text-sm'}`}>
                  “{c.message}”
                </p>
              )}
              <p className="mt-3 font-label uppercase tracking-luxe text-[9px] text-gold-300/80">
                — {c.contributorName || 'A friend'}
              </p>
            </Frame>
          ))}

          {/* End frame (index N+1) */}
          <Frame
            active={active === contributions.length + 1}
            reducedMotion={reducedMotion}
            frameRef={setFrameRef(contributions.length + 1)}
          >
            <p className="font-serif italic text-2xl text-foil-static">Fin.</p>
            <p className="mt-4 font-label uppercase tracking-luxe text-[8px] text-brand-muted/50">Made with Beamwall</p>
            <Link
              to="/"
              className="mt-4 inline-block rounded-full border border-white/15 bg-white/[0.05] px-5 py-2 font-label uppercase tracking-luxe text-[9px] text-brand-fg hover:bg-white/[0.1] transition"
            >
              Create your own
            </Link>
          </Frame>
        </div>
      </div>

      {/* Interactive step buttons (optional) */}
      {(onPrev || onNext) && (
        <div className="pointer-events-none sticky bottom-4 flex justify-center gap-3">
          {onPrev && (
            <button
              onClick={onPrev}
              disabled={active === 0}
              className="pointer-events-auto rounded-full bg-black/60 border border-white/15 px-4 py-2 font-label uppercase tracking-luxe text-[9px] text-brand-fg disabled:opacity-30"
            >
              Prev frame
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              disabled={active === contributions.length + 1}
              className="pointer-events-auto rounded-full bg-black/60 border border-white/15 px-4 py-2 font-label uppercase tracking-luxe text-[9px] text-brand-fg disabled:opacity-30"
            >
              Next frame
            </button>
          )}
        </div>
      )}
    </div>
  );
}
