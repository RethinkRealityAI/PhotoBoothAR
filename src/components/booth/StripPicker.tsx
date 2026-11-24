/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StripPicker — the photo-strip format chooser.
 *
 * The strip button used to arm a fixed 3-shot strip in place; guests had no
 * idea what the toggle meant until three countdowns fired at them. Now the
 * button opens this small dialog: pick a format (2, 3 or 4 shots stacked, or
 * four in a 2x2 grid), each with a mini layout preview of the card it
 * produces, or drop back to a single photo.
 */
import { Camera } from 'lucide-react';
import Modal from '../ui/Modal';
import { haptic } from '../../lib/haptics';
import { STRIP_FORMATS, type StripFormat, type StripFormatId } from '../../lib/photoStrip';

/** A square tile previewing the card: stacked bars, or a 2x2 of cells. */
function StripGlyph({ format }: { format: StripFormat }) {
  const panelStyle = {
    background:
      'linear-gradient(135deg, rgba(var(--accent-rgb),0.75), rgba(var(--accent-rgb),0.3))',
  };
  return (
    <span
      aria-hidden
      className={`grid h-14 w-14 gap-1 rounded-lg border border-white/15 bg-white/[0.04] p-1.5 ${
        format.cols === 2 ? 'grid-cols-2' : 'grid-cols-1'
      }`}
    >
      {Array.from({ length: format.shots }, (_, i) => (
        <span key={i} className="rounded-[3px]" style={panelStyle} />
      ))}
    </span>
  );
}

export default function StripPicker({
  stripMode,
  current,
  onPick,
  onSingle,
  onClose,
}: {
  /** Whether strip mode is currently armed (shows the way back to single). */
  stripMode: boolean;
  current: StripFormatId;
  onPick: (id: StripFormatId) => void;
  onSingle: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Photo strip" onClose={onClose} zClass="z-[80]" maxWidthClass="max-w-sm">
      <p className="mb-5 font-sans text-sm leading-relaxed text-brand-muted/80">
        A quick series of poses, arranged into one keepsake card in your event&rsquo;s colours.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {STRIP_FORMATS.map((f) => {
          const on = stripMode && current === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => { haptic('select'); onPick(f.id); }}
              aria-pressed={on}
              aria-label={`${f.label}: ${f.blurb}`}
              className={`pressable flex flex-col items-center gap-2.5 rounded-2xl border p-4 transition-colors ${
                on
                  ? 'border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/10'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <StripGlyph format={f} />
              <span className="font-label text-[11px] uppercase tracking-luxe text-brand-fg">
                {f.label}
              </span>
              <span className="font-sans text-[11px] leading-snug text-brand-muted/70">
                {f.blurb}
              </span>
            </button>
          );
        })}
      </div>
      {stripMode && (
        <button
          type="button"
          onClick={() => { haptic('toggle'); onSingle(); }}
          className="pressable mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] font-label text-[10px] uppercase tracking-luxe text-brand-muted/80 transition-colors hover:text-brand-fg"
        >
          <Camera className="h-3.5 w-3.5" />
          Back to single photo
        </button>
      )}
    </Modal>
  );
}
