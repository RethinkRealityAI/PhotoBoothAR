/**
 * The booth "reveal" — a transient, premium DOM overlay played over the stage
 * when the guest applies a NEW db-sourced experience (Booth.tsx gates
 * mounting on source==='db' + a real frameExp/attachExp id change). A soft
 * radial glow blooms and fades under a handful of accent sparkles, then this
 * component's parent (an AnimatePresence in Booth) unmounts it completely —
 * no lingering DOM, no capture-path involvement (this never touches
 * StageCanvas; it is a pure visual sibling of the stage, never sampled by
 * drawFrame). Deterministic sparkle layout mirrors SendOff.tsx's GoldBeam.
 */
import { motion } from 'motion/react';

const SPARKLE_COUNT = 7;

// Deterministic layout (not random per render) so the shimmer looks identical
// every time it plays — position around the stage center, size, stagger.
const SPARKLES = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
  const angle = (i / SPARKLE_COUNT) * Math.PI * 2 + 0.35;
  const r = 0.2 + (i % 3) * 0.09; // vary radius so it isn't a perfect ring
  return {
    x: 50 + Math.cos(angle) * r * 100,
    y: 50 + Math.sin(angle) * r * 82,
    delay: (i % 7) * 0.03,
    size: 4 + (i % 3) * 2,
  };
});

export default function RevealShimmer() {
  return (
    <motion.div
      className="absolute inset-0 z-40 pointer-events-none overflow-hidden"
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.22, ease: 'easeOut' } }}
    >
      {/* Soft radial glow sweep — a warm accent bloom that blooms in, drifts, fades */}
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(45% 38% at 50% 46%, rgba(var(--accent-rgb),0.38), rgba(var(--accent-rgb),0.12) 55%, transparent 75%)',
        }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0.9, 0], scale: [0.7, 1.15, 1.3] }}
        transition={{ duration: 0.5, ease: 'easeOut', times: [0, 0.4, 1] }}
      />
      {/* Sparkle particles */}
      {SPARKLES.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            background: 'var(--color-accent)',
            boxShadow: '0 0 8px 2px rgba(var(--accent-rgb),0.7)',
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.4] }}
          transition={{ duration: 0.42, delay: s.delay, ease: 'easeOut' }}
        />
      ))}
    </motion.div>
  );
}
