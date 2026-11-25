/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallHeader — the platform wall's chrome (legacy builds keep the original
 * header in Wall.tsx byte-for-byte).
 *
 * ONE balanced bar, the event's name dead centre:
 *
 *   [ Wall ▾ ]  [● 12 moments]      Event name      [ ▦ Gallery ▾ ]  [ ⤢ Project ]
 *
 *  - left:   the guest pages as a compact menu (the same list GuestNav draws,
 *            via useGuestDests) and the live moment counter;
 *  - centre: the event wordmark, on the true centre line whatever the sides hold
 *            (a 1fr · auto · 1fr grid, so a wider left never pushes it over);
 *  - right:  ONE Display menu (layout, QR codes, share) and Project.
 *
 * It replaced two stacked rows of pills (pages, then six layouts + QR + Share
 * + Project) with the name squeezed off to the left. A layout is picked once
 * per screen and the QR codes once per evening, so they live one tap away in a
 * menu instead of permanently on top of the photos.
 *
 * Phones: counter · name · Display, and the pages stay in GuestNav's bottom
 * tab bar. Every size is `calc(Npx * var(--wall-scale))`, so it reads from
 * across a ballroom on a 4K projector and never drops below 12px at the
 * 1440×900 design size.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, ChevronDown, Maximize, QrCode } from 'lucide-react';
import { Wordmark } from '../ui/EventLogo';
import GuestNav, { useGuestDests } from '../ui/GuestNav';
import ShareButton from '../ui/ShareButton';
import { haptic } from '../../lib/haptics';

export interface WallTab<Id extends string> {
  id: Id;
  label: string;
  Icon: (p: { className?: string; 'aria-hidden'?: boolean }) => ReactNode;
  /** Spans the whole row of the Display menu's layout grid. */
  wide?: boolean;
}

interface Props<Id extends string> {
  barRef: Ref<HTMLElement>;
  tabs: WallTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  count: number;
  /** The realtime-health dot (Wall's SocketDot). */
  socket: ReactNode;
  showQR: boolean;
  onToggleQR: () => void;
  onProject: () => void;
  driftStyle: CSSProperties;
  /** An optional last row (the phone-only Mine chip). Inside the header so
   *  the measured header height pushes the wall down instead of covering it. */
  extra?: ReactNode;
}

const px = (n: number): CSSProperties => ({ fontSize: `calc(${n}px * var(--wall-scale, 1))` });
const LABEL = px(12);
const PILL = 'pressable wall-glass flex items-center gap-1.5 rounded-full px-3.5 min-h-11 font-sans font-medium text-champagne hover:text-ivory transition-colors';

function Counter({ count, socket, compact = false }: { count: number; socket: ReactNode; compact?: boolean }) {
  return (
    <div
      className={`wall-glass flex items-center rounded-full min-h-11 ${compact ? 'gap-2 px-3' : 'gap-2.5 px-4'}`}
      aria-live="polite"
      aria-label={`${count} ${count === 1 ? 'moment' : 'moments'} on the wall`}
    >
      {socket}
      <span className="font-serif leading-none tabular-nums text-ivory" style={px(compact ? 17 : 20)}>
        {count}
      </span>
      {!compact && (
        <span className="font-sans text-champagne/80" style={LABEL}>
          {count === 1 ? 'moment' : 'moments'}
        </span>
      )}
    </div>
  );
}

/**
 * A button with a panel under it. Closes on a tap outside, on Escape (focus
 * goes back to the button) and when the panel's content asks to.
 */
function Popover({
  label, button, align, children, buttonClass, title,
}: {
  label: string;
  button: ReactNode;
  align: 'start' | 'end';
  children: (close: () => void) => ReactNode;
  buttonClass: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => { haptic('tap'); setOpen((o) => !o); }}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={title ?? label}
        className={buttonClass}
        style={LABEL}
      >
        {button}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={`wall-glass wall-panel top-full mt-2 z-50 rounded-3xl p-2 ${align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}`}
            // Inline: .wall-glass (unlayered CSS) sets position: relative and
            // would beat an `absolute` utility, pushing the whole bar down.
            style={{ position: 'absolute' }}
          >
            {children(close)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The guest pages (Booth, Challenges, Photos, Upload) as one compact menu. */
function PagesMenu() {
  const { dests, active, basePath } = useGuestDests('wall');
  const here = dests.find((d) => d.key === active);
  return (
    <Popover
      label="Go to another page"
      align="start"
      buttonClass={PILL}
      button={(
        <>
          {here !== undefined && <here.Icon size={16} />}
          <span>{here?.label ?? 'Wall'}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </>
      )}
    >
      {(close) => (
        <nav aria-label="Primary" className="flex flex-col gap-0.5" style={{ minWidth: 'calc(200px * var(--wall-scale, 1))' }}>
          {dests.map((d) => {
            const on = d.key === active;
            return (
              <Link
                key={d.key}
                to={`${basePath}${d.to}`}
                onClick={() => { haptic('tap'); close(); }}
                aria-current={on ? 'page' : undefined}
                className={`wall-menu-item pressable flex items-center gap-3 rounded-2xl px-3 min-h-11 font-sans font-medium ${on ? 'text-ivory' : 'text-champagne/85 hover:text-ivory'}`}
                style={px(14)}
              >
                <d.Icon size={18} />
                <span className="flex-1">{d.label}</span>
                {on && <Check className="h-4 w-4 opacity-80" aria-hidden />}
              </Link>
            );
          })}
        </nav>
      )}
    </Popover>
  );
}

/** A switch row: the whole row is the control. */
function SwitchRow({ on, onToggle, title, hint, Icon }: {
  on: boolean; onToggle: () => void; title: string; hint: string; Icon: typeof QrCode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => { haptic('tap'); onToggle(); }}
      className="wall-menu-item pressable flex w-full items-center gap-3 rounded-2xl px-3 py-2 min-h-12 text-left"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-champagne" aria-hidden />
      <span className="flex-1 min-w-0">
        <span className="block font-sans font-medium text-ivory" style={px(14)}>{title}</span>
        <span className="block font-sans text-champagne/70" style={LABEL}>{hint}</span>
      </span>
      <span className={`wall-switch ${on ? 'is-on' : ''}`} aria-hidden><span /></span>
    </button>
  );
}

export default function WallHeader<Id extends string>({
  barRef, tabs, active, onSelect, count, socket, showQR, onToggleQR, onProject, driftStyle, extra,
}: Props<Id>) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  const display = (
    <Popover
      label="Display options for this screen"
      title="Layout, QR codes and sharing"
      align="end"
      buttonClass={`${PILL} max-sm:px-0 max-sm:min-w-11 max-sm:justify-center`}
      button={(
        <>
          {current !== undefined && <current.Icon className="h-4 w-4 shrink-0" aria-hidden />}
          <span className="hidden sm:inline">{current?.label ?? 'Display'}</span>
          <ChevronDown className="hidden sm:block h-3.5 w-3.5 opacity-70" aria-hidden />
        </>
      )}
    >
      {(close) => (
        <div style={{ width: 'min(calc(340px * var(--wall-scale, 1)), calc(100vw - 24px))' }}>
          <p className="px-3 pt-2 pb-1.5 font-sans font-medium text-champagne/70" style={LABEL}>Layout</p>
          <div className="grid grid-cols-3 gap-1.5 px-1" role="group" aria-label="Wall layout">
            {tabs.map(({ id, label, Icon, wide }) => {
              const on = id === active;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => { haptic('tap'); onSelect(id); close(); }}
                  aria-pressed={on}
                  className={`wall-tab pressable flex items-center justify-center rounded-2xl font-sans font-medium transition-colors ${wide ? 'col-span-3 gap-2 px-3 min-h-12' : 'flex-col gap-1.5 px-1 py-2.5 min-h-16'} ${on ? 'text-ivory' : 'text-champagne/80 hover:text-ivory'}`}
                  style={LABEL}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="leading-tight text-center">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="my-2 mx-3 h-px bg-white/10" aria-hidden />
          <p className="px-3 pb-1 font-sans font-medium text-champagne/70" style={LABEL}>On this screen</p>
          <SwitchRow
            on={showQR}
            onToggle={onToggleQR}
            title="QR codes"
            hint="Guests scan to join the booth"
            Icon={QrCode}
          />
          <ShareButton
            label="Share the wall"
            iconSize={18}
            className="wall-menu-item pressable flex w-full items-center gap-3 rounded-2xl px-3 min-h-12 font-sans font-medium text-[14px] text-ivory [&>svg]:text-champagne"
          />
          {/* Projection belongs to whoever drives the venue screen; on a phone
              it only ever produced a chrome-less dead end for a guest. */}
          <button
            type="button"
            onClick={() => { close(); onProject(); }}
            className="wall-menu-item pressable hidden sm:flex w-full items-center gap-3 rounded-2xl px-3 min-h-12 font-sans font-medium text-ivory"
            style={px(14)}
          >
            <Maximize className="h-[18px] w-[18px] text-champagne" aria-hidden />
            Project full screen
          </button>
        </div>
      )}
    </Popover>
  );

  return (
    <motion.header
      ref={barRef}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="wall-chrome relative z-40 shrink-0 flex flex-col items-center gap-2 px-3 pt-3 pb-2 sm:px-5"
      // Burn-in defence: the chrome drifts a few pixels over the evening.
      style={driftStyle}
    >
      {/* Pages live in GuestNav's bottom tab bar on phones; above that, in
          the compact menu on the left. */}
      <GuestNav current="wall" inline={false} />

      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 min-h-11">
        <div className="flex min-w-0 items-center justify-start gap-2">
          <div className="hidden sm:block"><PagesMenu /></div>
          <div className="hidden md:block"><Counter count={count} socket={socket} /></div>
          <div className="md:hidden"><Counter count={count} socket={socket} compact /></div>
        </div>

        <div className="wall-title flex min-w-0 justify-center">
          <span className="sm:hidden"><Wordmark size="sm" /></span>
          <span className="hidden sm:inline"><Wordmark size="md" /></span>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          {display}
          <button
            type="button"
            onClick={onProject}
            className={`${PILL} hidden lg:flex`}
            style={LABEL}
            title="Full screen: hides everything except the photos"
          >
            <Maximize className="h-4 w-4" aria-hidden />
            <span>Project</span>
          </button>
        </div>
      </div>
      {extra}
    </motion.header>
  );
}
