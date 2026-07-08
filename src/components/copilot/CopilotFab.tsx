/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The floating copilot button — a foil circle that pops in bottom-right on
 * every host-platform surface. Hidden on /host/new (the full concierge lives
 * there) and everywhere outside /host/**. Mounted once in App.tsx.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { useCopilotStore } from '../../lib/copilotStore';
import { getSession, onAuthStateChange } from '../../lib/auth';

export default function CopilotFab() {
  const { pathname } = useLocation();
  const { isOpen, open } = useCopilotStore();
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let active = true;
    getSession().then((s) => { if (active) setHasSession(Boolean(s)); });
    const unsubscribe = onAuthStateChange((_e, s) => { if (active) setHasSession(Boolean(s)); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const visible =
    hasSession &&
    pathname.startsWith('/host') &&
    !pathname.startsWith('/host/new') &&
    !isOpen;

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="copilot-fab"
          initial={{ scale: 0, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0, opacity: 0, y: 16 }}
          transition={{ type: 'spring', stiffness: 380, damping: 24 }}
          onClick={open}
          title="Beamwall Copilot"
          aria-label="Open the Beamwall Copilot"
          className="fixed bottom-6 right-6 z-[70] w-14 h-14 rounded-full bg-foil glow-accent shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex items-center justify-center text-white active:scale-95 transition-transform"
        >
          <Sparkles className="w-6 h-6" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
