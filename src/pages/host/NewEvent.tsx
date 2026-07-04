/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/new — three-step event creation wizard:
 *   1. Basics (name, type, optional date)
 *   2. Slug (auto-suggested, live-validated; server has the final word)
 *   3. Create → success screen with guest link + QR + Open studio.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, PartyPopper } from 'lucide-react';
import { slugify, SLUG_RE, RESERVED_SLUGS } from '../../lib/slug';
import { createEvent, isSlugVisiblyTaken, type CreateEventError, type HostEventRow } from '../../lib/host';

const EVENT_TYPES = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'gala', label: 'Gala' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'party', label: 'Party' },
  { value: 'remote', label: 'Remote / virtual' },
];

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

type SlugHint =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'invalid'; message: string }
  | { kind: 'taken' };

function slugClientError(slug: string): string | null {
  if (!slug) return 'Pick a link for your event.';
  if (!SLUG_RE.test(slug)) return 'Use 2–63 lowercase letters, numbers and dashes, starting with a letter or number.';
  if (RESERVED_SLUGS.has(slug)) return 'That link is reserved — try another.';
  return null;
}

export default function NewEvent() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [name, setName] = useState('');
  const [eventType, setEventType] = useState('wedding');
  const [date, setDate] = useState('');

  // Step 2
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugHint, setSlugHint] = useState<SlugHint>({ kind: 'idle' });
  const checkSeq = useRef(0);

  // Step 3
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<HostEventRow | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-suggest the slug from the name until the user edits it themselves.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  // Debounced availability hint (client-side; RLS hides other orgs' drafts,
  // so the create-event function still has the final word).
  useEffect(() => {
    if (step !== 2) return;
    const err = slugClientError(slug);
    if (err) {
      setSlugHint({ kind: 'invalid', message: err });
      return;
    }
    setSlugHint({ kind: 'checking' });
    const seq = ++checkSeq.current;
    const tid = setTimeout(async () => {
      const taken = await isSlugVisiblyTaken(slug);
      if (checkSeq.current !== seq) return;
      setSlugHint(taken ? { kind: 'taken' } : { kind: 'ok' });
    }, 350);
    return () => clearTimeout(tid);
  }, [slug, step]);

  const doCreate = async () => {
    setCreating(true);
    setCreateError(null);
    const startsAt = date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
    const res = await createEvent({ eventName: name.trim(), slug, eventType, startsAt });
    setCreating(false);
    if (res.error) {
      const slugErrors: CreateEventError[] = ['slug_taken', 'reserved_slug', 'invalid_slug'];
      if (slugErrors.includes(res.error)) {
        setStep(2);
        setSlugHint(
          res.error === 'slug_taken'
            ? { kind: 'taken' }
            : { kind: 'invalid', message: res.error === 'reserved_slug' ? 'That link is reserved — try another.' : 'That link isn’t valid — try another.' },
        );
        return;
      }
      setCreateError(
        res.error === 'unauthorized'
          ? 'Your session expired — sign in again and retry.'
          : 'Something went wrong creating the event. Please try again.',
      );
      return;
    }
    setCreated(res.event);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const guestUrl = created ? `${origin}/e/${created.slug}` : '';

  /* ── Success screen ── */
  if (created) {
    return (
      <div className="p-6 md:p-10 max-w-lg mx-auto">
        <div className="glass-strong rounded-3xl p-10 text-center flex flex-col items-center gap-5 animate-rise-in">
          <div className="w-14 h-14 rounded-full bg-foil glow-accent flex items-center justify-center">
            <PartyPopper className="w-6 h-6 text-noir-900" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-foil-static">{created.name}</h1>
            <p className="mt-1 font-sans text-xs text-brand-muted/60">Your event is ready (in draft). Go live from the events list when the day comes.</p>
          </div>
          <div className="rounded-xl p-3 bg-ivory/95 shadow-lg">
            <QRCodeSVG value={guestUrl} size={160} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
          </div>
          <div className="flex items-center gap-1.5 w-full justify-center">
            <p className="font-mono text-[11px] text-brand-muted/70 truncate">{guestUrl}</p>
            <button
              onClick={() => navigator.clipboard.writeText(guestUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors"
              title="Copy guest link"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
            <button
              onClick={() => navigate(`/host/events/${created.id}`)}
              className="flex-1 rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[10px] font-bold text-noir-900 glow-accent transition active:scale-[0.98]"
            >
              Open studio
            </button>
            <Link
              to="/host"
              className="flex-1 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08] text-center"
            >
              Back to events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const canNext1 = Boolean(name.trim());
  const canNext2 = slugHint.kind === 'ok' || slugHint.kind === 'checking';

  return (
    <div className="p-6 md:p-10 max-w-lg mx-auto">
      <Link to="/host" className="inline-flex items-center gap-1.5 mb-6 font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 hover:text-brand-fg transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Events
      </Link>

      <div className="glass-strong rounded-3xl p-8 animate-rise-in">
        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all ${s === step ? 'w-6 bg-[color:var(--color-accent)]' : 'w-1.5 bg-white/15'}`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-serif text-2xl text-foil-static">The basics</h1>
              <p className="mt-1 font-sans text-xs text-brand-muted/60">What are we celebrating?</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Event name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Jenna & Jake's Wedding"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Type</span>
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={inputClass}>
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              {eventType === 'remote' && (
                <p className="mt-1 rounded-xl border border-gold-400/20 bg-gold-400/[0.06] px-3.5 py-2.5 font-sans text-[11px] leading-relaxed text-gold-200/80">
                  Remote celebrations shine with a greeting card — create one in the studio's Cards
                  tab after setup, and guests everywhere can add photos, videos and notes.
                </p>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Date (optional)</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </label>
            <button
              onClick={() => setStep(2)}
              disabled={!canNext1}
              className="mt-2 w-full rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-serif text-2xl text-foil-static">Claim your link</h1>
              <p className="mt-1 font-sans text-xs text-brand-muted/60">Guests will open the booth at this address.</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Event link</span>
              <div className="flex items-center gap-0 rounded-xl bg-white/[0.04] border border-white/10 focus-within:border-[color:var(--color-accent)]/60 transition">
                <span className="pl-4 font-mono text-sm text-brand-muted/50 select-none">/e/</span>
                <input
                  autoFocus
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="jenna-jake-2026"
                  className="flex-1 bg-transparent px-1.5 py-3 font-mono text-sm text-brand-fg placeholder:text-brand-muted/30 outline-none"
                />
              </div>
            </label>
            <div className="min-h-[1.25rem] font-sans text-xs">
              {slugHint.kind === 'checking' && <span className="text-brand-muted/50">Checking availability…</span>}
              {slugHint.kind === 'ok' && <span className="text-emerald-400">Looks available.</span>}
              {slugHint.kind === 'taken' && <span className="text-red-400">That link is already taken — try another.</span>}
              {slugHint.kind === 'invalid' && <span className="text-red-400">{slugHint.message}</span>}
            </div>
            <p className="font-sans text-[10px] text-brand-muted/40 leading-relaxed">
              Availability is a best-effort check — unpublished events from other hosts aren't visible here, so the final word comes when you create.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!canNext2}
                className="flex-1 rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-serif text-2xl text-foil-static">Ready to create</h1>
              <p className="mt-1 font-sans text-xs text-brand-muted/60">One last look before we set the stage.</p>
            </div>
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 space-y-2.5">
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Name</span>
                <span className="text-brand-fg text-right">{name.trim()}</span>
              </div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Type</span>
                <span className="text-brand-fg capitalize">{eventType}</span>
              </div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Link</span>
                <span className="font-mono text-brand-fg">/e/{slug}</span>
              </div>
              {date && (
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-brand-muted/50">Date</span>
                  <span className="text-brand-fg">{date}</span>
                </div>
              )}
            </div>
            {createError && <p role="alert" className="text-sm text-red-400">{createError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                disabled={creating}
                className="flex-1 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08] disabled:opacity-40"
              >
                Back
              </button>
              <button
                onClick={doCreate}
                disabled={creating}
                className="flex-1 rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : 'Create event'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
