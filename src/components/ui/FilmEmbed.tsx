/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared marketing film embed, hoisted out of Landing.tsx unchanged so every
 * public marketing surface (landing, guides) plays its films the same way.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/**
 * Film embed with managed playback: plays while ≥25% in view, pauses offscreen.
 * Five looping videos on one page would otherwise decode (and drain batteries)
 * simultaneously — iOS Safari also caps concurrent video pipelines, which
 * silently freezes whichever films exceed the cap.
 *
 * CONTROLS (owner directive, round 7): "there should be play and pause, thats
 * it. even then make it subtle and bottom right of the video." So the native
 * control bar is gone — including the reduced-motion branch that used to show
 * it — replaced by ONE glass chip in the bottom-right corner. No timeline, no
 * mute, no fullscreen, no PiP.
 *
 * Two rules make that chip trustworthy:
 *   1. Its icon reflects the ELEMENT's state, read from the video's own
 *      play/pause events — never a flag this component set optimistically. An
 *      autoplay rejection, an offscreen pause and an iOS interruption all move
 *      the icon without any of them going through our click handler.
 *   2. `userPaused` is explicit and sticky: once a visitor pauses a film,
 *      scrolling away and back must NOT restart it. Pressing play clears it.
 */
export default function FilmEmbed({ src, poster, label }: { src: string; poster: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const userPaused = useRef(false);
  const intersecting = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);

    const tryPlay = () => {
      if (userPaused.current || !intersecting.current) return;
      void el.play().catch(() => { /* autoplay refused — the chip is the way in */ });
    };
    // NO prefers-reduced-motion gate here, deliberately (owner directive,
    // round 7 follow-up): these muted films ARE the section content, and the
    // owner's own device reports Reduce Motion — gating on it meant the films
    // never autoplayed for exactly the person who required them to. Reduced
    // motion still disables the page's decorative animation; a visitor who
    // wants a film stopped has the pause chip, and the pause is sticky.
    // iOS Safari can reject the FIRST play() on a preload="metadata" element
    // that has no decodable frame yet, and nothing retries afterwards — which
    // is exactly the "native controls over a frozen poster" state the owner
    // photographed. Retry once the element says it has data.
    el.addEventListener('canplay', tryPlay);
    el.addEventListener('loadeddata', tryPlay);
    // iOS Low Power Mode rejects even muted play() until the page receives a
    // real user gesture — retry on the first one, then unhook.
    const onFirstGesture = () => {
      tryPlay();
      window.removeEventListener('touchstart', onFirstGesture);
      window.removeEventListener('pointerdown', onFirstGesture);
    };
    window.addEventListener('touchstart', onFirstGesture, { passive: true, once: true });
    window.addEventListener('pointerdown', onFirstGesture, { passive: true, once: true });

    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'undefined') {
      // No observer available: treat the film as in view so it still autoplays.
      intersecting.current = true;
      tryPlay();
    } else {
      io = new IntersectionObserver(
        ([entry]) => {
          intersecting.current = entry.isIntersecting;
          // 0.25: the film starts playing DURING its screen-tilt entrance
          // rather than after it settles — "the video plays as it tilts".
          if (entry.isIntersecting) tryPlay();
          else el.pause();
        },
        { threshold: 0.25 },
      );
      io.observe(el);
    }
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('canplay', tryPlay);
      el.removeEventListener('loadeddata', tryPlay);
      window.removeEventListener('touchstart', onFirstGesture);
      window.removeEventListener('pointerdown', onFirstGesture);
      io?.disconnect();
    };
  }, []);

  // Branch on the ELEMENT, not on `playing` — the two can disagree for a frame,
  // and the element is the one that decides what actually happens.
  const toggle = () => {
    const el = ref.current;
    if (el === null) return;
    if (el.paused) {
      userPaused.current = false;
      void el.play().catch(() => { /* nothing more to try; icon stays on Play */ });
    } else {
      userPaused.current = true;
      el.pause();
    }
  };

  return (
    <div className="relative">
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        className="block h-auto w-full"
        aria-label={label}
      />
      {/* 44px hit area, 40px visual chip, resting at 55% so it decorates the
          corner instead of competing with the film. */}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? 'Pause film' : 'Play film'}
        className="absolute bottom-2 right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:bottom-2.5 sm:right-2.5"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full liquid-glass text-brand-fg">
          {playing ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </span>
      </button>
    </div>
  );
}
