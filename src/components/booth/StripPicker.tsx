/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StripPicker — the photo-strip format chooser.
 *
 * The strip button used to arm a fixed 3-shot strip in place; guests had no
 * idea what the toggle meant until three countdowns fired at them. Now the
 * button opens this small dialog: pick 2 or 3 shots (with a mini layout
 * preview of the card each produces), or drop back to a single photo.
 */
import { Camera } from 'lucide-react';
import Modal from '../ui/Modal';
import { haptic } from '../../lib/haptics';
import { STRIP_SHOT_CHOICES, type StripShotCount } from '../../lib/photoStrip';

function StripGlyph({ shots }: { shots: number }) {
  return (
    <span
      aria-hidden
      className="flex h-16 w-11 flex-col gap-1 rounded-lg border border-white/15 bg-white/[0.04] p-1"
    >
      {Array.from({ length: shots }, (_, i) => (
        <span
          key={i}
          className="w-full flex-1 rounded-[3px]"
          style={{
            background:
              'linear-gradient(135deg, rgba(var(--accent-rgb),0.75), rgba(var(--accent-rgb),0.3))',
          }}
        />
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
  current: StripShotCount;
  onPick: (n: StripShotCount) => void;
  onSingle: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Photo strip" onClose={onClose} zClass="z-[80]" maxWidthClass="max-w-sm">
      <p className="mb-5 font-sans text-sm leading-relaxed text-brand-muted/80">
        A quick series of poses, arranged into one keepsake card in your event&rsquo;s colours.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {STRIP_SHOT_CHOICES.map((n) => {
          const on = stripMode && current === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => { haptic('select'); onPick(n); }}
              aria-pressed={on}
              className={`pressable flex flex-col items-center gap-2.5 rounded-2xl border p-4 transition-colors ${
                on
                  ? 'border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/10'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <StripGlyph shots={n} />
              <span className="font-label text-[11px] uppercase tracking-luxe text-brand-fg">
                {n} shots
              </span>
              <span className="font-sans text-[11px] leading-snug text-brand-muted/70">
                {n === 2 ? 'Two big moments' : 'The classic strip'}
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
