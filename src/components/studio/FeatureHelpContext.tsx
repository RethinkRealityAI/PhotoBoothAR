/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio-wide "which feature help modal is open" state. One provider mounted
 * at StudioShell's root so any descendant (AssetsDock, StudioStage,
 * PropertiesDock — siblings, not parent/child) can open a topic via
 * useFeatureHelp() without prop-drilling through StudioShell.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import FeatureHelpModal from './FeatureHelpModal';
import type { FeatureHelpTopic } from '../../lib/studio/featureHelp';

interface FeatureHelpCtx {
  open: (topic: FeatureHelpTopic) => void;
}

const FeatureHelpContext = createContext<FeatureHelpCtx | null>(null);

export function useFeatureHelp(): FeatureHelpCtx {
  const ctx = useContext(FeatureHelpContext);
  if (!ctx) throw new Error('useFeatureHelp must be used within FeatureHelpProvider');
  return ctx;
}

export function FeatureHelpProvider({ children }: { children: ReactNode }) {
  const [topic, setTopic] = useState<FeatureHelpTopic | null>(null);
  const value = useMemo<FeatureHelpCtx>(() => ({ open: (t) => setTopic(t) }), []);
  return (
    <FeatureHelpContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {topic && <FeatureHelpModal key={topic} topic={topic} onClose={() => setTopic(null)} />}
      </AnimatePresence>
    </FeatureHelpContext.Provider>
  );
}
