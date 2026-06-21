/**
 * Booth entrance. Gates the camera start behind a tap (more reliable on iOS,
 * and a more magical arrival than jumping straight to a permission prompt).
 *
 * The hero sits inside an ornate card with an animated gold sheen border that
 * slowly sweeps light around the frame — a premium, magical first impression.
 */
import { motion } from 'motion/react';
import { Camera } from 'lucide-react';
import { HopeGalaWordmark } from '../ui/Logo';

/** Small ornate gold corner flourish. */
function Corner({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={`absolute w-8 h-8 text-gold-400/70 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 20 C3 10.6 10.6 3 20 3" />
      <path d="M3 13 C3 7.5 7.5 3 13 3" strokeWidth="0.7" />
      <circle cx="10" cy="10" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center px-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="relative w-full max-w-sm"
        initial={{ y: 20, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* soft outer glow */}
        <div className="absolute -inset-3 rounded-[2.6rem] bg-gold-400/10 blur-2xl pointer-events-none" />

        {/* animated gold-border card */}
        <div className="relative rounded-[2rem] overflow-hidden shadow-[0_24px_90px_rgba(0,0,0,0.62)]">
          {/* rotating conic sheen — the animated gold border */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[1200px]"
            style={{
              background:
                'conic-gradient(from 0deg, #9A6F1C 0deg, #B8860B 38deg, #FBF3D9 66deg, #E8C766 94deg, #B8860B 140deg, #8A6314 200deg, #D4AF37 248deg, #FBF3D9 286deg, #B8860B 322deg, #9A6F1C 360deg)',
              animation: 'slow-spin 9s linear infinite',
            }}
          />
          {/* inner fill leaves a glowing ~2px ring */}
          <div className="absolute inset-[2px] rounded-[1.9rem] bg-noir-900/82 backdrop-blur-sm" />
          {/* static inner hairline for an ornate double-rule */}
          <div className="absolute inset-[11px] rounded-[1.5rem] border border-gold-400/20 pointer-events-none" />

          {/* content */}
          <div className="relative px-8 py-12 flex flex-col items-center text-center">
            <Corner className="top-3.5 left-3.5" />
            <Corner className="top-3.5 right-3.5 rotate-90" />
            <Corner className="bottom-3.5 right-3.5 rotate-180" />
            <Corner className="bottom-3.5 left-3.5 -rotate-90" />

            <motion.div
              initial={{ y: 14, opacity: 0, scale: 0.92 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <HopeGalaWordmark size="lg" />
            </motion.div>

            <motion.p
              className="mt-7 max-w-xs font-serif italic text-lg text-champagne/80 leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.8 }}
            >
              Step into the booth and capture a moment to remember.
            </motion.p>

            <motion.button
              onClick={onStart}
              whileTap={{ scale: 0.96 }}
              className="mt-9 flex items-center gap-3 px-9 py-4 bg-foil text-noir-900 rounded-full font-label uppercase tracking-luxe text-[11px] font-bold glow-gold animate-pulse-glow"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.6 }}
            >
              <Camera className="w-4 h-4" />
              Step Inside
            </motion.button>

            <motion.p
              className="mt-6 font-label uppercase tracking-luxe text-[8px] text-champagne/30 leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.05, duration: 0.8 }}
            >
              Camera access required · your photo is only shared when you choose
            </motion.p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
