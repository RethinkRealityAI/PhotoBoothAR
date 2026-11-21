/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthShell — the frame around the sign-in and sign-up cards: Beamy, large,
 * beside the form on desktop, cycling idle moves and short lines in a speech
 * bubble; on phones a compact peek (small Beamy + one-line bubble) above the
 * form, short enough that the form always starts on the first screen.
 *
 * The form comes first, always: the card renders immediately, the 3D rig is
 * lazy-loaded after the browser goes idle, and a still of Beamy (15 KB webp)
 * holds his place until then, or for good if WebGL is missing, Save-Data is
 * on, or the model fails. Only ONE canvas is ever mounted (desktop hero OR
 * phone peek, never both).
 *
 * Motion (lib/beamyMotion): Beamy's moves and lines are content, so they keep
 * playing under reduced motion, softened (no hops or dances, slower lines,
 * fades instead of pops); decor (the bob, the pointer turn) stops. The lines
 * pause on the desktop pause button, while the tab is hidden, and on phones
 * while a form field has focus (the bubble sits right above it there).
 * Beamy and his bubble are aria-hidden: the page's real content is the form.
 */
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Gift, MonitorPlay, Pause, Play, Sparkles } from 'lucide-react';
import beamyPoster from '../../assets/sales/beamy.webp';
import { BEAMY_LINES, beatClip, beatMs, nextLineIndex, type AuthBeamyPage, type GreeterClip } from '../../lib/authBeamy';
import { motionAttrs } from '../../lib/beamyMotion';
import { canUseWebgl, usePageVisible, usePrefersReducedMotion } from '../../components/wall/wallHooks';

const BeamyActor = lazy(() => import('../../components/beamy/BeamyActor'));

const HERO_COPY: Record<AuthBeamyPage, { title: string; body: string }> = {
  signin: {
    title: 'Welcome back to the booth.',
    body: 'AR filters, 3D props and a live photo wall for your event. All in the browser, no app for your guests.',
  },
  signup: {
    title: 'Your event’s own AR photo booth.',
    body: 'AR filters, 3D props and a live photo wall, all in the browser. Guests scan a code and they’re in.',
  },
};

const FEATURES = [
  { icon: Sparkles, label: 'AR looks & 3D props' },
  { icon: MonitorPlay, label: 'Live photo wall' },
  { icon: Gift, label: 'Digital keepsakes' },
] as const;

/** A missing WebGL context or a failed chunk must never take the form down. */
class Quiet extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function useIsDesktop(): boolean {
  const query = '(min-width: 1024px)';
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

/** Mount the 3D rig only once the page is idle, and only where it can run. */
function useDeferredActor(): boolean {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData === true || !canUseWebgl()) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setGo(true), { timeout: 1200 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setGo(true), 400);
    return () => window.clearTimeout(t);
  }, []);
  return go;
}

interface BeamyFigureProps {
  clip: GreeterClip;
  beat: number;
  mountActor: boolean;
  lookAtPointer: boolean;
  className: string;
  posterClassName: string;
}

/** The still holds his place; the live rig fades in over it once it is ready. */
function BeamyFigure({ clip, beat, mountActor, lookAtPointer, className, posterClassName }: BeamyFigureProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => { setFailed(true); setReady(false); }, []);
  const live = mountActor && !failed;
  return (
    <div className={`relative ${className}`} aria-hidden>
      <img
        src={beamyPoster}
        alt=""
        width={530}
        height={472}
        decoding="async"
        className={`auth-beamy-poster absolute left-1/2 -translate-x-1/2 object-contain transition-opacity duration-500 ${posterClassName}`}
        style={{ opacity: ready ? 0 : 1 }}
      />
      {live && (
        <Quiet onError={onError}>
          <Suspense fallback={null}>
            <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: ready ? 1 : 0 }}>
              <BeamyActor clip={clip} beat={beat} lookAtPointer={lookAtPointer} onReady={() => setReady(true)} onError={onError} />
            </div>
          </Suspense>
        </Quiet>
      )}
    </div>
  );
}

export default function AuthShell({ page, children }: { page: AuthBeamyPage; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const desktop = useIsDesktop();
  const mountActor = useDeferredActor();
  const lines = BEAMY_LINES[page];
  const [index, setIndex] = useState(0);
  const [beat, setBeat] = useState(0);
  const [paused, setPaused] = useState(false);
  const [formFocused, setFormFocused] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const advance = useCallback(() => {
    setIndex((i) => nextLineIndex(i, lines.length));
    setBeat((b) => b + 1);
  }, [lines.length]);

  // He greets on arrival: the first line's wave plays shortly after load.
  useEffect(() => {
    const t = window.setTimeout(() => setBeat((b) => (b === 0 ? 1 : b)), 900);
    return () => window.clearTimeout(t);
  }, []);

  const holding = paused || !visible || (!desktop && formFocused);
  useEffect(() => {
    if (holding) return;
    const id = window.setInterval(advance, beatMs(reduced));
    return () => window.clearInterval(id);
  }, [advance, holding, reduced]);

  const line = lines[index];
  const clip = beatClip(line.clip, reduced);
  const copy = HERO_COPY[page];

  const bubble = (tail: 'down' | 'left', extra: string) => (
    <p
      key={index}
      aria-hidden
      data-tail={tail === 'left' ? 'left' : undefined}
      className={`bw-bubble auth-bubble ${extra}`}
    >
      {line.text}
    </p>
  );

  return (
    <div
      data-auth-shell
      {...motionAttrs(reduced)}
      className="h-full w-full app-bg overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-14 lg:px-10 lg:py-10">
        {desktop && (
          <section className="relative hidden min-w-0 flex-1 flex-col lg:flex">
            <h2 className="font-serif text-[clamp(34px,3.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-brand-fg">
              {copy.title}
            </h2>
            <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-brand-fg/85">{copy.body}</p>

            <div className="relative mt-6 flex h-[min(50vh,440px)] min-h-[300px] flex-col items-center">
              {/* Warm light behind him, so the page is not one flat purple. */}
              <div aria-hidden className="auth-glow pointer-events-none absolute inset-x-[6%] bottom-0 top-[18%]" />
              <div className="relative z-10 flex h-[76px] w-full max-w-[420px] items-end justify-center">
                {bubble('down', 'px-5 py-3 text-center text-[16px]')}
              </div>
              <div
                className="relative mt-3 w-full flex-1 cursor-pointer"
                onClick={advance}
              >
                <BeamyFigure
                  clip={clip}
                  beat={beat}
                  mountActor={mountActor}
                  lookAtPointer={!reduced}
                  className="h-full w-full"
                  posterClassName="bottom-[4%] h-[62%] w-auto"
                />
              </div>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-pressed={paused}
                aria-label={paused ? 'Play Beamy' : 'Pause Beamy'}
                className="absolute bottom-1 right-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-brand-fg/80 backdrop-blur-md transition hover:bg-white/20 hover:text-brand-fg"
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
            </div>

            <ul className="mt-5 flex flex-wrap gap-2.5">
              {FEATURES.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3.5 py-2 text-[14px] text-brand-fg/90 backdrop-blur-md"
                >
                  <Icon className="h-4 w-4 text-[#FFC56B]" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="my-auto flex w-full max-w-md flex-col self-center lg:my-0 lg:w-[440px] lg:max-w-none lg:shrink-0">
          {!desktop && (
            <div className="mb-3 flex h-[96px] items-center gap-1" onClick={advance}>
              <BeamyFigure
                clip={clip}
                beat={beat}
                mountActor={mountActor}
                lookAtPointer={false}
                className="h-[96px] w-[96px] shrink-0"
                posterClassName="bottom-0 h-[78px] w-auto"
              />
              {bubble('left', 'ml-2 min-w-0 flex-1 px-3.5 py-2.5 text-[14px] leading-snug')}
            </div>
          )}
          <div
            ref={formRef}
            onFocus={() => setFormFocused(true)}
            onBlur={(e) => { if (!formRef.current?.contains(e.relatedTarget as Node | null)) setFormFocused(false); }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
