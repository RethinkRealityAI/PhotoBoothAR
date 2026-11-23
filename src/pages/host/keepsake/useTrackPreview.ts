/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Music previews for the Keepsake editor. One shared <audio>: one track plays
 * at a time and it stops on unmount.
 *
 * A missing file is answered by Vite AND Netlify with index.html at 200, so
 * the probe checks the content type, not just `ok`.
 *
 * HANDLED FAILURES: probe network error or non-audio answer (ready=false, the
 * play button is disabled) · `new Audio` throwing · a media `error` event ·
 * play() rejecting (except AbortError, which is the next tap's pause()).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { KEEPSAKE_TRACKS, type KeepsakeTrack } from '../../../lib/keepsakeMusic';

export interface TrackPreview {
  /** The id of the track playing, or null. */
  playing: string | null;
  /** id → true (playable) / false (missing or broken). Absent = still checking. */
  ready: Record<string, boolean>;
  toggle: (t: KeepsakeTrack) => void;
  stop: () => void;
}

export function useTrackPreview(): TrackPreview {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    for (const t of KEEPSAKE_TRACKS) {
      fetch(t.file, { method: 'HEAD' })
        .then((r) => {
          const type = r.headers.get('content-type') ?? '';
          if (alive) setReady((m) => ({ ...m, [t.id]: r.ok && type.startsWith('audio/') }));
        })
        .catch(() => { if (alive) setReady((m) => ({ ...m, [t.id]: false })); });
    }
    return () => {
      alive = false;
      const a = audioRef.current;
      if (a !== null) { a.pause(); a.removeAttribute('src'); a.load(); }
      audioRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a !== null) a.pause();
    setPlaying(null);
  }, []);

  const toggle = useCallback((t: KeepsakeTrack) => {
    if (playing === t.id) { stop(); return; }
    const prev = audioRef.current;
    if (prev !== null) prev.pause();
    let a: HTMLAudioElement;
    try {
      a = new Audio(t.file);
    } catch {
      setReady((m) => ({ ...m, [t.id]: false }));
      return;
    }
    audioRef.current = a;
    const broken = () => {
      setReady((m) => ({ ...m, [t.id]: false }));
      setPlaying((cur) => (cur === t.id ? null : cur));
    };
    a.addEventListener('ended', () => setPlaying((cur) => (cur === t.id ? null : cur)));
    a.addEventListener('error', broken);
    setPlaying(t.id);
    a.play().catch((err: unknown) => {
      // A pause() from the next tap aborts this play — not a broken file.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      broken();
    });
  }, [playing, stop]);

  return { playing, ready, toggle, stop };
}
