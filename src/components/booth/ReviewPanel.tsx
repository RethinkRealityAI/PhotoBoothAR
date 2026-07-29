/**
 * Review panel — the moment between "I took a photo" and "it's on the wall".
 *
 * It used to be a form: a challenge chip, a name field, a 100-character
 * textarea, four buttons and a three-link "Or explore" row stacked into a
 * bottom sheet — and then a SECOND full-screen modal with a paragraph of copy
 * in front of Send. In a queue, at an event, that is four decisions and two
 * screens between a guest and the thing they actually wanted.
 *
 * Now: the photo, one big Send, and everything optional folded behind one
 * disclosure the guest can ignore entirely.
 *   • Sending is ONE tap. The confirmation modal is gone; what it was
 *     protecting against — not realising the photo goes public — is stated on
 *     the button's own helper line BEFORE the tap instead of in a dialog after
 *     it. The double-submit latch stays, because that guarded a real bug.
 *   • Name and message are hidden until asked for, EXCEPT when a challenge is
 *     selected: the leaderboard needs a name, so that field is promoted.
 *   • Leaving with an un-sent capture still confirms — that one is not
 *     ceremony, it is the only thing standing between a guest and losing the
 *     shot.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Download, Share2, RefreshCw, Send, Upload, ChevronDown } from 'lucide-react';
import { GalleryIcon, MediaStackIcon } from '../ui/MediaIcons';
import { getGuestName } from '../../lib/session';
import { haptic } from '../../lib/haptics';
import { Challenge } from '../../types';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';

interface Props {
  dataUrl: string;             // JPEG data-url for image; object URL for video
  mediaType?: 'image' | 'video';
  durationMs?: number;
  onRetake: () => void;
  onSend: (guestName: string, message: string) => void;
  selectedChallenge?: Challenge | null;
}

export default function ReviewPanel({
  dataUrl, mediaType = 'image', durationMs,
  onRetake, onSend, selectedChallenge,
}: Props) {
  const { eventId, config, basePath } = useEvent();
  const navigate = useNavigate();
  const copy = useStore((s) => s.copy);
  const reduced = useReducedMotion() ?? false;
  const [guestName, setGuestName] = useState(() => getGuestName(eventId));
  const [message, setMessage] = useState('');
  /** One-way latch: the panel is unmounted by the Booth the instant the send
   *  starts, but a double-tap inside the same frame must not fire onSend twice. */
  const [submitted, setSubmitted] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  // "Or explore" leave-confirm: the capture in review is un-sent, so leaving
  // destroys it — intercept the link and ask first (client-side navigation via
  // react-router, event-scoped by basePath; the old raw hrefs full-reloaded
  // onto the default event and lost the shot).
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Challenge photos must carry a name so the leaderboard can crown winners.
  const nameRequired = !!selectedChallenge;
  const nameMissing = nameRequired && guestName.trim().length < 2;

  // A required name is not an "extra" — surface it without a tap, and put the
  // cursor in it, so the one blocking field is never hidden behind a chevron.
  useEffect(() => {
    if (!nameMissing) return;
    setExtrasOpen(true);
  }, [nameMissing]);

  // Resolve the real container from the blob so the saved file's extension
  // matches its bytes (recordings may be .webm or .mp4 depending on the browser;
  // a hardcoded extension produces files players treat as corrupt).
  const extFromMime = (type: string): string => {
    if (/mp4/.test(type)) return 'mp4';
    if (/webm/.test(type)) return 'webm';
    if (/png/.test(type)) return 'png';
    return mediaType === 'video' ? 'webm' : 'jpg';
  };

  async function resolveFile(): Promise<{ blob: Blob; filename: string }> {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = mediaType === 'video' ? extFromMime(blob.type) : 'jpg';
    return { blob, filename: `${config.copy.filePrefix}-${Date.now()}.${ext}` };
  }

  async function handleDownload() {
    haptic('tap');
    const { blob, filename } = await resolveFile();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleShare() {
    haptic('tap');
    if (!navigator.share) { handleDownload(); return; }
    try {
      const { blob, filename } = await resolveFile();
      const file = new File([blob], filename, { type: blob.type });
      await navigator.share({ files: [file], title: copy.shareTitle });
    } catch { /* cancelled */ }
  }

  function handleSendPress() {
    if (submitted) return;
    if (nameMissing) {
      // Don't just refuse — take them to the thing that is blocking them.
      haptic('error');
      setExtrasOpen(true);
      nameInputRef.current?.focus();
      return;
    }
    setSubmitted(true);
    haptic('capture');
    onSend(guestName.trim(), message.trim());
  }

  const durationSec = durationMs ? Math.round(durationMs / 1000) : 0;
  const noun = mediaType === 'video' ? 'video' : 'photo';

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-end bg-noir-900/90 backdrop-blur-sm">
      {/* Preview — min-h-0 lets the tall 9:16 capture shrink to fit the space
          left above the controls instead of overflowing off the top. */}
      <div className="flex-1 min-h-0 w-full relative flex items-center justify-center px-4 py-3">
        <motion.div
          className="relative flex h-full w-full items-center justify-center"
          // The send-off's beam takes over immediately; this is the half-beat
          // of lift that makes the hand-off feel like one motion rather than a
          // cut to another screen.
          animate={submitted && !reduced ? { scale: 1.05, y: -18, opacity: 0.85 } : { scale: 1, y: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          {mediaType === 'video' ? (
            <video
              src={dataUrl}
              autoPlay
              loop
              muted
              playsInline
              className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl"
              style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
            />
          ) : (
            <img
              src={dataUrl}
              alt="Your captured photo"
              className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl glow-soft"
              style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
            />
          )}
        </motion.div>
        {mediaType === 'video' && durationSec > 0 && (
          <div className="absolute top-6 right-6 glass rounded-full px-2.5 py-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="font-label text-[9px] uppercase tracking-wide text-champagne/70">{durationSec}s</span>
          </div>
        )}
      </div>

      {/* Controls. `pb-safe-bottom` COMPOSES with the design padding via
          --safe-bottom (src/index.css) — a bare env() would win the cascade and
          zero the padding on every non-notch device. Without it the Send button
          sat under the iPhone home indicator. */}
      <div className="w-full glass-strong rounded-t-3xl px-5 pt-5 pb-safe-bottom [--safe-bottom:1.25rem] space-y-3">
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

        {/* THE decision — one tap. */}
        <div className="flex gap-3">
          <button
            onClick={() => { haptic('toggle'); onRetake(); }}
            disabled={submitted}
            className="pressable glass rounded-2xl px-4 min-h-[56px] flex items-center gap-2 text-champagne/70 hover:text-ivory transition-colors text-sm font-label uppercase tracking-wide disabled:opacity-40"
          >
            <RefreshCw className="w-4 h-4" />
            Retake
          </button>
          <button
            onClick={handleSendPress}
            disabled={submitted}
            aria-label={`Send your ${noun} to the live wall`}
            className="flex-1 bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-sm rounded-2xl px-5 min-h-[56px] flex items-center justify-center gap-2.5 hover:brightness-110 transition-all active:scale-[0.97] disabled:opacity-70 disabled:pointer-events-none"
          >
            <Send className="w-4 h-4" />
            {submitted ? 'Beaming…' : 'Send to the wall'}
          </button>
        </div>

        {/* Says what the tap DOES, before the tap — which is the job the
            full-screen confirmation modal used to do afterwards. */}
        <p className="text-center font-sans text-[11px] leading-snug text-champagne/45">
          {nameMissing
            ? 'Add your name below to send your challenge entry'
            : `Everyone at ${copy.eventName} will see it on the live wall.`}
        </p>

        {/* Everything optional, behind one control. */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { haptic('tap'); setExtrasOpen((o) => !o); }}
            aria-expanded={extrasOpen}
            className="pressable glass flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 font-label text-[10px] uppercase tracking-wide text-champagne/60 hover:text-ivory transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${extrasOpen ? 'rotate-180' : ''}`} />
            {extrasOpen ? 'Hide extras' : 'Add a name or note'}
          </button>
          <button
            onClick={handleDownload}
            className="pressable glass rounded-xl min-h-11 min-w-11 flex items-center justify-center text-champagne/70 hover:text-gold-400 transition-colors"
            title="Save to device"
            aria-label="Save to device"
          >
            <Download className="w-4 h-4" />
          </button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <button
              onClick={handleShare}
              className="pressable glass rounded-xl min-h-11 min-w-11 flex items-center justify-center text-champagne/70 hover:text-gold-400 transition-colors"
              title="Share"
              aria-label="Share"
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {extrasOpen && (
            <motion.div
              key="extras"
              initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="space-y-3 pt-1">
                <input
                  ref={nameInputRef}
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

                {/* Explore — reachable whether or not you send to the wall */}
                <div className="flex gap-2">
                  {([
                    { to: `${basePath}/wall`, icon: <GalleryIcon size={15} />, label: 'Wall' },
                    { to: `${basePath}/me`, icon: <MediaStackIcon size={15} />, label: 'My Media' },
                    { to: `${basePath}/upload`, icon: <Upload size={15} />, label: 'Upload' },
                  ] as const).map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={(e) => {
                        // The capture on screen is un-sent — confirm before leaving.
                        e.preventDefault();
                        setLeaveTarget(l.to);
                      }}
                      className="flex-1 glass rounded-xl px-3 min-h-11 flex items-center justify-center gap-1.5 text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors"
                    >
                      {l.icon}
                      <span className="font-label uppercase tracking-wide text-[9px]">{l.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Leave-confirm dialog — the un-sent capture would be lost */}
      <AnimatePresence>
        {leaveTarget && (
          <motion.div
            className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-noir-900/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLeaveTarget(null)}
          >
            <motion.div
              className="glass-strong rounded-3xl border border-gold-400/20 p-7 w-full max-w-xs text-center"
              initial={{ scale: 0.9, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 16 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-serif text-2xl text-ivory mb-1.5">Leave the booth?</h3>
              <p className="font-sans text-[13px] text-champagne/65 leading-relaxed mb-6">
                Your {noun} hasn&rsquo;t been sent — leave anyway? You can save it to your device first.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setLeaveTarget(null)}
                  className="flex-1 bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 min-h-11 hover:brightness-110 transition-all active:scale-95"
                >
                  Stay
                </button>
                <button
                  onClick={() => navigate(leaveTarget)}
                  className="flex-1 glass rounded-xl px-4 min-h-11 font-label uppercase tracking-luxe text-[11px] text-champagne/70 hover:text-ivory transition-colors"
                >
                  Leave anyway
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
