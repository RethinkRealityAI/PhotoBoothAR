/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EditorShell — the platform's standard full-viewport editor layout, grown
 * from the host setup wizard (owner, 2026-11-22: "nicely organised tabs, then
 * the preview window and everything nicely contained in the viewport").
 *
 *   desktop (lg)  header · [ options card: tabs + ONE panel that scrolls
 *                 inside itself ] [ pinned preview with its own toolbar ]
 *                 The page never scrolls: 100dvh, every scroll is inside.
 *   phone         header · preview on top · options in a drag-up drawer
 *                 whose top row is the tab bar (EditorSheet)
 *
 * Saving lives in the header (SaveChip + the `actions` slot), so no footer
 * ever sits over the content. Generic on purpose: it knows tabs, a panel, a
 * preview and actions, nothing about what is being edited.
 */
import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { useIsDesktop } from '../../pages/host/wizard/PreviewSheet';
import SaveChip, { type EditorSaveState } from './SaveChip';
import EditorSheet from './EditorSheet';

export interface EditorTab {
  id: string;
  label: string;
  /** Shorter label for the phone tab bar (defaults to `label`). */
  short?: string;
  Icon?: LucideIcon;
  /** One line under the tab bar saying what this group is for. */
  blurb?: string;
}

export interface EditorShellProps {
  /** Where the back link goes, and what it says ("Reveals"). */
  backTo: string;
  backLabel: string;
  /** Called on a back-link click; call `e.preventDefault()` to stay (unsaved edits). */
  onBack?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** What is being edited ("Spring launch"). */
  title: string;
  /** A small line or chip beside the title (a status). */
  titleAside?: ReactNode;
  saveState: EditorSaveState;
  onRetrySave?: () => void;
  /** The header's right side: the primary action (Publish…). */
  actions?: ReactNode;
  tabs: readonly EditorTab[];
  tab: string;
  onTab: (id: string) => void;
  /** Accessible name of the tab list ("Reveal settings"). */
  tabsLabel: string;
  /** The ACTIVE tab's panel. One group visible at a time. */
  children: ReactNode;
  /** The live preview; fills the pane (use FitFrame inside). */
  preview: ReactNode;
  /** Above the preview: a view switch, Replay… */
  previewBar?: ReactNode;
  /** Share of the width the preview takes on desktop. Default 'wide'. */
  previewSize?: 'balanced' | 'wide';
}

function TabBar({ tabs, tab, onTab, label, phone }: { tabs: readonly EditorTab[]; tab: string; onTab: (id: string) => void; label: string; phone: boolean }) {
  return (
    <div
      className="wz-tabs w-full !grid !overflow-visible"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      role="tablist"
      aria-label={label}
    >
      {tabs.map(({ id, label: l, short, Icon }) => (
        <button
          key={id}
          id={`ed-tab-${id}`}
          type="button"
          role="tab"
          aria-selected={tab === id}
          aria-controls="ed-panel"
          className={`wz-tab justify-center min-w-0 ${phone ? '!px-1 !text-[12.5px]' : '!px-2'}`}
          onClick={() => onTab(id)}
        >
          {Icon && !phone && <Icon className="hidden xl:block h-4 w-4 shrink-0" aria-hidden />}
          <span className="truncate">{phone ? (short ?? l) : l}</span>
        </button>
      ))}
    </div>
  );
}

export default function EditorShell(p: EditorShellProps) {
  const desktop = useIsDesktop();
  const active = p.tabs.find((t) => t.id === p.tab) ?? p.tabs[0];

  const header = (
    <header className="flex-none px-3 sm:px-4 lg:px-6 pt-[max(10px,env(safe-area-inset-top))] pb-2.5">
      <div className="mx-auto max-w-[1600px] flex items-center gap-2 sm:gap-3">
        <Link
          to={p.backTo}
          onClick={p.onBack}
          className="pressable liquid-glass-raised inline-flex items-center gap-1.5 rounded-full min-h-11 min-w-11 justify-center px-3 sm:px-4 text-[14px] font-medium shrink-0"
          aria-label={`Back to ${p.backLabel}`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{p.backLabel}</span>
        </Link>
        <div className="min-w-0 flex-1 flex items-center gap-2.5">
          <h1 className="wz-display min-w-0 truncate text-[17px] sm:text-[20px] text-white">{p.title}</h1>
          {p.titleAside && <span className="hidden md:inline-flex shrink-0">{p.titleAside}</span>}
        </div>
        <SaveChip state={p.saveState} onRetry={p.onRetrySave} compact={!desktop} />
        {p.actions && <div className="flex items-center gap-2 shrink-0">{p.actions}</div>}
      </div>
    </header>
  );

  const panel = (
    <div id="ed-panel" role="tabpanel" aria-labelledby={`ed-tab-${active.id}`} tabIndex={-1} className="outline-none">
      {active.blurb && <p className="text-[13px] text-white/70 mb-4">{active.blurb}</p>}
      {p.children}
    </div>
  );

  const previewPane = (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      {p.previewBar && <div className="flex-none">{p.previewBar}</div>}
      <div className="flex-1 min-h-0">{p.preview}</div>
    </div>
  );

  return (
    <div data-platform data-surface="night" className="wz-root app-bg flex flex-col h-[100dvh] !min-h-0 overflow-hidden">
      {header}
      {desktop ? (
        <div
          className={`flex-1 min-h-0 mx-auto w-full max-w-[1600px] px-6 pb-5 grid gap-6 xl:gap-7 ${
            p.previewSize === 'balanced'
              ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
              : 'grid-cols-[minmax(400px,0.85fr)_minmax(0,1.15fr)]'
          }`}
        >
          <section className="liquid-glass rounded-[28px] flex flex-col min-h-0 overflow-hidden">
            <div className="flex-none px-5 pt-5 pb-3">
              <TabBar tabs={p.tabs} tab={active.id} onTab={p.onTab} label={p.tabsLabel} phone={false} />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-1 pb-8 [scrollbar-width:thin]">
              {panel}
            </div>
          </section>
          <aside aria-label="Preview" className="min-h-0">{previewPane}</aside>
        </div>
      ) : (
        <EditorSheet
          label={p.tabsLabel}
          preview={previewPane}
          tabBar={<TabBar tabs={p.tabs} tab={active.id} onTab={p.onTab} label={p.tabsLabel} phone />}
        >
          {panel}
        </EditorSheet>
      )}
    </div>
  );
}
