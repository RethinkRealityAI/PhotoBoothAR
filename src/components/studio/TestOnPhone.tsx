/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TestOnPhone — "Director's Preview" hand-off. A compact liquid-glass popover
 * (StudioStage's preview mode, bottom-right) showing a QR code for the guest
 * booth deep link to THIS experience: `${origin}${basePath}/experience/:id`
 * (the same `experience/:id` guest route Library's QRModal links to — see
 * App.tsx guestRoutes; Booth reads it via useParams().id as
 * routeExperienceId). Only meaningful for a saved, clean draft — an unsaved
 * or dirty draft has no stable id to scan yet, so this offers a Save button
 * that calls the shell's existing handleSave instead.
 */
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, Save, Smartphone } from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import Modal from '../ui/Modal';

interface Props {
  /** The saved experience id (draft.id) — undefined until the first save. */
  experienceId: string | undefined;
  /** True once the draft has unsaved edits (state.dirty). */
  dirty: boolean;
  /** True while the shell's save is in flight. */
  saving: boolean;
  /** The shell's existing handleSave. */
  onSave: () => void;
  onClose: () => void;
}

export default function TestOnPhone({ experienceId, dirty, saving, onSave, onClose }: Props) {
  const { basePath } = useEvent();
  const [copied, setCopied] = useState(false);

  const needsSave = !experienceId || dirty;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = experienceId ? `${origin}${basePath}/experience/${experienceId}` : '';

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <Modal title="Test on phone" onClose={onClose} maxWidthClass="max-w-xs">
      <div className="flex flex-col items-center gap-4 text-center">
        {needsSave ? (
          <>
            <Smartphone className="w-8 h-8 text-brand-muted/40" />
            <p className="font-sans text-sm text-brand-fg leading-relaxed">
              Save first, then scan — the phone link opens this exact saved piece.
            </p>
            <button
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-foil text-white font-bold text-[10px] font-label uppercase tracking-widest rounded-xl glow-accent transition active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <div className="rounded-2xl p-3 bg-brand-fg">
              <QRCodeSVG value={url} size={168} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
            </div>
            <button
              onClick={copy}
              className="font-mono text-[10px] text-brand-muted/50 hover:text-accent-2 break-all transition-colors"
            >
              {copied ? 'Copied!' : url.replace(/^https?:\/\//, '')}
            </button>
            <p className="font-sans text-[11px] text-brand-muted/45 leading-relaxed">
              Published pieces appear in the booth picker; this link opens your piece directly.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
