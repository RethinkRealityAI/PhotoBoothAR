/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /book/:ref — a rep's public booking page (prospect-facing, noindex).
 *
 * Pick a day → pick a time (shown in the VISITOR's timezone) → a short form
 * → booked, with add-to-calendar. The slot list is built client-side from the
 * rep's hours for speed; sales_book_meeting (042) re-validates everything, so
 * a stale list can only ever produce a friendly "pick another time".
 *
 * What a visitor never sees: who else booked (busy times only), the rep's
 * email, or the meeting link before they have booked.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CalendarCheck2, CalendarPlus, Check, Clock, Download, Globe2, Video,
} from 'lucide-react';
import {
  BOOKER_ICPS, buildIcs, EMPTY_BOOKER, formatSlotLong, formatSlotTime, generateSlots, googleCalendarUrl,
  groupSlotsByDay, hasErrors, isValidTimeZone, tzCity, validateBooker,
  type BookerDraft, type BookerErrors, type BookingConfirmation, type PublicBookingPage, type Slot,
} from '../../lib/booking';
import { bookMeeting, fetchPublicBookingPage } from '../../lib/bookingApi';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from './components/pageMeta';
import { AutoTextarea, Field, inputCls, labelCls, Spinner } from './crm/ui';
import { BEAMY, BEAMY_WAVE } from './salesImages';

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ready'; page: PublicBookingPage; loadedAt: number };

const cta =
  'pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-foil px-6 font-label text-[11.5px] font-bold uppercase tracking-[0.2em] text-white glow-accent disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-[color:var(--color-accent)]';
const ghost =
  'pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 font-label text-[10.5px] font-semibold uppercase tracking-[0.18em] text-brand-fg hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]';

function viewerTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export default function BookPage() {
  const { ref = '' } = useParams();
  const code = ref.trim().toLowerCase();
  const viewerTz = useMemo(viewerTimeZone, []);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<BookingConfirmation | null>(null);

  useNoIndex();
  const repName = load.state === 'ready' ? load.page.rep_name : '';
  usePageTitle(repName !== '' ? `Book a call with ${firstName(repName)} · Beamwall` : 'Book a call · Beamwall');

  const fetchPage = useCallback(async () => {
    if (!/^[a-z0-9-]{2,24}$/.test(code)) { setLoad({ state: 'missing' }); return; }
    const r = await fetchPublicBookingPage(code);
    if (r.error !== null) {
      // 042 not applied reads, to a prospect, exactly like an inactive link.
      setLoad(r.notSetUp === true ? { state: 'missing' } : { state: 'error', message: r.error });
      return;
    }
    setLoad(r.data === null ? { state: 'missing' } : { state: 'ready', page: r.data, loadedAt: Date.now() });
  }, [code]);

  useEffect(() => { void fetchPage(); }, [fetchPage]);

  const days = useMemo(() => {
    if (load.state !== 'ready') return [];
    return groupSlotsByDay(generateSlots(load.page, load.page.busy, new Date(load.loadedAt)), viewerTz);
  }, [load, viewerTz]);

  // Default to the first day with a slot; keep the pick across refetches if it still exists.
  useEffect(() => {
    if (days.length === 0) { setDayKey(null); return; }
    setDayKey((k) => (k !== null && days.some((d) => d.key === k) ? k : days[0].key));
  }, [days]);

  const day = days.find((d) => d.key === dayKey) ?? null;
  const formRef = useRef<HTMLDivElement | null>(null);

  function pick(s: Slot) {
    setSlot(s);
    setNotice(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden app-bg text-brand-fg">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/5 bg-brand-bg/75 px-4 py-2.5 backdrop-blur-md sm:px-6">
        <Link to="/" className="rounded font-serif text-xl font-semibold tracking-wide text-foil-static focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:text-2xl">
          Beamwall
        </Link>
        <span className="font-label text-[10px] uppercase tracking-[0.22em] text-brand-muted">Book a call</span>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:pt-10">
        {load.state === 'loading' && <LoadingState />}
        {load.state === 'missing' && <MissingState />}
        {load.state === 'error' && (
          <div className="liquid-glass-raised rounded-3xl p-6 text-center">
            <p role="alert" className="text-sm text-brand-muted">{load.message}</p>
            <button type="button" onClick={() => { setLoad({ state: 'loading' }); void fetchPage(); }} className={`${ghost} mt-4`}>Try again</button>
          </div>
        )}
        {load.state === 'ready' && done !== null && (
          <Confirmed booking={done} viewerTz={viewerTz} />
        )}
        {load.state === 'ready' && done === null && (
          <>
            <Intro page={load.page} viewerTz={viewerTz} />

            {days.length === 0 ? (
              <div className="mt-5 liquid-glass rounded-3xl p-6 text-center">
                <p className="font-serif text-xl text-brand-fg">No open times right now</p>
                <p className="mt-2 text-sm text-brand-muted leading-relaxed">
                  {firstName(load.page.rep_name)}’s calendar is full for the next {load.page.horizon_days} days. Check back soon,
                  or reply to the message that sent you here.
                </p>
              </div>
            ) : (
              <section aria-labelledby="pick-time" className="mt-5 liquid-glass-raised rounded-3xl p-4 sm:p-6">
                <h2 id="pick-time" className="font-serif text-2xl text-brand-fg">Pick a time</h2>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-brand-muted">
                  <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Times are in your time zone ({tzCity(viewerTz)}).
                </p>

                <div className="mt-4 -mx-4 px-4 sm:-mx-6 sm:px-6 flex gap-2 overflow-x-auto hide-scrollbar pb-1" role="radiogroup" aria-label="Day">
                  {days.map((d) => {
                    const on = d.key === dayKey;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => { setDayKey(d.key); setSlot(null); }}
                        className={`pressable shrink-0 w-[4.6rem] rounded-2xl border px-2 py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
                          on ? 'border-[color:var(--color-accent)]/70 bg-[color:var(--color-accent)]/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="block font-label text-[10px] uppercase tracking-[0.18em] text-brand-muted">{d.weekday}</span>
                        <span className="mt-0.5 block font-serif text-lg leading-tight text-brand-fg">{d.label}</span>
                        <span className="mt-0.5 block text-[10px] text-brand-muted/80">{d.slots.length} open</span>
                      </button>
                    );
                  })}
                </div>

                {day !== null && (
                  <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-2" role="radiogroup" aria-label={`Times on ${day.weekday} ${day.label}`}>
                    {day.slots.map((s) => {
                      const on = slot?.startMs === s.startMs;
                      return (
                        <button
                          key={s.startMs}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => pick(s)}
                          className={`pressable min-h-12 rounded-xl border text-[15px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
                            on ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--on-accent)] font-semibold' : 'border-white/12 bg-white/[0.03] text-brand-fg hover:bg-white/[0.07]'
                          }`}
                        >
                          {formatSlotTime(s.startMs, viewerTz)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {notice !== null && <p role="alert" className="mt-3 text-sm text-amber-200">{notice}</p>}
              </section>
            )}

            <div ref={formRef} className="scroll-mt-20">
              {slot !== null && (
                <BookerForm
                  page={load.page}
                  slot={slot}
                  viewerTz={viewerTz}
                  onChangeTime={() => setSlot(null)}
                  onBooked={setDone}
                  onSlotGone={(msg) => {
                    setSlot(null);
                    setNotice(msg);
                    void fetchPage();
                  }}
                />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Intro({ page, viewerTz }: { page: PublicBookingPage; viewerTz: string }) {
  const who = firstName(page.rep_name);
  const headline = (page.headline ?? '').trim() !== '' ? page.headline : `Book a call with ${who}`;
  const intro = (page.intro ?? '').trim() !== ''
    ? page.intro
    : `A quick ${page.duration_min}-minute video call to see if Beamwall fits your next event. We’ll walk through the AR photo booth, the live photo wall and keepsake cards, and talk through what you’re planning.`;
  const sameTz = page.timezone === viewerTz;
  return (
    <section className="liquid-glass-raised rounded-3xl p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <img src={BEAMY_WAVE?.src ?? BEAMY.src} width={BEAMY_WAVE?.width ?? BEAMY.width} height={BEAMY_WAVE?.height ?? BEAMY.height}
          alt="" className="h-auto w-20 shrink-0 sm:w-24 motion-safe:animate-float" />
        <div className="min-w-0">
          <p className="font-label text-[10px] uppercase tracking-[0.24em] text-[color:var(--color-accent)]">{page.rep_name} · Beamwall</p>
          <h1 className="mt-1 font-serif text-[28px] sm:text-4xl font-semibold leading-tight text-foil-static">{headline}</h1>
        </div>
      </div>
      <p className="mt-4 text-[15px] leading-relaxed text-brand-muted whitespace-pre-line">{intro}</p>
      <ul className="mt-4 flex flex-wrap gap-2 text-xs text-brand-fg/85">
        <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <Clock className="h-3.5 w-3.5 text-brand-muted" aria-hidden="true" /> {page.duration_min} min
        </li>
        <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <Video className="h-3.5 w-3.5 text-brand-muted" aria-hidden="true" /> Video call
        </li>
        {!sameTz && (
          <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
            <Globe2 className="h-3.5 w-3.5 text-brand-muted" aria-hidden="true" /> {who} is in {tzCity(page.timezone)}
          </li>
        )}
      </ul>
    </section>
  );
}

function BookerForm({
  page, slot, viewerTz, onChangeTime, onBooked, onSlotGone,
}: {
  page: PublicBookingPage;
  slot: Slot;
  viewerTz: string;
  onChangeTime: () => void;
  onBooked: (b: BookingConfirmation) => void;
  onSlotGone: (message: string) => void;
}) {
  const [d, setD] = useState<BookerDraft>(() => ({ ...EMPTY_BOOKER, icp: 'planners' }));
  const [errors, setErrors] = useState<BookerErrors>({});
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const set = <K extends keyof BookerDraft>(k: K, v: BookerDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const ng = page.market === 'ng';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs = validateBooker(d);
    setErrors(errs);
    if (hasErrors(errs)) { setFormErr('Check the highlighted fields.'); return; }
    setBusy(true);
    setFormErr(null);
    const r = await bookMeeting(page.ref, new Date(slot.startMs).toISOString(), d, viewerTz);
    setBusy(false);
    if (r.data !== null) { onBooked(r.data); return; }
    const msg = r.error ?? 'That didn’t go through. Try again.';
    if (/just booked|isn’t available/.test(msg)) { onSlotGone(msg); return; }
    setFormErr(msg);
  }

  const phoneField = (
    <Field key="phone" label={ng ? 'WhatsApp number' : 'Phone (optional)'} error={errors.phone}
      hint={errors.phone === undefined && ng ? 'With country code, e.g. +234 803 123 4567' : undefined}>
      {(a) => <input {...a} type="tel" inputMode="tel" autoComplete="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} placeholder={ng ? '+234…' : '+1…'} />}
    </Field>
  );
  const emailField = (
    <Field key="email" label={ng ? 'Email (optional)' : 'Email'} error={errors.email}>
      {(a) => <input {...a} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={d.email} onChange={(e) => set('email', e.target.value)} className={inputCls} placeholder="you@company.com" />}
    </Field>
  );

  return (
    <section aria-labelledby="your-details" className="mt-5 liquid-glass-raised rounded-3xl p-4 sm:p-6 animate-rise-in">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--color-accent)]/35 bg-[color:var(--color-accent)]/10 px-4 py-3">
        <CalendarCheck2 className="h-5 w-5 shrink-0 text-[color:var(--color-accent)]" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-brand-fg">
          <span className="font-medium">{formatSlotLong(slot.startMs, viewerTz)}</span>
          <span className="text-brand-muted"> · {page.duration_min} min</span>
        </p>
        <button type="button" onClick={onChangeTime} className="min-h-11 px-2 text-xs text-brand-muted underline-offset-4 hover:text-brand-fg hover:underline">
          Change
        </button>
      </div>

      <h2 id="your-details" className="mt-5 font-serif text-2xl text-brand-fg">Your details</h2>
      <form onSubmit={(e) => void submit(e)} noValidate className="mt-3 space-y-3.5">
        <Field label="Your name" error={errors.name}>
          {(a) => <input {...a} autoComplete="name" value={d.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />}
        </Field>
        {ng ? [phoneField, emailField] : [emailField, phoneField]}
        {errors.contact !== undefined && <p role="alert" className="-mt-2 text-[11px] text-amber-300">{errors.contact}</p>}
        <Field label="Company (optional)">
          {(a) => <input {...a} autoComplete="organization" value={d.company} onChange={(e) => set('company', e.target.value)} className={inputCls} />}
        </Field>
        <div>
          <p className={labelCls} id="booker-icp">What are you planning?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-labelledby="booker-icp">
            {BOOKER_ICPS.map((o) => {
              const on = d.icp === o.id;
              return (
                <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => set('icp', o.id)}
                  className={`pressable min-h-11 rounded-xl border px-3.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
                    on ? 'border-[color:var(--color-accent)]/70 bg-[color:var(--color-accent)]/15 text-brand-fg' : 'border-white/10 bg-white/[0.03] text-brand-muted hover:text-brand-fg'
                  }`}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Event date, if you have one (optional)" error={errors.eventDate}>
          {(a) => <input {...a} type="date" value={d.eventDate} onChange={(e) => set('eventDate', e.target.value)} className={`${inputCls} [color-scheme:dark]`} />}
        </Field>
        <Field label="Anything we should know? (optional)" error={errors.notes}>
          {(a) => <AutoTextarea {...a} minRows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Guest count, venue, what you’d love guests to walk away with…" maxLength={1000} />}
        </Field>
        <label className="flex items-start gap-3 rounded-xl px-1 py-1 cursor-pointer">
          <input type="checkbox" checked={d.consent} onChange={(e) => set('consent', e.target.checked)}
            aria-invalid={errors.consent !== undefined}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--color-accent)]" />
          <span className="text-xs leading-relaxed text-brand-muted">
            Beamwall can contact me about this call and my event. We only use your details for this, and you can ask us to delete them at any time.
            {errors.consent !== undefined && <span className="mt-1 block text-amber-300">{errors.consent}</span>}
          </span>
        </label>
        {formErr !== null && <p role="alert" className="text-sm text-amber-200">{formErr}</p>}
        <button type="submit" disabled={busy} className={cta}>
          {busy ? <><Spinner label="Booking" /> Booking…</> : <>Confirm booking <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
        </button>
      </form>
    </section>
  );
}

function Confirmed({ booking, viewerTz }: { booking: BookingConfirmation; viewerTz: string }) {
  const start = Date.parse(booking.starts_at);
  const end = Date.parse(booking.ends_at);
  const who = firstName(booking.rep_name);
  const ev = {
    uid: booking.booking_id,
    startMs: start,
    endMs: end,
    title: `Beamwall call with ${who}`,
    description: `Your ${booking.duration_min}-minute call with ${booking.rep_name} from Beamwall.${booking.meeting_link !== null ? `\nJoin: ${booking.meeting_link}` : ''}`,
    location: booking.meeting_link,
  };

  function downloadIcs() {
    try {
      const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'beamwall-call.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Google link below still works.
    }
  }

  return (
    <section aria-labelledby="booked" className="liquid-glass-raised rounded-3xl p-6 sm:p-8 text-center animate-rise-in">
      <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
        <Check className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 id="booked" className="mt-4 font-serif text-3xl sm:text-4xl font-semibold text-foil-static">You’re booked</h1>
      <p className="mt-3 text-[15px] text-brand-fg">{formatSlotLong(start, viewerTz)}</p>
      <p className="mt-1 text-sm text-brand-muted">{booking.duration_min} minutes with {booking.rep_name} · your time ({tzCity(viewerTz)})</p>

      {booking.meeting_link !== null && (
        <a href={booking.meeting_link} target="_blank" rel="noopener noreferrer"
          className="mx-auto mt-5 flex max-w-sm items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-brand-fg hover:bg-white/[0.08] break-all">
          <Video className="h-4 w-4 shrink-0" aria-hidden="true" /> {booking.meeting_link.replace(/^https:\/\//, '')}
        </a>
      )}

      <div className="mx-auto mt-6 flex max-w-sm flex-col gap-2.5">
        <a href={googleCalendarUrl(ev)} target="_blank" rel="noopener noreferrer" className={cta}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Add to Google Calendar
        </a>
        <button type="button" onClick={downloadIcs} className={ghost}>
          <Download className="h-4 w-4" aria-hidden="true" /> Apple / Outlook (.ics)
        </button>
      </div>

      <p className="mx-auto mt-6 max-w-sm text-xs leading-relaxed text-brand-muted">
        {who} will be in touch before the call. Need to change the time? Just reply to the message that brought you here.
      </p>
      <Link to="/" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-xs text-brand-muted underline-offset-4 hover:text-brand-fg hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> See Beamwall in action
      </Link>
    </section>
  );
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Loading times" className="space-y-4">
      <div className="liquid-glass-raised rounded-3xl p-6 h-48 motion-safe:animate-pulse" />
      <div className="liquid-glass rounded-3xl p-6 h-64 motion-safe:animate-pulse" />
    </div>
  );
}

function MissingState() {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <img src={BEAMY.src} width={BEAMY.width} height={BEAMY.height} alt="" className="h-auto w-36 motion-safe:animate-float" />
      <h1 className="mt-6 font-serif text-3xl font-semibold text-foil-static">This booking link isn’t active</h1>
      <p className="mt-3 max-w-md text-brand-muted leading-relaxed">
        It may be out of date. Reply to the message that sent you here and we’ll find a time, or have a look around Beamwall in the meantime.
      </p>
      <Link to="/" className={`${cta} mt-8 w-auto`}>
        Visit Beamwall <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
