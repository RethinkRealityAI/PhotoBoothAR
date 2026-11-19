/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One dialog, two shapes: a bottom sheet on phones (thumb reach, drag the
 * handle down to dismiss, safe-area aware) and a centred modal from 640px up,
 * where a sheet pinned to the bottom of a wide screen reads as a cookie
 * banner. Same content, same focus trap, Escape and scrim close either way
 * (lib/useDialog), and it announces itself as a modal dialog.
 *
 * Render it inside an AnimatePresence: the enter/exit motion lives here, and
 * under prefers-reduced-motion both shapes only fade.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { motion, useDragControls, useReducedMotion } from 'motion/react';
import { useDialog } from '../../lib/useDialog';

const WIDE = '(min-width: 640px)';

function subscribeWide(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function readWide(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(WIDE).matches;
}

/** Past either of these the sheet closes instead of springing back. */
const DISMISS_OFFSET_PX = 110;
const DISMISS_VELOCITY = 650;

export default function ResponsiveSheet({
  onClose,
  label,
  children,
  zClass = 'z-[70]',
  panelClassName = '',
  tone,
}: {
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
  zClass?: string;
  panelClassName?: string;
  /** Scene tone for the panel's ink (`data-scene-ui`). */
  tone?: 'dark' | 'light';
}) {
  const wide = useSyncExternalStore(subscribeWide, readWide, () => false);
  const reduced = useReducedMotion() ?? false;
  const drag = useDragControls();
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, label);

  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : wide
      ? { initial: { opacity: 0, y: 24, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 16, scale: 0.98 } }
      : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } };

  return (
    <motion.div
      data-scene-ui={tone}
      className={`absolute inset-0 ${zClass} flex ${wide ? 'items-center justify-center p-6' : 'items-end justify-center'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Scrim: tap to close, same as Skip. */}
      <div
        aria-hidden
        className="absolute inset-0 backdrop-blur-[3px]"
        style={{ background: 'var(--sc-scrim, rgba(10, 9, 34, 0.6))' }}
        onClick={onClose}
      />
      <motion.div
        ref={panelRef}
        {...dialogProps}
        {...enter}
        transition={{ duration: reduced ? 0.2 : 0.42, ease: [0.16, 1, 0.3, 1] }}
        drag={wide || reduced ? false : 'y'}
        dragListener={false}
        dragControls={drag}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > DISMISS_OFFSET_PX || info.velocity.y > DISMISS_VELOCITY) onClose();
        }}
        className={`sc-glass-strong relative w-full overflow-hidden outline-none ${
          wide
            ? 'max-w-[520px] rounded-[32px]'
            : 'max-h-[92dvh] rounded-t-[30px] pb-safe-bottom [--safe-bottom:1.25rem]'
        } ${panelClassName}`}
      >
        {!wide && (
          // The grab handle. Only this strip starts a drag, so horizontal
          // swipes and taps inside the content keep working.
          <div
            className="flex h-7 w-full cursor-grab touch-none items-center justify-center"
            onPointerDown={(e) => drag.start(e)}
            aria-hidden
          >
            <span className="h-1.5 w-11 rounded-full opacity-50" style={{ background: 'var(--sc-faint, rgba(255,255,255,0.6))' }} />
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  );
}
