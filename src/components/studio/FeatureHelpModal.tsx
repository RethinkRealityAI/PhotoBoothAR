/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single-topic "how this works" modal, opened from a HelpButton next to a
 * studio feature. Stacks (media strip, then content) on phones; from md: up
 * it becomes a two-column card — a flush media column plus a wider content
 * column — so desktop width actually gets used instead of one tall stack.
 * `detail` renders as short icon+label+blurb chips (a scan, not a paragraph).
 */
import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { FEATURE_HELP, type FeatureHelpTopic } from '../../lib/studio/featureHelp';
import { MODES } from './StudioOnboarding';

function ModesIllustration() {
  return (
    <div className="grid h-full w-full grid-cols-3 gap-2 bg-[radial-gradient(120%_100%_at_50%_0%,color-mix(in_srgb,var(--color-accent)_16%,transparent),transparent_62%)] p-3 md:grid-cols-1 md:content-center md:gap-2.5 md:p-4">
      {MODES.map((m) => (
        <div
          key={m.label}
          className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3 text-center md:py-4"
        >
          <m.Icon className="h-6 w-6 text-accent md:h-7 md:w-7" />
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-fg md:text-[10px]">{m.label}</span>
          <span className="hidden text-[10px] leading-snug text-brand-muted/70 md:block">{m.caption}</span>
        </div>
      ))}
    </div>
  );
}

export default function FeatureHelpModal({ topic, onClose }: { topic: FeatureHelpTopic; onClose: () => void }) {
  const content = FEATURE_HELP[topic];
  const media = content.media;
  const videoRef = useRef<HTMLVideoElement>(null);
  // Reduced-motion users get the poster frame, not an autoplaying loop (the
  // poster is a representative still, so nothing is lost).
  const reduced = useReducedMotion() ?? false;

  // Escape closes the modal — standard dialog affordance alongside the X,
  // backdrop click and the "Got it" button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Every loop after the first skips straight past the recording's own
  // app-load moment — only the very first play shows it, same as a guest
  // opening the real studio would.
  function loopPastIntro() {
    const v = videoRef.current;
    if (!v || media.kind !== 'video') return;
    v.currentTime = media.introSkip;
    v.play().catch(() => {});
  }

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={content.title}
    >
      <motion.div
        className="glass-strong relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl shadow-[0_30px_100px_rgba(0,0,0,0.7)] sm:max-w-md md:max-h-[600px] md:max-w-3xl md:flex-row lg:max-w-4xl"
        initial={{ opacity: 0, y: 26, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-foil opacity-60" />
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 rounded-full border border-white/10 bg-black/40 p-2 text-white/80 backdrop-blur transition hover:text-white md:bg-white/[0.06] md:text-brand-muted/70 md:hover:text-brand-fg"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Media column — flush on md+, a rounded top strip on phones. */}
        <div className="relative h-40 w-full shrink-0 overflow-hidden sm:h-48 md:h-auto md:w-[300px] md:border-r md:border-white/10 lg:w-[340px]">
          {media.kind === 'modes' ? (
            <ModesIllustration />
          ) : (
            <video
              ref={videoRef}
              src={media.src}
              poster={media.poster}
              aria-hidden
              className="h-full w-full object-cover object-top"
              autoPlay={!reduced}
              onEnded={reduced ? undefined : loopPastIntro}
              muted
              playsInline
              preload="metadata"
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[color:var(--color-brand-bg)]/80 to-transparent md:hidden" />
        </div>

        {/* Content column — its own scroll, independent of the media column's height. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-6 md:px-8 md:py-7">
          <p className="font-label uppercase tracking-luxe text-[10px] text-accent">{content.eyebrow}</p>
          <h3 className="mt-2 font-serif text-2xl text-brand-fg">{content.title}</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-brand-muted/80">{content.body}</p>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {content.detail.map(({ icon: Icon, label, blurb }) => (
              <div key={label} className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-2" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold leading-tight text-brand-fg">{label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-brand-muted/70">{blurb}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="mt-6 w-full rounded-full bg-foil px-6 py-3 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] md:mt-auto md:w-auto md:self-start md:px-10"
          >
            Got it
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
