/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * KeepsakeEditor — how the morning-after keepsake looks, reads and sounds.
 *
 * STANDS ALONE: it loads and saves its own settings (events.config.keepsakes,
 * src/lib/keepsakeSettings.ts) so the same component mounts on Share & Print
 * (variant 'panel') and inside the host setup wizard (variant 'wizard', no
 * outer card chrome). Every rule a host can trip over lives in the pure,
 * tested src/lib/keepsakeEditor.ts; this file only wires it.
 *
 * SAVE IS EXPLICIT. No autosave: a host tries themes and words freely, sees
 * "Unsaved changes", and only Save writes. A failed READ never shows defaults
 * with a Save button — saving those would overwrite a real configuration.
 *
 * HANDLED FAILURES: settings read fails (retry card, nothing saveable) · org
 * read fails (signer stays as stored) · plan read fails (no film note, never a
 * guess) · save fails or writes zero rows (stays dirty, says so, toast) ·
 * a music file missing, not audio, or refusing to play (that preview button is
 * disabled with a note; nothing throws) · no ToastProvider above (inline status
 * only).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Film, Images, LayoutGrid, Loader2, Mail, Music, Pause, Play, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';
import { fetchMyOrg } from '../../../lib/host';
import { fetchKeepsakeFilmIncluded, fetchKeepsakeSettings, saveKeepsakeSettings } from '../../../lib/keepsakeContacts';
import {
  KEEPSAKE_COPY_MAX,
  KEEPSAKE_THEMES,
  fillKeepsakeCopy,
  keepsakeTheme,
  type KeepsakeDownloadId,
  type KeepsakeSettings,
  type KeepsakeThemeOption,
} from '../../../lib/keepsakeSettings';
import { KEEPSAKE_TRACKS, keepsakeTrack, type KeepsakeTrack } from '../../../lib/keepsakeMusic';
import {
  KEEPSAKE_TOKEN_CHIPS,
  copyCounter,
  insertToken,
  isLastDownloadOn,
  keepsakeSettingsEqual,
  prefillHostName,
  resetKeepsakeLook,
  sampleCopyContext,
  toggleDownload,
  type KeepsakeCopyField,
} from '../../../lib/keepsakeEditor';
import beamyImg from '../../../assets/sales/beamy.webp';

export interface KeepsakeEditorProps {
  eventUuid: string;
  eventName: string;
  /** 'panel' = its own card (Share & Print). 'wizard' = compact, no card chrome. */
  variant?: 'panel' | 'wizard';
}

type ToastPush = ((message: string, tone?: 'success' | 'error' | 'info') => void) | null;

/** The toast when a ToastProvider is mounted above (it is on /host), else null.
 *  useToast always runs its useContext first, so hook order is stable. */
function useOptionalToast(): ToastPush {
  try {
    return useToast().push;
  } catch {
    return null;
  }
}

/* ── Small shared controls ───────────────────────────────────────── */

function Switch({ on, onToggle, labelledBy, disabled = false, describedBy }: {
  on: boolean;
  onToggle: () => void;
  labelledBy: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) onToggle(); }}
      className={`flex min-h-11 min-w-14 shrink-0 items-center justify-center ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {/* The visible track is 28px; the button around it is the 44px target. */}
      <span aria-hidden className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${on ? 'bg-accent' : 'bg-white/15'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

function SectionTitle({ icon: Icon, children, hint }: { icon: typeof Mail; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="flex items-center gap-2 font-label uppercase tracking-luxe text-[10px] text-brand-muted/80">
        <Icon className="h-4 w-4 text-accent-2" aria-hidden /> {children}
      </h3>
      {hint !== undefined && <p className="font-sans text-xs leading-relaxed text-brand-muted/60">{hint}</p>}
    </div>
  );
}

/* ── Theme intro hints (CSS only, still under reduced motion) ────── */

const HINT_CSS = `
.ks-anim{animation-iteration-count:infinite;animation-timing-function:ease-in-out}
@keyframes ks-beam{0%{transform:translateX(-140%) skewX(-18deg)}60%,100%{transform:translateX(420%) skewX(-18deg)}}
@keyframes ks-curtain-l{0%,20%{transform:translateX(0)}60%,85%{transform:translateX(-96%)}100%{transform:translateX(0)}}
@keyframes ks-curtain-r{0%,20%{transform:translateX(0)}60%,85%{transform:translateX(96%)}100%{transform:translateX(0)}}
@keyframes ks-fall{0%{transform:translateY(-14px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translateY(70px) rotate(260deg);opacity:0}}
@keyframes ks-drift{0%{transform:translate(-14px,-14px) rotate(0);opacity:0}20%{opacity:.95}100%{transform:translate(34px,70px) rotate(110deg);opacity:0}}
@keyframes ks-fade{0%,100%{opacity:.12}50%{opacity:1}}
@keyframes ks-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@media (prefers-reduced-motion: reduce){
  .ks-anim{animation:none!important}
  .ks-beam{transform:translateX(120%) skewX(-18deg)}
  .ks-curtain-l{transform:translateX(-70%)}
  .ks-curtain-r{transform:translateX(70%)}
  .ks-fall,.ks-drift{opacity:.9}
  .ks-fade{opacity:1}
}`;

const CONFETTI = [
  { left: '12%', top: '10%', delay: '0s' }, { left: '30%', top: '24%', delay: '0.5s' }, { left: '52%', top: '6%', delay: '1.1s' },
  { left: '70%', top: '30%', delay: '0.3s' }, { left: '86%', top: '14%', delay: '0.8s' }, { left: '42%', top: '40%', delay: '1.4s' },
];

function IntroHint({ theme }: { theme: KeepsakeThemeOption }) {
  const p = theme.palette;
  const card = <span className="absolute left-1/2 top-1/2 h-7 w-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/10" style={{ background: p.surface }} />;
  return (
    <span aria-hidden className="relative block h-16 w-full overflow-hidden rounded-xl" style={{ background: p.background }}>
      {theme.intro === 'fade' ? (
        <span className="ks-anim ks-fade absolute inset-0" style={{ animationName: 'ks-fade', animationDuration: '3s' }}>{card}</span>
      ) : card}
      {theme.intro === 'beam' && (
        <span
          className="ks-anim ks-beam absolute inset-y-0 left-0 w-1/4"
          style={{ animationName: 'ks-beam', animationDuration: '2.6s', background: `linear-gradient(90deg, transparent, ${p.glow}cc, ${p.accent}aa, transparent)` }}
        />
      )}
      {theme.intro === 'curtain' && (
        <>
          <span className="ks-anim ks-curtain-l absolute inset-y-0 left-0 w-1/2" style={{ animationName: 'ks-curtain-l', animationDuration: '3.2s', background: `linear-gradient(90deg, ${p.accent}, ${p.glow})` }} />
          <span className="ks-anim ks-curtain-r absolute inset-y-0 right-0 w-1/2" style={{ animationName: 'ks-curtain-r', animationDuration: '3.2s', background: `linear-gradient(270deg, ${p.accent}, ${p.glow})` }} />
        </>
      )}
      {theme.intro === 'confetti' && CONFETTI.map((c, i) => (
        <span
          key={i}
          className="ks-anim ks-fall absolute h-2 w-1.5 rounded-[1px]"
          style={{ left: c.left, top: c.top, animationName: 'ks-fall', animationDuration: '2.2s', animationDelay: c.delay, background: i % 2 === 0 ? p.accent : p.glow }}
        />
      ))}
      {theme.intro === 'petals' && CONFETTI.slice(0, 5).map((c, i) => (
        <span
          key={i}
          className="ks-anim ks-drift absolute h-2.5 w-2.5 rounded-[60%_0_60%_0]"
          style={{ left: c.left, top: c.top, animationName: 'ks-drift', animationDuration: '3.6s', animationDelay: c.delay, background: i % 2 === 0 ? p.accent : p.glow }}
        />
      ))}
    </span>
  );
}

function ThemeCard({ theme, selected, onSelect }: { theme: KeepsakeThemeOption; selected: boolean; onSelect: () => void }) {
  const p = theme.palette;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`relative flex min-h-11 flex-col gap-2 rounded-2xl p-2.5 text-left transition ${selected ? 'glass-strong ring-2 ring-accent' : 'glass hover:ring-1 hover:ring-white/20'}`}
    >
      <IntroHint theme={theme} />
      <span className="flex items-center gap-1" aria-hidden>
        {[p.background, p.surface, p.accent, p.glow, p.ink].map((c, i) => (
          <span key={i} className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ background: c }} />
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-sans text-sm text-brand-fg">{theme.label}</span>
        {theme.id === 'beamwall' && (
          <span className="rounded-md border border-accent/40 px-1.5 py-0.5 font-label uppercase tracking-luxe text-[10px] text-accent-2">Default</span>
        )}
      </span>
      <span className="font-sans text-[11px] leading-snug text-brand-muted/60">{theme.description}</span>
      {selected && (
        <span className="absolute right-3.5 top-3.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[color:var(--on-accent)]" aria-hidden>
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}

/* ── Live preview ────────────────────────────────────────────────── */

const DOWNLOAD_LABEL: Record<KeepsakeDownloadId, string> = { film: 'Film', collage: 'Collage', photos: 'Photos' };

function GreetingPreview({ settings, eventName, orgName }: { settings: KeepsakeSettings; eventName: string; orgName: string }) {
  const theme = keepsakeTheme(settings.theme);
  const p = theme.palette;
  // A fixed "now" per mount keeps the sample stable while the host types.
  const [now] = useState(() => Date.now());
  const ctx = sampleCopyContext(eventName, orgName, now);
  const host = settings.copy.hostName;
  const track = keepsakeTrack(settings.music);
  const offers = (['film', 'collage', 'photos'] as const).filter((d) => settings.downloads[d]);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Live preview · sample numbers</figcaption>
      <div className="relative overflow-hidden rounded-2xl border border-white/10 p-5" style={{ background: `radial-gradient(120% 80% at 50% 0%, ${p.surface}, ${p.background})`, color: p.ink }}>
        {settings.beamy ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <img src={beamyImg} alt="Beamy, the Beamwall mascot" width={88} height={78} className="ks-anim h-[78px] w-auto drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]" style={{ animationName: 'ks-bob', animationDuration: '3s' }} />
            <p className="font-serif text-xl leading-tight break-words" style={{ color: p.ink }}>{fillKeepsakeCopy(settings.copy.headline, ctx, host)}</p>
            <p className="font-sans text-sm leading-relaxed break-words" style={{ color: p.muted }}>{fillKeepsakeCopy(settings.copy.message, ctx, host)}</p>
            <p className="font-sans text-sm italic" style={{ color: p.muted }}>
              {fillKeepsakeCopy(settings.copy.signOff, ctx, host)}<br />
              <span className="not-italic font-semibold" style={{ color: p.accent }}>{fillKeepsakeCopy('{host}', ctx, host)}</span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="font-serif text-xl leading-tight" style={{ color: p.ink }}>{eventName.trim() || 'Your event'}</p>
            <p className="font-sans text-xs" style={{ color: p.muted }}>Beamy’s greeting is off, so the album opens straight onto the photos.</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {offers.map((d) => (
            <span key={d} className="rounded-full px-2.5 py-1 font-sans text-[11px]" style={{ background: `${p.accent}26`, color: p.ink, border: `1px solid ${p.accent}55` }}>
              {DOWNLOAD_LABEL[d]}
            </span>
          ))}
        </div>
        <p className="mt-3 text-center font-sans text-[11px]" style={{ color: p.muted }}>
          {track !== null ? `♪ ${track.title}` : 'No music'} · {theme.label} theme
        </p>
      </div>
    </figure>
  );
}

/* ── Music preview ───────────────────────────────────────────────── */

/** One shared <audio>: one track plays at a time and it stops on unmount.
 *  A missing file is answered by Vite AND Netlify with index.html at 200, so
 *  the probe checks the content type, not just `ok`. */
function useTrackPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  /** id → true (playable) / false (missing or broken). Absent = still checking. */
  const [ready, setReady] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    for (const t of KEEPSAKE_TRACKS) {
      fetch(t.file, { method: 'HEAD' })
        .then((r) => {
          const type = r.headers.get('content-type') ?? '';
          if (alive) setReady((m) => ({ ...m, [t.id]: r.ok && type.startsWith('audio/') }));
        })
        .catch(() => { if (alive) setReady((m) => ({ ...m, [t.id]: false })); });
    }
    return () => {
      alive = false;
      const a = audioRef.current;
      if (a !== null) { a.pause(); a.removeAttribute('src'); a.load(); }
      audioRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a !== null) a.pause();
    setPlaying(null);
  }, []);

  const toggle = useCallback((t: KeepsakeTrack) => {
    if (playing === t.id) { stop(); return; }
    const prev = audioRef.current;
    if (prev !== null) prev.pause();
    let a: HTMLAudioElement;
    try {
      a = new Audio(t.file);
    } catch {
      setReady((m) => ({ ...m, [t.id]: false }));
      return;
    }
    audioRef.current = a;
    const broken = () => {
      setReady((m) => ({ ...m, [t.id]: false }));
      setPlaying((cur) => (cur === t.id ? null : cur));
    };
    a.addEventListener('ended', () => setPlaying((cur) => (cur === t.id ? null : cur)));
    a.addEventListener('error', broken);
    setPlaying(t.id);
    a.play().catch((err: unknown) => {
      // A pause() from the next tap aborts this play — not a broken file.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      broken();
    });
  }, [playing, stop]);

  return { playing, ready, toggle, stop };
}

/* ── The editor ──────────────────────────────────────────────────── */

type LoadState = 'loading' | 'failed' | 'ready';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const FIELD_LABEL: Record<KeepsakeCopyField, string> = {
  headline: 'Headline',
  message: 'Message',
  signOff: 'Sign-off',
  hostName: 'Signed by',
};

export function KeepsakeEditor({ eventUuid, eventName, variant = 'panel' }: KeepsakeEditorProps) {
  const toast = useOptionalToast();
  const wizard = variant === 'wizard';
  const [load, setLoad] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<KeepsakeSettings | null>(null);
  const [draft, setDraft] = useState<KeepsakeSettings | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [filmIncluded, setFilmIncluded] = useState<boolean | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const music = useTrackPreview();

  useEffect(() => {
    let alive = true;
    setLoad('loading');
    void Promise.all([
      fetchKeepsakeSettings(eventUuid),
      fetchMyOrg().catch(() => null),
    ]).then(([read, org]) => {
      if (!alive) return;
      if (read === null) { setLoad('failed'); return; }
      const name = org?.name ?? null;
      setOrgName(name);
      setStored(read.settings);
      setDraft(prefillHostName(read.settings, name));
      setLoad('ready');
      void fetchKeepsakeFilmIncluded(read.slug).then((v) => { if (alive) setFilmIncluded(v); });
    });
    return () => { alive = false; };
  }, [eventUuid, attempt]);

  const dirty = stored !== null && draft !== null && !keepsakeSettingsEqual(stored, draft);

  const update = useCallback((fn: (s: KeepsakeSettings) => KeepsakeSettings) => {
    setDraft((d) => (d === null ? d : fn(d)));
    setSaveState((s) => (s === 'saving' ? s : 'idle'));
  }, []);

  async function save() {
    if (draft === null || saveState === 'saving') return;
    const snapshot = draft;
    setSaveState('saving');
    const ok = await saveKeepsakeSettings(eventUuid, snapshot);
    if (ok) setStored(snapshot);
    setSaveState(ok ? 'saved' : 'failed');
    toast?.(ok ? 'Keepsake saved. Guests will see it in their album.' : 'Couldn’t save your keepsake. Check your connection and try again.', ok ? 'success' : 'error');
  }

  /* Token insertion targets the last copy field the host was in. */
  const fieldRefs = useRef<Partial<Record<KeepsakeCopyField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const [activeField, setActiveField] = useState<KeepsakeCopyField>('headline');

  function insertChip(token: string) {
    if (draft === null) return;
    const el = fieldRefs.current[activeField] ?? null;
    const out = insertToken(draft.copy[activeField], token, el?.selectionStart ?? null, el?.selectionEnd ?? null, KEEPSAKE_COPY_MAX[activeField]);
    if (out === null) return;
    update((s) => ({ ...s, copy: { ...s.copy, [activeField]: out.value } }));
    requestAnimationFrame(() => {
      const t = fieldRefs.current[activeField];
      if (t) { t.focus(); t.setSelectionRange(out.caret, out.caret); }
    });
  }

  const orgLabel = orgName ?? '';
  const preview = useMemo(
    () => (draft === null ? null : <GreetingPreview settings={draft} eventName={eventName} orgName={orgLabel} />),
    [draft, eventName, orgLabel],
  );

  const shell = (children: ReactNode) =>
    wizard ? (
      <div className="flex flex-col gap-5">{children}</div>
    ) : (
      <section aria-labelledby="keepsake-editor-title" className="print:hidden liquid-glass rounded-3xl border border-accent/20 p-4 sm:p-6 flex flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-accent-2" aria-hidden />
            <h2 id="keepsake-editor-title" className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/80">Design your keepsake</h2>
          </div>
          <p className="max-w-xl font-sans text-xs leading-relaxed text-brand-muted/60">
            Choose how the album looks, what Beamy says to your guests, what they can take home and the music under the film.
            Nothing changes for guests until you press Save.
          </p>
        </header>
        {children}
      </section>
    );

  if (load !== 'ready' || draft === null) {
    return shell(
      load === 'failed' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl glass px-4 py-3">
          <p className="flex-1 min-w-[12rem] font-sans text-sm text-brand-fg">Couldn’t load your keepsake settings. Nothing has been changed.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex min-h-11 items-center gap-2 rounded-xl glass px-4 font-label uppercase tracking-luxe text-[10px] text-brand-muted/80 hover:text-accent-2">
            <RotateCcw className="h-4 w-4" aria-hidden /> Try again
          </button>
        </div>
      ) : (
        <p role="status" className="flex min-h-11 items-center gap-2 font-sans text-sm text-brand-muted/60">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your keepsake…
        </p>
      ),
    );
  }

  const prefilled = stored !== null && stored.copy.hostName === '' && orgName !== null && draft.copy.hostName === orgName.trim().slice(0, KEEPSAKE_COPY_MAX.hostName) && draft.copy.hostName !== '';

  const copyField = (field: KeepsakeCopyField, multiline = false) => {
    const max = KEEPSAKE_COPY_MAX[field];
    const value = draft.copy[field];
    const counter = copyCounter(value, max);
    const id = `keepsake-copy-${field}`;
    const common = {
      id,
      value,
      maxLength: max,
      onFocus: () => setActiveField(field),
      onChange: (e: { target: { value: string } }) => {
        const v = e.target.value.slice(0, max);
        update((s) => ({ ...s, copy: { ...s.copy, [field]: v } }));
      },
      'aria-describedby': `${id}-count${field === 'hostName' && prefilled ? ` ${id}-note` : ''}`,
      className: 'w-full rounded-xl glass px-4 font-sans text-sm text-brand-fg placeholder:text-brand-muted/35',
    };
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">{FIELD_LABEL[field]}</label>
          <span id={`${id}-count`} className={`font-mono text-[10px] ${counter.near ? 'text-amber-300' : 'text-brand-muted/50'}`} aria-label={`${value.length} of ${max} characters`}>{counter.text}</span>
        </div>
        {multiline ? (
          <textarea ref={(el) => { fieldRefs.current[field] = el; }} rows={3} {...common} className={`${common.className} py-3 resize-y min-h-[5.5rem]`} />
        ) : (
          <input ref={(el) => { fieldRefs.current[field] = el; }} type="text" {...common} className={`${common.className} min-h-11`} placeholder={field === 'hostName' ? 'Your name or your organisation' : undefined} />
        )}
        {field === 'hostName' && prefilled && (
          <p id={`${id}-note`} className="font-sans text-[11px] text-brand-muted/55">Filled in from your organisation’s name. Save to use it on the album.</p>
        )}
      </div>
    );
  };

  const activeMax = KEEPSAKE_COPY_MAX[activeField];
  const activeLen = draft.copy[activeField].length;

  const downloadRows: { id: KeepsakeDownloadId; title: string; line: string; icon: typeof Film }[] = [
    { id: 'film', title: 'Film', line: 'A short film of the night, made from the booth photos.', icon: Film },
    { id: 'collage', title: 'Collage', line: 'A print-ready collage each guest builds: filmstrip, mosaic or scattered prints.', icon: LayoutGrid },
    { id: 'photos', title: 'Photos', line: 'Every photo from the night, to save one by one or all at once.', icon: Images },
  ];

  const status =
    saveState === 'saving' ? 'Saving…'
      : saveState === 'failed' ? 'Couldn’t save. Check your connection and try again.'
        : dirty ? 'Unsaved changes'
          : saveState === 'saved' ? 'All changes saved'
            : '';

  const body = (
    <>
      <style>{HINT_CSS}</style>
      <div className={wizard ? 'flex flex-col gap-6' : 'flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start'}>
        <div className="flex min-w-0 flex-col gap-7">
          {/* 1 · Theme */}
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Theme</legend>
            <SectionTitle icon={Sparkles} hint="Sets the album’s colours and the moment it opens with.">Theme</SectionTitle>
            <div role="radiogroup" aria-label="Keepsake theme" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {KEEPSAKE_THEMES.map((t) => (
                <ThemeCard key={t.id} theme={t} selected={draft.theme === t.id} onSelect={() => update((s) => ({ ...s, theme: t.id }))} />
              ))}
            </div>
          </fieldset>

          {/* 2 · Beamy greeting */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl glass px-4 py-2">
              <div className="flex items-center gap-3">
                <img src={beamyImg} alt="" aria-hidden width={40} height={36} className="h-9 w-auto" />
                <div className="flex flex-col">
                  <span id="keepsake-beamy-label" className="font-sans text-sm text-brand-fg">Beamy says hello</span>
                  <span className="font-sans text-[11px] leading-snug text-brand-muted/55">A short greeting from Beamy at the top of the album.</span>
                </div>
              </div>
              <Switch on={draft.beamy} onToggle={() => update((s) => ({ ...s, beamy: !s.beamy }))} labelledBy="keepsake-beamy-label" />
            </div>
            {draft.beamy && (
              <div className="flex flex-col gap-4">
                {copyField('headline')}
                {copyField('message', true)}
                <div className="grid gap-4 sm:grid-cols-2">
                  {copyField('signOff')}
                  {copyField('hostName')}
                </div>
                <div className="flex flex-col gap-2">
                  <p id="keepsake-chips-label" className="font-sans text-[11px] text-brand-muted/60">
                    Tap to add to <span className="text-brand-fg">{FIELD_LABEL[activeField]}</span> — it fills in with the real details for each guest.
                  </p>
                  <div role="group" aria-labelledby="keepsake-chips-label" className="flex flex-wrap gap-2">
                    {KEEPSAKE_TOKEN_CHIPS.map((c) => {
                      const noRoom = activeLen + c.token.length > activeMax;
                      return (
                        <button
                          key={c.token}
                          type="button"
                          disabled={noRoom}
                          title={noRoom ? `No room left in ${FIELD_LABEL[activeField]}` : undefined}
                          // Keep the field's caret: a mousedown would blur it first.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertChip(c.token)}
                          className="flex min-h-11 items-center gap-1 rounded-full glass px-3.5 font-sans text-xs text-brand-fg transition hover:text-accent-2 disabled:opacity-40"
                        >
                          <span aria-hidden className="text-accent-2">+</span> {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            <div className={wizard ? '' : 'lg:hidden'}>{preview}</div>
          </div>

          {/* 3 · Downloads */}
          <div className="flex flex-col gap-3">
            <SectionTitle icon={Images} hint="What guests can take home from the album.">Downloads</SectionTitle>
            <ul className="flex flex-col gap-2">
              {downloadRows.map((r) => {
                const lastOn = isLastDownloadOn(draft.downloads, r.id);
                const labelId = `keepsake-dl-${r.id}`;
                const noteId = `${labelId}-note`;
                const notes: string[] = [];
                if (r.id === 'film' && filmIncluded === false) notes.push('Included on paid plans. Your setting is kept for when you upgrade.');
                if (lastOn) notes.push('Guests need at least one thing to take home, so the last option stays on.');
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl glass px-4 py-2">
                    <div className="flex min-w-0 items-start gap-3">
                      <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-2" aria-hidden />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span id={labelId} className="font-sans text-sm text-brand-fg">{r.title}</span>
                        <span className="font-sans text-[11px] leading-snug text-brand-muted/55">{r.line}</span>
                        {notes.length > 0 && (
                          <span id={noteId} className="font-sans text-[11px] leading-snug text-amber-200/85">{notes.join(' ')}</span>
                        )}
                      </div>
                    </div>
                    <Switch
                      on={draft.downloads[r.id]}
                      onToggle={() => update((s) => ({ ...s, downloads: toggleDownload(s.downloads, r.id) }))}
                      labelledBy={labelId}
                      describedBy={notes.length > 0 ? noteId : undefined}
                      disabled={lastOn}
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 4 · Music */}
          <div className="flex flex-col gap-3">
            <SectionTitle icon={Music} hint="Plays under the keepsake film.">Music</SectionTitle>
            <div role="radiogroup" aria-label="Film music" className="flex flex-col gap-2">
              {KEEPSAKE_TRACKS.map((t) => {
                const selected = draft.music === t.id;
                const playable = music.ready[t.id];
                const isPlaying = music.playing === t.id;
                return (
                  <div key={t.id} className={`flex items-center gap-2 rounded-2xl px-2 py-1.5 ${selected ? 'glass-strong ring-2 ring-accent' : 'glass'}`}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => update((s) => ({ ...s, music: t.id }))}
                      className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-xl px-2 text-left"
                    >
                      <span className="flex items-center gap-2 font-sans text-sm text-brand-fg">
                        {t.title}
                        {selected && <Check className="h-3.5 w-3.5 text-accent-2" aria-hidden />}
                      </span>
                      <span className="font-sans text-[11px] leading-snug text-brand-muted/55">{t.mood}</span>
                      {playable === false && <span className="font-sans text-[10px] text-brand-muted/50">Preview isn’t ready yet. You can still choose it.</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => music.toggle(t)}
                      disabled={playable !== true}
                      aria-label={isPlaying ? `Pause ${t.title}` : `Play a preview of ${t.title}`}
                      aria-pressed={isPlaying}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass text-brand-fg transition hover:text-accent-2 disabled:opacity-35"
                    >
                      {playable === undefined ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        : isPlaying ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={draft.music === 'none'}
                onClick={() => { music.stop(); update((s) => ({ ...s, music: 'none' })); }}
                className={`flex min-h-11 items-center gap-2 rounded-2xl px-4 py-2 text-left font-sans text-sm text-brand-fg ${draft.music === 'none' ? 'glass-strong ring-2 ring-accent' : 'glass'}`}
              >
                No music
                {draft.music === 'none' && <Check className="h-3.5 w-3.5 text-accent-2" aria-hidden />}
              </button>
            </div>
            <p className="font-sans text-[11px] text-brand-muted/50">Made by Beamwall, free to use. No licence fee and no credit needed.</p>
          </div>

          {/* 5 · Next-day email */}
          <div className="flex items-center justify-between gap-4 rounded-2xl glass px-4 py-3">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent-2" aria-hidden />
              <div className="flex flex-col gap-0.5">
                <span id="keepsake-auto-label" className="font-sans text-sm text-brand-fg">Email it the next day</span>
                <span className="font-sans text-[11px] leading-relaxed text-brand-muted/55">
                  {draft.autoSend
                    ? 'Guests who left an address get it around 10 AM the day after your event date, or 12 hours after you end it.'
                    : 'Off. Nothing goes out unless you press Send keepsakes now.'}
                </span>
              </div>
            </div>
            <Switch on={draft.autoSend} onToggle={() => update((s) => ({ ...s, autoSend: !s.autoSend }))} labelledBy="keepsake-auto-label" />
          </div>
        </div>

        {!wizard && <aside className="hidden lg:sticky lg:top-4 lg:block">{preview}</aside>}
      </div>

      {/* 6 · Save */}
      <div className={`${wizard ? '' : 'sticky bottom-3 z-20'} flex flex-wrap items-center gap-3 rounded-2xl glass-strong px-4 py-2.5`}>
        <p role="status" aria-live="polite" className={`min-w-[9rem] flex-1 font-sans text-xs ${saveState === 'failed' ? 'text-amber-300' : dirty ? 'text-brand-fg' : 'text-brand-muted/60'}`}>
          {status}
        </p>
        <button
          type="button"
          onClick={() => { music.stop(); update((s) => resetKeepsakeLook(s, orgName)); }}
          className="min-h-11 px-2 font-sans text-xs text-brand-muted/70 underline underline-offset-4 hover:text-accent-2"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saveState === 'saving' || !dirty}
          className="flex min-h-11 items-center gap-2 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] transition active:scale-[0.98] disabled:opacity-45"
        >
          {saveState === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          {saveState === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  );

  return shell(body);
}

export default KeepsakeEditor;
