/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 6 — the big screen: how the live photo wall shows guests' photos.
 * Writes the wall's own settings row (app_settings 'wall'),
 * the same one the host's Wall Design panel edits.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, QrCode, Sparkles, Trophy, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import SceneBackdrop from '../../../../components/theme/SceneBackdrop';
import { getWallSettingsResult, setWallSettings } from '../../../../lib/db';
import {
  WALL_LAYOUTS, WALL_LAYOUT_META, normalizeScene, normalizeWallLook, resolveScene, type WallLayout,
} from '../../../../lib/sceneThemes';
import type { WallSettings } from '../../../../types';
import { StepHeading } from '../chrome';
import { useWizard } from '../wizardContext';
import { SAMPLE_SHOTS } from '../WelcomePreview';

interface WallDraft {
  layout: WallLayout;
  showQR: boolean;
  showLeaderboard: boolean;
  showChallenges: boolean;
  featuredSpotlight: boolean;
}

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
  }
}

function WallMock({ draft, url, sceneBg }: { draft: WallDraft; url: string; sceneBg: ReturnType<typeof resolveScene> }) {
  const shots = [...SAMPLE_SHOTS, ...SAMPLE_SHOTS];
  return (
    <div className="wz-screen w-full">
      <div className="wz-screen-inner">
        <SceneBackdrop scene={sceneBg} />
        <div className="absolute inset-0 p-[2.5cqw]">
          {draft.layout === 'grid' && (
            <div className="grid grid-cols-4 gap-[1cqw] h-full">{shots.slice(0, 12).map((s, i) => <img key={i} src={s} alt="" className="w-full h-full object-cover rounded-[0.8cqw]" />)}</div>
          )}
          {draft.layout === 'masonry' && (
            <div className="columns-4 gap-[1cqw] h-full overflow-hidden">{shots.map((s, i) => <img key={i} src={s} alt="" className={`w-full mb-[1cqw] object-cover rounded-[0.8cqw] ${i % 3 === 1 ? 'aspect-square' : 'aspect-[3/4]'}`} />)}</div>
          )}
          {draft.layout === 'marquee' && (
            <div className="flex flex-col justify-center gap-[1.5cqw] h-full">
              {[0, 1].map((r) => (
                <div key={r} className="flex gap-[1.2cqw]" style={{ transform: `translateX(${r ? -6 : -1}cqw)` }}>
                  {shots.slice(r * 3, r * 3 + 6).map((s, i) => <img key={i} src={s} alt="" className="h-[19cqw] aspect-[3/4] object-cover rounded-[0.8cqw] shrink-0" />)}
                </div>
              ))}
            </div>
          )}
          {draft.layout === 'carousel' && (
            <div className="relative h-full flex items-center justify-center [perspective:80cqw]">
              {[-2, -1, 0, 1, 2].map((k, i) => (
                <img
                  key={k}
                  src={shots[i]}
                  alt=""
                  className="absolute h-[60%] aspect-[3/4] object-cover rounded-[1cqw] shadow-xl"
                  style={{ transform: `translateX(${k * 17}cqw) rotateY(${k * -28}deg) scale(${1 - Math.abs(k) * 0.12})`, zIndex: 10 - Math.abs(k), opacity: 1 - Math.abs(k) * 0.18 }}
                />
              ))}
            </div>
          )}
          {draft.layout === 'slideshow' && (
            <div className="h-full flex items-center justify-center"><img src={shots[1]} alt="" className="h-full aspect-[3/4] object-cover rounded-[1cqw] shadow-xl" /></div>
          )}
        </div>
        {draft.showQR && (
          <div className="absolute right-[2.5cqw] bottom-[2.5cqw] flex items-center gap-[1cqw] rounded-[1.4cqw] bg-white/90 p-[0.8cqw] pr-[1.4cqw] text-[#1A1740]">
            <QRCodeSVG value={url} size={128} style={{ width: '7cqw', height: '7cqw' }} />
            <span className="text-[1.3cqw] font-semibold leading-tight max-w-[10cqw]">Scan to join the booth</span>
          </div>
        )}
        {draft.showLeaderboard && (
          <div className="absolute left-[2.5cqw] bottom-[2.5cqw] rounded-[1.2cqw] bg-[rgba(15,13,51,0.7)] px-[1.4cqw] py-[1cqw] text-white text-[1.25cqw]">
            <p className="font-semibold flex items-center gap-[0.6cqw]"><Trophy className="w-[1.4cqw] h-[1.4cqw]" aria-hidden /> Top snappers</p>
            {['Tolu · 12', 'Ada · 9', 'Sam · 7'].map((r) => <p key={r} className="opacity-85">{r}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}

const TOGGLES: { key: keyof Omit<WallDraft, 'layout'>; label: string; hint: string; Icon: typeof QrCode }[] = [
  { key: 'showQR', label: 'QR code on the live wall', hint: 'Guests scan it to open the booth.', Icon: QrCode },
  { key: 'featuredSpotlight', label: 'Spotlight a photo now and then', hint: 'One shot fills the screen for a few seconds.', Icon: Sparkles },
  { key: 'showLeaderboard', label: 'Show the leaderboard', hint: 'Points for photos and challenges.', Icon: Trophy },
  { key: 'showChallenges', label: 'Show challenges to guests', hint: 'The missions you picked, on the wall.', Icon: Zap },
];

export default function BoothStep() {
  const w = useWizard();
  const { ev } = w;
  const [draft, setDraft] = useState<WallDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const loaded = useRef<WallSettings | null>(null);

  useEffect(() => {
    let alive = true;
    void getWallSettingsResult(ev.slug).then((r) => {
      if (!alive) return;
      if (r.failed) { setFailed(true); return; }
      loaded.current = r.settings;
      setDraft({
        layout: normalizeWallLook(r.settings.wallLook, r.settings.galleryScroll).layout,
        showQR: r.settings.showQR,
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
      const look = normalizeWallLook(loaded.current?.wallLook, loaded.current?.galleryScroll ?? false);
      await setWallSettings(ev.slug, {
        showQR: d.showQR,
        showLeaderboard: d.showLeaderboard,
        showChallenges: d.showChallenges,
        featuredSpotlight: d.featuredSpotlight,
        wallLook: { ...look, layout: d.layout },
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
  useEffect(() => {
    if (!pending.current) return;
    const t = setTimeout(() => void flush.current(), 500);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    w.setBeforeContinue(() => flush.current());
    return () => w.setBeforeContinue(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sceneBg = useMemo(() => resolveScene(normalizeScene(ev.config.scene)), [ev.config.scene]);

  return (
    <>
      {failed && (
        <p role="alert" className="mb-4 rounded-2xl bg-[rgba(255,120,140,0.18)] px-4 py-3 text-[14.5px]">
          We couldn’t load your wall settings. Check your connection, then come back to this step. You can carry on meanwhile.
        </p>
      )}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-6 xl:gap-7 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <section className="liquid-glass rounded-[28px] p-5 sm:p-6 wz-enter">
            <StepHeading step="booth" />
            <p className="wz-label">Layout</p>
            {!draft ? (
              <div className="h-28 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" role="radiogroup" aria-label="Live wall layout">
                {WALL_LAYOUTS.map((l) => (
                  <button key={l} type="button" role="radio" aria-checked={draft.layout === l} className="wz-tile" onClick={() => update({ layout: l })} title={WALL_LAYOUT_META[l].blurb}>
                    <span className="wz-tile-art aspect-video flex"><LayoutGlyph layout={l} /></span>
                    <span className="wz-tile-name">{WALL_LAYOUT_META[l].label}</span>
                  </button>
                ))}
              </div>
            )}
            {draft && <p className="mt-3 text-[13px] text-white/70">{WALL_LAYOUT_META[draft.layout].blurb}</p>}
          </section>
          <section className="liquid-glass rounded-[28px] p-2 sm:p-3 wz-enter" style={{ animationDelay: '60ms' }}>
            {TOGGLES.map(({ key, label, hint, Icon }) => (
              <label key={key} className="flex items-center gap-3 rounded-2xl px-3 py-3 min-h-14 cursor-pointer hover:bg-white/6">
                <span className="grid place-items-center h-10 w-10 rounded-full bg-white/12 shrink-0"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-medium">{label}</span>
                  <span className="block text-[12.5px] text-white/65">{hint}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="h-6 w-11 appearance-none rounded-full bg-white/25 checked:bg-white relative cursor-pointer transition before:absolute before:top-0.5 before:left-0.5 before:h-5 before:w-5 before:rounded-full before:bg-[#1A1740] before:transition checked:before:translate-x-5"
                  checked={draft?.[key] ?? false}
                  disabled={!draft}
                  onChange={(e) => update({ [key]: e.target.checked })}
                />
              </label>
            ))}
          </section>
        </div>
        <div className="lg:sticky lg:top-[76px] flex flex-col gap-3 wz-enter" style={{ animationDelay: '80ms' }}>
          {draft && <WallMock draft={draft} url={`${origin}/e/${ev.slug}/welcome`} sceneBg={sceneBg} />}
          <p className="text-center text-[12.5px] text-white/60">Shown with sample photos. The wall wears your welcome page background.</p>
        </div>
      </div>
    </>
  );
}
