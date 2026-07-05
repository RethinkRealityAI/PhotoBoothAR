/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DetailsAndPost — final section: the uploader's name (one per batch), an
 * optional per-photo message (with "use for all"), and the Post action with a
 * confirm dialog + live progress. Styling mirrors the booth ReviewPanel.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Film } from 'lucide-react';
import { Experience } from '../../types';
import { UploadItem } from './types';
import FramedThumb from './FramedThumb';

export interface PostProgress {
  done: number;
  total: number;
  failed: number;
}

interface Props {
  items: UploadItem[];
  frames: Experience[];
  guestName: string;
  onGuestName: (v: string) => void;
  onUpdate: (id: string, patch: Partial<UploadItem>) => void;
  onPost: () => void;
  posting: boolean;
  progress: PostProgress | null;
}

export default function DetailsAndPost({
  items, frames, guestName, onGuestName, onUpdate, onPost, posting, progress,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [sharedMsg, setSharedMsg] = useState('');

  const applyMsgToAll = () => {
    const v = sharedMsg.slice(0, 100);
    items.forEach((i) => onUpdate(i.id, { message: v }));
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Batch fields */}
      <div className="shrink-0 space-y-3">
        <input
          type="text"
          placeholder="Your name (optional)"
          value={guestName}
          onChange={(e) => onGuestName(e.target.value.slice(0, 60))}
          maxLength={60}
          className="w-full bg-noir-800/60 border border-gold-400/20 rounded-xl px-4 py-3 font-sans text-sm text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/50 transition-colors"
        />
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="A message to use on all photos… (optional)"
            value={sharedMsg}
            onChange={(e) => setSharedMsg(e.target.value.slice(0, 100))}
            maxLength={100}
            className="flex-1 bg-noir-800/60 border border-gold-400/20 rounded-xl px-4 py-3 font-sans text-sm text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/50 transition-colors"
          />
          <button
            onClick={applyMsgToAll}
            className="px-4 py-2 glass rounded-xl text-[9px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors whitespace-nowrap"
          >
            Use for all
          </button>
        </div>
      </div>

      {/* Per-item review list */}
      <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar space-y-2.5 pr-1">
        {items.map((item) => {
          return (
            <div key={item.id} className="flex gap-3 items-center glass rounded-2xl border border-gold-400/12 p-2.5">
              <div className="relative w-12 aspect-[9/16] shrink-0">
                <FramedThumb item={item} frames={frames} className="w-full h-full" rounded="rounded-lg" />
                {item.kind === 'video' && (
                  <div className="absolute top-1 left-1 bg-noir-900/70 rounded px-1 py-0.5"><Film className="w-2.5 h-2.5 text-champagne/80" /></div>
                )}
              </div>
              <input
                type="text"
                placeholder="Message for this photo… (optional)"
                value={item.message}
                onChange={(e) => onUpdate(item.id, { message: e.target.value.slice(0, 100) })}
                maxLength={100}
                className="flex-1 bg-noir-800/50 border border-gold-400/15 rounded-lg px-3 py-2.5 font-sans text-[13px] text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/45 transition-colors"
              />
            </div>
          );
        })}
      </div>

      {/* Post button */}
      <div className="shrink-0">
        <button
          onClick={() => setConfirming(true)}
          disabled={posting || items.length === 0}
          className="w-full bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-xs rounded-xl px-5 py-4 flex items-center justify-center gap-2.5 hover:brightness-110 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        >
          <Send className="w-4 h-4" />
          Post {items.length} to the Wall
        </button>
      </div>

      {/* Confirm + progress dialog */}
      <AnimatePresence>
        {confirming && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-noir-900/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !posting && setConfirming(false)}
          >
            <motion.div
              className="glass-strong rounded-3xl border border-gold-400/20 p-7 w-full max-w-xs text-center"
              initial={{ scale: 0.9, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 16 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-foil glow-accent flex items-center justify-center">
                <Send className="w-6 h-6 text-noir-900" />
              </div>
              <h3 className="font-serif text-2xl text-ivory mb-1.5">Post to the wall?</h3>
              <p className="font-sans text-[13px] text-champagne/65 leading-relaxed mb-6">
                {items.length} {items.length === 1 ? 'item' : 'items'} will appear on the live photo wall for everyone to see.
              </p>

              {posting && progress ? (
                <div className="mb-2">
                  <div className="h-2 w-full rounded-full bg-noir-800 overflow-hidden">
                    <div
                      className="h-full bg-foil transition-all"
                      style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 font-label uppercase tracking-luxe text-[10px] text-champagne/60">
                    Posting {progress.done} / {progress.total}
                    {progress.failed > 0 && ` · ${progress.failed} failed`}
                  </p>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirming(false)}
                    className="flex-1 glass rounded-xl px-4 py-3 font-label uppercase tracking-luxe text-[11px] text-champagne/70 hover:text-ivory transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onPost}
                    className="flex-1 bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 py-3 flex items-center justify-center gap-2 hover:brightness-110 transition-all active:scale-95"
                  >
                    Yes, post
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
