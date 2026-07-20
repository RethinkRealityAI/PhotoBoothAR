/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single-topic "how this works" modal, opened from a HelpButton next to a
 * studio feature. Same glass-card visual language as StudioOnboarding (framed
 * screenshot + eyebrow/title/body) plus a `detail` list for the extra
 * specifics the brief first-run tour has no room for.
 */
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { FEATURE_HELP, type FeatureHelpTopic } from '../../lib/studio/featureHelp';
import { MODES } from './StudioOnboarding';

export default function FeatureHelpModal({ topic, onClose }: { topic: FeatureHelpTopic; onClose: () => void }) {
  const content = FEATURE_HELP[topic];
  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={content.title}
    >
      <motion.div
        className="glass-strong relative w-full max-w-lg overflow-hidden rounded-3xl px-7 pb-7 pt-6 shadow-[0_30px_100px_rgba(0,0,0,0.7)] max-h-[85vh] overflow-y-auto"
        initial={{ opacity: 0, y: 26, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foil opacity-60" />

        <div className="mb-4 flex items-center justify-between">
          <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">How this works</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-white/10 bg-white/[0.05] p-2 text-brand-muted/70 transition hover:text-brand-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="relative h-48 w-full overflow-hidden rounded-2xl border border-white/10 bg-brand-bg sm:h-56"
          style={{ boxShadow: '0 20px 60px -24px rgba(0,0,0,0.85)' }}
        >
          {content.modesIllustration ? (
            <div className="flex h-full w-full items-center justify-center gap-2.5 bg-[radial-gradient(120%_100%_at_50%_0%,color-mix(in_srgb,var(--color-accent)_16%,transparent),transparent_62%)] px-4">
              {MODES.map((m) => (
                <div
                  key={m.label}
                  className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-4 text-center"
                >
                  <m.Icon className="h-7 w-7 text-accent" />
                  <span className="font-label uppercase tracking-luxe text-[10px] text-brand-fg">{m.label}</span>
                  <span className="text-[10px] leading-snug text-brand-muted/70">{m.caption}</span>
                </div>
              ))}
            </div>
          ) : (
            <img src={content.image} alt="" aria-hidden className="h-full w-full object-cover object-top" draggable={false} />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[color:var(--color-brand-bg)] to-transparent" />
        </div>

        <div className="mt-5 text-center">
          <p className="font-label uppercase tracking-luxe text-[10px] text-accent">{content.eyebrow}</p>
          <h3 className="mt-2 font-serif text-2xl text-brand-fg">{content.title}</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-brand-muted/80">{content.body}</p>
        </div>

        <ul className="mt-5 flex flex-col gap-2.5 text-left">
          {content.detail.map((line, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-brand-muted/75">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-foil px-6 py-3 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
        >
          Got it
        </button>
      </motion.div>
    </motion.div>
  );
}
