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
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { getLandingContent, subscribeToLanding, DEFAULT_LANDING } from '../lib/db';
import { LandingContent } from '../types';
import GalaBackground from './ui/GalaBackground';
import ScagoMark from './ui/ScagoMark';

export default function JoinBooth() {
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING);

  useEffect(() => {
    let active = true;
    getLandingContent().then((c) => { if (active) setContent(c); });
    const unsubscribe = subscribeToLanding((c) => { if (active) setContent(c); });
    return () => { active = false; unsubscribe(); };
  }, []);

  // QR encodes the admin URL if set, otherwise the booth root at this origin.
  const qrUrl = useMemo(() => {
    const trimmed = content.url?.trim();
    if (trimmed) return trimmed;
    if (typeof window !== 'undefined') return window.location.origin + '/';
    return '/';
  }, [content.url]);

  const steps = (content.steps?.length ? content.steps : DEFAULT_LANDING.steps).map((s) => s.title);

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar bg-noir-900">
      <GalaBackground density={36} />

      <div className="relative z-10 min-h-full flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16">

          {/* ── LEFT: the massive scannable QR ── */}
          <motion.div
            className="flex flex-col items-center shrink-0"
            initial={{ opacity: 0, scale: 0.92, x: -16 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="font-label uppercase tracking-luxe text-[11px] sm:text-sm text-gold-300/85 mb-4">
              Scan to Join
            </p>
            <motion.div
              className="relative rounded-3xl p-4 sm:p-5"
              style={{
                background: '#faf6ef',
                border: '2px solid rgba(212,175,55,0.6)',
                boxShadow: '0 0 0 6px rgba(212,175,55,0.12), 0 28px 70px -18px rgba(0,0,0,0.7)',
              }}
              animate={{
                boxShadow: [
                  '0 0 0 6px rgba(212,175,55,0.12), 0 28px 70px -18px rgba(0,0,0,0.7)',
                  '0 0 0 7px rgba(232,199,102,0.26), 0 28px 80px -12px rgba(0,0,0,0.7)',
                  '0 0 0 6px rgba(212,175,55,0.12), 0 28px 70px -18px rgba(0,0,0,0.7)',
                ],
              }}
              transition={{ duration: 3.4, ease: 'easeInOut', repeat: Infinity }}
            >
              <span className="pointer-events-none absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-gold-500/60 rounded-tl-lg" aria-hidden />
              <span className="pointer-events-none absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-gold-500/60 rounded-tr-lg" aria-hidden />
              <span className="pointer-events-none absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-gold-500/60 rounded-bl-lg" aria-hidden />
              <span className="pointer-events-none absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-gold-500/60 rounded-br-lg" aria-hidden />

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
            <ScagoMark size={56} variant="gold" animated className="drop-shadow-[0_0_22px_rgba(212,175,55,0.4)]" title="SCAGO" />
            <p className="mt-3 font-label uppercase tracking-luxe text-[10px] sm:text-xs text-champagne/70">
              {content.eyebrow}
            </p>
            <h1 className="mt-1.5 font-serif font-semibold gold-foil text-4xl sm:text-5xl leading-[1.05]">
              {content.title}
            </h1>
            {content.subtitle && (
              <p className="mt-2 font-serif italic text-base sm:text-xl text-ivory/85">
                {content.subtitle}
              </p>
            )}
            {content.intro && (
              <p className="mt-2 font-sans text-xs sm:text-sm text-champagne/55 leading-relaxed">
                {content.intro}
              </p>
            )}

            {/* Big step pills */}
            <ol className="mt-7 flex flex-col gap-3 w-full">
              {steps.map((label, i) => (
                <motion.li
                  key={i}
                  className="flex items-center gap-4 glass-strong rounded-full pl-3 pr-7 py-3 border border-gold-400/30"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.2 + i * 0.09 }}
                >
                  <span className="w-11 h-11 rounded-full bg-foil text-noir-900 font-serif font-bold text-lg flex items-center justify-center glow-soft shrink-0">
                    {i + 1}
                  </span>
                  <span className="font-label uppercase tracking-luxe text-base sm:text-lg text-ivory">
                    {label}
                  </span>
                </motion.li>
              ))}
            </ol>

            <p className="mt-6 font-label uppercase tracking-luxe text-[9px] sm:text-[10px] text-champagne/45">
              {content.footer}
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
