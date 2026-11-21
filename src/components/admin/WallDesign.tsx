/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallDesign — the "Wall design" card on the host's Wall tab, and the sheet
 * it opens (WallDesignPanel: layout, grid size, tile transition, backdrop,
 * light/dark, live preview). Platform events only — mounted from the event
 * studio, which legacy single-event builds never render.
 *
 * The sheet is portalled to <body> inside its own `data-platform` root, so it
 * wears the platform look and is never clipped or transformed by the studio's
 * animated page containers.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ExternalLink, Palette, X } from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import { useToast } from '../ui/Toast';
import {
  describeWallLook,
  normalizeWallLook,
  resolveScene,
  resolveWallBackdrop,
} from '../../lib/sceneThemes';
import type { WallSettings } from '../../types';
import WallDesignPanel from './WallDesignPanel';

export default function WallDesign() {
  const { eventId, basePath, config } = useEvent();
  const wallSettings = useStore((s) => s.wallSettings);
  const storeSet = useStore((s) => s.setWallSettings);
  const fetchWallSettings = useStore((s) => s.fetchWallSettings);
  const allPosts = useStore((s) => s.posts);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { void fetchWallSettings(); }, [fetchWallSettings]);

  const look = useMemo(
    () => normalizeWallLook(wallSettings.wallLook, wallSettings.galleryScroll),
    [wallSettings.wallLook, wallSettings.galleryScroll],
  );
  const posts = useMemo(
    () => allPosts.filter((p) => p.approved && !p.hidden && p.media_type !== 'video').slice(0, 40),
    [allPosts],
  );
  const wallUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${basePath}/wall`;
  const swatch = resolveWallBackdrop(look) ?? resolveScene(config.scene);

  const close = useCallback(() => {
    if (dirty && !window.confirm('Discard your unsaved wall design changes?')) return;
    setOpen(false);
    setDirty(false);
  }, [dirty]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const onSettings = useCallback((s: WallSettings) => storeSet(s), [storeSet]);

  return (
    <>
      <div className="glass rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="relative h-11 w-16 shrink-0 overflow-hidden rounded-xl"
          style={{ background: swatch.background, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' }}
        >
          {swatch.imageUrl !== undefined && (
            <img src={swatch.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-sans text-[14px] font-semibold text-brand-fg">Wall design</p>
          <p className="font-sans text-[13px] text-brand-muted truncate">{describeWallLook(look)}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a
            href={wallUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pressable flex min-h-11 items-center gap-1.5 rounded-full px-4 font-sans text-[13px] font-medium text-brand-fg liquid-glass"
          >
            Open the wall <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="pressable bg-foil glow-accent flex min-h-11 items-center gap-2 rounded-full px-5 font-sans text-[13px] font-semibold text-[color:var(--on-accent)]"
          >
            <Palette className="h-4 w-4" aria-hidden /> Customize wall
          </button>
        </div>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <div data-platform>
          <AnimatePresence>
            {open && (
              <motion.div
                key="wall-design-sheet"
                className="fixed inset-0 z-[80] flex items-stretch justify-center sm:items-center sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <button type="button" aria-label="Close wall design" className="absolute inset-0 cursor-default bg-[rgba(10,9,32,0.55)] backdrop-blur-sm" onClick={close} />
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="wall-design-title"
                  className="app-bg relative flex h-full w-full max-w-6xl flex-col overflow-hidden sm:h-[min(860px,92vh)] sm:rounded-[28px]"
                  style={{ boxShadow: '0 40px 120px -40px rgba(4,3,20,0.9), inset 0 0 0 1px rgba(255,255,255,0.14)' }}
                  initial={{ y: 24, scale: 0.98 }}
                  animate={{ y: 0, scale: 1 }}
                  exit={{ y: 24, scale: 0.98 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center gap-3 px-4 pb-3 pt-4 sm:px-6">
                    <div className="min-w-0">
                      <h2 id="wall-design-title" className="font-serif text-[22px] leading-tight text-brand-fg">Wall design</h2>
                      <p className="font-sans text-[13px] text-brand-muted">Make the big screen yours. The preview updates as you go.</p>
                    </div>
                    <button
                      type="button"
                      onClick={close}
                      aria-label="Close"
                      className="pressable liquid-glass ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-fg"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <WallDesignPanel
                    eventId={eventId}
                    wallUrl={wallUrl}
                    eventScene={config.scene}
                    posts={posts}
                    notify={push}
                    onSettings={onSettings}
                    onClose={close}
                    onDirtyChange={setDirty}
                  />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </>
  );
}
