/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 8 (optional) — the booth intro: how Beamy shows guests around the booth
 * the first time they open it. Three ways: keep Beamy's intro (it already uses
 * this event's own looks), make it your own (words, pictures, hide steps), or
 * turn it off. The preview is the booth's real intro component, so every edit
 * shows exactly as a guest will see it.
 *
 * Pictures come from what the host already made — their Frames and Props are
 * tiles to tap, no screenshots — or an upload. Saves as the host goes into
 * events.config.boothIntro (lib/boothIntro), which the booth reads.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, EyeOff, ImagePlus, Loader2, RotateCcw, Sparkles, Wand2, PowerOff } from 'lucide-react';
import { StepShell } from '../chrome';
import { stepDef } from '../../../../lib/wizard/wizardModel';
import { useWizard } from '../wizardContext';
import { useAutosave } from '../useAutosave';
import IntroPreview from '../IntroPreview';
import {
  INTRO_BODY_MAX, INTRO_STEP_LABEL, INTRO_TITLE_MAX, PICTURE_STEPS, availableIntroSteps, buildIntroSteps, defaultIntroStep,
  editIntroStep, introGestures, listWords, introLooksFrom, normalizeBoothIntro, type BoothIntroConfig, type IntroContext, type IntroLook,
  type IntroPicture, type IntroStepId,
} from '../../../../lib/boothIntro';
import { buildCatalog } from '../../../../lib/catalog';
import { buildRuntimeConfig } from '../../../../events/runtime';
import { fetchChallenges, fetchExperiencesResult, fetchLinkedGlobalExperiences } from '../../../../lib/db';
import { normalizeScene, resolveScene } from '../../../../lib/sceneThemes';
import { createGenericVisuals } from '../../../../events/generic';
import { sceneUploadError } from '../../../../lib/scenePage';
import { uploadAsset } from '../../../../lib/wizard/wizardApi';
import beamyHello from '../../../../assets/sales/v2/beamy-hello.webp';
import boothStandin from '../../../../assets/landing/booth-standin.webp';

type Mode = 'default' | 'custom' | 'off';

const MODES: { id: Mode; label: string; hint: string; Icon: typeof Sparkles }[] = [
  { id: 'default', label: 'Beamy’s intro', hint: 'Recommended. Uses your own looks.', Icon: Sparkles },
  { id: 'custom', label: 'Make it your own', hint: 'Your words and pictures.', Icon: Wand2 },
  { id: 'off', label: 'Turn it off', hint: 'Straight to the camera.', Icon: PowerOff },
];

function modeOf(c: BoothIntroConfig): Mode {
  if (!c.enabled) return 'off';
  return c.custom ? 'custom' : 'default';
}

export default function IntroStep() {
  const { ev } = useWizard();
  const [cfg, setCfg] = useState<BoothIntroConfig>(() => normalizeBoothIntro(ev.config.boothIntro));
  const [loaded, setLoaded] = useState<{ looks: IntroLook[]; worldFrames: IntroLook[]; challenges: number } | null>(null);
  const [sel, setSel] = useState<IntroStepId>('welcome');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useAutosave(cfg, (v) => ({ boothIntro: v }));

  // What the booth will have: the same catalog the booth builds, and its active challenges.
  const runtime = useMemo(() => buildRuntimeConfig({
    id: ev.id, slug: ev.slug, name: ev.name, event_type: ev.event_type, status: ev.status, config: ev.config, plan_tier: null,
  }), [ev]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [rows, linked, ch] = await Promise.all([
        fetchExperiencesResult(ev.slug, { publishedOnly: true }),
        fetchLinkedGlobalExperiences(ev.slug),
        fetchChallenges(ev.slug, { activeOnly: true }),
      ]);
      if (!live) return;
      const catalog = buildCatalog(runtime.arContent, rows.rows, undefined, linked, true);
      setLoaded({ ...introLooksFrom(catalog), challenges: ch.length });
    })();
    return () => { live = false; };
  }, [ev.slug, runtime.arContent]);

  const ctx: IntroContext = useMemo(() => ({
    eventName: ev.name,
    looks: loaded?.looks ?? [],
    worldFrames: loaded?.worldFrames ?? [],
    video: true,
    strip: true,
    canFlip: true,
    gestures: introGestures(((ev.config.powerUps as { on?: unknown } | undefined)?.on as string[] | undefined) ?? []),
    challenges: loaded?.challenges ?? 0,
  }), [ev.name, ev.config.powerUps, loaded]);

  const available = useMemo(() => availableIntroSteps(ctx), [ctx]);
  const steps = useMemo(() => buildIntroSteps(ctx, cfg), [ctx, cfg]);
  const mode = modeOf(cfg);
  const current = available.includes(sel) ? sel : 'welcome';
  const edit = cfg.steps[current] ?? {};
  const base = defaultIntroStep(current, ctx);
  const editing = mode === 'custom';
  const previewIndex = Math.max(0, steps.findIndex((s) => s.id === current));

  const scene = resolveScene(normalizeScene(ev.config.scene));
  const Emblem = useMemo(() => createGenericVisuals(ev.name).Emblem, [ev.name]);
  const firstFrame = ctx.looks.find((l) => l.tab === 'frames' && l.thumb)?.thumb ?? null;

  const setMode = (m: Mode) => setCfg((c) => ({ ...c, enabled: m !== 'off', custom: m === 'custom' }));
  const patch = (p: Parameters<typeof editIntroStep>[2]) => setCfg((c) => editIntroStep(c, current, p));
  const setPicture = (pic: IntroPicture) => patch({ picture: pic.kind === 'default' ? undefined : pic });

  const upload = async (file: File) => {
    const why = sceneUploadError(file);
    if (why) { setUploadError(why); return; }
    setUploading(true);
    setUploadError(null);
    const url = await uploadAsset(ev.slug, file, `intro-${current}`);
    setUploading(false);
    if (!url) { setUploadError('That picture didn’t upload. Check your connection and try again.'); return; }
    setPicture({ kind: 'upload', url });
  };

  const pictureLooks = current === 'world'
    ? ctx.worldFrames.slice(0, 6)
    : ctx.looks.filter((l) => l.thumb !== null && l.tab !== 'effects').slice(0, 6);
  const pic = edit.picture;

  const preview = (
    <IntroPreview
      steps={steps}
      index={previewIndex}
      onIndex={(i) => { const s = steps[i]; if (s) setSel(s.id); }}
      enabled={cfg.enabled}
      eventName={ev.name}
      emblem={<Emblem size={30} />}
      accent={scene.accent}
      tone={scene.tone}
      frameUrl={firstFrame}
    />
  );

  return (
    <StepShell step="intro" preview={preview} sheetLabel={stepDef('intro').title}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Booth intro">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className="wz-choice !items-start" onClick={() => setMode(m.id)}>
              <m.Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-tight">{m.label}</span>
                <span className="block text-[12.5px] text-white/70">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {cfg.enabled && (
          <div>
            <p className="wz-label">{editing ? 'Pick a step to edit' : 'What Beamy shows your guests'}</p>
            {loaded === null ? (
              <p className="flex items-center gap-2 text-[13px] text-white/70"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your looks…</p>
            ) : editing && (
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Intro steps">
                {available.map((id) => {
                  const hidden = editing && cfg.steps[id]?.hidden === true;
                  const changed = editing && !!cfg.steps[id] && !hidden;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={current === id}
                      onClick={() => setSel(id)}
                      className={`wz-choice !min-h-10 !rounded-full !px-3.5 !py-1.5 text-[14px] font-medium ${hidden ? 'opacity-55 line-through' : ''}`}
                      aria-checked={current === id}
                    >
                      {hidden && <EyeOff className="h-3.5 w-3.5" aria-hidden />}
                      {INTRO_STEP_LABEL[id]}
                      {changed && <span className="h-1.5 w-1.5 rounded-full bg-[#5FD9A8]" aria-label="edited" />}
                    </button>
                  );
                })}
              </div>
            )}
            {!editing && loaded !== null && (
              <>
                <ol className="grid gap-2 sm:grid-cols-2">
                  {steps.map((st, i) => (
                    <li key={st.id}>
                      <button
                        type="button"
                        onClick={() => setSel(st.id)}
                        className={`flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left transition ${current === st.id ? 'bg-white/16 ring-1 ring-white/70' : 'bg-white/6 hover:bg-white/10'}`}
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15 text-[12px] font-semibold">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block text-[14.5px] font-semibold leading-snug">{st.title}</span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-white/65 line-clamp-2">{st.body}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[13px] text-white/70">
                  Built from what your event has: {listShort(available)}. Add or remove looks and challenges and it updates itself.
                </p>
              </>
            )}
          </div>
        )}

        {editing && loaded !== null && (
          <div className="flex flex-col gap-4" role="tabpanel" aria-label={`${INTRO_STEP_LABEL[current]} step`}>
            {current !== 'welcome' && (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl bg-white/6 px-3.5">
                <span className="flex-1 text-[15px] font-medium">Show the {INTRO_STEP_LABEL[current]} step to guests</span>
                <input type="checkbox" role="switch" className="wz-switch" checked={edit.hidden !== true} onChange={(e) => patch({ hidden: e.target.checked ? undefined : true })} />
              </label>
            )}
            {edit.hidden !== true && (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                <div>
                  <label className="wz-label" htmlFor="wz-intro-title">Title</label>
                  <input
                    id="wz-intro-title"
                    className="wz-input !min-h-12 !text-[16px]"
                    maxLength={INTRO_TITLE_MAX}
                    value={edit.title ?? base.title}
                    onChange={(e) => patch({ title: e.target.value === base.title ? undefined : e.target.value })}
                  />
                </div>
                <div>
                  <label className="wz-label" htmlFor="wz-intro-body">What Beamy says</label>
                  <textarea
                    id="wz-intro-body"
                    className="wz-input !min-h-[84px] resize-none py-3 !text-[16px]"
                    maxLength={INTRO_BODY_MAX}
                    value={edit.body ?? base.body}
                    onChange={(e) => patch({ body: e.target.value === base.body ? undefined : e.target.value })}
                  />
                  <p className="mt-1 text-right text-[12px] text-white/50">{(edit.body ?? base.body).length}/{INTRO_BODY_MAX}</p>
                </div>
                </div>

                {PICTURE_STEPS.includes(current) ? (
                  <div>
                    <p className="wz-label">Picture</p>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="sr-only"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }}
                    />
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-4" role="radiogroup" aria-label="Picture">
                      <PicTile on={!pic} label="Beamy’s pick" onClick={() => setPicture({ kind: 'default' })}>
                        <img src={beamyHello} alt="" className="h-full w-full object-contain p-1.5" />
                      </PicTile>
                      <button type="button" className="wz-tile" onClick={() => fileRef.current?.click()} disabled={uploading}>
                        <span className="wz-tile-art grid aspect-square place-items-center border border-dashed border-white/35">
                          {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <ImagePlus className="h-6 w-6" aria-hidden />}
                        </span>
                        <span className="wz-tile-name">{uploading ? 'Uploading…' : 'Upload'}</span>
                      </button>
                      {pictureLooks.map((l) => (
                        <PicTile key={l.id} on={pic?.kind === 'look' && pic.lookId === l.id} label={l.name} onClick={() => setPicture({ kind: 'look', lookId: l.id })}>
                          {l.tab === 'frames' && <img src={boothStandin} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                          <img src={l.thumb ?? ''} alt="" className={`relative h-full w-full ${l.tab === 'frames' ? 'object-fill' : 'object-cover'}`} />
                        </PicTile>
                      ))}
                      {pic?.kind === 'upload' && (
                        <PicTile on label="Your upload" onClick={() => undefined}>
                          <img src={pic.url} alt="" className="h-full w-full object-cover" />
                        </PicTile>
                      )}
                    </div>
                    {pictureLooks.length > 0 && (
                      <p className="mt-2 text-[12.5px] text-white/60">
                        {current === 'world' ? 'Your frames, standing up in the room.' : 'Your own looks. Tap one to use it, no screenshots needed.'}
                      </p>
                    )}
                    {uploadError && <p role="alert" className="mt-2 text-[13.5px] text-[#FFD2DA]">{uploadError}</p>}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-white/60 lg:pt-7">This picture is a live drawing of the booth’s own buttons, pointing at each one in turn, so it always matches your booth.</p>
                )}
              </div>
            )}
            {cfg.steps[current] && (
              <button type="button" onClick={() => setCfg((c) => { const steps = { ...c.steps }; delete steps[current]; return { ...c, steps }; })} className="pressable inline-flex min-h-11 items-center gap-2 self-start rounded-full px-1 text-[14px] text-white/80 hover:text-white">
                <RotateCcw className="h-4 w-4" aria-hidden /> Back to Beamy’s version
              </button>
            )}
          </div>
        )}
      </div>
    </StepShell>
  );
}

function listShort(ids: readonly IntroStepId[]): string {
  return listWords(ids.map((id) => (id === 'world' ? 'AR' : INTRO_STEP_LABEL[id].toLowerCase())));
}

function PicTile({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="wz-tile !p-1.5" onClick={onClick} title={label}>
      <span className="wz-tile-art relative aspect-square overflow-hidden bg-black/25">
        {children}
        {on && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[#5FD9A8] text-[#10213a]"><Check className="h-3 w-3" aria-hidden /></span>}
      </span>
      <span className="wz-tile-name truncate">{label}</span>
    </button>
  );
}
