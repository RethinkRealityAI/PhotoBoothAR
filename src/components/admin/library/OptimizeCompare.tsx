/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optimize one model in the browser and compare it with the original before
 * switching: two live 3D viewers (side by side, stacked on a phone) lit
 * exactly like the booth, each with its size / triangles / texture size.
 * Nothing is uploaded until the apply button; "Keep original" just closes.
 * The caller decides what applying means (an import draft points at the new
 * file; a library item goes through replace_library_item_model; an event
 * model is copied into the library) — or passes no `onUse` for a compare
 * with nothing to apply (built-in models are files in the app itself).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../../ui/Modal';
import { ModelPreview } from '../../studio/DirectorCards';
import { evictModel } from '../../../lib/glbCache';
import { optimizeModelAt } from '../../../lib/libraryImportBrowser';
import {
  OPTIMIZE_PRESETS,
  OPTIMIZE_PRESET_LABEL,
  formatTextureEdge,
  formatTriangles,
  savingsPercent,
  worthKeeping,
  type OptimizePreset,
  type OptimizeStats,
} from '../../../lib/glbOptimizePlan';
import { formatBytes } from '../../../lib/libraryImport';

const BTN =
  'pressable inline-flex items-center justify-center gap-1.5 rounded-full px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] transition-colors disabled:opacity-40';

type RunState =
  | { status: 'running' }
  | { status: 'failed'; reason: string; stale: boolean }
  | { status: 'ready'; bytes: Uint8Array; stats: OptimizeStats; notes: string[]; url: string };

function StatList({ rows }: { rows: string[] }) {
  return (
    <ul className="mt-2 space-y-0.5 text-[11px] text-brand-muted/70 tabular-nums">
      {rows.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );
}

const DRAFT_FOOT_NOTE = 'Turn both to compare. The optimized copy is saved next to the original; the thumbnail stays as it is.';

export default function OptimizeCompare({
  name,
  modelUrl,
  onUse,
  useLabel = 'Use optimized',
  footNote = DRAFT_FOOT_NOTE,
  confirm,
  onClose,
}: {
  name: string;
  modelUrl: string;
  /** Apply the optimized bytes; true on success (the parent closes). Omitted = compare only. */
  onUse?: (bytes: Uint8Array, stats: OptimizeStats) => Promise<boolean>;
  /** The apply button's words. */
  useLabel?: string;
  /** What applying does (or, with no `onUse`, why nothing can be applied). */
  footNote?: string;
  /**
   * An irreversible apply asks first, IN this dialog (a second dialog on top
   * would share its Escape and focus handling): the apply button shows these
   * lines and a confirm button instead of applying straight away.
   */
  confirm?: { lines: string[]; label: string };
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<OptimizePreset>('balanced');
  const [run, setRun] = useState<RunState>({ status: 'running' });
  const [using, setUsing] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setRun({ status: 'running' });
    setAsking(false);
    void optimizeModelAt(modelUrl, OPTIMIZE_PRESETS[preset]).then((r) => {
      if (!alive) return;
      if (!r.ok) { setRun({ status: 'failed', reason: r.reason, stale: r.stale === true }); return; }
      made = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'model/gltf-binary' }));
      setRun({ status: 'ready', bytes: r.bytes, stats: r.stats, notes: r.notes, url: made });
    });
    return () => {
      alive = false;
      // The optimized scene lives in the shared glbCache under its object
      // URL; release both so a session of compares does not pile up meshes.
      if (made) { evictModel(made); URL.revokeObjectURL(made); }
    };
  }, [modelUrl, preset]);

  const ready = run.status === 'ready' ? run : null;
  const keep = ready ? worthKeeping(ready.stats) : false;

  const use = async () => {
    if (!ready || !onUse) return;
    setUsing(true);
    const ok = await onUse(ready.bytes, ready.stats);
    setUsing(false);
    setAsking(false);
    if (ok) onClose();
  };

  return (
    <Modal title={`Optimize — ${name}`} onClose={() => { if (!using) onClose(); }} maxWidthClass="max-w-4xl" dismissOnScrim={!using}>
      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Optimization strength">
        {(Object.keys(OPTIMIZE_PRESETS) as OptimizePreset[]).map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            disabled={run.status === 'running' || using}
            aria-pressed={preset === p}
            className={`${BTN} ${preset === p ? 'bg-white/[0.14] text-brand-fg' : 'bg-white/[0.04] text-brand-muted/70 hover:bg-white/[0.08]'}`}
          >
            {OPTIMIZE_PRESET_LABEL[p]}
          </button>
        ))}
        <span className="text-[11px] text-brand-muted/60">
          {preset === 'balanced'
            ? 'Textures up to 2048px, light simplifying only on dense meshes.'
            : 'Textures up to 1024px and stronger simplifying. Check the detail.'}
        </span>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <section className="min-w-0" aria-label="Original">
          <h3 className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 mb-1.5">Original</h3>
          <ModelPreview url={modelUrl} height={240} />
          {ready && (
            <StatList rows={[
              formatBytes(ready.stats.bytesBefore),
              formatTriangles(ready.stats.trianglesBefore),
              formatTextureEdge(ready.stats.textureMaxEdgeBefore),
            ]} />
          )}
        </section>

        <section className="min-w-0" aria-label="Optimized" aria-live="polite">
          <h3 className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 mb-1.5">Optimized</h3>
          {run.status === 'running' && (
            <div className="rounded-lg border border-white/10 flex flex-col items-center justify-center gap-2 px-4 text-center" style={{ height: 240, backgroundColor: '#05060B' }}>
              <Loader2 className="w-6 h-6 animate-spin text-[color:var(--color-accent)]" aria-hidden />
              <p className="text-xs text-brand-fg/80">Optimizing in your browser…</p>
              <p className="text-[11px] text-brand-muted/60">A big model can take a minute, and the page may pause while it works.</p>
            </div>
          )}
          {run.status === 'failed' && (
            <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.04] px-3 py-4 flex items-start gap-2 text-xs text-rose-100/90" style={{ minHeight: 240 }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-300" aria-hidden />
              <div className="flex flex-col items-start gap-3">
                <span>{run.reason}</span>
                {run.stale && (
                  <button type="button" onClick={() => window.location.reload()} className={`${BTN} bg-white/[0.08] hover:bg-white/[0.14] text-brand-fg`}>
                    Reload the page
                  </button>
                )}
              </div>
            </div>
          )}
          {ready && (
            <>
              <ModelPreview url={ready.url} height={240} />
              <StatList rows={[
                `${formatBytes(ready.stats.bytesAfter)}${savingsPercent(ready.stats.bytesBefore, ready.stats.bytesAfter) > 0 ? ` · ${savingsPercent(ready.stats.bytesBefore, ready.stats.bytesAfter)}% smaller` : ''}`,
                formatTriangles(ready.stats.trianglesAfter),
                formatTextureEdge(ready.stats.textureMaxEdgeAfter),
                `Took ${ready.stats.seconds}s`,
              ]} />
            </>
          )}
        </section>
      </div>

      {ready && ready.notes.map((n) => (
        <p key={n} className="mt-3 text-[11px] text-amber-200/90 flex gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden /> {n}
        </p>
      ))}
      {ready && !keep && onUse && (
        <p className="mt-3 text-xs text-brand-muted/70">It saves too little to be worth it. Keep the original.</p>
      )}
      <p className="mt-3 text-[11px] text-brand-muted/60">{footNote}</p>

      {asking && confirm && (
        <div role="group" aria-label="Confirm" className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] px-4 py-3 font-sans text-xs text-brand-fg/85 leading-relaxed">
          {confirm.lines.map((l) => <p key={l} className="mb-1.5 last:mb-0">{l}</p>)}
        </div>
      )}
      <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
        {asking && confirm ? (
          <>
            <button onClick={() => setAsking(false)} disabled={using} className={`${BTN} bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/80 sm:flex-1`}>
              Back
            </button>
            <button onClick={() => void use()} disabled={!ready || using} className={`${BTN} bg-foil text-[color:var(--on-accent)] font-bold sm:flex-1`}>
              {using ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Saving…</> : confirm.label}
            </button>
          </>
        ) : (<>
        <button onClick={onClose} disabled={using} className={`${BTN} bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/80 sm:flex-1`}>
          {onUse ? 'Keep original' : 'Close'}
        </button>
        {onUse && (
          <button
            onClick={() => { if (confirm) setAsking(true); else void use(); }}
            disabled={!ready || !keep || using}
            className={`${BTN} bg-foil text-[color:var(--on-accent)] font-bold sm:flex-1`}
          >
            {using ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Saving…</> : useLabel}
          </button>
        )}
        </>)}
      </div>
    </Modal>
  );
}
