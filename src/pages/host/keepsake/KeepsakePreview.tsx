/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keepsake editor · the pinned live preview. It follows the active tab:
 *   Look      → the album cover in the theme's colours, with a looping hint of
 *               the chosen reveal (CSS only; still under reduced motion),
 *   Greeting  → Beamy's card with the copy filled from sample numbers,
 *   Take-home → the save buttons as guests see them,
 *   Music     → the chosen track with its play state (one shared <audio>),
 *   Sending   → the next-day email as it lands in an inbox.
 *
 * The real reveals live on the album page (another lane); this is a hint of
 * the moment, not the moment.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Loader2, Mail, Pause, Play } from 'lucide-react';
import { fillKeepsakeCopy, keepsakeTheme, type KeepsakeRevealId, type KeepsakeSettings, type KeepsakeThemeOption } from '../../../lib/keepsakeSettings';
import { keepsakeTrack } from '../../../lib/keepsakeMusic';
import { KEEPSAKE_TABS, keepsakeRevealChoice, sampleCopyContext, type KeepsakeTabId } from '../../../lib/keepsakeEditor';
import beamyImg from '../../../assets/sales/beamy.webp';
import { DOWNLOAD_ROWS } from './ChoicePanels';
import type { TrackPreview } from './useTrackPreview';

/* The preview's animations. (The editor's layout and its step bar are the
   shared StageCard's, in wizard.css.) */
export const KEEPSAKE_EDITOR_CSS = `
.ks-anim{animation-iteration-count:infinite;animation-timing-function:ease-in-out}
@keyframes ks-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes ks-album-in{0%,36%{opacity:0;transform:scale(.96)}48%,100%{opacity:1;transform:none}}
@keyframes ks-r-veil{0%,30%{opacity:1}46%,100%{opacity:0}}
@keyframes ks-r-beam{0%{transform:translateX(-160%) skewX(-18deg);opacity:1}46%{transform:translateX(420%) skewX(-18deg);opacity:1}50%,100%{transform:translateX(420%) skewX(-18deg);opacity:0}}
@keyframes ks-r-flap{0%,14%{transform:rotateX(0)}32%,100%{transform:rotateX(180deg)}}
@keyframes ks-r-drop{0%,34%{transform:translate(-50%,-50%);opacity:1}54%,100%{transform:translate(-50%,60%);opacity:0}}
@keyframes ks-r-ribbon-v{0%,18%{transform:translateY(0)}48%,100%{transform:translateY(-115%)}}
@keyframes ks-r-ribbon-h{0%,18%{transform:translateX(0)}48%,100%{transform:translateX(115%)}}
@keyframes ks-r-bow{0%,14%{opacity:1;transform:translate(-50%,-50%) scale(1)}26%,100%{opacity:0;transform:translate(-50%,-50%) scale(.4)}}
@keyframes ks-r-curtain-l{0%,14%{transform:translateX(0)}50%,100%{transform:translateX(-102%)}}
@keyframes ks-r-curtain-r{0%,14%{transform:translateX(0)}50%,100%{transform:translateX(102%)}}
@keyframes ks-r-plane{0%{left:-12%;top:78%;opacity:0}10%{opacity:1}44%{left:52%;top:36%;opacity:1}54%,100%{left:112%;top:8%;opacity:0}}
@keyframes ks-r-dust{0%{opacity:0}14%{opacity:1}44%{left:50%;top:50%;opacity:1;transform:scale(.5)}54%,100%{left:50%;top:50%;opacity:0;transform:scale(.2)}}
@keyframes ks-r-paper{0%{transform:translateY(105%)}18%,38%{transform:translateY(0)}58%,100%{transform:translateY(110%)}}
@keyframes ks-eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
@media (prefers-reduced-motion: reduce){
  .ks-anim{animation:none!important}
  .ks-reveal{display:none}
}`;

/* ── Reveal hint ─────────────────────────────────────────────────── */

const CYCLE = '5s';
const anim = (name: string, delay = '0s'): CSSProperties => ({ animationName: name, animationDuration: CYCLE, animationDelay: delay });

const DUST = [
  { left: '8%', top: '14%' }, { left: '88%', top: '20%' }, { left: '22%', top: '82%' }, { left: '76%', top: '86%' },
  { left: '50%', top: '6%' }, { left: '94%', top: '58%' }, { left: '4%', top: '52%' }, { left: '60%', top: '94%' },
  { left: '34%', top: '30%' }, { left: '68%', top: '40%' },
];

function RevealHint({ reveal, theme }: { reveal: KeepsakeRevealId; theme: KeepsakeThemeOption }) {
  const p = theme.palette;
  if (reveal === 'none') return null;
  const veil = <span className="ks-anim absolute inset-0" style={{ ...anim('ks-r-veil'), background: `radial-gradient(120% 90% at 50% 30%, ${p.surface}, ${p.background})` }} />;
  let body: ReactNode = null;
  if (reveal === 'beam') {
    body = (
      <>
        {veil}
        <span className="ks-anim absolute inset-y-0 left-0 w-1/3" style={{ ...anim('ks-r-beam'), background: `linear-gradient(90deg, transparent, ${p.glow}dd, ${p.accent}bb, transparent)` }} />
      </>
    );
  } else if (reveal === 'envelope') {
    body = (
      <>
        {veil}
        <span className="ks-anim absolute left-1/2 top-1/2 block h-20 w-32" style={{ ...anim('ks-r-drop'), perspective: '300px' }}>
          <span className="absolute inset-0 rounded-md" style={{ background: p.surface, boxShadow: `inset 0 0 0 1.5px ${p.accent}88` }} />
          <span className="ks-anim absolute inset-x-0 top-0 h-1/2" style={{ ...anim('ks-r-flap'), transformOrigin: 'top', background: p.accent, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
          <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: p.glow }} />
        </span>
      </>
    );
  } else if (reveal === 'ribbon') {
    body = (
      <>
        {veil}
        <span className="ks-anim absolute inset-y-0 left-1/2 w-4 -translate-x-1/2" style={{ ...anim('ks-r-ribbon-v'), background: `linear-gradient(90deg, ${p.accent}, ${p.glow}, ${p.accent})` }} />
        <span className="ks-anim absolute inset-x-0 top-1/2 h-4 -translate-y-1/2" style={{ ...anim('ks-r-ribbon-h'), background: `linear-gradient(180deg, ${p.accent}, ${p.glow}, ${p.accent})` }} />
        <span className="ks-anim absolute left-1/2 top-1/2 h-7 w-12 rounded-full" style={{ ...anim('ks-r-bow'), background: `radial-gradient(circle at 25% 50%, ${p.glow} 0 30%, transparent 31%), radial-gradient(circle at 75% 50%, ${p.glow} 0 30%, transparent 31%)` }} />
      </>
    );
  } else if (reveal === 'curtain') {
    body = (
      <>
        <span className="ks-anim absolute inset-y-0 left-0 w-1/2" style={{ ...anim('ks-r-curtain-l'), background: `repeating-linear-gradient(90deg, ${p.accent} 0 10px, ${p.glow}cc 10px 14px)` }} />
        <span className="ks-anim absolute inset-y-0 right-0 w-1/2" style={{ ...anim('ks-r-curtain-r'), background: `repeating-linear-gradient(270deg, ${p.accent} 0 10px, ${p.glow}cc 10px 14px)` }} />
      </>
    );
  } else if (reveal === 'airplane') {
    body = (
      <>
        {veil}
        <span className="ks-anim absolute block" style={anim('ks-r-plane')}>
          <span className="block h-0 w-0" style={{ borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: `26px solid ${p.ink}`, filter: `drop-shadow(0 0 6px ${p.glow})` }} />
        </span>
      </>
    );
  } else if (reveal === 'stardust') {
    body = (
      <>
        {veil}
        {DUST.map((d, i) => (
          <span key={i} className="ks-anim absolute h-1.5 w-1.5 rounded-full" style={{ ...anim('ks-r-dust'), left: d.left, top: d.top, background: i % 2 === 0 ? p.glow : p.accent, boxShadow: `0 0 8px ${p.glow}` }} />
        ))}
      </>
    );
  } else if (reveal === 'papercut') {
    body = (
      <>
        {veil}
        {[{ c: p.surface, h: '78%', d: '0s' }, { c: p.accent, h: '58%', d: '0.12s' }, { c: p.glow, h: '38%', d: '0.24s' }].map((l, i) => (
          <span key={i} className="ks-anim absolute inset-x-[-10%] bottom-0" style={{ ...anim('ks-r-paper', l.d), height: l.h, background: l.c, borderRadius: '50% 50% 0 0 / 40% 40% 0 0', boxShadow: '0 -6px 14px rgba(0,0,0,.25)' }} />
        ))}
      </>
    );
  }
  return <span aria-hidden className="ks-reveal pointer-events-none absolute inset-0 overflow-hidden">{body}</span>;
}

/* ── Per-tab previews ────────────────────────────────────────────── */

const TILE_GRADIENTS = (p: KeepsakeThemeOption['palette']) => [
  `linear-gradient(135deg, ${p.accent}, ${p.surface})`,
  `linear-gradient(160deg, ${p.glow}, ${p.background})`,
  `linear-gradient(200deg, ${p.surface}, ${p.accent}99)`,
  `linear-gradient(120deg, ${p.glow}aa, ${p.accent}66)`,
  `linear-gradient(180deg, ${p.accent}88, ${p.background})`,
  `linear-gradient(90deg, ${p.surface}, ${p.glow}99)`,
];

function LookPreview({ settings, eventName }: { settings: KeepsakeSettings; eventName: string }) {
  const theme = keepsakeTheme(settings.theme);
  const p = theme.palette;
  const animated = settings.reveal !== 'none';
  return (
    <div key={`${settings.reveal}-${settings.theme}`} className="relative flex h-full flex-col items-center justify-center gap-2 overflow-hidden px-4 py-3 text-center">
      <div className={`flex w-full flex-col items-center gap-1.5 ${animated ? 'ks-anim' : ''}`} style={animated ? anim('ks-album-in') : undefined}>
        <p className="hidden font-label uppercase tracking-luxe text-[10px] lg:block" style={{ color: p.muted }}>Your keepsake album</p>
        <p className="max-w-full truncate font-serif text-lg leading-tight lg:text-xl" style={{ color: p.ink }}>{eventName.trim() || 'Your event'}</p>
        <p className="font-sans text-[11px]" style={{ color: p.muted }}>128 photos · 46 guests</p>
        <div className="mt-1 grid w-full max-w-[7.5rem] grid-cols-3 gap-1 lg:max-w-[14rem] lg:gap-1.5">
          {TILE_GRADIENTS(p).map((g, i) => (
            <span key={i} className="aspect-square rounded-md lg:rounded-lg" style={{ background: g, boxShadow: `inset 0 0 0 1px ${p.ink}1a` }} />
          ))}
        </div>
      </div>
      <RevealHint reveal={settings.reveal} theme={theme} />
    </div>
  );
}

function GreetingCard({ settings, eventName, orgName }: { settings: KeepsakeSettings; eventName: string; orgName: string }) {
  const p = keepsakeTheme(settings.theme).palette;
  // A fixed "now" per mount keeps the sample stable while the host types.
  const [now] = useState(() => Date.now());
  const ctx = sampleCopyContext(eventName, orgName, now);
  const host = settings.copy.hostName;
  if (!settings.beamy) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center">
        <p className="font-serif text-xl leading-tight" style={{ color: p.ink }}>{eventName.trim() || 'Your event'}</p>
        <p className="font-sans text-xs" style={{ color: p.muted }}>Beamy’s greeting is off, so the album opens straight onto the photos.</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 px-5 py-4 text-center lg:gap-3">
      <img src={beamyImg} alt="Beamy, the Beamwall mascot" width={88} height={78} className="ks-anim h-12 w-auto drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)] lg:h-[78px]" style={{ animationName: 'ks-bob', animationDuration: '3s' }} />
      <p className="font-serif text-lg leading-tight break-words lg:text-xl" style={{ color: p.ink }}>{fillKeepsakeCopy(settings.copy.headline, ctx, host)}</p>
      <p className="font-sans text-xs leading-relaxed break-words lg:text-sm" style={{ color: p.muted }}>{fillKeepsakeCopy(settings.copy.message, ctx, host)}</p>
      <p className="font-sans text-xs italic lg:text-sm" style={{ color: p.muted }}>
        {fillKeepsakeCopy(settings.copy.signOff, ctx, host)}<br />
        <span className="not-italic font-semibold" style={{ color: p.accent }}>{fillKeepsakeCopy('{host}', ctx, host)}</span>
      </p>
    </div>
  );
}

function TakeHomePreview({ settings, eventName, filmIncluded }: { settings: KeepsakeSettings; eventName: string; filmIncluded: boolean | null }) {
  const p = keepsakeTheme(settings.theme).palette;
  const rows = DOWNLOAD_ROWS.filter((r) => settings.downloads[r.id]);
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 px-5 py-4 text-center lg:gap-3">
      <p className="max-w-full truncate font-serif text-lg leading-tight" style={{ color: p.ink }}>{eventName.trim() || 'Your event'}</p>
      <p className="font-sans text-[11px]" style={{ color: p.muted }}>Take your favourites home</p>
      <div className="flex w-full max-w-[16rem] flex-col gap-1.5 lg:gap-2">
        {rows.map((r) => {
          const later = r.id === 'film' && filmIncluded === false;
          return (
            <span
              key={r.id}
              className="flex items-center gap-2 rounded-full px-3.5 py-2 text-left font-sans text-xs"
              style={{ background: `${p.accent}26`, color: p.ink, border: `1px solid ${p.accent}66`, opacity: later ? 0.55 : 1 }}
            >
              <r.icon className="h-4 w-4 shrink-0" style={{ color: p.accent }} aria-hidden />
              <span className="flex-1">{r.guestLabel}</span>
              {later && <span className="font-sans text-[10px]" style={{ color: p.muted }}>After upgrade</span>}
            </span>
          );
        })}
      </div>
      <p className="font-sans text-[10px]" style={{ color: p.muted }}>Options you switch off don’t appear for guests.</p>
    </div>
  );
}

function MusicPreview({ settings, music }: { settings: KeepsakeSettings; music: TrackPreview }) {
  const p = keepsakeTheme(settings.theme).palette;
  const track = keepsakeTrack(settings.music);
  if (track === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center">
        <p className="font-serif text-lg" style={{ color: p.ink }}>No music</p>
        <p className="font-sans text-xs" style={{ color: p.muted }}>The film plays silently.</p>
      </div>
    );
  }
  const playable = music.ready[track.id];
  const playing = music.playing === track.id;
  const status = playing ? 'Playing a preview' : playable === false ? 'Preview isn’t ready yet' : playable === undefined ? 'Checking the preview…' : 'Tap play to hear it';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center lg:gap-3">
      <button
        type="button"
        onClick={() => music.toggle(track)}
        disabled={playable !== true}
        aria-label={playing ? `Pause ${track.title}` : `Play a preview of ${track.title}`}
        aria-pressed={playing}
        className="flex h-14 w-14 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50 lg:h-16 lg:w-16"
        style={{ background: p.accent, color: p.background, boxShadow: `0 0 28px ${p.glow}66` }}
      >
        {playable === undefined ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : playing ? <Pause className="h-6 w-6" aria-hidden /> : <Play className="h-6 w-6 translate-x-0.5" aria-hidden />}
      </button>
      <span aria-hidden className="flex h-6 items-end gap-1">
        {[0.9, 0.5, 1, 0.65, 0.8].map((d, i) => (
          <span
            key={i}
            className={`w-1.5 origin-bottom rounded-full ${playing ? 'ks-anim' : ''}`}
            style={{ height: '100%', background: p.glow, transform: playing ? undefined : `scaleY(${0.25 + d * 0.15})`, ...(playing ? { animationName: 'ks-eq', animationDuration: `${0.6 + d * 0.5}s` } : {}) }}
          />
        ))}
      </span>
      <p className="font-serif text-lg leading-tight" style={{ color: p.ink }}>♪ {track.title}</p>
      <p className="font-sans text-xs leading-snug" style={{ color: p.muted }}>{track.mood}</p>
      <p role="status" className="font-sans text-[11px]" style={{ color: p.accent }}>{status}</p>
    </div>
  );
}

function SendingPreview({ settings, eventName }: { settings: KeepsakeSettings; eventName: string }) {
  const p = keepsakeTheme(settings.theme).palette;
  const name = eventName.trim() || 'your event';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-left">
      <div className="w-full max-w-[17rem] rounded-2xl bg-white/95 p-3 text-[#1d1a15] shadow-xl" style={{ opacity: settings.autoSend ? 1 : 0.6 }}>
        <div className="flex items-center justify-between gap-2 font-sans text-[10px] text-[#6f675b]">
          <span className="flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden /> Inbox</span>
          <span>{settings.autoSend ? 'Tomorrow, ~10 AM' : 'Not scheduled'}</span>
        </div>
        <div className="mt-2 flex items-start gap-2.5">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-sans text-xs font-bold text-white" style={{ background: p.accent }}>B</span>
          <div className="min-w-0">
            <p className="font-sans text-xs font-semibold">Beamwall</p>
            <p className="truncate font-sans text-xs">Your photos from {name}</p>
            <p className="font-sans text-[11px] leading-snug text-[#6f675b]">A link to their album from the night.</p>
          </div>
        </div>
      </div>
      <p className="text-center font-sans text-[11px] leading-snug" style={{ color: p.muted }}>
        {settings.autoSend ? 'Goes out by itself the morning after your event.' : 'Off: it only goes out when you press Send keepsakes now.'}
      </p>
    </div>
  );
}

/* ── The pinned preview ──────────────────────────────────────────── */

export function KeepsakePreview({ tab, settings, eventName, orgName, filmIncluded, music }: {
  tab: KeepsakeTabId;
  settings: KeepsakeSettings;
  eventName: string;
  orgName: string;
  filmIncluded: boolean | null;
  music: TrackPreview;
}) {
  const theme = keepsakeTheme(settings.theme);
  const p = theme.palette;
  const tabLabel = KEEPSAKE_TABS.find((t) => t.id === tab)?.label ?? '';
  const footer =
    tab === 'look' ? `Opens with ${keepsakeRevealChoice(settings.reveal).label} · ${theme.label} colours`
      : tab === 'greeting' ? 'Sample numbers, filled in for real for each guest'
        : null;
  return (
    <figure className="flex h-full min-h-0 flex-col gap-1.5">
      <figcaption className="flex items-center justify-between gap-2 font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">
        <span>Live preview · {tabLabel}</span>
      </figcaption>
      <div
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10"
        style={{ background: `radial-gradient(120% 80% at 50% 0%, ${p.surface}, ${p.background})`, color: p.ink, scrollbarWidth: 'none' }}
      >
        {tab === 'look' && <LookPreview settings={settings} eventName={eventName} />}
        {tab === 'greeting' && <GreetingCard settings={settings} eventName={eventName} orgName={orgName} />}
        {tab === 'takehome' && <TakeHomePreview settings={settings} eventName={eventName} filmIncluded={filmIncluded} />}
        {tab === 'music' && <MusicPreview settings={settings} music={music} />}
        {tab === 'sending' && <SendingPreview settings={settings} eventName={eventName} />}
      </div>
      {footer !== null && <p className="truncate text-center font-sans text-[11px] text-brand-muted/60">{footer}</p>}
    </figure>
  );
}
