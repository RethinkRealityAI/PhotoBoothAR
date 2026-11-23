/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The reveals list (/admin/reveals), as a view over injected loaders so the
 * DEV harness can show it without a database. States, all honest:
 * loading · failed (migration 052 not applied is the likely first cause) ·
 * empty · the cards. The empty and failed states both link the seven live
 * demos, which need no database at all.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import {
  OCCASION_META, REVEAL_OCCASIONS, THEME_PALETTES, UNLOCK_META, demoRevealPath, type RevealOccasion,
} from '../../../lib/reveals/revealModel';
import type { RevealRow } from '../../../lib/reveals/revealApi';
import { NAME_MAX, cleanName, relativeTime, revealStatus } from '../../../lib/reveals/revealEditor';
import { StatusChip } from './RevealPanels';
import { ThemeSwatch } from './fields';

export interface RevealsListProps {
  load: () => Promise<RevealRow[] | 'failed'>;
  create: (occasion: RevealOccasion, name: string, taken: readonly string[]) => Promise<RevealRow | 'failed'>;
  /** The editor URL for a reveal. */
  editorPath: (id: string) => string;
}

const btnQuiet = 'pressable inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-[13px] font-medium text-brand-fg';
const btnPrimary = 'pressable inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-foil text-[color:var(--on-accent)] text-[13px] font-semibold disabled:opacity-50';

function Demos() {
  return (
    <div className="mt-6">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-brand-muted/70">Try the live demos</p>
      <div className="mt-2.5 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {REVEAL_OCCASIONS.map((o) => (
          <a
            key={o}
            href={demoRevealPath(o)}
            target="_blank"
            rel="noopener noreferrer"
            className="pressable flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] px-3 min-h-12 text-left"
          >
            <ThemeSwatch palette={THEME_PALETTES[OCCASION_META[o].theme]} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-brand-fg">{OCCASION_META[o].label}</span>
              <span className="block truncate text-[12px] text-brand-muted/70">{UNLOCK_META[OCCASION_META[o].unlock].label}</span>
            </span>
            <ExternalLink className="h-4 w-4 shrink-0 text-brand-muted/60" aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}

function NewRevealDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (o: RevealOccasion, name: string) => Promise<boolean> }) {
  const [occasion, setOccasion] = useState<RevealOccasion>('feature-drop');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalName = cleanName(name) || OCCASION_META[occasion].label;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const ok = await onCreate(occasion, finalName);
    setBusy(false);
    if (!ok) setError('Couldn’t create it. If reveals have never worked here, they need a one-time database update (migration 052).');
  };
  return (
    <Modal title="New reveal" onClose={onClose} maxWidthClass="max-w-xl" dismissOnScrim={false}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label htmlFor="nr-name" className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-brand-muted/70 mb-1.5">Name</label>
        <input
          id="nr-name"
          autoFocus
          maxLength={NAME_MAX}
          value={name}
          placeholder={OCCASION_META[occasion].label}
          onChange={(e) => setName(e.target.value)}
          className="w-full min-h-11 rounded-xl bg-white/[0.04] border border-white/10 px-3 text-[15px] text-brand-fg placeholder:text-brand-muted/50 focus:outline-none focus:border-[color:var(--color-accent)]/60"
        />
        <p className="mt-4 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-brand-muted/70" id="nr-occ">Start from</p>
        <div className="grid sm:grid-cols-2 gap-2 max-h-[46dvh] overflow-y-auto pr-1" role="radiogroup" aria-labelledby="nr-occ">
          {REVEAL_OCCASIONS.map((o) => {
            const m = OCCASION_META[o];
            const on = occasion === o;
            return (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setOccasion(o)}
                className={`pressable flex items-start gap-3 rounded-xl border px-3 py-2.5 min-h-12 text-left transition-colors ${on ? 'border-white/80 bg-white/[0.12]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}
              >
                <ThemeSwatch palette={THEME_PALETTES[m.theme]} size="sm" />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-brand-fg">{m.label}</span>
                  <span className="block text-[12px] leading-snug text-brand-muted/75">{m.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-3 text-[13px] text-red-300">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={busy} className={`${btnPrimary} flex-1 justify-center`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            Create and edit
          </button>
          <button type="button" onClick={onClose} disabled={busy} className={`${btnQuiet} flex-1 justify-center`}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export default function RevealsListView({ load, create, editorPath }: RevealsListProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RevealRow[] | 'failed' | null>(null);
  const [dialog, setDialog] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setRows(null);
    const r = await load();
    setRows(r);
    setNow(Date.now());
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);

  const onCreate = async (o: RevealOccasion, name: string) => {
    const taken = Array.isArray(rows) ? rows.map((r) => r.slug) : [];
    const res = await create(o, name, taken);
    if (res === 'failed') return false;
    navigate(editorPath(res.id));
    return true;
  };

  return (
    <div className="min-h-full px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Reveals</h1>
            <p className="mt-1 text-[13px] text-brand-muted/80 max-w-[60ch]">
              Beamwall’s own announcement emails. Each one has a glowing button that opens a page where Beamy guards the news until the reader unlocks it.
            </p>
          </div>
          <button type="button" onClick={() => setDialog(true)} className={`${btnPrimary} ml-auto`}>
            <Plus className="h-4 w-4" aria-hidden /> New reveal
          </button>
        </header>

        {rows === null && (
          <div className="liquid-glass rounded-2xl p-10 grid place-items-center">
            <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-brand-muted/70" aria-label="Loading reveals" />
          </div>
        )}

        {rows === 'failed' && (
          <div className="liquid-glass rounded-2xl p-5 md:p-6">
            <div className="flex items-start gap-3" role="alert">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300 mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-brand-fg">Couldn’t load reveals</p>
                <p className="mt-1 text-[13px] leading-relaxed text-brand-muted/80">
                  Reveals need a one-time database update (migration 052). If it is already applied, check your connection and try again.
                </p>
              </div>
              <button type="button" onClick={() => void refresh()} className={btnQuiet}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Retry
              </button>
            </div>
            <Demos />
          </div>
        )}

        {Array.isArray(rows) && rows.length === 0 && (
          <div className="liquid-glass rounded-2xl p-6 md:p-8">
            <p className="wz-display text-[22px] text-brand-fg">No reveals yet</p>
            <p className="mt-1 text-[13.5px] text-brand-muted/80">Start from an occasion: the words, colour and unlock come with it.</p>
            <button type="button" onClick={() => setDialog(true)} className={`${btnPrimary} mt-4`}>
              <Plus className="h-4 w-4" aria-hidden /> New reveal
            </button>
            <Demos />
          </div>
        )}

        {Array.isArray(rows) && rows.length > 0 && (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((r) => {
              const status = revealStatus(r.draft, r.published);
              return (
                <li key={r.id}>
                  <Link to={editorPath(r.id)} className="pressable liquid-glass rounded-2xl p-4 flex flex-col gap-3 h-full hover:bg-white/[0.04]">
                    <div className="flex items-start gap-3">
                      <ThemeSwatch palette={THEME_PALETTES[r.draft.theme]} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-brand-fg">{r.name}</p>
                        <p className="truncate font-mono text-[12px] text-brand-muted/70">/reveal/{r.slug}</p>
                      </div>
                      <StatusChip status={status} />
                    </div>
                    <div className="mt-auto flex items-center gap-2 text-[12px] text-brand-muted/75">
                      <span className="truncate">{OCCASION_META[r.draft.occasion].label}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{UNLOCK_META[r.draft.unlock].label}</span>
                      <span className="ml-auto shrink-0">{relativeTime(r.updatedAt, now)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {dialog && <NewRevealDialog onClose={() => setDialog(false)} onCreate={onCreate} />}
    </div>
  );
}
