/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The live wall's background music: a shuffled playlist from the CC0 library
 * (lib/wallMusic), crossfading from track to track, at the host's level.
 *
 * Two <audio> elements take turns so one track fades out while the next fades
 * in (FADE_SEC), and a single rAF loop eases each element's volume toward its
 * target, so a mute, a level change or a skip never clicks.
 *
 * AUTOPLAY: browsers refuse sound until someone has touched the page. A venue
 * laptop usually gets that touch (the operator clicks Project), but if not the
 * wall shows one "Tap to start the music" chip, even in projection mode, and
 * the very first tap or key press anywhere on the page starts it.
 *
 * HANDLED FAILURES: play() rejected for autoplay (status 'blocked' + chip,
 * retried on the next gesture) · a track that will not load or decode (skip
 * to the next; every track failing in a row stops with status 'error' instead
 * of looping forever) · `new Audio` throwing (status 'error') · unmount (both
 * elements paused and released). NOT HANDLED (by choice): iOS ignores
 * `volume` (walls run on laptops and TVs; mute still works through pause).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Music2, Volume2 } from 'lucide-react';
import { nowPlayingLabel, wallPlayOrder, type WallMusic, type WallTrack } from '../../lib/wallMusic';

const FADE_SEC = 4;

export type WallMusicStatus = 'off' | 'starting' | 'playing' | 'blocked' | 'error';

export interface WallMusicControl {
  status: WallMusicStatus;
  track: WallTrack | null;
  /** This screen's own mute (the host's switch turns music on for the wall). */
  muted: boolean;
  setMuted: (m: boolean) => void;
  skip: () => void;
  /** Called from a user gesture: the autoplay retry. */
  start: () => void;
}

function readMuted(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

export function useWallMusic(music: WallMusic, active: boolean, eventId: string): WallMusicControl {
  const muteKey = `beamwall:wall-music-muted:${eventId}`;
  const [muted, setMutedState] = useState(() => readMuted(muteKey));
  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    try { localStorage.setItem(muteKey, m ? '1' : '0'); } catch { /* best effort */ }
  }, [muteKey]);

  const on = active && music.enabled;
  const [seed] = useState(() => Date.now() >>> 0);
  const order = useMemo(() => wallPlayOrder(music.playlist, seed), [music.playlist, seed]);

  const [status, setStatus] = useState<WallMusicStatus>('off');
  const [index, setIndex] = useState(0);
  const els = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const front = useRef(0); // which element is the current track
  const targets = useRef<[number, number]>([0, 0]);
  const failures = useRef(0);
  const level = muted ? 0 : music.volume;
  const levelRef = useRef(level);
  levelRef.current = level;

  // One volume loop for both elements.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const k of [0, 1] as const) {
        const a = els.current[k];
        if (a === null) continue;
        const target = targets.current[k] * levelRef.current;
        const v = a.volume;
        const next = v + Math.sign(target - v) * Math.min(Math.abs(target - v), dt / FADE_SEC);
        if (Math.abs(next - v) > 0.0005) a.volume = Math.min(1, Math.max(0, next));
        if (targets.current[k] === 0 && a.volume <= 0.001 && !a.paused) a.pause();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  const playOn = useCallback((k: 0 | 1, track: WallTrack) => {
    let a = els.current[k];
    if (a === null) {
      try {
        a = new Audio();
      } catch {
        setStatus('error');
        return;
      }
      a.preload = 'auto';
      els.current[k] = a;
    }
    const el = a;
    el.src = track.file;
    el.volume = 0;
    targets.current[k] = 1;
    el.play().then(() => {
      failures.current = 0;
      setStatus('playing');
    }).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotAllowedError') { setStatus('blocked'); return; }
      if (err instanceof DOMException && err.name === 'AbortError') return; // the next skip's pause()
      // A file that will not play: the element's error handler moves on.
    });
  }, []);

  /** Crossfade to the next track in the order. */
  const indexRef = useRef(0);
  const advance = useCallback(() => {
    const next = (indexRef.current + 1) % Math.max(1, order.length);
    const k = (front.current === 0 ? 1 : 0) as 0 | 1;
    targets.current[front.current as 0 | 1] = 0;
    front.current = k;
    indexRef.current = next;
    setIndex(next);
    const track = order[next];
    if (track !== undefined) playOn(k, track);
  }, [order, playOn]);

  // Start / stop with the host's switch (and restart on a new playlist).
  useEffect(() => {
    if (!on || order.length === 0) {
      targets.current = [0, 0];
      for (const a of els.current) a?.pause();
      setStatus('off');
      return;
    }
    setStatus('starting');
    failures.current = 0;
    front.current = 0;
    indexRef.current = 0;
    setIndex(0);
    targets.current = [0, 0];
    els.current[1]?.pause();
    playOn(0, order[0]);
  }, [on, order, playOn]);

  // Near the end of the current track, start the next one under it; on a
  // broken file, move on (but never spin through a library that all fails).
  useEffect(() => {
    if (!on) return;
    const handlers: Array<() => void> = [];
    for (const k of [0, 1] as const) {
      const a = els.current[k];
      if (a === null) continue;
      const onTime = () => {
        if (front.current !== k || !Number.isFinite(a.duration)) return;
        if (a.duration - a.currentTime < FADE_SEC && targets.current[k] === 1 && !a.paused) advance();
      };
      const onError = () => {
        if (front.current !== k) return;
        failures.current += 1;
        if (failures.current >= order.length) { setStatus('error'); targets.current = [0, 0]; return; }
        advance();
      };
      a.addEventListener('timeupdate', onTime);
      a.addEventListener('error', onError);
      handlers.push(() => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('error', onError); });
    }
    return () => handlers.forEach((h) => h());
  }, [on, advance, order.length, index]);

  // Muted: pause outright once faded (saves the decode); unmuted: resume.
  useEffect(() => {
    if (!on || status !== 'playing') return;
    const a = els.current[front.current as 0 | 1];
    if (a !== null && !muted && a.paused) void a.play().catch(() => { /* next gesture retries */ });
  }, [muted, on, status]);

  const start = useCallback(() => {
    if (!on) return;
    const a = els.current[front.current as 0 | 1];
    if (a === null) return;
    targets.current[front.current as 0 | 1] = 1;
    a.play().then(() => setStatus('playing')).catch(() => { /* still blocked */ });
  }, [on]);

  // The first gesture anywhere retries a blocked start.
  useEffect(() => {
    if (status !== 'blocked') return;
    const go = () => start();
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
  }, [status, start]);

  useEffect(() => () => {
    for (const a of els.current) {
      if (a === null) continue;
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    els.current = [null, null];
  }, []);

  return {
    status,
    track: on && status !== 'off' ? order[index] ?? null : null,
    muted,
    setMuted,
    skip: advance,
    start,
  };
}

/**
 * The wall's quiet music line, bottom-left: "Tap to start the music" when the
 * browser is holding the sound back, otherwise the track's name for a few
 * seconds after it starts (which is also the artist's credit).
 */
export function WallMusicChip({ control, projection }: { control: WallMusicControl; projection: boolean }) {
  const { status, track, muted, start } = control;
  const [showTitle, setShowTitle] = useState(false);
  const id = track?.id;
  useEffect(() => {
    if (id === undefined || status !== 'playing' || muted) return;
    setShowTitle(true);
    const t = setTimeout(() => setShowTitle(false), 7000);
    return () => clearTimeout(t);
  }, [id, status, muted]);

  const blocked = status === 'blocked';
  return (
    <div
      className="wall-chrome pointer-events-none absolute z-40"
      style={{ left: 'calc(16px * var(--wall-scale, 1))', bottom: projection ? 'calc(16px * var(--wall-scale, 1))' : 'calc(84px * var(--wall-scale, 1))' }}
    >
      <AnimatePresence>
        {blocked && (
          <motion.button
            key="start"
            type="button"
            onClick={start}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="wall-glass pressable pointer-events-auto flex items-center gap-2 rounded-full px-4 min-h-11 font-sans font-medium text-ivory"
            style={{ fontSize: 'calc(13px * var(--wall-scale, 1))' }}
          >
            <Volume2 className="h-4 w-4" aria-hidden />
            Tap to start the music
          </motion.button>
        )}
        {!blocked && showTitle && track !== null && (
          <motion.div
            key={`title-${track.id}`}
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.5 }}
            className="wall-glass flex items-center gap-2 rounded-full px-4 min-h-10 font-sans text-champagne"
            style={{ fontSize: 'calc(12px * var(--wall-scale, 1))' }}
          >
            <Music2 className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{nowPlayingLabel(track)}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
