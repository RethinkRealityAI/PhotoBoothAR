/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RailToggle — the ONE collapse / expand control every desktop side menu uses
 * (host rail, admin rail, Studio docks, editor options panel, sales hub rail,
 * library categories). A real <button> with aria-expanded + aria-controls, a
 * 44px target, and a tooltip naming what it does. `side` is the edge the menu
 * sits on, so the icon always points the way the panel will move.
 */
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import Tooltip from './Tooltip';

interface RailToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  /** What the panel is called in the label: "menu", "Assets panel"… */
  label: string;
  /** id of the element this button shows and hides. */
  controls?: string;
  side?: 'left' | 'right';
  className?: string;
}

export default function RailToggle({ collapsed, onToggle, label, controls, side = 'left', className = '' }: RailToggleProps) {
  const Icon = side === 'left' ? (collapsed ? PanelLeftOpen : PanelLeftClose) : collapsed ? PanelRightOpen : PanelRightClose;
  const action = `${collapsed ? 'Expand' : 'Collapse'} ${label}`;
  return (
    <Tooltip label={action} side={side === 'left' ? 'right' : 'left'}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={controls}
        aria-label={action}
        className={`pressable grid place-items-center w-11 h-11 shrink-0 rounded-xl text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] transition-colors ${className}`}
      >
        <Icon className="w-[18px] h-[18px]" aria-hidden />
      </button>
    </Tooltip>
  );
}
