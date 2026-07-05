/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UploadToWall — guest-facing "/upload" page. Behind a beautiful password gate
 * (UploadGate), guests bulk-upload photos/videos, review the whole batch as a
 * premium stack (delete/curate), optionally wrap each image in any frame (with
 * a big, WYSIWYG pan/zoom crop), add a name + message, and post to the live
 * wall. Four steps: Upload → Review stack → Frame & Arrange → Name & Post, with
 * a "skip framing" shortcut throughout.
 *
 * Multi-tenant: everything is keyed to the active event (useEvent) and plan
 * (useEntitlements) — video uploads and the baked signature/watermark follow
 * the event's entitlements.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Sparkles, Check, Images } from 'lucide-react';
import EventBackground from './ui/EventBackground';
import GuestNav from './ui/GuestNav';
import UploadGate from './upload/UploadGate';
import UploadDropzone from './upload/UploadDropzone';
import UploadStack from './upload/UploadStack';
import FrameEditor from './upload/FrameEditor';
import DetailsAndPost, { PostProgress } from './upload/DetailsAndPost';
import { UploadItem } from './upload/types';
import { compositeUpload, DEFAULT_CROP } from './booth/capture';
import { buildCatalog } from '../lib/catalog';
import { submitPost } from '../lib/db';
import { savePhoto, getGuestName, setGuestName as persistGuestName } from '../lib/session';
import { useStore } from '../store';
import { useEvent } from '../events/EventContext';
import { useEntitlements } from '../lib/entitlements';

type Step = 'upload' | 'frame' | 'details' | 'done';

function uid(): string {
  return crypto.randomUUID?.() ?? `u_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Read natural dimensions for an image/video file. */
function readDims(item: UploadItem): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    if (item.kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve({ w: v.videoWidth || 1080, h: v.videoHeight || 1920 });
      v.onerror = () => resolve({ w: 1080, h: 1920 });
      v.src = item.srcUrl;
    } else {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1080, h: img.naturalHeight || 1920 });
      img.onerror = () => resolve({ w: 1080, h: 1920 });
      img.src = item.srcUrl;
    }
  });
}

function UploadInner() {
  const navigate = useNavigate();
  const { eventId, config, basePath } = useEvent();
  const entitlements = useEntitlements();
  const watermark = entitlements.watermark;
  const videoAllowed = entitlements.videoEnabled;
  const {
    experiences, linkedGlobals, experiencesLoaded, fetchExperiences,
    presetOverrides, fetchPresetOverrides,
  } = useStore();

  const [step, setStep] = useState<Step>('upload');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [guestName, setGuestName] = useState(() => getGuestName(eventId));
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState<PostProgress | null>(null);
  const [result, setResult] = useState<{ posted: number; failed: number } | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Load experiences + preset overrides (same as the booth) for the frame rail.
  useEffect(() => {
    if (!experiencesLoaded) fetchExperiences(true);
    fetchPresetOverrides();
  }, [experiencesLoaded, fetchExperiences, fetchPresetOverrides]);

  // Revoke every object URL on unmount.
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((i) => URL.revokeObjectURL(i.srcUrl));
    };
  }, []);

  const frames = useMemo(() => {
    const catalog = buildCatalog(config.arContent, experiencesLoaded ? experiences : [], presetOverrides, experiencesLoaded ? linkedGlobals : []);
    return catalog.filter((e) => e.kind === 'border' || e.kind === '2d_filter');
  }, [config, experiences, linkedGlobals, experiencesLoaded, presetOverrides]);

  const addFiles = useCallback((files: File[]) => {
    // Video uploads are entitlement-gated (free tier: images only).
    const usable = videoAllowed ? files : files.filter((f) => !f.type.startsWith('video/'));
    if (usable.length < files.length) {
      console.warn('[upload] video uploads are not available on this event plan — skipped');
    }
    const newItems: UploadItem[] = usable.map((file) => ({
      id: uid(),
      file,
      kind: file.type.startsWith('video/') ? 'video' : 'image',
      srcUrl: URL.createObjectURL(file),
      frameId: null,
      crop: { ...DEFAULT_CROP },
      message: '',
    }));
    setItems((prev) => [...prev, ...newItems]);
    setActiveId((cur) => cur ?? newItems[0]?.id ?? null);
    // hydrate natural dimensions
    newItems.forEach(async (it) => {
      const { w, h } = await readDims(it);
      setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, naturalW: w, naturalH: h } : p)));
    });
  }, [videoAllowed]);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) URL.revokeObjectURL(found.srcUrl);
      return prev.filter((p) => p.id !== id);
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setActiveId((cur) => {
      if (cur !== id) return cur;
      const remaining = itemsRef.current.filter((p) => p.id !== id);
      return remaining[0]?.id ?? null;
    });
  }, []);

  const removeSelected = useCallback(() => {
    const doomed = selectedIds;
    if (doomed.size === 0) return;
    const remaining = itemsRef.current.filter((p) => !doomed.has(p.id));
    itemsRef.current.forEach((p) => { if (doomed.has(p.id)) URL.revokeObjectURL(p.srcUrl); });
    setItems(remaining);
    setActiveId((cur) => (cur && doomed.has(cur) ? remaining[0]?.id ?? null : cur));
    setSelectedIds(new Set());
  }, [selectedIds]);

  const clearAll = useCallback(() => {
    itemsRef.current.forEach((i) => URL.revokeObjectURL(i.srcUrl));
    setItems([]);
    setActiveId(null);
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(itemsRef.current.map((i) => i.id)));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const reorder = useCallback((from: number, to: number) => {
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const applyFrameToAll = useCallback((frameId: string | null) => {
    setItems((prev) => prev.map((p) => (p.kind === 'image' ? { ...p, frameId } : p)));
  }, []);

  const applyFrameToSelected = useCallback((frameId: string | null) => {
    setItems((prev) =>
      prev.map((p) => (p.kind === 'image' && selectedIds.has(p.id) ? { ...p, frameId } : p)),
    );
  }, [selectedIds]);

  const openItem = useCallback((id: string) => {
    setActiveId(id);
    setStep('frame');
  }, []);

  // ── Post everything to the wall ───────────────────────────────────────
  const handlePost = useCallback(async () => {
    if (posting || items.length === 0) return;
    setPosting(true);
    const total = items.length;
    let done = 0;
    let failed = 0;
    setProgress({ done, total, failed });

    if (guestName.trim()) persistGuestName(eventId, guestName.trim());

    // Post in reverse so the guest's first-arranged item is newest → lands at the
    // top of the newest-first wall.
    for (const item of [...items].reverse()) {
      try {
        let blob: Blob;
        let width: number | undefined;
        let height: number | undefined;

        if (item.kind === 'image') {
          const frameUrl = item.frameId
            ? frames.find((f) => f.id === item.frameId)?.asset_url ?? null
            : null;
          const out = await compositeUpload({
            srcUrl: item.srcUrl,
            frameUrl,
            crop: item.crop,
            srcType: item.file.type,
            // The free-tier mark reads the EVENT's own name (matches a booth
            // capture) — never a hardcoded gala label.
            signatureLabel: config.copy.eventName,
            // Entitlement-gated watermark: keep the default behaviour
            // (signature when framed) only while the plan carries the mark.
            ...(watermark ? {} : { applySignature: false }),
          });
          blob = out.blob;
          width = out.width;
          height = out.height;
        } else {
          blob = item.file;
          width = item.naturalW;
          height = item.naturalH;
        }

        const post = await submitPost(eventId, {
          blob,
          mediaType: item.kind,
          message: item.message || undefined,
          guestName: guestName || undefined,
          experienceId: item.frameId ?? null,
          width,
          height,
        });

        if (post) {
          savePhoto(eventId, {
            id: post.id,
            image_url: post.image_url,
            media_type: item.kind,
            message: item.message || undefined,
            createdAt: Date.now(),
          });
          done += 1;
        } else {
          failed += 1;
        }
      } catch (e) {
        console.error('[upload] post failed', e);
        failed += 1;
      }
      setProgress({ done, total, failed });
    }

    setPosting(false);
    setResult({ posted: done, failed });
    setStep('done');
  }, [posting, items, frames, guestName, eventId, watermark]);

  const reset = useCallback(() => {
    items.forEach((i) => URL.revokeObjectURL(i.srcUrl));
    setItems([]);
    setActiveId(null);
    setSelectedIds(new Set());
    setProgress(null);
    setResult(null);
    setStep('upload');
  }, [items]);

  const goFrame = () => {
    if (!items.length) return;
    setActiveId((cur) => cur ?? items[0].id);
    setStep('frame');
  };

  const steps: { id: Step; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'frame', label: 'Frame & Arrange' },
    { id: 'details', label: 'Name & Post' },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-noir-900">
      <EventBackground density={32} />

      {/* Header — centered nav + stepper, always contained */}
      <header className="relative z-20 flex flex-col items-center gap-2 px-3 pt-3 pb-2 shrink-0"
        style={{ background: 'linear-gradient(to bottom, rgba(10,7,3,0.9) 0%, rgba(10,7,3,0) 100%)' }}>
        {/* Task flow: keep nav inline (its own controls live at the bottom) */}
        <GuestNav current="upload" bottomOnMobile={false} />

        {/* Stepper (centered) */}
        {step !== 'done' && (
          <div className="flex items-center gap-2">
            {/* dots on phones */}
            <div className="flex sm:hidden items-center gap-1.5">
              <div className="flex items-center gap-1">
                {steps.map((s, i) => (
                  <span
                    key={s.id}
                    className={`h-1.5 rounded-full transition-all ${
                      i === stepIndex ? 'w-5 bg-foil' : i < stepIndex ? 'w-1.5 bg-gold-400/60' : 'w-1.5 bg-champagne/20'
                    }`}
                  />
                ))}
              </div>
              <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/60 whitespace-nowrap">
                {stepIndex + 1}/{steps.length} · {steps[stepIndex]?.label}
              </span>
            </div>

            {/* full stepper on sm+ */}
            <div className="hidden sm:flex items-center gap-2">
              {steps.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-label uppercase tracking-luxe transition-colors ${
                    i === stepIndex ? 'bg-foil text-noir-900' : i < stepIndex ? 'text-gold-300' : 'text-champagne/40'
                  }`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] ${
                      i < stepIndex ? 'bg-gold-400/30 text-gold-200' : i === stepIndex ? 'bg-noir-900/20' : 'bg-champagne/10'
                    }`}>
                      {i < stepIndex ? <Check className="w-2.5 h-2.5" /> : i + 1}
                    </span>
                    {s.label}
                  </div>
                  {i < steps.length - 1 && <span className="w-5 h-px bg-gold-400/20" />}
                </div>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Body */}
      <main className="relative z-10 flex-1 min-h-0 px-4 sm:px-8 pb-5">
        <div className="mx-auto h-full max-w-5xl flex flex-col min-h-0">
          <AnimatePresence mode="wait">
            {/* ── Step: Upload / Review ── */}
            {step === 'upload' && (
              <motion.div key="upload" className="flex-1 min-h-0 flex flex-col"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                {items.length === 0 ? (
                  <div className="flex-1 min-h-0 flex flex-col justify-center gap-6">
                    <div className="text-center">
                      <h1 className="font-serif italic text-4xl text-foil-static">Add to the Wall</h1>
                      <p className="mt-2 font-sans text-sm text-champagne/55">
                        Upload your favourite shots — frame them beautifully or post them as-is.
                      </p>
                    </div>
                    <UploadDropzone count={items.length} onAdd={addFiles} />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    <div className="shrink-0 text-center">
                      <h1 className="font-serif italic text-2xl sm:text-3xl text-foil-static">Your uploads</h1>
                      <p className="mt-1 font-sans text-[12px] sm:text-sm text-champagne/55">
                        Review the batch — tap a photo to frame it, or remove any you don’t want.
                      </p>
                    </div>
                    <div className="flex-1 min-h-0">
                      <UploadStack
                        items={items}
                        frames={frames}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                        onRemove={removeItem}
                        onRemoveSelected={removeSelected}
                        onClearAll={clearAll}
                        onSelectAll={selectAll}
                        onClearSelection={clearSelection}
                        onAddFiles={addFiles}
                        onOpenItem={openItem}
                      />
                    </div>
                    <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 pt-1">
                      <div className="flex items-center gap-2 text-champagne/60 font-label uppercase tracking-luxe text-[10px]">
                        <Images className="w-4 h-4 text-gold-400/70" /> {items.length} ready
                      </div>
                      <button onClick={goFrame}
                        className="flex items-center gap-2 px-6 py-3 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] font-bold rounded-xl glow-accent hover:scale-[1.02] transition-transform">
                        <Sparkles className="w-4 h-4" /> Frame &amp; arrange
                      </button>
                      <button onClick={() => setStep('details')}
                        className="flex items-center gap-2 px-6 py-3 glass rounded-xl text-[11px] font-label uppercase tracking-luxe text-champagne/70 hover:text-gold-300 border border-gold-400/15 hover:border-gold-400/35 transition-colors">
                        Skip framing <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Step: Frame & Arrange ── */}
            {step === 'frame' && (
              <motion.div key="frame" className="flex-1 min-h-0 flex flex-col"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                <div className="flex-1 min-h-0">
                  <FrameEditor
                    items={items}
                    frames={frames}
                    activeId={activeId}
                    selectedIds={selectedIds}
                    onSetActive={setActiveId}
                    onToggleSelect={toggleSelect}
                    onUpdate={updateItem}
                    onRemove={removeItem}
                    onReorder={reorder}
                    onApplyFrameToAll={applyFrameToAll}
                    onApplyFrameToSelected={applyFrameToSelected}
                    onAddFiles={addFiles}
                  />
                </div>
                <NavBar
                  onBack={() => setStep('upload')}
                  onNext={() => setStep('details')}
                  nextLabel="Continue"
                />
              </motion.div>
            )}

            {/* ── Step: Details & Post ── */}
            {step === 'details' && (
              <motion.div key="details" className="flex-1 min-h-0 flex flex-col"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                <div className="flex-1 min-h-0">
                  <DetailsAndPost
                    items={items}
                    frames={frames}
                    guestName={guestName}
                    onGuestName={setGuestName}
                    onUpdate={updateItem}
                    onPost={handlePost}
                    posting={posting}
                    progress={progress}
                  />
                </div>
                {!posting && (
                  <NavBar
                    onBack={() => setStep(items.some((i) => i.frameId) ? 'frame' : 'upload')}
                    hideNext
                  />
                )}
              </motion.div>
            )}

            {/* ── Step: Done ── */}
            {step === 'done' && result && (
              <motion.div key="done" className="flex-1 min-h-0 flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
                <div className="glass-strong rounded-3xl border border-gold-400/20 p-10 max-w-sm text-center">
                  <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-foil glow-accent flex items-center justify-center">
                    <Check className="w-7 h-7 text-noir-900" />
                  </div>
                  <h2 className="font-serif italic text-3xl text-foil-static">On the wall!</h2>
                  <p className="mt-2 font-sans text-sm text-champagne/60">
                    {result.posted} {result.posted === 1 ? 'item is' : 'items are'} now live
                    {result.failed > 0 && ` · ${result.failed} couldn't be posted`}.
                  </p>
                  <div className="mt-7 flex gap-3">
                    <button onClick={reset}
                      className="flex-1 glass rounded-xl px-4 py-3 font-label uppercase tracking-luxe text-[11px] text-champagne/70 hover:text-ivory transition-colors">
                      Upload more
                    </button>
                    <button onClick={() => navigate(`${basePath}/wall`)}
                      className="flex-1 bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-[11px] rounded-xl px-4 py-3 hover:brightness-110 transition-all">
                      View the wall
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function NavBar({
  onBack, onNext, nextLabel = 'Continue', hideNext = false,
}: {
  onBack: () => void; onNext?: () => void; nextLabel?: string; hideNext?: boolean;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between pt-3">
      <button onClick={onBack}
        className="flex items-center gap-2 px-4 py-2.5 glass rounded-xl text-[10px] font-label uppercase tracking-luxe text-champagne/60 hover:text-gold-300 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {!hideNext && onNext && (
        <button onClick={onNext}
          className="flex items-center gap-2 px-6 py-2.5 bg-foil text-noir-900 font-label uppercase tracking-luxe text-[11px] font-bold rounded-xl glow-accent hover:scale-[1.02] transition-transform">
          {nextLabel} <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default function UploadToWall() {
  return (
    <UploadGate>
      <UploadInner />
    </UploadGate>
  );
}
