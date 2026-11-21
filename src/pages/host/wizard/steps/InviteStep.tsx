/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 2 — the welcome page: what guests see when they scan the QR, and what
 * goes on the big screen. Three ways in (a template, a colour, your own
 * photo), an optional border and a line of welcome. Saves as the host goes,
 * into the SAME events.config.scene the live page reads.
 */
import { useMemo, useRef, useState } from 'react';
import { Frame, ImagePlus, Loader2, MessageSquareText, Palette, Sparkles, Upload } from 'lucide-react';
import SceneBackdrop from '../../../../components/theme/SceneBackdrop';
import {
  SCENE_PAGE_BORDERS, SCENE_PAGE_BORDER_META, SCENE_PALETTES, SCENE_TEMPLATES, normalizeScene, resolveScene,
  resolveSceneImageUrl, type EventScene, type ScenePageBorder,
} from '../../../../lib/sceneThemes';
import { sceneUploadError } from '../../../../lib/scenePage';
import { uploadAsset } from '../../../../lib/wizard/wizardApi';
import { formatEventDate, ymdFromIso } from '../../../../lib/wizard/occasions';
import { StepPanel, StepShell, TabPanel, WizardTabs } from '../chrome';
import { stepDef } from '../../../../lib/wizard/wizardModel';
import { useWizard } from '../wizardContext';
import { useAutosave } from '../useAutosave';
import WelcomePreview from '../WelcomePreview';
import ImageFitTool from '../ImageFitTool';

type Mode = 'template' | 'colour' | 'photo';
/** The background modes, then the border and the welcome line — one row of tabs. */
type Tab = Mode | 'border' | 'words';

const SOLIDS = ['#1A1740', '#2B2A8C', '#4840C6', '#0F4B5C', '#3B1F4F', '#7A2E4A', '#F4F2FA', '#FBE3DA', '#DDE9DF'];

function modeOf(s: EventScene | undefined): Mode {
  if (!s) return 'template';
  if (s.kind === 'image') return 'photo';
  if (s.kind === 'gradient' || s.kind === 'color') return 'colour';
  return 'template';
}

interface Draft {
  scene: EventScene | undefined;
  intro: string;
}

export default function InviteStep() {
  const { ev } = useWizard();
  const initialScene = normalizeScene(ev.config.scene);
  const copy = (ev.config.copy && typeof ev.config.copy === 'object' ? ev.config.copy : {}) as Record<string, unknown>;
  const [d, setD] = useState<Draft>({
    scene: initialScene ?? { kind: 'template', id: 'beamwall' },
    intro: typeof copy.welcomeIntro === 'string' ? copy.welcomeIntro : '',
  });
  const [mode, setMode] = useState<Mode>(modeOf(initialScene));
  const [tab, setTab] = useState<Tab>(modeOf(initialScene));
  // The last pick in each mode, so flipping tabs and back does not lose it.
  const memory = useRef<Partial<Record<Mode, EventScene>>>({ [modeOf(initialScene)]: initialScene });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const evRef = useRef(ev);
  evRef.current = ev;
  useAutosave(d, (v) => {
    const cur = (evRef.current.config.copy && typeof evRef.current.config.copy === 'object' ? evRef.current.config.copy : {}) as Record<string, unknown>;
    const intro = v.intro.trim();
    const nextCopy = { ...cur };
    if (intro) nextCopy.welcomeIntro = intro;
    else delete nextCopy.welcomeIntro;
    return { scene: v.scene, copy: nextCopy };
  });

  const border: ScenePageBorder = d.scene?.border ?? 'none';
  const setScene = (s: EventScene) => {
    const withBorder = border !== 'none' ? { ...s, border } : (() => { const { border: _b, ...rest } = s; return rest as EventScene; })();
    memory.current[modeOf(s)] = withBorder;
    setD((p) => ({ ...p, scene: withBorder }));
  };
  const setBorder = (b: ScenePageBorder) => setD((p) => {
    if (!p.scene) return p;
    const { border: _old, ...rest } = p.scene;
    return { ...p, scene: (b === 'none' ? rest : { ...rest, border: b }) as EventScene };
  });
  const switchMode = (m: Mode) => {
    setMode(m);
    const remembered = memory.current[m];
    if (remembered) setScene(remembered);
    else if (m === 'template') setScene({ kind: 'template', id: 'beamwall' });
    else if (m === 'colour') setScene({ kind: 'gradient', paletteId: 'dusk' });
  };

  const upload = async (file: File) => {
    const why = sceneUploadError(file);
    if (why) { setUploadError(why); return; }
    setUploading(true);
    setUploadError(null);
    const url = await uploadAsset(ev.slug, file, 'page-background');
    setUploading(false);
    const safe = url ? resolveSceneImageUrl(url) : undefined;
    if (!safe) { setUploadError('That photo didn’t upload. Check your connection and try again.'); return; }
    setScene({ kind: 'image', url: safe, dim: 0.3, tone: 'dark' });
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const previewCopy = useMemo(() => ({
    name: ev.name,
    dateLabel: formatEventDate(ymdFromIso(ev.starts_at)),
    intro: d.intro.trim() || null,
  }), [ev.name, ev.starts_at, d.intro]);
  const image = d.scene?.kind === 'image' ? d.scene : null;

  const pickTab = (id: Tab) => { setTab(id); if (id === 'template' || id === 'colour' || id === 'photo') { if (id !== mode) switchMode(id); } };
  const card = (
          <StepPanel
            step="invite"
            tabs={(
              <WizardTabs<Tab>
                idBase="wz-invite"
                label="Welcome page settings"
                className="wz-tabs-even"
                value={tab}
                onChange={pickTab}
                tabs={[
                  { id: 'template', label: 'Templates', short: 'Styles', Icon: Sparkles },
                  { id: 'colour', label: 'Colour', short: 'Colour', Icon: Palette },
                  { id: 'photo', label: 'Photo', short: 'Photo', Icon: ImagePlus },
                  { id: 'border', label: 'Border', short: 'Border', Icon: Frame },
                  { id: 'words', label: 'Message', short: 'Words', Icon: MessageSquareText },
                ]}
              />
            )}
          >
            <TabPanel idBase="wz-invite" value={tab}>
            {tab === 'template' && (
              <div className="wz-sq grid grid-cols-3 sm:grid-cols-4 gap-2.5" role="radiogroup" aria-label="Templates">
                {SCENE_TEMPLATES.map((t) => {
                  const on = d.scene?.kind === 'template' && d.scene.id === t.id;
                  return (
                    <button key={t.id} type="button" role="radio" aria-checked={on} className="wz-tile" onClick={() => setScene({ kind: 'template', id: t.id })} title={t.blurb}>
                      <span className="wz-tile-art aspect-[9/14]">
                        <SceneBackdrop scene={resolveScene({ kind: 'template', id: t.id })} compact />
                      </span>
                      <span className="wz-tile-name">{t.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {tab === 'colour' && (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="wz-label">Soft gradients</p>
                  <div className="wz-sq-5 grid grid-cols-5 gap-2.5" role="radiogroup" aria-label="Gradients">
                    {SCENE_PALETTES.map((p) => {
                      const on = d.scene?.kind === 'gradient' && d.scene.paletteId === p.id;
                      return (
                        <button key={p.id} type="button" role="radio" aria-checked={on} className="wz-tile !p-1.5" onClick={() => setScene({ kind: 'gradient', paletteId: p.id })}>
                          <span className="wz-tile-art aspect-square">
                            <SceneBackdrop scene={resolveScene({ kind: 'gradient', paletteId: p.id })} compact />
                          </span>
                          <span className="wz-tile-name text-center">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="wz-label">One colour</p>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {SOLIDS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="wz-swatch"
                        style={{ background: c }}
                        aria-label={`Colour ${c}`}
                        aria-pressed={d.scene?.kind === 'color' && d.scene.color.toLowerCase() === c.toLowerCase()}
                        onClick={() => setScene({ kind: 'color', color: c })}
                      />
                    ))}
                    <label className="relative wz-swatch overflow-hidden cursor-pointer grid place-items-center bg-[conic-gradient(#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa,#f472b6,#f87171)]" title="Any colour">
                      <span className="sr-only">Pick any colour</span>
                      <input
                        type="color"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        value={d.scene?.kind === 'color' ? d.scene.color : '#4840C6'}
                        onChange={(e) => setScene({ kind: 'color', color: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {tab === 'photo' && (
              <div className="flex flex-col gap-5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }}
                />
                {image ? (
                  <>
                    <ImageFitTool url={image.url} fit={image.fit} onChange={(fit) => setScene({ ...image, fit })} />
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="wz-label" htmlFor="wz-dim">Soften the photo</label>
                        <input id="wz-dim" type="range" min={0} max={0.7} step={0.05} value={image.dim} className="w-full accent-white" onChange={(e) => setScene({ ...image, dim: Number(e.target.value) })} />
                        <p className="text-[12px] text-white/60 mt-1">A darker or lighter wash keeps the words easy to read.</p>
                      </div>
                      <div>
                        <p className="wz-label">Words in</p>
                        <div className="wz-tabs">
                          {(['dark', 'light'] as const).map((tone) => (
                            <button key={tone} type="button" aria-pressed={image.tone === tone} role="tab" aria-selected={image.tone === tone} className="wz-tab" onClick={() => setScene({ ...image, tone })}>
                              {tone === 'dark' ? 'White' : 'Dark'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="pressable self-start liquid-glass-raised inline-flex items-center gap-2 rounded-full px-4 min-h-11 text-[14px]">
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} Use a different photo
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
                    disabled={uploading}
                    className="rounded-[22px] border-2 border-dashed border-white/35 hover:border-white/70 transition px-6 py-10 flex flex-col items-center text-center gap-2"
                  >
                    {uploading ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : <ImagePlus className="h-8 w-8" aria-hidden />}
                    <span className="text-[16px] font-semibold">{uploading ? 'Uploading…' : 'Upload a photo or design'}</span>
                    <span className="text-[13px] text-white/70 max-w-[40ch]">
                      Best at <strong className="text-white">1080 × 1920 px</strong> (portrait). Any size works: you can drag and zoom it to fit after. JPG, PNG or WebP, up to 10 MB.
                    </span>
                  </button>
                )}
                {uploadError && <p role="alert" className="text-[13.5px] text-[#FFD2DA]">{uploadError}</p>}
              </div>
            )}

            {tab === 'border' && (
              <div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Border">
                  {SCENE_PAGE_BORDERS.map((b) => (
                    <button key={b} type="button" role="radio" aria-checked={border === b} className="wz-choice !min-h-11 !py-2" onClick={() => setBorder(b)} title={SCENE_PAGE_BORDER_META[b].blurb}>
                      <span className="text-[14px] font-medium">{SCENE_PAGE_BORDER_META[b].label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[13px] text-white/70">{SCENE_PAGE_BORDER_META[border].blurb}</p>
              </div>
            )}

            {tab === 'words' && (
              <div>
                <label className="wz-label" htmlFor="wz-intro">A line of welcome <span className="normal-case tracking-normal font-normal text-white/50">(optional)</span></label>
                <textarea
                  id="wz-intro"
                  className="wz-input !min-h-[88px] py-3 !text-[16px] resize-none"
                  maxLength={200}
                  placeholder="Snap a photo, try on a look and watch it land on the live wall."
                  value={d.intro}
                  onChange={(e) => setD((p) => ({ ...p, intro: e.target.value }))}
                />
                <p className="mt-1 text-right text-[12px] text-white/50">{d.intro.length}/200</p>
              </div>
            )}
            </TabPanel>
          </StepPanel>
  );
  const preview = <WelcomePreview scene={d.scene} copy={previewCopy} url={`${origin}/e/${ev.slug}/welcome`} />;

  return <StepShell panel={card} preview={preview} sheetLabel={stepDef('invite').title} />;
}
