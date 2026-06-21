/**
 * Review panel — shows captured photo (or looping video preview), name/message
 * inputs, and action buttons: Retake / Download / Share / Send-to-Wall.
 * Supports both mediaType='image' and mediaType='video'.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, Share2, RefreshCw, Send } from 'lucide-react';
import { GalleryIcon, MediaStackIcon } from '../ui/MediaIcons';
import { getGuestName } from '../../lib/session';
import { Challenge } from '../../types';

interface Props {
  dataUrl: string;             // JPEG data-url for image; object URL for video
  mediaType?: 'image' | 'video';
  durationMs?: number;
  onRetake: () => void;
  onSend: (guestName: string, message: string) => void;
  sending: boolean;
  selectedChallenge?: Challenge | null;
}

export default function ReviewPanel({
  dataUrl, mediaType = 'image', durationMs,
  onRetake, onSend, sending, selectedChallenge,
}: Props) {
  const [guestName, setGuestName] = useState(() => getGuestName());
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Challenge photos must carry a name so the leaderboard can crown winners.
  const nameRequired = !!selectedChallenge;
  const nameMissing = nameRequired && guestName.trim().length < 2;

  const ext = mediaType === 'video' ? 'webm' : 'jpg';
  const filename = `HopeGala2026-${Date.now()}.${ext}`;

  function handleDownload() {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  async function handleShare() {
    if (!navigator.share) { handleDownload(); return; }
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: blob.type });
      await navigator.share({ files: [file], title: 'SCAGO Hope Gala & Awards 2026' });
    } catch { /* cancelled */ }
  }

  const durationSec = durationMs ? Math.round(durationMs / 1000) : 0;

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-end bg-noir-900/90 backdrop-blur-sm">
      {/* Preview */}
      <div className="flex-1 w-full relative flex items-center justify-center p-4 pt-8">
        {mediaType === 'video' ? (
          <video
            src={dataUrl}
            autoPlay
            loop
            muted
            playsInline
            className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl"
            style={{ border: '1px solid rgba(212,175,55,0.2)' }}
          />
        ) : (
          <img
            src={dataUrl}
            alt="Your captured photo"
            className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl glow-soft"
            style={{ border: '1px solid rgba(212,175,55,0.2)' }}
          />
        )}
        {mediaType === 'video' && durationSec > 0 && (
          <div className="absolute top-6 right-6 glass rounded-full px-2.5 py-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="font-label text-[9px] uppercase tracking-wide text-champagne/70">{durationSec}s</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="w-full glass-strong rounded-t-3xl px-6 py-6 space-y-4">
        {/* Challenge chip */}
        {selectedChallenge && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gold-400/10 border border-gold-400/20">
            <span className="text-lg">{selectedChallenge.emoji}</span>
            <div>
              <p className="font-label text-[9px] uppercase tracking-wide text-gold-400">Challenge</p>
              <p className="font-sans text-xs text-champagne/70">{selectedChallenge.title}</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <input
            type="text"
            placeholder={nameRequired ? 'Your name (required for challenges)' : 'Your name (optional)'}
            value={guestName}
            onChange={(e) => setGuestName(e.target.value.slice(0, 60))}
            maxLength={60}
            className={`w-full bg-noir-800/60 border rounded-xl px-4 py-3 font-sans text-sm text-ivory placeholder-champagne/30 outline-none transition-colors ${
              nameMissing ? 'border-gold-400/60 focus:border-gold-400' : 'border-gold-400/20 focus:border-gold-400/50'
            }`}
          />
          <div className="relative">
            <textarea
              placeholder="Leave a message for the wall… (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 100))}
              maxLength={100}
              rows={2}
              className="w-full bg-noir-800/60 border border-gold-400/20 rounded-xl px-4 py-3 font-sans text-sm text-ivory placeholder-champagne/30 outline-none focus:border-gold-400/50 transition-colors resize-none"
            />
            <span className="absolute bottom-2 right-3 font-label text-[8px] uppercase tracking-wide text-champagne/25">
              {message.length}/100
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onRetake}
            className="glass rounded-xl px-4 py-3.5 flex items-center gap-2 text-champagne/70 hover:text-ivory transition-colors text-sm font-label uppercase tracking-wide"
          >
            <RefreshCw className="w-4 h-4" />
            Retake
          </button>
          <button
            onClick={handleDownload}
            className="glass rounded-xl px-4 py-3.5 flex items-center gap-2 text-champagne/70 hover:text-gold-400 transition-colors"
            title="Save to device"
          >
            <Download className="w-4 h-4" />
          </button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <button
              onClick={handleShare}
              className="glass rounded-xl px-4 py-3.5 flex items-center gap-2 text-champagne/70 hover:text-gold-400 transition-colors"
              title="Share"
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => { if (nameMissing) return; setConfirming(true); }}
            disabled={sending || nameMissing}
            title={nameMissing ? 'Enter your name to send a challenge photo' : undefined}
            className="flex-1 bg-foil glow-gold text-noir-900 font-label uppercase tracking-luxe text-xs rounded-xl px-5 py-3.5 flex items-center justify-center gap-2.5 hover:brightness-110 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
          >
            <Send className="w-4 h-4" />
            Send to Wall
          </button>
        </div>
        {nameMissing && (
          <p className="text-center font-label text-[9px] uppercase tracking-luxe text-gold-300/70 -mt-1">
            Add your name to send your challenge entry
          </p>
        )}

        {/* Explore — reachable whether or not you send to the wall */}
        <div className="pt-1">
          <div className="flex items-center gap-3 mb-2.5">
            <span className="h-px flex-1 bg-gold-400/15" />
            <span className="font-label uppercase tracking-luxe text-[8px] text-champagne/35">Or explore</span>
            <span className="h-px flex-1 bg-gold-400/15" />
          </div>
          <div className="flex gap-3">
            <a
              href="/wall"
              className="flex-1 glass rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors"
            >
              <GalleryIcon size={16} />
              <span className="font-label uppercase tracking-wide text-[10px]">Live Photo Wall</span>
            </a>
            <a
              href="/me"
              className="flex-1 glass rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors"
            >
              <MediaStackIcon size={16} />
              <span className="font-label uppercase tracking-wide text-[10px]">My Media</span>
            </a>
          </div>
        </div>
      </div>

      {/* Confirm-before-send dialog (prevents accidental posts to the public wall) */}
      <AnimatePresence>
        {confirming && (
          <motion.div
            className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-noir-900/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !sending && setConfirming(false)}
          >
            <motion.div
              className="glass-strong rounded-3xl border border-gold-400/20 p-7 w-full max-w-xs text-center"
              initial={{ scale: 0.9, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 16 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-foil glow-gold flex items-center justify-center">
                <Send className="w-6 h-6 text-noir-900" />
              </div>
              <h3 className="font-serif text-2xl text-ivory mb-1.5">Send to the wall?</h3>
              <p className="font-sans text-[13px] text-champagne/65 leading-relaxed mb-6">
                Your {mediaType === 'video' ? 'video' : 'photo'} will appear on the live photo wall for everyone to see. You can still save it to your device after.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                  className="flex-1 glass rounded-xl px-4 py-3 font-label uppercase tracking-luxe text-[11px] text-champagne/70 hover:text-ivory transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { if (sending || submitted) return; setSubmitted(true); onSend(guestName.trim(), message.trim()); }}
                  disabled={sending || submitted}
                  className="flex-1 bg-foil glow-gold text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 py-3 flex items-center justify-center gap-2 hover:brightness-110 transition-all active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
                >
                  {sending || submitted ? 'Sending…' : 'Yes, send'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
