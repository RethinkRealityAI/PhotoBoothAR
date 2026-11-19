/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Size details under the 3D view in /admin/library's side panel: file size,
 * triangles, textures (how many, which formats, the biggest one) and whether
 * the file is already optimized — read straight from the .glb's bytes by the
 * pure lib/glbInfo.ts. The bytes usually come from the browser cache (the
 * live view above just loaded the same URL). Never blocks the panel: while it
 * reads, a quiet line says so; a failure says so and nothing else changes.
 */
import { useEffect, useState } from 'react';
import { Check, Minimize2 } from 'lucide-react';
import { glbDetailRows, isGlbOptimized, readGlbInfo, type GlbInfo } from '../../../lib/glbInfo';
import { formatBytes } from '../../../lib/libraryImport';
import { formatTriangles } from '../../../lib/glbOptimizePlan';

type Read = { status: 'reading' } | { status: 'failed' } | { status: 'ready'; info: GlbInfo };

/** Parsed details by URL for this page visit: a library file never changes
 *  under its URL (a replaced file gets a new name), so reading once is enough. */
const seen = new Map<string, GlbInfo>();

export default function ModelSizeDetails({ url, onOptimize }: {
  url: string;
  /** Opens the optimizer compare for this model; omitted = no link on the pill. */
  onOptimize?: () => void;
}) {
  const [read, setRead] = useState<Read>(() => {
    const hit = seen.get(url);
    return hit ? { status: 'ready', info: hit } : { status: 'reading' };
  });

  useEffect(() => {
    const hit = seen.get(url);
    if (hit) { setRead({ status: 'ready', info: hit }); return; }
    setRead({ status: 'reading' });
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const info = readGlbInfo(new Uint8Array(await res.arrayBuffer()));
        if (ctrl.signal.aborted) return;
        if (!info) { setRead({ status: 'failed' }); return; }
        seen.set(url, info);
        setRead({ status: 'ready', info });
      } catch {
        if (!ctrl.signal.aborted) setRead({ status: 'failed' });
      }
    })();
    return () => ctrl.abort();
  }, [url]);

  if (read.status === 'reading') {
    return <p className="font-sans text-[11px] text-brand-muted/50" aria-live="polite">Reading the file size…</p>;
  }
  if (read.status === 'failed') {
    return <p className="font-sans text-[11px] text-brand-muted/50">The size details could not be read for this file.</p>;
  }
  const { info } = read;
  const optimized = isGlbOptimized(info);
  const rows = glbDetailRows(info, { bytes: formatBytes, triangles: formatTriangles });
  const pillClass = 'inline-flex items-center gap-1 min-h-11 px-3 rounded-full font-sans text-[11px]';
  return (
    <div className="flex flex-col gap-2" aria-label="File size details">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-sans text-[11px]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-brand-muted/55">{r.label}</dt>
            <dd className="text-brand-fg/85 tabular-nums min-w-0 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div>
        {optimized ? (
          <span className={`${pillClass} bg-emerald-500/10 text-emerald-100/90`}>
            <Check className="w-3.5 h-3.5" aria-hidden /> Optimized
          </span>
        ) : onOptimize ? (
          <button type="button" onClick={onOptimize} className={`pressable ${pillClass} bg-amber-500/10 hover:bg-amber-500/20 text-amber-100/90`}>
            <Minimize2 className="w-3.5 h-3.5" aria-hidden /> Not optimized yet · Optimize
          </button>
        ) : (
          <span className={`${pillClass} bg-amber-500/10 text-amber-100/90`}>Not optimized yet</span>
        )}
      </div>
    </div>
  );
}
