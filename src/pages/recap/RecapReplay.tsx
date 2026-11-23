/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Relive the night" — the live wall filling up again, in the real order the
 * photos arrived, with the night's hours compressed into ~15–20 seconds.
 *
 * All the time maths (ordering, compression, the clock, the busiest window,
 * which posts get a tile) is in the pure lib/recapReplay.ts. This component
 * only paints it, and it is built to stay cheap on a 400-photo night:
 *   • TILES ARE CAPPED (24 on a phone, 40 wider) and evenly sampled across the
 *     night; the counter still counts every post.
 *   • Thumbnails are the same 160px renditions the hero and intro already
 *     fetched — the browser cache serves most of them.
 *   • The rAF loop writes to the DOM directly (clock text, counter text, a
 *     class on each tile as it lands, one scaleX on the progress bar). React
 *     renders twice per play: at the start and at the end.
 *
 * REDUCED MOTION gets no playback at all: a static summary of the same data
 * (the timeline as bars, first and last photo times, the busiest moment).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, Sparkles } from 'lucide-react';
import type { Post } from '../../types';
import {
  buildReplay,
  clockAt,
  countAt,
  formatClock,
  peakLine,
  replayTiles,
  timelineBuckets,
} from '../../lib/recapReplay';
import PostImage from '../../components/ui/PostImage';
import { K_BODY, K_EYEBROW, K_GLASS, K_H2 } from './recapStyles';

const BUCKETS = 36;

export default function RecapReplay({ posts, reducedMotion }: { posts: readonly Post[]; reducedMotion: boolean }) {
  const plan = useMemo(() => buildReplay(posts), [posts]);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const tiles = useMemo(() => replayTiles(plan, narrow ? 24 : 40), [plan, narrow]);
  const buckets = useMemo(() => timelineBuckets(plan, BUCKETS), [plan]);
  const maxBucket = Math.max(1, ...buckets);
  const peak = peakLine(plan.peak);

  const [phase, setPhase] = useState<'idle' | 'playing' | 'ended'>('idle');
  const stageRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  function play() {
    const stage = stageRef.current;
    if (stage === null) return;
    cancelAnimationFrame(rafRef.current);
    const tileEls = Array.from(stage.querySelectorAll<HTMLElement>('[data-replay-tile]'));
    tileEls.forEach((el) => el.classList.remove('is-in'));
    stage.classList.remove('is-peak');
    setPhase('playing');
    let next = 0;
    let lastClock = '';
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = now - t0;
      const clock = formatClock(clockAt(plan, t));
      if (clock !== lastClock && clockRef.current !== null) {
        clockRef.current.textContent = clock;
        lastClock = clock;
      }
      if (countRef.current !== null) countRef.current.textContent = countAt(plan, t).toLocaleString('en-US');
      while (next < tiles.length && tiles[next].at <= t) {
        tileEls[next]?.classList.add('is-in');
        next++;
      }
      const f = plan.durationMs > 0 ? Math.min(1, t / plan.durationMs) : 1;
      if (barRef.current !== null) barRef.current.style.transform = `scaleX(${f})`;
      if (headRef.current !== null) headRef.current.style.left = `${f * 100}%`;
      const c = clockAt(plan, t);
      stage.classList.toggle('is-peak', plan.peak !== null && c >= plan.peak.start && c < plan.peak.end);
      if (t < plan.durationMs + 400) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stage.classList.remove('is-peak');
        tileEls.forEach((el) => el.classList.add('is-in'));
        setPhase('ended');
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  const first = formatClock(plan.start);
  const last = formatClock(plan.end);
  const total = plan.moments.length;

  return (
    <section
      data-reveal
      aria-labelledby="recap-replay-title"
      className={`flex flex-col gap-5 rounded-[2rem] p-4 sm:p-7 ${K_GLASS}`}
    >
      <style>{REPLAY_CSS}</style>
      <header className="flex flex-col gap-1.5 px-1">
        <p className={K_EYEBROW}>Relive the night</p>
        <h2 id="recap-replay-title" className={K_H2}>Watch the wall fill up</h2>
        <p className={`${K_BODY} max-w-md`}>
          {first === last
            ? `Every moment from ${first}, in the order it happened.`
            : `${first} to ${last}, replayed in the order every photo landed on the wall.`}
        </p>
      </header>

      {/* The stage — fixed aspect so nothing below moves while it plays. */}
      <div
        ref={stageRef}
        className="replay-stage relative overflow-hidden rounded-[1.5rem] border border-[color:var(--k-line)] bg-[color:var(--k-bg)] aspect-[4/5] sm:aspect-[16/9]"
        data-phase={phase}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(80% 60% at 50% 0%, rgba(var(--k-accent-rgb),0.18), transparent 70%)' }} />

        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4 sm:p-5">
          <div className="flex flex-col">
            <span className="font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-muted)]">Time</span>
            <span ref={clockRef} className="font-serif italic text-3xl tabular-nums leading-none text-[color:var(--k-ink)] sm:text-5xl" aria-live="off">
              {phase === 'idle' ? first : last}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-muted)]">On the wall</span>
            <span className="font-serif italic text-3xl tabular-nums leading-none text-[color:var(--k-accent-text)] sm:text-5xl">
              <span ref={countRef}>{phase === 'idle' ? '0' : total.toLocaleString('en-US')}</span>
            </span>
          </div>
        </div>

        <ul
          aria-hidden
          className={`absolute inset-x-3 bottom-5 top-[5.75rem] grid grid-rows-4 gap-1.5 sm:inset-x-5 sm:top-[7.75rem] sm:gap-2 ${narrow ? 'grid-cols-6' : 'grid-cols-10'}`}
        >
          {tiles.map((m) => {
            const p = m.post as Post;
            return (
              <li key={p.id} data-replay-tile className={`replay-tile relative min-h-0 overflow-hidden rounded-md sm:rounded-lg ${reducedMotion || phase === 'ended' ? 'is-in' : ''}`}>
                {p.media_type === 'video' ? (
                  <span className="block h-full w-full bg-[linear-gradient(135deg,rgba(var(--k-accent-rgb),0.5),rgba(var(--k-glow-rgb),0.35))]" />
                ) : (
                  <PostImage src={p.image_url} alt="" displayWidth={160} className="h-full w-full object-cover" />
                )}
              </li>
            );
          })}
        </ul>

        <div className="absolute inset-x-0 bottom-0 h-1 bg-[rgba(var(--k-ink-rgb),0.08)]">
          <div ref={barRef} className="h-full origin-left bg-[color:var(--k-accent)]" style={{ transform: `scaleX(${phase === 'idle' ? 0 : 1})` }} />
        </div>

        {!reducedMotion && phase !== 'playing' && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[rgba(var(--k-bg-rgb),0.55)] px-6 text-center backdrop-blur-[2px]">
            {phase === 'ended' && peak !== null && (
              <div className="flex flex-col items-center gap-1 animate-rise-in">
                <span className="inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-accent-text)]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> Busiest moment
                </span>
                <span className="font-serif italic text-2xl leading-tight text-[color:var(--k-ink)] sm:text-4xl">{peak}</span>
              </div>
            )}
            <button
              type="button"
              onClick={play}
              className="mt-1 inline-flex min-h-14 items-center gap-2.5 rounded-full bg-[color:var(--k-accent)] px-7 font-label uppercase tracking-luxe text-[11px] text-[color:var(--k-on-accent)] shadow-[0_16px_44px_-14px_rgba(var(--k-accent-rgb),0.95)] transition hover:brightness-110 active:scale-[0.98]"
            >
              {phase === 'ended' ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {phase === 'ended' ? 'Replay' : 'Relive the night'}
            </button>
            {phase === 'idle' && (
              <span className="font-sans text-xs text-[color:var(--k-muted)]">
                {total.toLocaleString('en-US')} moments · {Math.round(plan.durationMs / 1000)} seconds
              </span>
            )}
          </div>
        )}
      </div>

      {/* The timeline — the whole night as bars. Also the reduced-motion summary. */}
      <div className="flex flex-col gap-2 px-1">
        <div className="relative flex h-14 items-end gap-[2px]" role="img" aria-label={`Photos over the night, from ${first} to ${last}${peak !== null ? `. Busiest: ${peak}` : ''}`}>
          {buckets.map((c, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-sm bg-[rgba(var(--k-accent-rgb),0.55)]"
              style={{ height: `${c === 0 ? 4 : 12 + (c / maxBucket) * 88}%`, opacity: c === 0 ? 0.35 : 1 }}
            />
          ))}
          {!reducedMotion && (
            <div ref={headRef} aria-hidden className="pointer-events-none absolute bottom-0 top-0 w-px bg-[color:var(--k-ink)]" style={{ left: phase === 'idle' ? '0%' : '100%', opacity: phase === 'idle' ? 0 : 0.8 }} />
          )}
        </div>
        <div className="flex justify-between font-sans text-[11px] tabular-nums text-[color:var(--k-muted)]">
          <span>{first}</span>
          {peak !== null && reducedMotion && (
            <span className="text-[color:var(--k-ink)]">Busiest: {peak}</span>
          )}
          <span>{last}</span>
        </div>
      </div>
    </section>
  );
}

const REPLAY_CSS = `
.replay-tile { opacity: 0; transform: translateY(14px) scale(0.6); transition: opacity 380ms ease-out, transform 520ms cubic-bezier(.2,1.4,.4,1); box-shadow: 0 6px 16px -8px rgba(0,0,0,0.7); }
.replay-tile.is-in { opacity: 1; transform: none; }
.replay-tile::after { content: ''; position: absolute; inset: 0; transform: scaleY(0); transform-origin: 50% 100%; opacity: 0; pointer-events: none;
  background: linear-gradient(to top, rgba(255,255,255,0.95), rgba(var(--k-accent-rgb),0.6) 45%, transparent); }
.replay-stage[data-phase="playing"] .replay-tile.is-in::after { animation: replay-beam 520ms ease-out; }
@keyframes replay-beam { 0% { opacity: 0.95; transform: scaleY(1); } 100% { opacity: 0; transform: scaleY(0.15); } }
.replay-stage { transition: box-shadow 400ms ease; }
.replay-stage.is-peak { box-shadow: inset 0 0 0 1px rgba(var(--k-glow-rgb),0.7), 0 0 60px -10px rgba(var(--k-glow-rgb),0.6); }
@media (prefers-reduced-motion: reduce) { .replay-tile { transition: none; } .replay-tile::after { display: none; } }
`;
