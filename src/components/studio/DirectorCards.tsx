/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DirectorCards — the presentational half of the docked Scene Director. The
 * orchestration (plan fetch, credits, generation, dispatch-into-draft) lives in
 * DirectorPanel; this file holds the composer-card chrome, the honest credit
 * chips, and the interactive R3F mini viewer that lets the host orbit a
 * generated head piece BEFORE approving it into the open draft.
 *
 * Every card is a small state machine (idle → generating → ready → added, with
 * failed → retry, stalled → resume, and a reject branch: ready → rejected →
 * {regenerate (charged) | keep → ready | discard}); DirectorPanel owns the
 * state and hands each card its status + artifacts + handlers. Media (the 2D
 * preview / 3D viewer) DWELLS: it stays visible through ready, rejected, AND
 * added — the host always sees what they generated before and after adding it.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { Box, Check, Loader2, RotateCcw, SlidersHorizontal, Sparkles, Wand2, X } from 'lucide-react';

/* ── Card state machine (owned by DirectorPanel, rendered here) ───────────── */

export type CardStatus = 'idle' | 'generating' | 'ready' | 'added' | 'failed' | 'discarded' | 'stalled' | 'rejected';

export interface CardState {
  status: CardStatus;
  error?: string;
  /** frame: the processed transparent PNG url (ready preview + approve target). */
  frameUrl?: string;
  /** head piece (generate): the finished GLB url + a display name. */
  glbUrl?: string;
  glbName?: string | null;
  /** head piece (generate): Meshy progress 0-100 while the job runs. */
  progress?: number | null;
  /** head piece (generate): the current rotating status verb. */
  statusLine?: string;
  /** head piece (generate): the Meshy job id — kept so a poll TIMEOUT can
   *  resume checking the SAME job for free instead of regenerating (audit C1:
   *  a slow >5min job must never cost another 11 credits to keep waiting on). */
  jobId?: string;
  /** rejected only: the host's "what should change" revision, composed into the
   *  next generation prompt when they hit Regenerate. */
  feedback?: string;
}

/** Rotating verbs shown UNDER the progress bar while a Meshy job runs. They
 *  cycle on a timer and never claim more than the job's real state. */
export const MESHY_STATUS_LINES = [
  'Sketching the concept…',
  'Sculpting the mesh…',
  'Refining the surface…',
  'Painting textures…',
  'Polishing the shine…',
];

/* ── Interactive 3D mini viewer ───────────────────────────────────────────── */

// Cached GLB loader — mirrors ar/FaceRig.loadModel / ar/ReferenceBust.loadBust
// (a runtime-URL fetch, never a static import) so the build never depends on
// any model file being present.
const _glbCache = new Map<string, Promise<THREE.Group | null>>();
function loadGlb(url: string): Promise<THREE.Group | null> {
  if (!_glbCache.has(url)) {
    _glbCache.set(
      url,
      new Promise<THREE.Group | null>((resolve) => {
        new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, () => resolve(null));
      }),
    );
  }
  return _glbCache.get(url)!;
}

/**
 * Normalizes a loaded GLB's longest axis to ~2 units centred at the origin, so
 * an arbitrary Meshy mesh (any native scale / off-centre pivot) always frames
 * inside the fixed mini-viewer camera. Renders null until fit, so drei <Bounds>
 * only ever measures real geometry (never an empty box). The load itself is
 * owned by ModelPreview so a load failure surfaces an explicit note.
 */
function FittedModel({ scene }: { scene: THREE.Group }) {
  const fitted = useMemo(() => {
    const obj = scene.clone(true);
    obj.updateMatrixWorld(true); // fold node transforms in before measuring
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return null;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDim) || maxDim <= 0) return null;
    const scale = 2 / maxDim;
    return { obj, scale, position: [-center.x * scale, -center.y * scale, -center.z * scale] as [number, number, number] };
  }, [scene]);

  if (!fitted) return null;
  return (
    <group scale={fitted.scale} position={fitted.position}>
      <primitive object={fitted.obj} />
    </group>
  );
}

/** ~180px interactive viewer — orbit the piece before deciding. loadGlb resolves
 *  null when the browser can't fetch/parse the GLB (CORS, transient network);
 *  the model FILE is still valid server-side, so we say so honestly and let the
 *  host add it anyway rather than show an empty black box. */
function ModelPreview({ url }: { url: string }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setScene(null);
    setFailed(false);
    loadGlb(url)
      .then((s) => { if (!alive) return; if (s) setScene(s); else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);

  if (failed) {
    return (
      <div className="rounded-lg border border-white/10 px-3 py-4 flex items-center gap-2 text-[11px] text-brand-muted/70 leading-snug" style={{ backgroundColor: '#05060B' }}>
        <Box className="w-4 h-4 shrink-0 text-accent-2/70" />
        <span>3D preview unavailable — the model itself is fine; Approve to add it to your scene.</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-white/10" style={{ backgroundColor: '#05060B' }}>
      <Canvas
        camera={{ position: [0, 0, 4.2], fov: 40, near: 0.1, far: 100 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        style={{ width: '100%', height: 180 }}
      >
        {/* In-canvas Suspense: an async 3D child must never suspend past the
            Canvas to the route boundary (the W3 black-app lesson). */}
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[5, 10, 8]} intensity={1.3} color="#EAF1FF" />
          <directionalLight position={[-4, 2, -4]} intensity={0.35} color="#5B8CFF" />
          <Bounds fit clip observe margin={1.15}>
            {scene && <FittedModel scene={scene} />}
          </Bounds>
          <OrbitControls makeDefault enableDamping dampingFactor={0.12} enablePan={false} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/* ── Shared card chrome ───────────────────────────────────────────────────── */

function cardClass(status: CardStatus): string {
  const base = 'rounded-xl border px-3.5 py-3 transition-colors flex flex-col gap-2';
  if (status === 'added') return `${base} border-emerald-400/30 bg-emerald-500/[0.06]`;
  if (status === 'discarded') return `${base} border-white/8 bg-white/[0.02] opacity-60`;
  if (status === 'failed') return `${base} border-rose-400/25 bg-rose-500/[0.04]`;
  if (status === 'stalled') return `${base} border-amber-400/25 bg-amber-500/[0.04]`;
  if (status === 'rejected') return `${base} border-amber-400/20 bg-amber-500/[0.03]`;
  return `${base} border-white/10 bg-white/[0.03]`;
}

function StatusBadge({ status }: { status: CardStatus }) {
  if (status === 'added')
    return (
      <span className="flex items-center gap-1 text-[10px] font-label uppercase tracking-widest text-emerald-400">
        <Check className="w-3.5 h-3.5" /> Added
      </span>
    );
  if (status === 'discarded')
    return <span className="text-[10px] font-label uppercase tracking-widest text-brand-muted/40">Kept in Library</span>;
  if (status === 'generating')
    return <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-2" />;
  if (status === 'stalled')
    return <span className="text-[10px] font-label uppercase tracking-widest text-amber-400/90">Still working</span>;
  return null;
}

function ActionButton({ onClick, disabled, children, tone = 'primary' }: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: 'primary' | 'ghost';
}) {
  const cls =
    tone === 'primary'
      ? 'bg-foil text-white glow-accent'
      : 'bg-white/[0.05] text-brand-muted/70 hover:text-brand-fg';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-label uppercase tracking-widest text-[9px] font-bold transition active:scale-95 disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function CreditChip({ cost }: { cost: number }) {
  if (cost <= 0) return <span className="font-mono text-[9px] text-brand-muted/40">Free</span>;
  return <span className="font-mono text-[9px] text-brand-muted/50">{cost} credit{cost === 1 ? '' : 's'}</span>;
}

/** Header row + optional error/retry footer shared by every card. */
function CardShell({ label, icon, cost, state, onRetry, onResume, children }: {
  label: string;
  icon: ReactNode;
  cost?: number;
  state: CardState;
  onRetry?: () => void;
  /** stalled only: resume polling the SAME Meshy job (free — never re-charges). */
  onResume?: () => void;
  children: ReactNode;
}) {
  // Hide the "this will cost N" header chip once the piece is decided or being
  // reworked — the RejectPanel shows the regenerate cost on its own.
  const done = state.status === 'added' || state.status === 'discarded' || state.status === 'rejected';
  return (
    <div className={cardClass(state.status)}>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 font-label uppercase tracking-widest text-[9px] text-accent-2">
          {icon}
          {label}
        </span>
        {cost != null && !done && <CreditChip cost={cost} />}
        <div className="ml-auto flex items-center">
          <StatusBadge status={state.status} />
        </div>
      </div>
      {children}
      {state.error && (
        <p className={`flex items-start gap-2 text-[11px] leading-snug ${state.status === 'stalled' ? 'text-amber-200/90' : 'text-rose-300/90'}`}>
          <span className="flex-1">{state.error}</span>
          {onRetry && state.status === 'failed' && (
            <button onClick={onRetry} className="shrink-0 flex items-center gap-1 text-accent-2 hover:text-accent transition-colors">
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
          )}
          {onResume && state.status === 'stalled' && (
            <button onClick={onResume} className="shrink-0 flex items-center gap-1 text-amber-300 hover:text-amber-200 transition-colors">
              <RotateCcw className="w-3 h-3" /> Keep waiting (free)
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/* ── Reject → capture-intent → charged regenerate (frame + generated piece) ── */

/** Shown when a ready 2D/3D asset is rejected: a "what should change" box plus
 *  a clearly-priced Regenerate (charged — a rejected LOOK means the concept is
 *  redone), Keep it (back to ready), and Discard (drop it, kept in the Library).
 *  The preview media stays visible ABOVE this panel so the host sees what they
 *  are revising. */
function RejectPanel({ cost, feedback, onFeedbackChange, onRegenerate, onKeep, onDiscard }: {
  cost: number;
  feedback: string;
  onFeedbackChange: (v: string) => void;
  onRegenerate: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={feedback}
        onChange={(e) => onFeedbackChange(e.target.value)}
        rows={2}
        maxLength={300}
        placeholder="What should change? e.g. warmer gold, thinner border, more art-deco…"
        className="w-full rounded-lg bg-white/[0.04] border border-amber-400/20 px-3 py-2 text-[12px] text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/50 resize-none"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <ActionButton onClick={onRegenerate}>
          <RotateCcw className="w-3 h-3" /> Regenerate · {cost}
        </ActionButton>
        <ActionButton onClick={onKeep} tone="ghost">
          <Check className="w-3 h-3" /> Keep it
        </ActionButton>
        <ActionButton onClick={onDiscard} tone="ghost">
          <X className="w-3 h-3" /> Discard
        </ActionButton>
      </div>
      <p className="font-sans text-[9px] text-brand-muted/40 leading-snug">
        Regenerate spends {cost} credit{cost === 1 ? '' : 's'} on a fresh take from your notes. Discard keeps the current one in your Library.
      </p>
    </div>
  );
}

/* ── Scene header (name + Generate all) ───────────────────────────────────── */

export function SceneHeader({ sceneName, onGenerateAll, generateAllDisabled }: {
  sceneName: string;
  onGenerateAll: () => void;
  generateAllDisabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Sparkles className="w-3.5 h-3.5 text-accent-2 shrink-0" />
      <p className="font-serif italic text-[15px] text-brand-fg leading-tight min-w-0 truncate">{sceneName}</p>
      <button
        onClick={onGenerateAll}
        disabled={generateAllDisabled}
        className="ml-auto shrink-0 flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 font-label uppercase tracking-widest text-[9px] font-bold text-brand-fg hover:bg-white/[0.1] transition disabled:opacity-40"
      >
        <Wand2 className="w-3 h-3" /> Generate all
      </button>
    </div>
  );
}

/* ── FILTER card (free, instant) ──────────────────────────────────────────── */

export function FilterCard({ name, description, state, onApprove, onSkip }: {
  name: string;
  description: string;
  state: CardState;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const { status } = state;
  return (
    <CardShell label="Filter look" icon={<SlidersHorizontal className="w-3 h-3" />} cost={0} state={state}>
      <div>
        <p className="font-sans text-[12px] text-brand-fg leading-snug">{name}</p>
        <p className="font-sans text-[11px] text-brand-muted/60 leading-snug mt-0.5">{description}</p>
      </div>
      {(status === 'idle' || status === 'ready') && (
        <div className="flex items-center gap-2">
          <ActionButton onClick={onApprove}>
            <Wand2 className="w-3 h-3" /> Approve
          </ActionButton>
          {status === 'ready' && (
            <ActionButton onClick={onSkip} tone="ghost">
              <X className="w-3 h-3" /> Skip
            </ActionButton>
          )}
          <span className="text-[10px] text-brand-muted/40 font-sans">Applies to the scene instantly</span>
        </div>
      )}
      {status === 'added' && (
        <p className="font-sans text-[10px] text-emerald-300/70">In your scene · one filter per scene</p>
      )}
    </CardShell>
  );
}

/* ── FRAME card (generate 1cr → preview → approve) ────────────────────────── */

export function FrameCard({ prompt, cost, regenCost, state, onGenerate, onApprove, onReject, onImageError, onFeedbackChange, onRegenerate, onKeep, onDiscard }: {
  prompt: string;
  cost: number;
  /** credits a reject → Regenerate spends (frame: a fresh image, 1cr). */
  regenCost: number;
  state: CardState;
  onGenerate: () => void;
  onApprove: () => void;
  onReject: () => void;
  onImageError: () => void;
  onFeedbackChange: (v: string) => void;
  onRegenerate: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const { status } = state;
  // Media dwells through ready → rejected → added (never a media-less jump).
  const showImg = !!state.frameUrl && (status === 'ready' || status === 'rejected' || status === 'added');
  return (
    <CardShell label="Signature frame" icon={<Sparkles className="w-3 h-3" />} cost={cost} state={state} onRetry={onGenerate}>
      <p className="font-sans text-[12px] text-brand-muted/70 leading-snug line-clamp-2">{prompt}</p>

      {status === 'idle' && (
        <div className="flex items-center gap-2">
          <ActionButton onClick={onGenerate}>
            <Wand2 className="w-3 h-3" /> Generate · {cost}
          </ActionButton>
          <span className="text-[9px] text-accent-2/70 font-sans">or one of your free generations</span>
        </div>
      )}

      {status === 'generating' && (
        <p className="flex items-center gap-1.5 text-[11px] text-brand-muted/60 font-sans">
          <Loader2 className="w-3 h-3 animate-spin text-accent-2" /> Generating & keying transparency…
        </p>
      )}

      {showImg && (
        <div
          className="rounded-lg border border-white/10 overflow-hidden"
          style={{
            backgroundColor: '#0c0d12',
            backgroundImage: 'repeating-conic-gradient(#20222b 0% 25%, #0c0d12 0% 50%)',
            backgroundSize: '14px 14px',
          }}
        >
          <img src={state.frameUrl} onError={onImageError} alt="Generated frame preview" className="w-full h-[150px] object-contain" />
        </div>
      )}

      {status === 'ready' && (
        <div className="flex items-center gap-2">
          <ActionButton onClick={onApprove}>
            <Check className="w-3 h-3" /> Approve
          </ActionButton>
          <ActionButton onClick={onReject} tone="ghost">
            <X className="w-3 h-3" /> Reject
          </ActionButton>
          <span className="text-[10px] text-brand-muted/40 font-sans">Transparent PNG · swaps any current frame</span>
        </div>
      )}

      {status === 'added' && (
        <p className="font-sans text-[10px] text-emerald-300/70">In your scene · swaps any current frame</p>
      )}

      {status === 'rejected' && (
        <RejectPanel
          cost={regenCost}
          feedback={state.feedback ?? ''}
          onFeedbackChange={onFeedbackChange}
          onRegenerate={onRegenerate}
          onKeep={onKeep}
          onDiscard={onDiscard}
        />
      )}
    </CardShell>
  );
}

/* ── HEAD PIECE card (procedural free, or generate 1+10cr → orbit → approve) ─ */

export function HeadPieceCard({ mode, label, cost, regenCost, note, state, onApprove, onGenerate, onReject, onResume, onSkip, onFeedbackChange, onRegenerate, onKeep, onDiscard }: {
  mode: 'procedural' | 'generate';
  /** procedural: the piece name; generate: the concept brief. */
  label: string;
  cost: number;
  /** credits a reject → Regenerate spends (generated piece: fresh concept + 3D, 11cr). */
  regenCost: number;
  note?: string;
  state: CardState;
  onApprove: () => void;
  onGenerate: () => void;
  onReject: () => void;
  /** stalled only: keep polling the same Meshy job (free). */
  onResume?: () => void;
  /** procedural: skip this built-in piece (nothing to regenerate). */
  onSkip: () => void;
  onFeedbackChange: (v: string) => void;
  onRegenerate: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const { status } = state;
  // The orbit viewer dwells through ready → rejected → added.
  const showViewer = mode === 'generate' && !!state.glbUrl && (status === 'ready' || status === 'rejected' || status === 'added');
  return (
    <CardShell label="Head piece" icon={<Box className="w-3 h-3" />} cost={cost} state={state} onRetry={onGenerate} onResume={onResume}>
      <p className="font-sans text-[12px] text-brand-muted/70 leading-snug line-clamp-2">{label}</p>

      {mode === 'procedural' && (status === 'idle' || status === 'ready') && (
        <div className="flex items-center gap-2">
          <ActionButton onClick={onApprove}>
            <Wand2 className="w-3 h-3" /> Approve
          </ActionButton>
          {status === 'ready' && (
            <ActionButton onClick={onSkip} tone="ghost">
              <X className="w-3 h-3" /> Skip
            </ActionButton>
          )}
          <span className="text-[10px] text-brand-muted/40 font-sans">Built-in piece · free</span>
        </div>
      )}

      {mode === 'generate' && status === 'idle' && (
        <div className="flex flex-col gap-1.5">
          <ActionButton onClick={onGenerate}>
            <Wand2 className="w-3 h-3" /> Generate · {cost}
          </ActionButton>
          {note && <p className="font-sans text-[10px] text-brand-muted/45 leading-snug">{note}</p>}
        </div>
      )}

      {mode === 'generate' && status === 'generating' && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-[color:var(--color-accent)] transition-[width] duration-700 ease-out"
              style={{ width: `${typeof state.progress === 'number' ? Math.max(6, state.progress) : 6}%` }}
            />
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-brand-muted/60 font-sans">
            <Loader2 className="w-3 h-3 animate-spin text-accent-2 shrink-0" />
            {state.statusLine ?? MESHY_STATUS_LINES[0]}
            {typeof state.progress === 'number' && <span className="text-brand-muted/40">· {state.progress}%</span>}
          </p>
          <p className="font-sans text-[9px] text-brand-muted/35">Usually 1–3 minutes — keep this panel open.</p>
        </div>
      )}

      {showViewer && (
        <div className="flex flex-col gap-2">
          <ModelPreview url={state.glbUrl!} />
          {status === 'ready' && (
            <>
              <p className="font-sans text-[10px] text-brand-muted/40">Drag to orbit — inspect before you add it.</p>
              <div className="flex items-center gap-2">
                <ActionButton onClick={onApprove}>
                  <Check className="w-3 h-3" /> Approve
                </ActionButton>
                <ActionButton onClick={onReject} tone="ghost">
                  <X className="w-3 h-3" /> Reject
                </ActionButton>
              </div>
            </>
          )}
          {status === 'added' && (
            <p className="font-sans text-[10px] text-emerald-300/70">In your scene</p>
          )}
          {status === 'rejected' && (
            <RejectPanel
              cost={regenCost}
              feedback={state.feedback ?? ''}
              onFeedbackChange={onFeedbackChange}
              onRegenerate={onRegenerate}
              onKeep={onKeep}
              onDiscard={onDiscard}
            />
          )}
        </div>
      )}
    </CardShell>
  );
}
