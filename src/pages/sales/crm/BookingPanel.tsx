/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The rep's booking link: copy/share it, see who booked, and set the hours.
 * Data rules live in Postgres (042): a rep edits only their own page and only
 * their own bookings' status; this panel is UX.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CalendarDays, Check, Copy, ExternalLink, Link2, MessageCircle, Plus, Trash2,
} from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';
import {
  bookingStatusDef, bookingUrl, compactWeekly, defaultSettings, DURATIONS, formatHHMM, formatSlotLong, parseHHMM,
  sortBookings, TIMEZONE_OPTIONS, tzCity, validateWeekly, WEEKDAYS,
  type Booking, type BookingSettings, type BookingStatus, type Weekday,
} from '../../../lib/booking';
import { getMyBookingSettings, saveMyBookingSettings, setMyRefCode } from '../../../lib/bookingApi';
import { copyText } from '../../../lib/clipboard';
import { validRefCode, whatsappLink, type Prospect } from '../../../lib/crm';
import type { Market } from '../../../lib/salesTypes';
import {
  btnPrimary, btnQuiet, chip, chipOff, chipOn, Field, iconBtn, inputCls, labelCls, Pill, Sheet, Spinner,
} from './ui';

type Tab = 'calls' | 'hours';

export default function BookingPanel({
  userId, refCode, suggestedRef, bookings, prospects, now, onRefCodeSet, onStatus, onOpenProspect, onClose, onSettingsSaved,
}: {
  userId: string;
  refCode: string | null;
  /** Pre-filled ref code suggestion when the rep has none yet. */
  suggestedRef: string;
  bookings: Booking[];
  prospects: Prospect[];
  now: Date;
  onRefCodeSet: () => Promise<void>;
  onStatus: (id: string, status: BookingStatus) => Promise<boolean>;
  onOpenProspect: (id: string) => void;
  onClose: () => void;
  onSettingsSaved: (enabled: boolean) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('calls');
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const [copied, setCopied] = useState(false);

  const browserTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; }
  }, []);

  useEffect(() => {
    let live = true;
    void getMyBookingSettings(userId).then((r) => {
      if (!live) return;
      if (r.error !== null) { setLoadErr(r.error); setNotSetUp(r.notSetUp === true); return; }
      if (r.data === null) {
        setIsNew(true);
        setTab('hours');
        setSettings(defaultSettings(userId, 'ng', browserTz));
      } else {
        setSettings(r.data);
      }
    });
    return () => { live = false; };
  }, [userId, browserTz]);

  const url = typeof window !== 'undefined' ? bookingUrl(window.location.origin, refCode) : null;
  const live = url !== null && settings !== null && !isNew && settings.enabled;
  const mine = useMemo(() => sortBookings(bookings.filter((b) => b.rep_id === userId), now), [bookings, userId, now]);

  async function copy() {
    if (url === null) return;
    const ok = await copyText(url);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
    toast.push(ok ? 'Booking link copied.' : `Couldn’t copy. The link is ${url}`, ok ? 'success' : 'error');
  }

  return (
    <Sheet title="Booking link" onClose={onClose} wide>
      {notSetUp ? (
        <p className="text-sm text-brand-muted leading-relaxed">
          Booking links switch on as soon as Dapo applies the booking update to the database. Everything else in the CRM works as normal.
        </p>
      ) : loadErr !== null ? (
        <p role="alert" className="text-sm text-amber-200">{loadErr}</p>
      ) : settings === null ? (
        <div className="flex justify-center py-10"><Spinner label="Loading your booking page" /></div>
      ) : refCode === null ? (
        <ClaimRef suggested={suggestedRef} onSet={onRefCodeSet} />
      ) : (
        <>
          {/* ── The link ── */}
          <div className="liquid-glass rounded-2xl p-3.5">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 shrink-0 text-[color:var(--color-accent)]" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-sm text-brand-fg" title={url ?? ''}>{url?.replace(/^https?:\/\//, '')}</p>
              <Pill className={live ? 'bg-emerald-400/12 border-emerald-300/35 text-emerald-100' : 'bg-white/[0.04] border-white/12 text-brand-muted'}>
                {live ? 'Live' : isNew ? 'Not saved yet' : 'Paused'}
              </Pill>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {live && (
                <button type="button" onClick={() => void copy()} className={btnPrimary}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy link'}
                </button>
              )}
              {url !== null && live && (
                <a href={url} target="_blank" rel="noopener noreferrer" className={btnQuiet}>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Preview
                </a>
              )}
            </div>
            {!live && (
              <p className="mt-2 text-[11px] text-brand-muted">
                {isNew ? 'Check your hours and press Save to switch your link on.' : 'Your link is paused. Turn it back on under Hours.'}
              </p>
            )}
            {live && (
              <p className="mt-2 text-[11px] text-brand-muted">
                The <span className="text-brand-fg">{'{{bookingLink}}'}</span> in message templates now fills with this link, and decks you share with your ref code get a “Book a call” button.
              </p>
            )}
          </div>

          <div className="mt-4 flex gap-1.5" role="tablist" aria-label="Booking">
            <button type="button" role="tab" aria-selected={tab === 'calls'} onClick={() => setTab('calls')} className={`${chip} ${tab === 'calls' ? chipOn : chipOff}`}>
              Calls {mine.filter((b) => b.status === 'confirmed' && Date.parse(b.ends_at) >= now.getTime()).length}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'hours'} onClick={() => setTab('hours')} className={`${chip} ${tab === 'hours' ? chipOn : chipOff}`}>
              Hours
            </button>
          </div>

          {tab === 'calls' ? (
            <Calls list={mine} prospects={prospects} now={now} onStatus={onStatus} onOpenProspect={onOpenProspect} />
          ) : (
            <HoursForm
              initial={settings}
              onSaved={(s) => {
                setSettings(s);
                setIsNew(false);
                onSettingsSaved(s.enabled);
                toast.push(s.enabled ? 'Saved. Your booking link is live.' : 'Saved. Your booking link is paused.', 'success');
              }}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

function ClaimRef({ suggested, onSet }: { suggested: string; onSet: () => Promise<void> }) {
  const [code, setCode] = useState(suggested);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!validRefCode(code)) { setErr('2–24 lowercase letters, numbers or dashes.'); return; }
    setBusy(true);
    const r = await setMyRefCode(code);
    setBusy(false);
    if (r.error !== null) { setErr(r.error); return; }
    await onSet();
  }
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3.5">
      <p className="text-sm text-brand-muted leading-relaxed">
        Pick the short name for your link. It also goes on every deck you share (<span className="text-brand-fg">?ref=…</span>) so sign-ups are credited to you.
        Choose carefully: once people have it, it can’t change without breaking their links.
      </p>
      <Field label="Your link name" error={err ?? undefined} hint={err === null ? `beamwall…/book/${code.trim().toLowerCase() || 'yourname'}` : undefined}>
        {(a) => <input {...a} autoCapitalize="none" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} maxLength={24} placeholder="jamesa" />}
      </Field>
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy ? 'Saving…' : 'Create my link'}</button>
    </form>
  );
}

function Calls({
  list, prospects, now, onStatus, onOpenProspect,
}: {
  list: Booking[];
  prospects: Prospect[];
  now: Date;
  onStatus: (id: string, status: BookingStatus) => Promise<boolean>;
  onOpenProspect: (id: string) => void;
}) {
  const viewerTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; }
  }, []);
  const known = useMemo(() => new Set(prospects.map((p) => p.id)), [prospects]);
  if (list.length === 0) {
    return (
      <div className="mt-4 liquid-glass rounded-2xl p-6 text-center">
        <CalendarDays className="mx-auto w-6 h-6 text-brand-muted" aria-hidden="true" />
        <p className="mt-2 text-sm text-brand-muted">No calls yet. Share your link and bookings show up here, and in your pipeline.</p>
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {list.map((b) => {
        const st = bookingStatusDef(b.status);
        const past = Date.parse(b.ends_at) < now.getTime();
        // The booker picked no market; try a Nigerian reading, then North American.
        const wa = whatsappLink(b.phone, 'ng') ?? whatsappLink(b.phone, 'na');
        return (
          <li key={b.id} className="liquid-glass rounded-2xl p-3.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-brand-fg truncate">{b.name}{b.company !== null ? <span className="text-brand-muted font-normal"> · {b.company}</span> : null}</p>
                <p className="mt-0.5 text-xs text-brand-muted">{formatSlotLong(Date.parse(b.starts_at), viewerTz)}</p>
              </div>
              <Pill className={st.pill}>{st.label}</Pill>
            </div>
            {b.notes !== null && <p className="mt-2 text-xs text-brand-fg/80 leading-relaxed line-clamp-3">“{b.notes}”</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {b.prospect_id !== null && known.has(b.prospect_id) && (
                <button type="button" onClick={() => onOpenProspect(b.prospect_id as string)} className={btnQuiet}>Open prospect</button>
              )}
              {wa !== null && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className={btnQuiet}>
                  <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> WhatsApp
                </a>
              )}
              {b.email !== null && <a href={`mailto:${b.email}`} className={btnQuiet}>Email</a>}
              {b.status === 'confirmed' && past && (
                <>
                  <button type="button" onClick={() => void onStatus(b.id, 'completed')} className={btnQuiet}>Done</button>
                  <button type="button" onClick={() => void onStatus(b.id, 'no_show')} className={btnQuiet}>No-show</button>
                </>
              )}
              {b.status === 'confirmed' && !past && (
                <button type="button" onClick={() => void onStatus(b.id, 'cancelled')} className={`${btnQuiet} hover:text-rose-200`}>Cancel</button>
              )}
              {b.status !== 'confirmed' && !past && (
                <button type="button" onClick={() => void onStatus(b.id, 'confirmed')} className={btnQuiet}>Restore</button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HoursForm({ initial, onSaved }: { initial: BookingSettings; onSaved: (s: BookingSettings) => void }) {
  const [s, setS] = useState<BookingSettings>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BookingSettings>(k: K, v: BookingSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const tzOptions = TIMEZONE_OPTIONS.some((o) => o.id === s.timezone)
    ? TIMEZONE_OPTIONS
    : [{ id: s.timezone, label: tzCity(s.timezone) }, ...TIMEZONE_OPTIONS];

  function setDay(day: Weekday, wins: Array<[string, string]>) {
    setS((x) => ({ ...x, weekly: { ...x.weekly, [day]: wins } }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const weekly = compactWeekly(s.weekly);
    const wErr = validateWeekly(weekly);
    if (wErr !== null) { setErr(wErr); return; }
    const link = (s.meeting_link ?? '').trim();
    if (link !== '' && !/^https:\/\/\S+$/.test(link)) { setErr('The meeting link has to start with https://'); return; }
    setErr(null);
    setBusy(true);
    const r = await saveMyBookingSettings({
      ...s,
      weekly,
      headline: (s.headline ?? '').trim() === '' ? null : (s.headline ?? '').trim(),
      intro: (s.intro ?? '').trim() === '' ? null : (s.intro ?? '').trim(),
      meeting_link: link === '' ? null : link,
    });
    setBusy(false);
    if (r.error !== null || r.data === null) { setErr(r.error ?? 'That didn’t save.'); return; }
    setS(r.data);
    onSaved(r.data);
  }

  return (
    <form onSubmit={(e) => void save(e)} noValidate className="mt-4 space-y-4">
      <label className="flex items-center justify-between gap-3 liquid-glass rounded-2xl px-4 py-3 cursor-pointer">
        <span>
          <span className="block text-sm text-brand-fg">Accept bookings</span>
          <span className="block text-[11px] text-brand-muted">Turn off while you’re away. Your link shows “not active”.</span>
        </span>
        <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-5 w-5 accent-[color:var(--color-accent)]" />
      </label>

      <div>
        <p className={labelCls}>Weekly hours ({tzCity(s.timezone)} time)</p>
        <ul className="space-y-1.5">
          {WEEKDAYS.map((day) => {
            const wins = s.weekly[day.id] ?? [];
            const open = wins.length > 0;
            return (
              <li key={day.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 rounded-xl bg-white/[0.02] px-2.5 py-1">
                <div className="flex items-center justify-between sm:w-24 sm:shrink-0">
                  <label className="flex min-h-11 items-center gap-2.5 pr-3 text-sm text-brand-fg cursor-pointer">
                    <input type="checkbox" checked={open} onChange={(e) => setDay(day.id, e.target.checked ? [['10:00', '17:00']] : [])}
                      className="h-5 w-5 accent-[color:var(--color-accent)]" aria-label={`Open on ${day.long}`} />
                    {day.short}
                  </label>
                  {!open && <span className="text-xs text-brand-muted/70 sm:hidden">Unavailable</span>}
                </div>
                {!open ? (
                  <span className="hidden sm:inline text-xs text-brand-muted/70">Unavailable</span>
                ) : (
                  <div className="flex flex-1 flex-col gap-1.5 pb-1.5 sm:pb-0">
                    {wins.map((w, i) => (
                      <div key={i} className="flex items-center gap-1.5 min-w-0">
                        <TimeInput label={`${day.long} range ${i + 1} start`} value={w[0]} onChange={(v) => setDay(day.id, wins.map((x, j) => (j === i ? [v, x[1]] : x)))} />
                        <span className="text-brand-muted text-xs">to</span>
                        <TimeInput label={`${day.long} range ${i + 1} end`} value={w[1]} onChange={(v) => setDay(day.id, wins.map((x, j) => (j === i ? [x[0], v] : x)))} />
                        {wins.length > 1 && (
                          <button type="button" onClick={() => setDay(day.id, wins.filter((_, j) => j !== i))} aria-label={`Remove ${day.long} range ${i + 1}`} className={iconBtn}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {i === wins.length - 1 && wins.length < 3 && (
                          <button type="button" aria-label={`Add a range on ${day.long}`} className={iconBtn}
                            onClick={() => {
                              const lastEnd = parseHHMM(w[1]) ?? 17 * 60;
                              const s2 = Math.min(lastEnd + 60, 22 * 60);
                              setDay(day.id, [...wins, [formatHHMM(s2), formatHHMM(Math.min(s2 + 120, 23 * 60 + 30))]]);
                            }}>
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Field label="Time zone">
          {(a) => (
            <select {...a} value={s.timezone} onChange={(e) => set('timezone', e.target.value)} className={`${inputCls} [color-scheme:dark]`}>
              {tzOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Market">
          {(a) => (
            <select {...a} value={s.market} onChange={(e) => set('market', e.target.value as Market)} className={`${inputCls} [color-scheme:dark]`}>
              <option value="ng">Nigeria (asks for WhatsApp first)</option>
              <option value="na">North America (asks for email first)</option>
            </select>
          )}
        </Field>
      </div>

      <div>
        <p className={labelCls} id="dur">Call length</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="dur">
          {DURATIONS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={s.duration_min === d} onClick={() => set('duration_min', d)} className={`${chip} ${s.duration_min === d ? chipOn : chipOff}`}>
              {d} min
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <NumberField label="Gap between" unit="min" value={s.buffer_min} min={0} max={60} onChange={(v) => set('buffer_min', v)} />
        <NumberField label="Min notice" unit="hours" value={s.min_notice_hours} min={0} max={168} onChange={(v) => set('min_notice_hours', v)} />
        <NumberField label="Book ahead" unit="days" value={s.horizon_days} min={1} max={60} onChange={(v) => set('horizon_days', v)} />
      </div>

      <Field label="Meeting link (optional)" hint="Google Meet or Zoom. Shown to people only after they book.">
        {(a) => <input {...a} type="url" inputMode="url" autoCapitalize="none" spellCheck={false} value={s.meeting_link ?? ''} onChange={(e) => set('meeting_link', e.target.value)} className={inputCls} placeholder="https://meet.google.com/…" />}
      </Field>
      <Field label="Headline (optional)" hint="Defaults to “Book a call with <your first name>”.">
        {(a) => <input {...a} value={s.headline ?? ''} onChange={(e) => set('headline', e.target.value)} className={inputCls} maxLength={120} />}
      </Field>
      <Field label="Intro (optional)" hint="One or two sentences on what the call is for.">
        {(a) => <textarea {...a} rows={3} value={s.intro ?? ''} onChange={(e) => set('intro', e.target.value)} className={`${inputCls} py-2.5 leading-relaxed resize-none`} maxLength={600} />}
      </Field>

      {err !== null && <p role="alert" className="text-xs text-amber-300">{err}</p>}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input type="time" step={900} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className="min-h-11 min-w-0 flex-1 sm:flex-none sm:w-[8rem] rounded-lg liquid-glass-inset px-2 text-sm text-brand-fg tabular-nums [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]/50" />
  );
}

function NumberField({
  label, unit, value, min, max, onChange,
}: { label: string; unit: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} hint={unit}>
      {(a) => (
        <input {...a} type="number" inputMode="numeric" min={min} max={max} value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
          }}
          className={inputCls} />
      )}
    </Field>
  );
}
