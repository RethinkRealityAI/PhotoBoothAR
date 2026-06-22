/**
 * Countdown overlay: counts from `from` down to 1, then calls onComplete.
 * Supports variable from value (3, 5, 10) for the timer selector.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  from?: number;
  onComplete: () => void;
}

export default function Countdown({ from = 3, onComplete }: Props) {
  const [count, setCount] = useState(from);

  useEffect(() => {
    setCount(from);
  }, [from]);

  useEffect(() => {
    if (count <= 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, onComplete]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
      <AnimatePresence mode="wait">
        {count > 0 && (
          <motion.div
            key={count}
            initial={{ scale: 1.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="font-serif text-9xl font-bold text-foil drop-shadow-2xl"
            style={{ textShadow: '0 0 60px rgba(var(--accent-rgb),0.8)' }}
          >
            {count}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
