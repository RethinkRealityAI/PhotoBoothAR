/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optimize one import draft in the browser and compare it with the original
 * before switching: two live 3D viewers (side by side, stacked on a phone)
 * lit exactly like the booth, each with its size / triangles / texture size.
 * Nothing is uploaded until "Use optimized"; "Keep original" just closes.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../../ui/Modal';
import { ModelPreview } from '../../studio/DirectorCards';
import { evictModel } from '../../../lib/glbCache';
import { optimizeDraftModel } from '../../../lib/libraryImportBrowser';
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
  | { status: 'failed'; reason: string }
  | { status: 'ready'; bytes: Uint8Array; stats: OptimizeStats; notes: string[]; url: string };

function StatList({ rows }: { rows: string[] }) {
  return (
    <ul className="mt-2 space-y-0.5 text-[11px] text-brand-muted/70 tabular-nums">
      {rows.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );
}

export default function OptimizeCompare({
  name,
  assetUrl,
  onUse,
  onClose,
}: {
  name: string;
  assetUrl: string;
  /** Upload + point the draft at the optimized bytes; true on success (the parent closes). */
  onUse: (bytes: Uint8Array, stats: OptimizeStats) => Promise<boolean>;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<OptimizePreset>('balanced');
  const [run, setRun] = useState<RunState>({ status: 'running' });
  const [using, setUsing] = useState(false);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setRun({ status: 'running' });
    void optimizeDraftModel(assetUrl, OPTIMIZE_PRESETS[preset]).then((r) => {
      if (!alive) return;
      if (!r.ok) { setRun({ status: 'failed', reason: r.reason }); return; }
      made = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'model/gltf-binary' }));
      setRun({ status: 'ready', bytes: r.bytes, stats: r.stats, notes: r.notes, url: made });
    });
    return () => {
      alive = false;
      // The optimized scene lives in the shared glbCache under its object
      // URL; release both so a session of compares does not pile up meshes.
      if (made) { evictModel(made); URL.revokeObjectURL(made); }
    };
  }, [assetUrl, preset]);

  const ready = run.status === 'ready' ? run : null;
  const keep = ready ? worthKeeping(ready.stats) : false;

  const use = async () => {
    if (!ready) return;
    setUsing(true);
    const ok = await onUse(ready.bytes, ready.stats);
    setUsing(false);
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
          <ModelPreview url={assetUrl} height={240} />
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
              <span>{run.reason}</span>
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
      {ready && !keep && (
        <p className="mt-3 text-xs text-brand-muted/70">It saves too little to be worth it. Keep the original.</p>
      )}
      <p className="mt-3 text-[11px] text-brand-muted/60">
        Turn both to compare. The optimized copy is saved next to the original; the thumbnail stays as it is.
      </p>

      <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
        <button onClick={onClose} disabled={using} className={`${BTN} bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/80 sm:flex-1`}>
          Keep original
        </button>
        <button
          onClick={() => void use()}
          disabled={!ready || !keep || using}
          className={`${BTN} bg-foil text-[color:var(--on-accent)] font-bold sm:flex-1`}
        >
          {using ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Saving…</> : 'Use optimized'}
        </button>
      </div>
    </Modal>
  );
}
