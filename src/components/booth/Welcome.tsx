/**
 * Booth entrance. Gates the camera start behind a tap (more reliable on iOS,
 * and a more magical arrival than jumping straight to a permission prompt).
 *
 * The hero sits inside an ornate card with an animated accent sheen border that
 * slowly sweeps light around the frame — a premium, magical first impression.
 */
import { motion } from 'motion/react';
import { Camera } from 'lucide-react';
import { Wordmark } from '../ui/EventLogo';
import GoldFrameCard from '../ui/GoldFrameCard';

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
        <GoldFrameCard>
          <motion.div
            initial={{ y: 14, opacity: 0, scale: 0.92 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ delay: 0.25, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <Wordmark size="lg" />
          </motion.div>

          <motion.p
            className="mt-7 max-w-xs font-serif italic text-lg text-brand-muted/80 leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.8 }}
          >
            Step into the booth and capture a moment to remember.
          </motion.p>

          <motion.button
            onClick={onStart}
            whileTap={{ scale: 0.96 }}
            className="mt-9 flex items-center gap-3 px-9 py-4 bg-foil text-white rounded-full font-label uppercase tracking-luxe text-[11px] font-bold glow-accent animate-pulse-glow"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
          >
            <Camera className="w-4 h-4" />
            Step Inside
          </motion.button>

          <motion.p
            className="mt-6 font-label uppercase tracking-luxe text-[8px] text-brand-muted/30 leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.05, duration: 0.8 }}
          >
            Camera access required · your photo is only shared when you choose
          </motion.p>
        </GoldFrameCard>
      </motion.div>
    </motion.div>
  );
}
