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
import { createEvent, updateEventConfig, isSlugVisiblyTaken, type CreateEventError, type HostEventRow } from '../../lib/host';
import { EVENT_TEMPLATES, templateById, templateConfigPatch } from '../../lib/eventTemplates';
import TemplatePreview from '../../components/ui/TemplatePreview';

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
  const [templateId, setTemplateId] = useState('wedding');
  const [remote, setRemote] = useState(false);
  const [date, setDate] = useState('');
  const template = templateById(templateId) ?? EVENT_TEMPLATES[0];

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
    const res = await createEvent({ eventName: name.trim(), slug, eventType: remote ? 'remote' : template.eventType, startsAt });
    if (res.event) {
      // Seed the chosen template's complete look (theme, frames, effects, copy)
      // into events.config so the event is beautiful the moment it opens.
      // Best-effort client-side merge — member RLS permits it.
      await updateEventConfig(res.event.id, templateConfigPatch(template, name.trim()));
    }
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
            <div className="flex flex-col gap-2">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Choose a style</span>
              <div className="grid grid-cols-3 gap-2">
                {EVENT_TEMPLATES.map((t) => {
                  const on = t.id === templateId;
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      aria-pressed={on}
                      title={t.label}
                      className={`group relative rounded-xl border p-2 text-left transition active:scale-[0.98] ${on ? 'border-[color:var(--color-accent)]/70 ring-1 ring-[color:var(--color-accent)]/40' : 'border-white/10 hover:border-white/25'}`}
                    >
                      <div className="h-9 rounded-lg mb-1.5 shadow-[inset_0_1px_8px_rgba(0,0,0,0.4)]" style={{ background: t.swatch }} />
                      <div className="flex items-center gap-1">
                        <span className="text-[13px] leading-none">{t.emoji}</span>
                        <span className="font-label uppercase tracking-luxe text-[8.5px] text-brand-fg">{t.label}</span>
                      </div>
                      {on && (
                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[color:var(--color-accent)] flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-noir-900" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="font-sans text-[11px] text-brand-muted/60 leading-relaxed min-h-[2.5em]">{template.blurb}</p>

              <label className="mt-0.5 flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 cursor-pointer hover:bg-white/[0.04] transition-colors">
                <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="mt-0.5 accent-[color:var(--color-accent)]" />
                <span className="font-sans text-[11px] leading-relaxed text-brand-muted/70">
                  <span className="text-brand-fg">Remote / virtual celebration.</span> Guests can’t attend in person — we’ll open the studio to a shareable greeting card where anyone, anywhere adds photos, videos &amp; notes. Your chosen style still applies.
                </span>
              </label>
            </div>
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
              <p className="mt-1 font-sans text-xs text-brand-muted/60">Here’s the look — you can fine-tune everything later.</p>
            </div>
            <div className="flex gap-4 items-stretch">
              <div className="w-28 sm:w-32 shrink-0">
                <TemplatePreview template={template} eventName={name.trim()} />
              </div>
              <div className="flex-1 rounded-2xl bg-white/[0.03] border border-white/10 p-4 sm:p-5 space-y-2.5 self-center">
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Name</span>
                <span className="text-brand-fg text-right">{name.trim()}</span>
              </div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Style</span>
                <span className="text-brand-fg text-right">{template.emoji} {template.label}{remote ? ' · Remote' : ''}</span>
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
