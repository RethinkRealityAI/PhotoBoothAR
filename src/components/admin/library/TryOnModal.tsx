/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Try on — wear a library piece on your own face, straight from /admin/library,
 * without building a scene. The camera stays on while you flip between pieces.
 *
 * THE BOOTH'S PIPELINE, NOT A LOOKALIKE: the same camera hook, the same face
 * engine (each piece's own `config.tracking`, resolved as the booth resolves
 * it), the same Overlay3D canvas composited by the same StageCanvas with
 * frame-lock, and pieces from the shared layerToPiece mapper (lib/tryOn). So a
 * hat that sits right here sits right in an event.
 *
 * Occlusion is always on (your head hides the back of the piece). The fit pad
 * nudges the piece's offset / tilt / size live; "Save fit" writes it onto the
 * item IN PLACE behind a confirm that says how many events use it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, ChevronDown, ChevronUp, Loader2, Minus, Plus, RotateCcw,
  RotateCw, SwitchCamera, X,
} from 'lucide-react';
import { useCameraStream, type CameraError } from '../../booth/useCameraStream';
import StageCanvas from '../../booth/StageCanvas';
import Overlay3D from '../../booth/Overlay3D';
import ConfirmModal from '../../ui/ConfirmModal';
import { useToast } from '../../ui/Toast';
import { useDialog } from '../../../lib/useDialog';
import { boothLightingFor } from '../../../lib/studio/lighting';
import {
  getActiveFaceEngineInfo, initFaceEngine, resolveSurfaceFaceMode, setFaceTrackingMode, subscribeFaceEngine,
} from '../../../lib/faceEngine';
import { fetchTryOnRows, libraryErrorText, setLibraryItemFit } from '../../../lib/adminLibrary';
import {
  currentFit, describeFit, fitTargetOf, nudgeFit, sameFit, tryOnScene,
  type ItemFit, type Nudge, type TryOnRow,
} from '../../../lib/tryOn';

export interface TryOnItem {
  id: string;
  name: string;
  thumb: string | null;
  /** Library rows can be fitted and saved; event pieces are look-only here. */
  saveable: boolean;
  /** Events using it, for the save confirm (a lower bound when `linkCapped`). */
  linkCount: number;
  linkCapped?: boolean;
}

const VIDEO_ID = 'tryon-video';

const CAMERA_COPY: Record<CameraError, string> = {
  NotAllowedError: 'Camera access is blocked. Allow the camera for this site in your browser, then try again.',
  NotFoundError: 'No camera was found on this device.',
  NotReadableError: 'Another app is using the camera. Close it and try again.',
  OverconstrainedError: 'This camera could not start in a usable mode. Try again, or try another camera.',
  webview: 'The camera only works on a secure page in a full browser.',
  unknown: 'The camera could not start. Try again.',
};

const PAD_BTN =
  'pressable min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-brand-fg/90 transition-colors disabled:opacity-30';
const LABEL = 'font-label uppercase tracking-luxe text-[10px] text-brand-muted/60';

function useIsDesktop(): boolean {
  const q = '(min-width: 1024px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

export default function TryOnModal({
  items, startId, onClose, onSaved,
}: {
  items: readonly TryOnItem[];
  startId: string;
  onClose: () => void;
  /** After a successful Save fit — the page refreshes its copy of the item. */
  onSaved?: (id: string) => void;
}) {
  const { push } = useToast();
  const desktop = useIsDesktop();
  const [currentId, setCurrentId] = useState(startId);
  const current = items.find((i) => i.id === currentId) ?? items[0];

  // ── Rows (read once for the whole strip, so flipping is instant) ──────
  const [rows, setRows] = useState<Map<string, TryOnRow> | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const loadRows = useCallback(async () => {
    setRowsError(null);
    const { rows: got, error } = await fetchTryOnRows(ids);
    if (error !== null) { setRowsError(error); return; }
    setRows(new Map(got.map((r) => [r.id, r])));
  }, [ids]);
  useEffect(() => { void loadRows(); }, [loadRows]);
  const row = rows?.get(current?.id ?? '') ?? null;

  // ── Fit (session edits per item; Save writes it) ──────────────────────
  const [fits, setFits] = useState<Record<string, ItemFit>>({});
  const savedFit = useMemo(() => (row ? currentFit(row) : null), [row]);
  const fit = (current && fits[current.id]) ?? savedFit;
  const fittable = row !== null && fitTargetOf(row.config) !== null;
  const dirty = fit !== null && savedFit !== null && !sameFit(fit, savedFit);
  const scene = useMemo(() => (row ? tryOnScene(row, dirty ? fit : null) : null), [row, fit, dirty]);

  // ── Camera + the booth's face engine ──────────────────────────────────
  const { videoRef, ready, error: camError, retry, facingMode, flipCamera, canFlip } = useCameraStream(true, false);
  const mirror = facingMode === 'user';
  useEffect(() => {
    // The piece's own tracking choice, resolved exactly as the booth does.
    setFaceTrackingMode(resolveSurfaceFaceMode({ config: row?.config ?? undefined }).mode);
    initFaceEngine().catch(() => { /* surfaced through faceInfo.failed below */ });
  }, [row]);
  const faceInfo = useSyncExternalStore(subscribeFaceEngine, getActiveFaceEngineInfo, getActiveFaceEngineInfo);
  const [faceVisible, setFaceVisible] = useState(false);

  // ── Model load state for the current piece ────────────────────────────
  const [loadedUrls, setLoadedUrls] = useState<ReadonlySet<string>>(() => new Set());
  const [modelError, setModelError] = useState<string | null>(null);
  useEffect(() => { setModelError(null); }, [currentId]);
  const sceneUrls = useMemo(
    () => (scene ? (scene.pieces ? scene.pieces.map((p) => p.assetUrl) : [scene.assetUrl]).filter((u): u is string => !!u) : []),
    [scene],
  );
  const modelLoading = sceneUrls.some((u) => !loadedUrls.has(u)) && modelError === null;
  const markReady = useCallback((url: string) => {
    setLoadedUrls((s) => (s.has(url) ? s : new Set(s).add(url)));
  }, []);

  // ── Nudge + save ──────────────────────────────────────────────────────
  const nudge = useCallback((n: Nudge, big = false) => {
    if (!current || !fit || !fittable) return;
    setFits((f) => ({ ...f, [current.id]: nudgeFit(fit, n, big) }));
  }, [current, fit, fittable]);
  const resetFit = () => {
    if (!current) return;
    setFits((f) => { const next = { ...f }; delete next[current.id]; return next; });
  };
  // Screen directions. Checked on a tracked face: in the selfie (mirrored)
  // view the head's +x shows on the RIGHT, so the rear camera flips it.
  const sx: 1 | -1 = mirror ? 1 : -1;

  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const doSave = async () => {
    if (!current || !fit) return;
    setSaving(true);
    const res = await setLibraryItemFit(current.id, fit);
    setSaving(false);
    setConfirming(false);
    if (res.error !== null) { push(libraryErrorText(res.error), 'error'); return; }
    // The saved config is now the baseline: patch our row, drop the session edit.
    setRows((m) => {
      if (!m || !row) return m;
      const t = fitTargetOf(row.config);
      if (t === null || !row.config) return m;
      const cfg: Record<string, unknown> = { ...row.config };
      const place = (a: unknown) => ({ ...(a as object), offset: { ...fit.offset }, rotation: { ...fit.rotation }, scale: fit.scale });
      if (t >= 0) {
        const layers = (cfg.layers as Record<string, unknown>[]).slice();
        const slot = (layers[t].anchor as { anchor?: string }).anchor;
        layers[t] = { ...layers[t], anchor: place(layers[t].anchor) };
        cfg.layers = layers;
        if ((cfg.anchor as { anchor?: string } | undefined)?.anchor === slot) cfg.anchor = place(cfg.anchor);
      } else cfg.anchor = place(cfg.anchor);
      return new Map(m).set(row.id, { ...row, config: cfg });
    });
    resetFit();
    push(`Saved the fit for ${current.name}.`, 'success');
    onSaved?.(current.id);
  };

  // ── Leaving with unsaved fits ─────────────────────────────────────────
  const unsavedCount = Object.entries(fits).filter(([id, f]) => {
    const r = rows?.get(id);
    const s = r ? currentFit(r) : null;
    return s !== null && !sameFit(f, s);
  }).length;
  const [askLeave, setAskLeave] = useState(false);
  const requestClose = useCallback(() => {
    if (unsavedCount > 0) setAskLeave(true);
    else onClose();
  }, [unsavedCount, onClose]);

  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(requestClose, `Try on ${current?.name ?? ''}`, !confirming && !askLeave);

  // Keyboard: arrows move (Shift = 4 steps), + / - resize, [ ] flip pieces.
  const idx = items.findIndex((i) => i.id === current?.id);
  const go = useCallback((d: 1 | -1) => {
    if (items.length === 0) return;
    const next = items[(idx + d + items.length) % items.length];
    setCurrentId(next.id);
  }, [items, idx]);
  useEffect(() => {
    if (confirming || askLeave) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const big = e.shiftKey;
      const map: Record<string, () => void> = {
        ArrowUp: () => nudge({ kind: 'move', axis: 'y', dir: 1 }, big),
        ArrowDown: () => nudge({ kind: 'move', axis: 'y', dir: -1 }, big),
        ArrowLeft: () => nudge({ kind: 'move', axis: 'x', dir: (-sx) as 1 | -1 }, big),
        ArrowRight: () => nudge({ kind: 'move', axis: 'x', dir: sx }, big),
        '+': () => nudge({ kind: 'scale', dir: 1 }, big),
        '=': () => nudge({ kind: 'scale', dir: 1 }, big),
        '-': () => nudge({ kind: 'scale', dir: -1 }, big),
        '[': () => go(-1),
        ']': () => go(1),
      };
      const fn = map[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nudge, go, sx, confirming, askLeave]);

  // Keep the selected thumbnail in view when flipping by keyboard.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-id="${current?.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current?.id]);

  // Open on a laptop (where fit gets tuned); folded on a phone so the camera has the room.
  const [padOpen, setPadOpen] = useState(desktop);

  // ── Status line over the camera ───────────────────────────────────────
  let status: string | null = null;
  if (rowsError !== null) status = 'Could not load the library pieces.';
  else if (rows === null) status = 'Loading pieces…';
  else if (!row) status = 'This piece is withdrawn or not readable here, so it cannot be tried on.';
  else if (!scene) status = 'Nothing to wear in this one.';
  else if (modelError !== null) status = modelError;
  else if (!ready) status = 'Starting the camera…';
  else if (faceInfo.failed) status = 'Face tracking could not start on this device.';
  else if (!faceInfo.ready) status = 'Loading face tracking…';
  else if (modelLoading) status = 'Loading the model…';
  else if (!faceVisible) status = 'Looking for your face…';

  const viewfinder = (
    <div className="relative h-full aspect-[9/16] max-w-full overflow-hidden rounded-none lg:rounded-3xl bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video id={VIDEO_ID} ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover opacity-0" />
      {scene && (
        <Overlay3D
          assetUrl={scene.pieces ? null : scene.assetUrl}
          proceduralId={scene.pieces ? null : scene.proceduralId}
          anchor={scene.anchor}
          pieces={scene.pieces}
          videoId={VIDEO_ID}
          mirror={mirror}
          occlude
          lightingPreset={boothLightingFor('db', undefined)}
          onFaceVisible={setFaceVisible}
          onAssetReady={markReady}
          onAssetError={(_u, m) => setModelError(`This model would not load: ${m}`)}
          composited
        />
      )}
      <StageCanvas
        videoRef={videoRef}
        effectId="none"
        mirror={mirror}
        threeCanvasId={scene ? 'booth-3d-layer' : null}
        frameLock={scene !== null}
        watermark={false}
        active
      />
      {status !== null && (
        <p role="status" className="absolute inset-x-3 top-16 z-30 mx-auto w-fit max-w-[90%] rounded-full bg-black/60 px-3.5 py-1.5 text-center font-sans text-xs text-brand-fg/90">
          {(modelLoading || !faceInfo.ready || rows === null) && status !== null && !status.startsWith('This') && (
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin align-[-2px]" aria-hidden />
          )}
          {status}
        </p>
      )}
    </div>
  );

  const strip = (
    <div ref={stripRef} className="flex gap-2 overflow-x-auto lg:grid lg:grid-cols-4 lg:overflow-x-visible lg:overflow-y-auto pb-1" role="listbox" aria-label="Pieces to try on">
      {items.map((it) => {
        const on = it.id === current?.id;
        return (
          <button
            key={it.id}
            data-id={it.id}
            type="button"
            role="option"
            aria-selected={on}
            title={it.name}
            onClick={() => setCurrentId(it.id)}
            className={`pressable relative shrink-0 h-16 w-16 lg:h-auto lg:w-auto lg:aspect-square rounded-xl overflow-hidden border transition-colors ${
              on ? 'border-[color:var(--color-accent)] bg-white/[0.1]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
            }`}
          >
            {it.thumb
              ? <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
              : <Box className="m-auto h-6 w-6 text-brand-muted/50" aria-hidden />}
            <span className="sr-only">{it.name}</span>
            {fits[it.id] && rows?.get(it.id) && !sameFit(fits[it.id], currentFit(rows.get(it.id)!)) && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" aria-label="unsaved fit" />
            )}
          </button>
        );
      })}
    </div>
  );

  const pad = current && (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => setPadOpen((o) => !o)} aria-expanded={padOpen} className="flex min-h-11 items-center justify-between text-left">
        <span className={LABEL}>Adjust fit</span>
        {padOpen ? <ChevronDown className="h-4 w-4 text-brand-muted/60" aria-hidden /> : <ChevronUp className="h-4 w-4 text-brand-muted/60" aria-hidden />}
      </button>
      {padOpen && (!fittable ? (
        <p className="font-sans text-xs leading-relaxed text-brand-muted/70">
          {row ? 'This look has several pieces, so fit it in the Studio, where each piece has its own handles.' : 'Pick a piece that loads to adjust its fit.'}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="grid grid-cols-3 gap-1.5" aria-label="Move">
              <span />
              <button type="button" className={PAD_BTN} aria-label="Move up" onClick={(e) => nudge({ kind: 'move', axis: 'y', dir: 1 }, e.shiftKey)}><ArrowUp className="h-4 w-4" /></button>
              <span />
              <button type="button" className={PAD_BTN} aria-label="Move left" onClick={(e) => nudge({ kind: 'move', axis: 'x', dir: (-sx) as 1 | -1 }, e.shiftKey)}><ArrowLeft className="h-4 w-4" /></button>
              <span />
              <button type="button" className={PAD_BTN} aria-label="Move right" onClick={(e) => nudge({ kind: 'move', axis: 'x', dir: sx }, e.shiftKey)}><ArrowRight className="h-4 w-4" /></button>
              <span />
              <button type="button" className={PAD_BTN} aria-label="Move down" onClick={(e) => nudge({ kind: 'move', axis: 'y', dir: -1 }, e.shiftKey)}><ArrowDown className="h-4 w-4" /></button>
              <span />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <button type="button" className={PAD_BTN} aria-label="Smaller" onClick={(e) => nudge({ kind: 'scale', dir: -1 }, e.shiftKey)}><Minus className="h-4 w-4" /></button>
                <span className="w-12 text-center font-sans text-[11px] text-brand-muted/70">Size</span>
                <button type="button" className={PAD_BTN} aria-label="Bigger" onClick={(e) => nudge({ kind: 'scale', dir: 1 }, e.shiftKey)}><Plus className="h-4 w-4" /></button>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className={PAD_BTN} aria-label="Move back, away from the camera" onClick={(e) => nudge({ kind: 'move', axis: 'z', dir: -1 }, e.shiftKey)}><span className="font-sans text-[11px]">Back</span></button>
                <span className="w-12 text-center font-sans text-[11px] text-brand-muted/70">Depth</span>
                <button type="button" className={PAD_BTN} aria-label="Move forward, toward the camera" onClick={(e) => nudge({ kind: 'move', axis: 'z', dir: 1 }, e.shiftKey)}><span className="font-sans text-[11px]">Front</span></button>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className={PAD_BTN} aria-label="Tip back" onClick={(e) => nudge({ kind: 'tilt', axis: 'x', dir: -1 }, e.shiftKey)}><RotateCcw className="h-4 w-4" /></button>
                <span className="w-12 text-center font-sans text-[11px] text-brand-muted/70">Tip</span>
                <button type="button" className={PAD_BTN} aria-label="Tip forward" onClick={(e) => nudge({ kind: 'tilt', axis: 'x', dir: 1 }, e.shiftKey)}><RotateCw className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
          <p className="font-sans text-[11px] text-brand-muted/60" aria-live="polite">
            {fit && savedFit ? describeFit(fit, savedFit) : ''}
            {desktop ? ' · Arrow keys move, + and − resize, Shift for bigger steps.' : ''}
          </p>
          {current.saveable ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => setConfirming(true)}
                className="pressable flex-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-foil px-4 font-label text-[10px] font-bold uppercase tracking-luxe text-[color:var(--on-accent)] disabled:opacity-40"
              >
                {dirty ? 'Save fit' : 'Fit saved'}
              </button>
              <button type="button" disabled={!dirty || saving} onClick={resetFit} className="pressable min-h-11 rounded-full bg-white/[0.06] px-4 font-label text-[10px] uppercase tracking-luxe text-brand-fg/85 hover:bg-white/[0.11] disabled:opacity-40">
                Undo
              </button>
            </div>
          ) : (
            <p className="font-sans text-[11px] leading-snug text-brand-muted/55">
              This piece belongs to an event. Add it to the library to save a fit onto it.
            </p>
          )}
        </>
      ))}
    </div>
  );

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className={LABEL}>Try on · {idx + 1} of {items.length}</p>
        <h2 className="truncate font-serif text-lg text-brand-fg">{current?.name ?? ''}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {canFlip && (
          <button type="button" onClick={flipCamera} aria-label="Flip camera" className={PAD_BTN}><SwitchCamera className="h-4 w-4" /></button>
        )}
        <button type="button" onClick={requestClose} aria-label="Close try on" className={PAD_BTN}><X className="h-4 w-4" /></button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[45] bg-[#05060B]">
      <div ref={panelRef} {...dialogProps} className="flex h-full w-full flex-col lg:flex-row lg:items-stretch lg:gap-6 lg:p-6">
        {camError !== null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="max-w-sm font-sans text-sm text-brand-fg/85">
              {CAMERA_COPY[camError]}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={retry} className={`${PAD_BTN} px-4`}>Try again</button>
              <button type="button" onClick={onClose} className={`${PAD_BTN} px-4`}>Close</button>
            </div>
          </div>
        ) : desktop ? (
          <>
            <div className="flex min-h-0 flex-1 items-center justify-center">{viewfinder}</div>
            <aside className="glass-strong flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto rounded-3xl p-5">
              {header}
              {pad}
              <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/10 pt-4">
                <p className={`${LABEL} mb-2`}>Switch piece · [ and ] keys</p>
                {strip}
              </div>
            </aside>
          </>
        ) : (
          <>
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
              {viewfinder}
              <div className="absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-[max(12px,env(safe-area-inset-top))]">{header}</div>
            </div>
            <div className="flex max-h-[45vh] shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 bg-[#0A0B12] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
              {strip}
              {pad}
            </div>
          </>
        )}
      </div>

      {confirming && current && (
        <ConfirmModal
          title={`Save this fit for ${current.name}?`}
          body={
            <>
              {fit && savedFit ? <p className="mb-2 text-brand-fg/85">{describeFit(fit, savedFit)}</p> : null}
              {current.linkCount === 0 && !current.linkCapped
                ? 'No events use it yet. Every host who picks it from now on gets this fit.'
                : `${current.linkCount}${current.linkCapped ? '+' : ''} event${current.linkCount === 1 ? '' : 's'} use it, and ${current.linkCount === 1 ? 'it' : 'they'} will show the new fit straight away, as will every host who picks it from now on.`}
            </>
          }
          confirmLabel="Save fit"
          busy={saving}
          onConfirm={() => void doSave()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {askLeave && (
        <ConfirmModal
          title="Leave without saving?"
          body={`You adjusted the fit of ${unsavedCount} piece${unsavedCount === 1 ? '' : 's'} and did not save. Those changes will be lost.`}
          confirmLabel="Leave"
          onConfirm={onClose}
          onCancel={() => setAskLeave(false)}
        />
      )}
    </div>
  );
}
