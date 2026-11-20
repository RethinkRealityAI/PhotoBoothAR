/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallHeader — the platform wall's chrome (legacy builds keep the original
 * header in Wall.tsx byte-for-byte). Calm by design: no dark band painted
 * over the photos, just floating glass — the event wordmark on the left, the
 * guest nav centred, a live moment counter on the right, and one slim row
 * beneath with the view switcher and this screen's own controls. Every size
 * is `calc(Npx * var(--wall-scale))`, so it reads from across a ballroom on a
 * 4K projector and never drops below 12px at the 1440×900 design size.
 */
import type { CSSProperties, ReactNode, Ref } from 'react';
import { motion } from 'motion/react';
import { Maximize, QrCode } from 'lucide-react';
import { Wordmark } from '../ui/EventLogo';
import GuestNav from '../ui/GuestNav';
import ShareButton from '../ui/ShareButton';

export interface WallTab<Id extends string> {
  id: Id;
  label: string;
  Icon: (p: { className?: string; 'aria-hidden'?: boolean }) => ReactNode;
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
}

const LABEL: CSSProperties = { fontSize: 'calc(12px * var(--wall-scale, 1))' };

function Counter({ count, socket }: { count: number; socket: ReactNode }) {
  return (
    <div className="wall-glass flex items-center gap-2.5 rounded-full px-4 min-h-11" aria-live="polite">
      {socket}
      <span className="font-serif leading-none tabular-nums text-ivory" style={{ fontSize: 'calc(20px * var(--wall-scale, 1))' }}>
        {count}
      </span>
      <span className="font-sans text-champagne/80" style={LABEL}>
        {count === 1 ? 'moment' : 'moments'}
      </span>
    </div>
  );
}

export default function WallHeader<Id extends string>({
  barRef, tabs, active, onSelect, count, socket, showQR, onToggleQR, onProject, driftStyle,
}: Props<Id>) {
  const pill = 'pressable wall-glass flex items-center gap-1.5 rounded-full px-3.5 min-h-11 font-sans font-medium text-champagne hover:text-ivory transition-colors';
  return (
    <motion.header
      ref={barRef}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="wall-chrome relative z-30 shrink-0 flex flex-col items-center gap-2 px-3 pt-3 pb-2 sm:px-5"
      // Burn-in defence: the chrome drifts a few pixels over the evening.
      style={driftStyle}
    >
      <div className="relative hidden sm:flex w-full items-center justify-center min-h-11">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 hidden lg:flex">
          <div className="wall-glass flex items-center rounded-full px-4 min-h-11">
            <Wordmark size="sm" />
          </div>
        </div>
        <GuestNav current="wall" />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 hidden lg:flex">
          <Counter count={count} socket={socket} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 max-w-full">
        <div className="lg:hidden">
          <Counter count={count} socket={socket} />
        </div>
        <div className="wall-glass flex rounded-full p-1 gap-0.5 max-w-full overflow-x-auto hide-scrollbar" aria-label="Wall view">
          {tabs.map(({ id, label, Icon }) => {
            const on = id === active;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                aria-pressed={on}
                title={label}
                aria-label={label}
                className={`wall-tab pressable flex shrink-0 items-center gap-1.5 rounded-full px-3 min-h-10 min-w-10 justify-center font-sans font-medium transition-colors ${
                  on ? 'is-selected text-ivory' : 'text-champagne/75 hover:text-ivory'
                }`}
                style={LABEL}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="hidden md:inline">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleQR}
            aria-pressed={showQR}
            className={pill}
            style={LABEL}
            title={showQR ? 'Hide the QR codes on this screen' : 'Show the QR codes on this screen'}
          >
            <QrCode className="h-4 w-4" aria-hidden />
            <span className="hidden md:inline">{showQR ? 'QR on' : 'QR off'}</span>
          </button>
          <ShareButton label="" iconSize={16} className={`${pill} md:hidden`} />
          <span className="hidden md:inline-flex" style={LABEL}>
            <ShareButton label="Share" iconSize={16} className={pill} />
          </span>
          {/* Projection is for whoever drives the venue screen; on a phone it
              only ever produced a chrome-less dead end for a guest. */}
          <button
            type="button"
            onClick={onProject}
            className={`${pill} hidden sm:flex`}
            style={LABEL}
            title="Full screen: hides everything except the photos"
          >
            <Maximize className="h-4 w-4" aria-hidden />
            <span className="hidden md:inline">Project</span>
          </button>
        </div>
      </div>
    </motion.header>
  );
}
