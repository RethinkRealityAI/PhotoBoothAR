/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JoinBooth — the "Join the Photo Booth" landing page at /join.
 *
 * Built to read clearly on a small projector: a huge scannable QR on the LEFT,
 * and the terse 3–4-word steps as big pills on the RIGHT
 * ("Scan QR · Select a Filter · Snap Photo · Share"). All copy is still
 * admin-editable (app_settings key='landing'): fetched on mount via
 * getLandingContent() and kept live with subscribeToLanding().
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { Camera } from 'lucide-react';
import { getLandingContent, subscribeToLanding, defaultLanding } from '../lib/db';
import { LandingContent } from '../types';
import { useEvent } from '../events/EventContext';
import EventBackground from './ui/EventBackground';
import { Emblem } from './ui/EventLogo';

/** Ambient motion only — the QR halo pulse stills when the OS asks it to. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function JoinBooth() {
  const { eventId, config, basePath } = useEvent();
  const defaults = useMemo(() => defaultLanding(config.copy), [config]);
  const [content, setContent] = useState<LandingContent>(defaults);
  const reduced = useMemo(prefersReducedMotion, []);

  useEffect(() => {
    let active = true;
    // A failed read is not worth showing on a projector: the admin-editable
    // copy simply stays at the event's own defaults, which are real copy, not
    // placeholders. What must never happen is an unhandled rejection here.
    getLandingContent(eventId, config.copy)
      .then((c) => { if (active) setContent(c); })
      .catch((err) => console.error('[JoinBooth] landing copy unavailable, using defaults', err));
    const unsubscribe = subscribeToLanding(eventId, config.copy, (c) => { if (active) setContent(c); });
    return () => { active = false; unsubscribe(); };
  }, [eventId, config]);

  // QR encodes the admin URL if set, otherwise the booth root at this origin.
  const qrUrl = useMemo(() => {
    const trimmed = content.url?.trim();
    if (trimmed) return trimmed;
    if (typeof window !== 'undefined') return window.location.origin + (basePath || '/');
    return basePath || '/';
  }, [content.url, basePath]);

  const steps = (content.steps?.length ? content.steps : defaults.steps).map((s) => s.title);

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar app-bg">
      <EventBackground density={36} />

      <div className="relative z-10 min-h-full flex items-center justify-center px-6 py-8 pt-safe-top [--safe-top:2rem] pb-safe-bottom [--safe-bottom:2rem]">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16">

          {/* ── LEFT: the massive scannable QR ── */}
          <motion.div
            className="flex flex-col items-center shrink-0"
            initial={{ opacity: 0, scale: 0.92, x: -16 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-label uppercase tracking-luxe text-[11px] sm:text-sm text-[color:var(--color-accent)] mb-4">
              Scan to Join
            </p>
            <motion.div
              className="relative rounded-3xl p-4 sm:p-5"
              style={{
                background: '#faf6ef',
                border: '2px solid rgba(var(--accent-rgb),0.6)',
                boxShadow: '0 0 0 6px rgba(var(--accent-rgb),0.12), 0 28px 70px -18px rgba(0,0,0,0.7)',
              }}
              animate={
                reduced
                  ? undefined
                  : {
                      boxShadow: [
                        '0 0 0 6px rgba(var(--accent-rgb),0.12), 0 28px 70px -18px rgba(0,0,0,0.7)',
                        '0 0 0 7px rgba(var(--accent-rgb),0.3), 0 28px 80px -12px rgba(0,0,0,0.7)',
                        '0 0 0 6px rgba(var(--accent-rgb),0.12), 0 28px 70px -18px rgba(0,0,0,0.7)',
                      ],
                    }
              }
              transition={{ duration: 3.4, ease: 'easeInOut', repeat: Infinity }}
            >
              {/* Corner ticks read as a viewfinder, which is what tells a guest
                  across the room that the white panel is meant to be scanned. */}
              <span className="pointer-events-none absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 rounded-tl-lg" style={{ borderColor: 'rgba(var(--accent-rgb),0.6)' }} aria-hidden />
              <span className="pointer-events-none absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 rounded-tr-lg" style={{ borderColor: 'rgba(var(--accent-rgb),0.6)' }} aria-hidden />
              <span className="pointer-events-none absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 rounded-bl-lg" style={{ borderColor: 'rgba(var(--accent-rgb),0.6)' }} aria-hidden />
              <span className="pointer-events-none absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 rounded-br-lg" style={{ borderColor: 'rgba(var(--accent-rgb),0.6)' }} aria-hidden />

              <div className="w-[min(88vw,72vh,640px)] h-[min(88vw,72vh,640px)]">
                <QRCodeSVG
                  value={qrUrl}
                  fgColor="#1a1108"
                  bgColor="#faf6ef"
                  level="M"
                  width="100%"
                  height="100%"
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
              </div>
            </motion.div>
          </motion.div>

          {/* ── RIGHT: brand + big step pills ── */}
          <motion.div
            className="flex flex-col items-center lg:items-start text-center lg:text-left max-w-md w-full"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          >
            <Emblem size={56} className="drop-shadow-[0_0_22px_rgba(var(--accent-rgb),0.4)]" />
            <p className="mt-3 font-label uppercase tracking-luxe text-[10px] sm:text-xs text-brand-muted/70">
              {content.eyebrow}
            </p>
            <h1 className="mt-1.5 font-serif font-semibold text-foil text-4xl sm:text-5xl leading-[1.05]">
              {content.title}
            </h1>
            {content.subtitle && (
              <p className="mt-2 font-serif italic text-base sm:text-xl text-brand-fg/85">
                {content.subtitle}
              </p>
            )}
            {content.intro && (
              <p className="mt-2 font-sans text-xs sm:text-sm text-brand-muted/60 leading-relaxed">
                {content.intro}
              </p>
            )}

            {/* A guest who opened this page ON their phone cannot scan the QR
                with the same phone — this is the way in for them, and it sits
                ABOVE the steps because "1. Scan QR" is the one instruction they
                cannot follow. Hidden on the large screens where the page is
                acting as projected signage. */}
            <Link
              to={`${basePath}/booth`}
              className="pressable lg:hidden mt-6 w-full inline-flex items-center justify-center gap-2 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] min-h-12 rounded-2xl glow-accent"
            >
              <Camera className="w-4 h-4" />
              Open the booth here
            </Link>

            {/* Big step pills */}
            <ol className="mt-7 flex flex-col gap-3 w-full">
              {steps.map((label, i) => (
                <motion.li
                  key={i}
                  className="flex items-center gap-4 liquid-glass rounded-full pl-3 pr-7 py-3"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.2 + i * 0.09 }}
                >
                  <span className="w-11 h-11 rounded-full bg-foil text-[color:var(--on-accent)] font-serif font-bold text-lg flex items-center justify-center glow-accent shrink-0">
                    {i + 1}
                  </span>
                  <span className="font-label uppercase tracking-luxe text-base sm:text-lg text-brand-fg">
                    {label}
                  </span>
                </motion.li>
              ))}
            </ol>

            <p className="mt-6 font-label uppercase tracking-luxe text-[9px] sm:text-[10px] text-brand-muted/45">
              {content.footer}
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
