/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 6 — the live wall: how guests' photos show on the TV or projector.
 * A one-tap style, then guided parts for the layout, background, photo cards,
 * how a new photo arrives, and what else is on screen. The preview on the
 * right is the REAL wall (LiveWallFrame) wearing the unsaved design, with a
 * "Beam a photo" button that plays the chosen arrival effect.
 *
 * Writes the wall's own settings row (app_settings 'wall'), the same one the
 * studio's Wall design panel edits; every field this step does not show is
 * kept (the look is read, edited and written whole).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ImageUp, LayoutGrid, Loader2, Monitor, Music2, Pause, Play, Palette, QrCode, Sparkles, Square, Trophy, Wand2, Zap } from 'lucide-react';
import { getWallSettingsResult, setWallSettings, uploadAsset } from '../../../../lib/db';
import {
  SCENE_PALETTES,
  WALL_AMBIENTS,
  WALL_AMBIENT_META,
  WALL_BEAM_META,
  WALL_BEAM_STYLES,
  WALL_CARD_META,
  WALL_CARD_STYLES,
  WALL_CORNERS,
  WALL_CORNER_META,
  WALL_GLOWS,
  WALL_GLOW_COLORS,
  WALL_GLOW_META,
  WALL_GRID_SIZES,
  WALL_LAYOUTS,
  WALL_LAYOUT_META,
  WALL_STYLES,
  WALL_TRANSITIONS,
  WALL_TRANSITION_META,
  applyWallStyle,
  matchingWallStyle,
  normalizeScene,
  normalizeWallLook,
  paletteById,
  paletteCss,
  resolveScene,
  resolveSceneImageUrl,
  resolveWallBackdrop,
  wallGlowColor,
  wallTone,
  type WallCardStyle,
  type WallLayout,
  type WallLook,
} from '../../../../lib/sceneThemes';
import type { WallSettings } from '../../../../types';
import {
  WALL_MUSIC_PLAYLISTS,
  WALL_PLAYLIST_META,
  normalizeWallMusic,
  tracksFor,
  type WallMusic,
  type WallTrack,
} from '../../../../lib/wallMusic';
import {
  WALL_CYCLE_STEPS,
  WALL_MODE_TRANSITIONS,
  WALL_MODE_TRANSITION_META,
  cycleActive,
  cycleLabel,
  normalizeWallShow,
  toggleCycleLayout,
  type WallShow,
} from '../../../../lib/wallShow';
import { wallImageProblem } from '../../../../components/admin/WallDesignPanel';
import { StepShell } from '../chrome';
import { stepDef } from '../../../../lib/wizard/wizardModel';
import { WALL_SUBSTEPS } from '../../../../lib/wizard/subSteps';
import { useSubSteps } from '../useSubSteps';
import { useWizard } from '../wizardContext';
import { SAMPLE_SHOTS } from '../WelcomePreview';
import LiveWallFrame from '../LiveWallFrame';

interface WallDraft {
  look: WallLook;
  music: WallMusic;
  show: WallShow;
  qrOnWall: boolean;
  showLeaderboard: boolean;
  showChallenges: boolean;
  featuredSpotlight: boolean;
}

/** A style, then each part of the wall: separate decisions, so they are
 *  guided sub-steps (lib/wizard/subSteps WALL_SUBSTEPS). */
const SUB_ICONS = { style: Wand2, layout: LayoutGrid, background: Palette, photos: Square, arrival: Sparkles, music: Music2, screen: Monitor } as const;

/** Plain colours first (black, white), then a few deep and soft tones. */
const PLAIN_COLORS = ['#0B0B12', '#FFFFFF', '#1A1740', '#2B1E3F', '#0F2E3A', '#F4EFE6', '#EDE9FF', '#FBE7EC'];

/** A tiny drawing of each layout, so the choice reads at a glance. */
function LayoutGlyph({ layout }: { layout: WallLayout }) {
  const cell = 'rounded-[3px] bg-white/70';
  switch (layout) {
    case 'grid':
      return <span className="grid grid-cols-4 gap-[3px] w-full h-full p-2">{Array.from({ length: 12 }, (_, i) => <span key={i} className={cell} />)}</span>;
    case 'masonry':
      return (
        <span className="grid grid-cols-3 gap-[3px] w-full h-full p-2">
          {[0, 1, 2].map((c) => (
            <span key={c} className="flex flex-col gap-[3px]">
              {[c === 1 ? 'h-[40%]' : 'h-[60%]', c === 1 ? 'h-[60%]' : 'h-[40%]'].map((h, i) => <span key={i} className={`${cell} ${h}`} />)}
            </span>
          ))}
        </span>
      );
    case 'marquee':
      return (
        <span className="flex flex-col justify-center gap-[4px] w-full h-full p-2">
          {[0, 1].map((r) => <span key={r} className={`flex gap-[3px] h-[38%] ${r ? 'translate-x-2' : '-translate-x-2'}`}>{[0, 1, 2, 3, 4].map((i) => <span key={i} className={`${cell} flex-1`} />)}</span>)}
        </span>
      );
    case 'carousel':
      return (
        <span className="relative flex items-center justify-center w-full h-full">
          <span className={`${cell} absolute w-[22%] h-[44%] left-[14%] opacity-60 scale-90`} />
          <span className={`${cell} absolute w-[22%] h-[44%] right-[14%] opacity-60 scale-90`} />
          <span className={`${cell} relative w-[30%] h-[60%]`} />
        </span>
      );
    case 'slideshow':
      return <span className="flex w-full h-full p-2"><span className={`${cell} flex-1`} /></span>;
    case 'album':
      return (
        <span className="flex w-full h-full items-center justify-center p-1.5">
          <span className="flex h-full w-[86%] rounded-[3px] bg-white/18 p-[3px] gap-[2px]">
            {[0, 1].map((pg) => (
              <span key={pg} className="relative flex-1 rounded-[2px] bg-white/12">
                <span className={`${cell} absolute left-[14%] top-[12%] h-[36%] w-[30%] -rotate-6`} />
                <span className={`${cell} absolute right-[14%] top-[16%] h-[36%] w-[30%] rotate-3`} />
                <span className={`${cell} absolute left-[30%] bottom-[10%] h-[36%] w-[30%] rotate-2`} />
              </span>
            ))}
          </span>
        </span>
      );
  }
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A small card in the swatches: the same visual idea as the wall's CSS. */
function cardCss(card: WallCardStyle, glow: string, glowOn: boolean, light: boolean): CSSProperties {
  const halo = glowOn ? `0 0 12px 1px ${rgba(glow, 0.6)}` : '0 0 0 0 transparent';
  switch (card) {
    case 'glass':
      return {
        border: '3px solid transparent',
        background: `linear-gradient(${light ? 'rgba(255,255,255,.6)' : 'rgba(14,12,40,.5)'}, ${light ? 'rgba(255,255,255,.6)' : 'rgba(14,12,40,.5)'}) padding-box, linear-gradient(140deg, rgba(255,255,255,.75), rgba(255,255,255,.15) 40%, ${rgba(glow, 0.45)} 72%, rgba(255,255,255,.5)) border-box`,
        borderRadius: 7,
        boxShadow: `${halo}, 0 8px 14px -8px rgba(0,0,0,.7)`,
      };
    case 'polaroid':
      return { border: '3px solid #FBFAF6', borderBottomWidth: 9, background: '#FBFAF6', borderRadius: 2, boxShadow: `${halo}, 0 6px 12px -6px rgba(0,0,0,.6)` };
    case 'neon':
      return { border: `1.5px solid ${glow}`, borderRadius: 6, boxShadow: `0 0 8px ${rgba(glow, 0.85)}, ${halo}` };
    case 'clean':
      return { borderRadius: 6, boxShadow: `${halo}, 0 10px 16px -8px rgba(0,0,0,.75)` };
    case 'classic':
      return { borderRadius: 6, boxShadow: `${halo}, inset 0 0 0 1px rgba(255,255,255,.12)` };
  }
}

/** The background a look shows, for the little swatches. */
function backdropCss(look: WallLook, eventBg: string): string {
  const b = look.backdrop;
  if (b.kind === 'gradient') {
    const p = paletteById(b.paletteId);
    return p ? paletteCss(p) : eventBg;
  }
  if (b.kind === 'color') return b.color;
  if (b.kind === 'image') return `center / cover no-repeat url("${b.url}")`;
  return eventBg;
}

/** Three sample photos dressed in a look: the style and card swatches. */
function MiniWall({ look, eventBg, eventTone, accent }: { look: WallLook; eventBg: string; eventTone: 'dark' | 'light'; accent: string }) {
  const tone = wallTone(look, eventTone);
  const glow = wallGlowColor(look, resolveWallBackdrop(look)?.accent ?? accent);
  const card = cardCss(look.card, glow, look.glow !== 'none', tone === 'light');
  return (
    <span className="absolute inset-0 flex items-center justify-center gap-[7%] px-[9%]" style={{ background: backdropCss(look, eventBg) }}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="block flex-1 overflow-hidden" style={{ ...card, aspectRatio: '3 / 4', transform: `translateY(${i === 1 ? -6 : 3}%)` }}>
          <img src={SAMPLE_SHOTS[(i + 1) % SAMPLE_SHOTS.length]} alt="" className="block h-full w-full object-cover" style={{ borderRadius: 'inherit' }} />
        </span>
      ))}
    </span>
  );
}

/** A tiny looping glyph for each arrival effect. */
function BeamGlyph({ style }: { style: WallLook['beam'] }) {
  return (
    <span className={`wz-beamglyph wz-beamglyph-${style}`} aria-hidden>
      <span className="tile" />
      {style === 'beam' && <span className="ray" />}
      {style === 'sparkle' && [0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="star" style={{ '--i': i } as CSSProperties} />)}
      {style === 'reveal' && <span className="sweep" />}
    </span>
  );
}

function Pills<T extends string | number>({ label, value, options, onPick }: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <p className="wz-label">{label}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} className="wz-pill" onClick={() => onPick(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}

function Toggle({ label, hint, Icon, checked, disabled, onChange }: {
  label: string;
  hint: string;
  Icon: typeof QrCode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-2xl px-3 py-3 min-h-14 cursor-pointer hover:bg-white/6">
      <span className="grid place-items-center h-10 w-10 rounded-full bg-white/12 shrink-0"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[12.5px] text-white/65">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="wz-switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** One shared <audio> for auditioning the music library: one song at a
 *  time, stopped on unmount. HANDLED FAILURES: `new Audio` throwing or the
 *  file failing (that song's button shows it cannot play) · play() rejected
 *  (AbortError from the next tap is not a failure). */
function useSongPreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [broken, setBroken] = useState<Record<string, true>>({});
  useEffect(() => () => {
    const a = audio.current;
    if (a !== null) { a.pause(); a.removeAttribute('src'); a.load(); }
    audio.current = null;
  }, []);
  const stop = () => { audio.current?.pause(); setPlaying(null); };
  const toggle = (t: WallTrack) => {
    if (playing === t.id) { stop(); return; }
    audio.current?.pause();
    let a: HTMLAudioElement;
    try { a = new Audio(t.file); } catch { setBroken((b) => ({ ...b, [t.id]: true })); return; }
    a.volume = 0.8;
    audio.current = a;
    const fail = () => { setBroken((b) => ({ ...b, [t.id]: true })); setPlaying((c) => (c === t.id ? null : c)); };
    a.addEventListener('ended', () => setPlaying((c) => (c === t.id ? null : c)));
    a.addEventListener('error', fail);
    setPlaying(t.id);
    a.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      fail();
    });
  };
  return { playing, broken, toggle, stop };
}

function formatLength(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

const SCREEN_TOGGLES: { key: Exclude<keyof WallDraft, 'look' | 'music' | 'show'>; label: string; hint: string; Icon: typeof QrCode }[] = [
  { key: 'qrOnWall', label: 'QR codes on the live wall', hint: 'Off by default. Guests scan to open the booth.', Icon: QrCode },
  { key: 'featuredSpotlight', label: 'Spotlight a photo now and then', hint: 'One shot fills the screen for a few seconds.', Icon: Sparkles },
  { key: 'showLeaderboard', label: 'Leaderboard tab', hint: 'Points for photos and challenges.', Icon: Trophy },
  { key: 'showChallenges', label: 'Show challenges to guests', hint: 'The missions you picked, on the wall.', Icon: Zap },
];

export default function BoothStep() {
  const w = useWizard();
  const { ev } = w;
  const [draft, setDraft] = useState<WallDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const sub = useSubSteps('booth', WALL_SUBSTEPS, SUB_ICONS);
  const tab = sub.current;
  const [beamSignal, setBeamSignal] = useState(0);
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef<WallSettings | null>(null);

  useEffect(() => {
    let alive = true;
    void getWallSettingsResult(ev.slug).then((r) => {
      if (!alive) return;
      if (r.failed) { setFailed(true); return; }
      loaded.current = r.settings;
      setDraft({
        look: normalizeWallLook(r.settings.wallLook, r.settings.galleryScroll),
        music: normalizeWallMusic(r.settings.music),
        show: normalizeWallShow(r.settings.show),
        qrOnWall: r.settings.qrOnWall === true,
        showLeaderboard: r.settings.showLeaderboard,
        showChallenges: r.settings.showChallenges,
        featuredSpotlight: r.settings.featuredSpotlight,
      });
    });
    return () => { alive = false; };
  }, [ev.slug]);

  // Debounced save into the wall's own row (its read-merge-write keeps any
  // field this step does not touch).
  const pending = useRef<WallDraft | null>(null);
  const flush = useRef(async () => true);
  flush.current = async () => {
    const d = pending.current;
    if (!d) return true;
    pending.current = null;
    w.reportSave('saving');
    try {
      await setWallSettings(ev.slug, {
        qrOnWall: d.qrOnWall,
        showLeaderboard: d.showLeaderboard,
        showChallenges: d.showChallenges,
        featuredSpotlight: d.featuredSpotlight,
        wallLook: d.look,
        music: d.music,
        show: d.show,
      }, { strict: true });
      w.reportSave('saved');
      return true;
    } catch {
      w.reportSave('error');
      return false;
    }
  };
  const update = (p: Partial<WallDraft>) => setDraft((prev) => {
    if (!prev) return prev;
    const next = { ...prev, ...p };
    pending.current = next;
    return next;
  });
  const patchLook = (p: Partial<WallLook>) => setDraft((prev) => {
    if (!prev) return prev;
    const next = { ...prev, look: { ...prev.look, ...p } };
    pending.current = next;
    return next;
  });
  const patchMusic = (p: Partial<WallMusic>) => update(draft ? { music: { ...draft.music, ...p } } : {});
  const patchShow = (p: Partial<WallShow>) => update(draft ? { show: { ...draft.show, ...p } } : {});
  const songs = useSongPreview();
  /** Replace the whole look (a style drops keys, e.g. its own glow colour). */
  const setLook = (next: WallLook) => setDraft((prev) => {
    if (!prev) return prev;
    const d = { ...prev, look: next };
    pending.current = d;
    return d;
  });
  useEffect(() => {
    if (!pending.current) return;
    const t = setTimeout(() => void flush.current(), 500);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    w.setBeforeContinue(() => flush.current());
    return () => w.setBeforeContinue(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const eventScene = useMemo(() => resolveScene(normalizeScene(ev.config.scene)), [ev.config.scene]);
  const previewSettings = useMemo(() => draft && ({
    qrOnWall: draft.qrOnWall,
    showLeaderboard: draft.showLeaderboard,
    showChallenges: draft.showChallenges,
    featuredSpotlight: draft.featuredSpotlight,
    wallLook: draft.look,
    show: draft.show,
  }), [draft]);

  const beam = () => setBeamSignal((n) => n + 1);

  const pickFile = async (file: File) => {
    const problem = wallImageProblem(file);
    if (problem !== null) { setUpload({ busy: false, error: problem }); return; }
    setUpload({ busy: true, error: null });
    let url: string | null = null;
    try {
      url = await uploadAsset(ev.slug, file, 'wall-backdrop');
    } catch {
      url = null;
    }
    const safe = resolveSceneImageUrl(url);
    if (safe === undefined) {
      setUpload({ busy: false, error: 'The upload didn’t go through. Check your connection and try again.' });
      return;
    }
    setUpload({ busy: false, error: null });
    const dim = draft?.look.backdrop.kind === 'image' ? draft.look.backdrop.dim : 0.45;
    patchLook({ backdrop: { kind: 'image', url: safe, dim } });
  };

  const look = draft?.look;
  const current = look ? matchingWallStyle(look) : undefined;
  const glowHex = look ? wallGlowColor(look, resolveWallBackdrop(look)?.accent ?? eventScene.accent) : '#D4D6FF';
  const b = look?.backdrop;

  const panel = (): ReactNode => {
    if (!draft || !look || !b) return null;
    switch (tab) {
      case 'style':
        return (
          <Section>
            <div className="wz-styles" role="radiogroup" aria-label="Live wall style">
              {WALL_STYLES.map((s) => {
                const styled = applyWallStyle(look, s);
                return (
                  <button key={s.id} type="button" role="radio" aria-checked={current?.id === s.id} className="wz-tile" title={s.blurb} onClick={() => setLook(applyWallStyle(look, s))}>
                    <span className="wz-tile-art aspect-[4/3]"><MiniWall look={styled} eventBg={eventScene.background} eventTone={eventScene.tone} accent={eventScene.accent} /></span>
                    <span className="wz-tile-name">{s.name}</span>
                  </button>
                );
              })}
            </div>
            <p className="-mt-2 text-[13px] text-white/70">
              {current ? current.blurb : 'Your own mix. Pick a style to start again, or keep tuning in the other tabs.'}
            </p>
          </Section>
        );
      case 'layout':
        return (
          <Section>
            <div className="wz-sq-6 grid grid-cols-3 sm:grid-cols-6 gap-2.5" role="radiogroup" aria-label="Live wall layout">
              {WALL_LAYOUTS.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={look.layout === l} className="wz-tile" onClick={() => patchLook({ layout: l })} title={WALL_LAYOUT_META[l].blurb}>
                  <span className="wz-tile-art aspect-video flex"><LayoutGlyph layout={l} /></span>
                  <span className="wz-tile-name">{WALL_LAYOUT_META[l].label}</span>
                </button>
              ))}
            </div>
            <p className="-mt-2 text-[13px] text-white/70">{WALL_LAYOUT_META[look.layout].blurb}</p>
            {look.layout === 'grid' && (
              <div className="flex flex-wrap gap-x-8 gap-y-4">
                <Pills label="Grid size" value={look.gridSize} options={WALL_GRID_SIZES.map((n) => ({ id: n, label: `${n} × ${n}` }))} onPick={(gridSize) => patchLook({ gridSize })} />
                <Pills label="New photo turns in with" value={look.transition} options={WALL_TRANSITIONS.map((t) => ({ id: t, label: WALL_TRANSITION_META[t].label }))} onPick={(transition) => patchLook({ transition })} />
              </div>
            )}
            <div>
              <p className="wz-label">Switch layouts on its own</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Layouts to rotate through">
                {WALL_LAYOUTS.map((l) => (
                  <button key={l} type="button" className="wz-pill" aria-pressed={draft.show.cycle.includes(l)} onClick={() => patchShow({ cycle: toggleCycleLayout(draft.show.cycle, l) })}>
                    {WALL_LAYOUT_META[l].label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[13px] text-white/70">
                {cycleActive(draft.show)
                  ? `The wall moves through ${draft.show.cycle.map((l) => WALL_LAYOUT_META[l].label).join(', ')}. Every screen in the room changes together.`
                  : 'Pick two or more and the wall takes turns with them, so the room always has something new to look at.'}
              </p>
            </div>
            {cycleActive(draft.show) && (
              <Pills label="How often" value={draft.show.cycleSec} options={WALL_CYCLE_STEPS.map((sec) => ({ id: sec, label: cycleLabel(sec) }))} onPick={(cycleSec) => patchShow({ cycleSec })} />
            )}
            <div>
              <Pills label="Change layouts with" value={draft.show.transition} options={WALL_MODE_TRANSITIONS.map((t) => ({ id: t, label: WALL_MODE_TRANSITION_META[t].label }))} onPick={(transition) => patchShow({ transition, cycle: draft.show.cycle })} />
              <p className="mt-2 text-[13px] text-white/70">
                {WALL_MODE_TRANSITION_META[draft.show.transition].blurb}
                {cycleActive(draft.show) ? ' The preview switches every few seconds so you can watch it.' : ''}
              </p>
            </div>
          </Section>
        );
      case 'background':
        return (
          <Section>
            <div className="wz-sq grid grid-cols-4 gap-2.5" role="radiogroup" aria-label="Background">
              {([
                ['event', 'Welcome page'],
                ['gradient', 'Gradient'],
                ['color', 'Plain colour'],
                ['image', 'Your photo'],
              ] as const).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={b.kind === kind}
                  className="wz-tile"
                  onClick={() => {
                    if (kind === 'event') patchLook({ backdrop: { kind: 'event' } });
                    else if (kind === 'gradient') patchLook({ backdrop: { kind: 'gradient', paletteId: b.kind === 'gradient' ? b.paletteId : 'dusk' } });
                    else if (kind === 'color') patchLook({ backdrop: { kind: 'color', color: b.kind === 'color' ? b.color : '#0B0B12' } });
                    else if (b.kind !== 'image') fileInput.current?.click();
                  }}
                >
                  <span className="wz-tile-art aspect-[4/3] grid place-items-center" style={{ background: kind === 'event' ? eventScene.background : kind === 'gradient' ? paletteCss(paletteById(b.kind === 'gradient' ? b.paletteId : 'dusk') ?? SCENE_PALETTES[0]) : kind === 'color' ? (b.kind === 'color' ? b.color : '#0B0B12') : b.kind === 'image' ? `center / cover no-repeat url("${b.url}")` : 'rgba(255,255,255,0.08)' }}>
                    {kind === 'image' && b.kind !== 'image' && <ImageUp className="h-5 w-5 text-white/85" aria-hidden />}
                  </span>
                  <span className="wz-tile-name">{label}</span>
                </button>
              ))}
            </div>
            {b.kind === 'event' && <p className="text-[13px] text-white/70">The live wall wears the same background as your welcome page.</p>}
            {b.kind === 'gradient' && (
              <div>
                <p className="wz-label">Gradient</p>
                <div className="flex flex-wrap gap-2.5">
                  {SCENE_PALETTES.map((p) => (
                    <button key={p.id} type="button" className="wz-swatch h-11 w-11" style={{ background: paletteCss(p) }} aria-pressed={b.paletteId === p.id} aria-label={p.name} title={p.name} onClick={() => patchLook({ backdrop: { kind: 'gradient', paletteId: p.id } })} />
                  ))}
                </div>
              </div>
            )}
            {b.kind === 'color' && (
              <div>
                <p className="wz-label">Colour</p>
                <div className="flex flex-wrap items-center gap-2.5">
                  {PLAIN_COLORS.map((c) => (
                    <button key={c} type="button" className="wz-swatch h-11 w-11" style={{ background: c }} aria-pressed={b.color.toLowerCase() === c.toLowerCase()} aria-label={c === '#0B0B12' ? 'Black' : c === '#FFFFFF' ? 'White' : c} onClick={() => patchLook({ backdrop: { kind: 'color', color: c } })} />
                  ))}
                  <label className="wz-pill cursor-pointer">
                    <span className="h-5 w-5 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,.5)]" style={{ background: b.color }} />
                    Custom
                    <input type="color" className="sr-only" value={b.color} onChange={(e) => patchLook({ backdrop: { kind: 'color', color: e.target.value } })} />
                  </label>
                </div>
              </div>
            )}
            {b.kind === 'image' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="h-16 w-24 shrink-0 rounded-xl bg-cover bg-center shadow-[inset_0_0_0_1px_rgba(255,255,255,.3)]" style={{ backgroundImage: `url("${b.url}")` }} />
                  <button type="button" className="wz-pill" onClick={() => fileInput.current?.click()} disabled={upload.busy}>
                    <ImageUp className="h-4 w-4" aria-hidden /> Change photo
                  </button>
                </div>
                <label className="block">
                  <span className="wz-label">Darken for contrast</span>
                  <input type="range" min={0} max={0.8} step={0.05} value={b.dim} className="w-full accent-white" onChange={(e) => patchLook({ backdrop: { ...b, dim: Number(e.target.value) } })} />
                </label>
                <Pills label="Wall text" value={look.tone === 'light' ? 'light' : 'dark'} options={[{ id: 'dark', label: 'Light text' }, { id: 'light', label: 'Dark text' }]} onPick={(tone) => patchLook({ tone })} />
              </div>
            )}
            {upload.busy && <p className="flex items-center gap-2 text-[13px] text-white/75"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Uploading your photo…</p>}
            {upload.error && <p role="alert" className="text-[13px] text-[#FFC2CC]">{upload.error}</p>}
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickFile(f); }} />
          </Section>
        );
      case 'photos':
        return (
          <Section>
            <div className="wz-sq-5 grid grid-cols-3 sm:grid-cols-5 gap-2.5" role="radiogroup" aria-label="Photo cards">
              {WALL_CARD_STYLES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={look.card === c} className="wz-tile" onClick={() => patchLook({ card: c })} title={WALL_CARD_META[c].blurb}>
                  <span className="wz-tile-art aspect-[4/3]"><MiniWall look={{ ...look, card: c }} eventBg={eventScene.background} eventTone={eventScene.tone} accent={eventScene.accent} /></span>
                  <span className="wz-tile-name">{WALL_CARD_META[c].label}</span>
                </button>
              ))}
            </div>
            <p className="-mt-2 text-[13px] text-white/70">
              {WALL_CARD_META[look.card].blurb}
              {(look.layout === 'carousel' || look.layout === 'slideshow' || look.layout === 'album') && ` Photo cards show on the Grid, Gallery and Scrolling layouts. Your ${WALL_LAYOUT_META[look.layout].label} layout shows each photo on its own.`}
            </p>
            <div className="flex flex-wrap gap-x-8 gap-y-5">
              <Pills label="Glow" value={look.glow} options={WALL_GLOWS.map((g) => ({ id: g, label: WALL_GLOW_META[g].label }))} onPick={(glow) => patchLook({ glow })} />
              <Pills label="Corners" value={look.corners} options={WALL_CORNERS.map((c) => ({ id: c, label: WALL_CORNER_META[c].label }))} onPick={(corners) => patchLook({ corners })} />
            </div>
            <div>
              <p className="wz-label">Glow and beam colour</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button type="button" className="wz-pill" aria-pressed={look.glowColor === undefined} onClick={() => { const { glowColor: _g, ...rest } = look; void _g; setLook(rest); }}>Match the wall</button>
                {WALL_GLOW_COLORS.map((g) => (
                  <button key={g.color} type="button" className="wz-swatch h-10 w-10" style={{ background: g.color, boxShadow: `0 0 14px -2px ${g.color}` }} aria-pressed={look.glowColor?.toLowerCase() === g.color.toLowerCase()} aria-label={g.name} title={g.name} onClick={() => patchLook({ glowColor: g.color })} />
                ))}
                <label className="wz-pill cursor-pointer">
                  <span className="h-5 w-5 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,.5)]" style={{ background: glowHex }} />
                  Custom
                  <input type="color" className="sr-only" value={glowHex} onChange={(e) => patchLook({ glowColor: e.target.value })} />
                </label>
              </div>
            </div>
            <Toggle label="Guest names on photos" hint="Shown along the bottom of each photo." Icon={Wand2} checked={look.captions} onChange={(captions) => patchLook({ captions })} />
          </Section>
        );
      case 'arrival':
        return (
          <Section>
            <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="How a new photo arrives">
              {WALL_BEAM_STYLES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={look.beam === s} className="wz-tile" onClick={() => { patchLook({ beam: s }); beam(); }}>
                  <span className="wz-tile-art aspect-[4/3]"><BeamGlyph style={s} /></span>
                  <span className="wz-tile-name">{WALL_BEAM_META[s].label}</span>
                </button>
              ))}
            </div>
            <p className="-mt-2 text-[13px] text-white/70">{WALL_BEAM_META[look.beam].blurb} Tap one to watch it on the wall.</p>
            <div>
              <Pills label="Background motion" value={look.ambient} options={WALL_AMBIENTS.map((a) => ({ id: a, label: WALL_AMBIENT_META[a].label }))} onPick={(ambient) => patchLook({ ambient })} />
              <p className="mt-2 text-[13px] text-white/70">{WALL_AMBIENT_META[look.ambient].blurb}</p>
            </div>
          </Section>
        );
      case 'music': {
        const m = draft.music;
        const list = tracksFor(m.playlist);
        return (
          <Section>
            <Toggle
              label="Play music on the live wall"
              hint="Only on the big screen, never on guests’ phones. Each screen can mute itself."
              Icon={Music2}
              checked={m.enabled}
              onChange={(enabled) => { patchMusic({ enabled }); if (!enabled) songs.stop(); }}
            />
            <div className={m.enabled ? '' : 'opacity-55'}>
              <p className="wz-label">The mood</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Music mood">
                {WALL_MUSIC_PLAYLISTS.map((pl) => (
                  <button
                    key={pl}
                    type="button"
                    role="radio"
                    aria-checked={m.playlist === pl}
                    className="wz-tile items-start text-left px-3 py-2.5 min-h-[64px]"
                    onClick={() => patchMusic({ playlist: pl, enabled: true })}
                  >
                    <span className="block text-[14px] font-semibold">{WALL_PLAYLIST_META[pl].label}</span>
                    <span className="block text-[12px] leading-snug text-white/65">{WALL_PLAYLIST_META[pl].blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="wz-label">Songs in this mix ({list.length})</p>
              <ul className="flex flex-col">
                {list.map((t) => {
                  const on = songs.playing === t.id;
                  const bad = songs.broken[t.id] === true;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-2xl px-2 min-h-12 text-left hover:bg-white/6 disabled:opacity-50"
                        onClick={() => songs.toggle(t)}
                        disabled={bad}
                        aria-label={`${on ? 'Stop' : 'Listen to'} ${t.title} by ${t.artist}`}
                      >
                        <span className="grid place-items-center h-9 w-9 rounded-full bg-white/12 shrink-0">
                          {on ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[14.5px] font-medium">{t.title}</span>
                          <span className="block truncate text-[12.5px] text-white/65">{bad ? 'Can’t play this one right now' : `${t.artist} · ${WALL_PLAYLIST_META[t.mood].label}`}</span>
                        </span>
                        <span className="text-[12.5px] tabular-nums text-white/60">{formatLength(t.durationSec)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <label className="block">
              <span className="wz-label">Volume on the wall</span>
              <input type="range" min={0.1} max={1} step={0.05} value={m.volume} className="w-full accent-white" aria-label="Music volume" onChange={(e) => patchMusic({ volume: Number(e.target.value) })} />
            </label>
            <p className="text-[12.5px] text-white/60">
              Every song is in the public domain (CC0), so it is free to play at paid events with no licence and no credit needed. If the screen’s browser holds the sound back, the wall shows a “Tap to start the music” button.
            </p>
          </Section>
        );
      }
      case 'screen':
        return (
          <div className="-mx-2 flex flex-col">
            {SCREEN_TOGGLES.map(({ key, label, hint, Icon }) => (
              <Toggle key={key} label={label} hint={hint} Icon={Icon} checked={draft[key]} onChange={(v) => update({ [key]: v })} />
            ))}
          </div>
        );
    }
  };

  const notice = failed ? (
    <p role="alert" className="mb-4 rounded-2xl bg-[rgba(255,120,140,0.18)] px-4 py-3 text-[14.5px]">
      We couldn’t load your live wall settings. Check your connection, then come back to this step. You can carry on meanwhile.
    </p>
  ) : undefined;
  const controls = (
      <div {...sub.panelProps} className="outline-none">
        {draft ? panel() : <div className="h-40 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>}
      </div>
  );
  const previewNode = (
    <div className="flex flex-col gap-3 w-full">
          {previewSettings ? (
            <LiveWallFrame slug={ev.slug} settings={previewSettings} beamSignal={beamSignal} />
          ) : (
            <div className="aspect-[16/10] rounded-[22px] bg-white/5 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-white/65 min-w-0 flex-1">This is your real live wall with sample photos. Try the tabs in it too.</p>
            <button type="button" className="wz-beam-btn" onClick={beam} disabled={!draft}>
              <Sparkles className="h-4 w-4" aria-hidden /> Beam a photo
            </button>
          </div>
    </div>
  );

  return (
    <StepShell step="booth" hint={sub.hint} tabs={sub.bar} nav={sub.nav} notice={notice} preview={previewNode} previewKind="wide" sheetLabel={stepDef('booth').title}>
      {controls}
    </StepShell>
  );
}
