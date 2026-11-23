/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The album's tap-to-open layer: mounts ONE reveal full-screen above the
 * album, with a Skip button always on top, and hands off.
 *
 *   • 'beam' is the album's own (BeamReveal.tsx). Every other id is a CARD
 *     reveal (src/components/cards/reveals, through its registry — never
 *     forked) fed by the pure adapter in lib/recapReveal.ts: the event's name
 *     as the card's title, the album's stills as its photos, the keepsake
 *     theme as its palette, nobody addressed by name.
 *   • The album is mounted underneath but INERT while this is up — it holds no
 *     WebGL, so a three.js reveal is still the only GPU context on the page,
 *     and the beam can measure the hero it lands on.
 *   • NEVER A BLANK PAGE: a reveal chunk that fails to load (or throws while
 *     rendering) hands off at once; one that has not loaded within
 *     RECAP_REVEAL_LOAD_DEADLINE_MS, or was tapped and has not called onDone
 *     within RECAP_REVEAL_DONE_DEADLINE_MS, hands off anyway.
 *   • After hand-off the layer fades over RECAP_REVEAL_FADE_MS and unmounts at
 *     RECAP_REVEAL_HANDOFF_MS (`onGone`).
 */
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Post } from '../../types';
import type { KeepsakeThemeOption } from '../../lib/keepsakeSettings';
import {
  RECAP_REVEAL_DONE_DEADLINE_MS,
  RECAP_REVEAL_FADE_MS,
  RECAP_REVEAL_HANDOFF_MS,
  RECAP_REVEAL_LOAD_DEADLINE_MS,
  recapRevealCard,
  recapRevealPalette,
  type RecapPlayableReveal,
} from '../../lib/recapReveal';
import { revealComponent } from '../../components/cards/reveals/registry';
import type { HeroLanding } from './BeamReveal';

const BeamReveal = lazy(() => import('./BeamReveal'));

/** How the reveal ended: it played to the end, the guest skipped, or it broke. */
export type RevealEnd = 'landed' | 'skipped' | 'failed';

let webglOk: boolean | null = null;
/**
 * Same probe as the carousel's hasWebGL (components/carousel/PhotoCarousel),
 * kept here because importing that module would pull three.js into the album
 * chunk. Cached: the answer cannot change during a visit.
 */
export function hasWebGL(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement('canvas');
    webglOk = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

/** A reveal that throws while rendering must not take the album with it. */
class RevealBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[recap] reveal failed; showing the album', error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Suspense fallback: gives up on a chunk that never arrives. */
function LoadWatch({ onTimeout }: { onTimeout: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onTimeout, RECAP_REVEAL_LOAD_DEADLINE_MS);
    return () => window.clearTimeout(t);
  }, [onTimeout]);
  return null;
}

export interface RecapRevealProps {
  reveal: RecapPlayableReveal;
  title: string;
  eyebrow: string;
  eventDate: string | null;
  /** "24 moments inside". */
  line: string;
  posts: readonly Post[];
  theme: KeepsakeThemeOption;
  reducedMotion: boolean;
  /** The album hero, measured (the beam lands on it). */
  measure: () => HeroLanding | null;
  /** The hand-off starts: show the album. Called once. */
  onHandoff: (how: RevealEnd) => void;
  /** The layer has faded out: unmount it. */
  onGone: () => void;
}

export default function RecapReveal({
  reveal,
  title,
  eyebrow,
  eventDate,
  line,
  posts,
  theme,
  reducedMotion,
  measure,
  onHandoff,
  onGone,
}: RecapRevealProps) {
  const [leaving, setLeaving] = useState(false);
  const endedRef = useRef(false);
  const armedRef = useRef(false);
  const doneTimer = useRef<number | null>(null);
  const onHandoffRef = useRef(onHandoff);
  onHandoffRef.current = onHandoff;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  const end = useCallback((how: RevealEnd) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (doneTimer.current !== null) window.clearTimeout(doneTimer.current);
    setLeaving(true);
    onHandoffRef.current(how);
  }, []);
  const landed = useCallback(() => end('landed'), [end]);
  const failed = useCallback(() => end('failed'), [end]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => onGoneRef.current(), RECAP_REVEAL_HANDOFF_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);
  useEffect(() => () => { if (doneTimer.current !== null) window.clearTimeout(doneTimer.current); }, []);

  // The first tap / Enter / Space on the stage arms the "it has to finish"
  // deadline. Skip is outside the stage, so it never arms it.
  const arm = useCallback(() => {
    if (armedRef.current || endedRef.current) return;
    armedRef.current = true;
    doneTimer.current = window.setTimeout(() => {
      console.error('[recap] reveal never handed off; showing the album');
      end('failed');
    }, RECAP_REVEAL_DONE_DEADLINE_MS);
  }, [end]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') arm(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arm]);

  const cardData = useMemo(
    () => (reveal === 'beam' ? null : recapRevealCard({ title, eventDate, posts })),
    [reveal, title, eventDate, posts],
  );
  const palette = useMemo(() => recapRevealPalette(theme), [theme]);
  const CardReveal = reveal === 'beam' ? null : revealComponent(reveal);

  return (
    <div
      data-recap-reveal-layer={reveal}
      className="fixed inset-0 z-[80] overflow-hidden transition-opacity ease-out"
      style={{
        background: 'var(--k-bg)',
        color: 'var(--k-ink)',
        opacity: leaving ? 0 : 1,
        transitionDuration: `${RECAP_REVEAL_FADE_MS}ms`,
        pointerEvents: leaving ? 'none' : undefined,
      }}
    >
      <div className="absolute inset-0" onPointerUp={arm}>
        <RevealBoundary onError={failed}>
          <Suspense fallback={<LoadWatch onTimeout={failed} />}>
            {reveal === 'beam' ? (
              <BeamReveal
                title={title}
                eyebrow={eyebrow}
                line={line}
                photos={posts}
                reducedMotion={reducedMotion}
                measure={measure}
                onDone={landed}
              />
            ) : CardReveal !== null && cardData !== null ? (
              <CardReveal
                card={cardData.card}
                contributions={cardData.contributions}
                look="event"
                palette={palette}
                reducedMotion={reducedMotion}
                noun="album"
                onDone={landed}
              />
            ) : null}
          </Suspense>
        </RevealBoundary>
      </div>
      {!leaving && (
        <button
          type="button"
          onClick={() => end('skipped')}
          className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[90] inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[color:var(--k-line)] bg-[rgba(var(--k-surface-rgb),0.55)] px-5 font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-ink)] backdrop-blur transition-colors hover:border-[color:var(--k-accent)]"
        >
          Skip
        </button>
      )}
    </div>
  );
}
