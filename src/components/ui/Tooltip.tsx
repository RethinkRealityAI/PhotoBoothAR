/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tooltip — the platform's first tooltip primitive. Portal-rendered so it
 * never clips inside overflow-hidden panels, delayed so it guides without
 * nagging, and dismissed on pointer-down so it stays out of the way of the
 * action it describes. Use for icon-only controls and non-obvious affordances;
 * skip it where a visible label already says the same thing.
 */
import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

type Side = 'top' | 'bottom' | 'left' | 'right';

const GAP = 8;
const SHOW_DELAY_MS = 450;

interface TooltipProps {
  label: ReactNode;
  /** Optional second line, rendered muted. */
  hint?: ReactNode;
  side?: Side;
  /** Disable without unwrapping (e.g. while dragging). */
  disabled?: boolean;
  children: ReactElement<Record<string, unknown>>;
}

function positionFor(rect: DOMRect, side: Side): { x: number; y: number } {
  switch (side) {
    case 'bottom':
      return { x: rect.left + rect.width / 2, y: rect.bottom + GAP };
    case 'left':
      return { x: rect.left - GAP, y: rect.top + rect.height / 2 };
    case 'right':
      return { x: rect.right + GAP, y: rect.top + rect.height / 2 };
    default:
      return { x: rect.left + rect.width / 2, y: rect.top - GAP };
  }
}

const TRANSFORMS: Record<Side, string> = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  left: 'translate(-100%, -50%)',
  right: 'translate(0, -50%)',
};


export default function Tooltip({ label, hint, side = 'top', disabled = false, children }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPos(null);
  }, []);

  useEffect(() => clear, [clear]);

  const schedule = useCallback(
    (el: HTMLElement) => {
      if (disabled) return;
      anchorRef.current = el;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const anchor = anchorRef.current;
        if (anchor && anchor.isConnected) setPos(positionFor(anchor.getBoundingClientRect(), side));
      }, SHOW_DELAY_MS);
    },
    [disabled, side],
  );

  if (!isValidElement(children)) return children;
  const childProps = children.props;

  const wrap =
    <E extends { currentTarget: EventTarget }>(theirs: unknown, mine: (e: E) => void) =>
    (e: E) => {
      if (typeof theirs === 'function') (theirs as (e: E) => void)(e);
      mine(e);
    };

  const trigger = cloneElement(children, {
    onPointerEnter: wrap(childProps.onPointerEnter, (e: React.PointerEvent) => schedule(e.currentTarget as HTMLElement)),
    onPointerLeave: wrap(childProps.onPointerLeave, clear),
    onPointerDown: wrap(childProps.onPointerDown, clear),
    onFocus: wrap(childProps.onFocus, (e: React.FocusEvent) => schedule(e.currentTarget as HTMLElement)),
    onBlur: wrap(childProps.onBlur, clear),
  });

  return (
    <>
      {trigger}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {pos && (
              <div
                className="fixed z-[100] pointer-events-none"
                style={{ left: pos.x, top: pos.y, transform: TRANSFORMS[side] }}
              >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                role="tooltip"
                className="max-w-[240px] rounded-lg liquid-glass px-2.5 py-1.5 shadow-xl"
              >
                <p className="font-label uppercase tracking-widest text-[9px] text-brand-fg leading-snug">{label}</p>
                {hint && <p className="font-sans text-[10px] text-brand-muted/80 leading-snug mt-0.5 normal-case tracking-normal">{hint}</p>}
              </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
