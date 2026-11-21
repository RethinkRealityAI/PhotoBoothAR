/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bulk optimize (/admin/library bulk bar → "Optimize N"). Runs the in-browser
 * optimizer over each selected library prop in turn, then shows one row per
 * model: size before → after, triangles, % saved and whether it is worth it.
 * Ticked rows (on by default only when worth it) are applied through the
 * SAME replace path as a single item (lib/libraryImportBrowser.ts
 * replaceModelFile → admin-api replace_library_item_model): swapped in place
 * when no event uses the item, otherwise added as a new version.
 *
 * Memory: no optimized bytes are kept. Each run keeps only its numbers
 * (libraryReplace.withRunResult); Apply optimizes each ticked model again as
 * it uploads it. Pure rules: lib/libraryReplace.ts.
 *
 * Compare opens the two-viewer compare IN PLACE of this dialog (never on top
 * of it: two dialogs would share Escape and focus handling) and comes back.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import Modal from '../../ui/Modal';
import OptimizeCompare from './OptimizeCompare';
import {
  fetchModelBytes,
  glbFile,
  modelFileAt,
  replaceModelFile,
  runOptimizer,
} from '../../../lib/libraryImportBrowser';
import { OPTIMIZE_PRESETS, formatSaving } from '../../../lib/glbOptimizePlan';
import {
  BULK_OPTIMIZE_MAX,
  bulkApplyPlan,
  bulkApplySummary,
  bulkOptRows,
  bulkRowFacts,
  glbFileName,
  replaceConsequence,
  replaceOutcomeText,
  withRunResult,
  type BulkOptRow,
} from '../../../lib/libraryReplace';

const BTN =
  'pressable inline-flex items-center justify-center gap-1.5 rounded-full px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] transition-colors disabled:opacity-40';
const QUIET = `${BTN} bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/80`;
const PRIMARY = `${BTN} bg-foil text-[color:var(--on-accent)] font-bold`;

export type BulkOptItem = Parameters<typeof bulkOptRows>[0][number];

const STATUS_WORD: Record<BulkOptRow['status'], string> = {
  waiting: 'Waiting',
  running: 'Optimizing…',
  done: '',
  failed: 'Could not optimize',
};

export default function BulkOptimizeModal({ items, skipped, capped, onApplied, onToast, onClose }: {
  items: readonly BulkOptItem[];
  /** Selected items left out (a scene, a withdrawn item, past the cap). */
  skipped: number;
  capped: boolean;
  /** Something was replaced: the page should re-read the library. */
  onApplied: () => void;
  onToast: (text: string, tone: 'success' | 'error') => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<BulkOptRow[]>(() => bulkOptRows(items));
  const [phase, setPhase] = useState<'running' | 'review' | 'asking' | 'applying'>('running');
  const [comparing, setComparing] = useState<BulkOptRow | null>(null);
  const alive = useRef(true);
  const applied = useRef(false);

  const patch = (id: string, f: (r: BulkOptRow) => BulkOptRow) =>
    setRows((rs) => rs.map((r) => (r.id === id ? f(r) : r)));

  // One model at a time: the optimizer is heavy, and only its numbers are kept.
  useEffect(() => {
    // Per-run flag (not only the ref): a remount must not leave two loops going.
    let cancelled = false;
    alive.current = true;
    const live = () => !cancelled && alive.current;
    void (async () => {
      for (const row of bulkOptRows(items)) {
        if (!live()) return;
        patch(row.id, (r) => ({ ...r, status: 'running' }));
        const got = await fetchModelBytes(row.modelUrl);
        const r = got.ok ? await runOptimizer(got.bytes, OPTIMIZE_PRESETS.balanced) : { ok: false as const, reason: got.reason };
        if (!live()) return;
        patch(row.id, (cur) => withRunResult(cur, r.ok ? { ok: true, stats: r.stats } : { ok: false, reason: r.reason }));
      }
      if (live()) setPhase('review');
    })();
    return () => { cancelled = true; };
  }, [items]);

  const close = () => {
    if (phase === 'applying') return;
    alive.current = false;
    if (applied.current) onApplied();
    onClose();
  };

  const plan = bulkApplyPlan(rows);

  const apply = async () => {
    setPhase('applying');
    const work = rows.map((r) => ({ ...r }));
    for (const id of plan.ids) {
      const row = work.find((r) => r.id === id);
      if (!row) continue;
      const set = (next: BulkOptRow) => { Object.assign(row, next); setRows(work.map((r) => ({ ...r }))); };
      set({ ...row, status: 'running' });
      const file = await modelFileAt(row.modelUrl, glbFileName(row.name));
      const run = file.ok
        ? await replaceModelFile({ id: row.id, name: row.name }, file.file, { optimize: OPTIMIZE_PRESETS.balanced, requireSmaller: true })
        : { ok: false as const, reason: file.reason };
      if (run.ok) {
        applied.current = true;
        const out = replaceOutcomeText(row.name, run.result);
        set({ ...row, status: 'done', applied: run.result.path, checked: false, applyError: out.tone === 'error' ? out.text : null });
      } else {
        set({ ...row, status: 'done', applyError: run.reason });
      }
    }
    setPhase('review');
    const sum = bulkApplySummary(work, plan.ids);
    onToast(sum.text, sum.tone);
  };

  if (comparing) {
    const c = replaceConsequence({ name: comparing.name, linkCount: comparing.linkCount, state: comparing.state }, capped);
    return (
      <OptimizeCompare
        name={comparing.name}
        modelUrl={comparing.modelUrl}
        useLabel="Use optimized"
        footNote={c.path === 'in_place'
          ? 'Use optimized swaps this item’s file for the smaller one. Events are not affected.'
          : 'Use optimized adds the smaller file as a new version. Events keep the file they have.'}
        confirm={{ lines: c.lines, label: c.path === 'in_place' ? 'Replace the file' : 'Add as a new version' }}
        onUse={async (bytes, stats) => {
          const row = comparing;
          const run = await replaceModelFile({ id: row.id, name: row.name }, glbFile(bytes, glbFileName(row.name)), { optimize: null });
          if (!run.ok) { onToast(`${row.name}: ${run.reason}`, 'error'); return false; }
          applied.current = true;
          const out = replaceOutcomeText(row.name, run.result, formatSaving(stats.bytesBefore, stats.bytesAfter));
          onToast(out.text, out.tone);
          patch(row.id, (r) => ({ ...r, applied: run.result.path, checked: false, applyError: out.tone === 'error' ? out.text : null }));
          return true;
        }}
        onClose={() => setComparing(null)}
      />
    );
  }

  const done = rows.filter((r) => r.status === 'done' || r.status === 'failed').length;
  return (
    <Modal title={`Optimize ${rows.length} model${rows.length === 1 ? '' : 's'}`} onClose={close} maxWidthClass="max-w-3xl" dismissOnScrim={false}>
      <p className="font-sans text-xs text-brand-muted/70 leading-relaxed mb-3" aria-live="polite">
        {phase === 'running'
          ? `Optimizing in your browser: ${done} of ${rows.length} done. A big model can take a minute.`
          : phase === 'applying'
            ? 'Uploading the optimized files…'
            : 'Ticked rows are applied. Each is ticked only when it saves enough to be worth it.'}
        {skipped > 0 && ` ${skipped} selected item${skipped === 1 ? ' was' : 's were'} left out (only 3D props hosts can use, at most ${BULK_OPTIMIZE_MAX} at a time).`}
      </p>

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const facts = bulkRowFacts(r);
          return (
            <li key={r.id} className="rounded-2xl bg-white/[0.03] border border-white/10 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <label className="flex items-start gap-2.5 min-w-0 flex-1 min-h-11 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 w-5 h-5 shrink-0 accent-[color:var(--color-accent)]"
                  checked={r.checked}
                  disabled={r.status !== 'done' || r.applied !== null || phase === 'applying' || phase === 'asking'}
                  onChange={(e) => patch(r.id, (x) => ({ ...x, checked: e.target.checked }))}
                  aria-label={`Apply to ${r.name}`}
                />
                <span className="min-w-0">
                  <span className="block font-sans text-sm text-brand-fg truncate">{r.name}</span>
                  {facts ? (
                    <span className="block font-sans text-[11px] text-brand-muted/70 tabular-nums">
                      {facts.size} · {facts.triangles} · {facts.saved} saved ·{' '}
                      <span className={facts.worth ? 'text-emerald-200/90' : 'text-brand-muted/60'}>{facts.worth ? 'Worth it' : 'Not worth it'}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 font-sans text-[11px] text-brand-muted/60">
                      {r.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
                      {STATUS_WORD[r.status]}{r.reason ? `: ${r.reason}` : ''}
                    </span>
                  )}
                  {r.applied !== null && (
                    <span className="flex items-center gap-1 font-sans text-[11px] text-emerald-200/90">
                      <Check className="w-3 h-3" aria-hidden />
                      {r.applied === 'in_place' ? 'File replaced' : 'Added as a new version'}
                    </span>
                  )}
                  {r.applyError !== null && (
                    <span className="flex gap-1 font-sans text-[11px] text-amber-200/90">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden /> {r.applyError}
                    </span>
                  )}
                </span>
              </label>
              <button
                type="button"
                onClick={() => setComparing(r)}
                disabled={phase !== 'review' || r.applied !== null || r.status !== 'done'}
                className={`${QUIET} shrink-0`}
              >
                Compare
              </button>
            </li>
          );
        })}
      </ul>

      {phase === 'asking' && (
        <div role="group" aria-label="Confirm" className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] px-4 py-3 font-sans text-xs text-brand-fg/85 leading-relaxed">
          {plan.inPlace > 0 && (
            <p className="mb-1.5">{plan.inPlace} no event uses yet: each gets the smaller file in place, keeping its name, category, tags and who can use it.</p>
          )}
          {plan.newVersion > 0 && (
            <p className="mb-1.5">{plan.newVersion} used by events: each gets a new version with the smaller file. Events keep the file they have now.</p>
          )}
          <p>Each model is optimized again as it uploads. This cannot be undone from here.</p>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
        {phase === 'asking' ? (
          <>
            <button type="button" onClick={() => setPhase('review')} className={`${QUIET} sm:flex-1`}>Back</button>
            <button type="button" onClick={() => void apply()} className={`${PRIMARY} sm:flex-1`}>Apply to {plan.ids.length}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={close} disabled={phase === 'applying'} className={`${QUIET} sm:flex-1`}>
              {phase === 'running' ? 'Stop' : 'Close'}
            </button>
            <button
              type="button"
              onClick={() => setPhase('asking')}
              disabled={phase !== 'review' || plan.ids.length === 0}
              className={`${PRIMARY} sm:flex-1`}
            >
              {phase === 'applying' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Applying…</> : `Apply${plan.ids.length > 0 ? ` to ${plan.ids.length}` : ''}`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
