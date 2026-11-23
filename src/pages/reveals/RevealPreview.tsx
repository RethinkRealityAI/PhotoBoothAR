/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RevealPreview — /reveal/preview, the admin reveal editor's iframe.
 *
 * On mount it posts REVEAL_PREVIEW_READY to its parent, then renders whatever
 * document the parent sends (readPreviewMessage; same-origin messages only).
 * A new document keeps the reader's place unless what it IS changed (unlock,
 * theme, occasion, tap count: needsRestart), which seals it again. `replay`
 * restarts sealed; `open` jumps to the revealed card. Before the first
 * document arrives it shows the feature-drop preset.
 */
import { useEffect, useRef, useState } from 'react';
import RevealExperience from '../../components/reveals/RevealExperience';
import { presetDoc, readPreviewMessage, REVEAL_PREVIEW_READY, type RevealDoc } from '../../lib/reveals/revealModel';
import { needsRestart } from '../../lib/reveals/revealScene';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';

export default function RevealPreview() {
  const [doc, setDoc] = useState<RevealDoc>(() => presetDoc('feature-drop'));
  const [replayKey, setReplayKey] = useState(0);
  const [openKey, setOpenKey] = useState(0);
  const docRef = useRef(doc);
  docRef.current = doc;

  useNoIndex();
  usePageTitle('Reveal preview · Beamwall');

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = readPreviewMessage(e.data);
      if (m === null) return;
      if (m.type === 'beamwall:reveal-preview-doc') {
        const restart = needsRestart(docRef.current, m.doc);
        docRef.current = m.doc;
        setDoc(m.doc);
        if (restart) setReplayKey((n) => n + 1);
      } else if (m.type === 'beamwall:reveal-preview-replay') {
        setReplayKey((n) => n + 1);
      } else {
        setOpenKey((n) => n + 1);
      }
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: REVEAL_PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return <RevealExperience doc={doc} mode="preview" replayKey={replayKey} openKey={openKey} />;
}
