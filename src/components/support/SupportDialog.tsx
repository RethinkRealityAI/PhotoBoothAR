/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The report-an-issue dialog. One dialog, mounted once in App.tsx, opened from
 * every surface through supportStore — the host rail, the studio bar, the guest
 * booth menu, the error boundaries, the landing footer.
 *
 * Two things it refuses to do:
 *   - Make the user classify their own bug before they can describe it. The
 *     pills come pre-ordered by where they clicked from and what they type, and
 *     one is already selected, so "send" is reachable without touching them.
 *   - Attach anything invisibly. The diagnostics we send are listed in a
 *     disclosure the user can open, already redacted (supportModel.redactUrl
 *     strips the auth fragment — see its docblock for why that is not optional).
 *
 * All decision logic lives in src/lib/supportModel.ts, which is unit-tested;
 * vitest here runs in node with no jsdom, so a .tsx file cannot be tested.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bug, CalendarRange, Users, Receipt, ShieldCheck, Sparkles, MessageCircle,
  ChevronDown, Paperclip, Check, X, Loader2, type LucideIcon,
} from 'lucide-react';
import Modal from '../ui/Modal';
import { useSupportStore } from '../../lib/supportStore';
import { useSession } from '../../lib/auth';
import { telemetrySessionId } from '../../lib/errorReport';
import {
  SUPPORT_CATEGORIES, categoryDef, suggestCategories,
  type SupportCategory,
} from '../../lib/supportModel';
import {
  createTicket, collectDiagnostics, uploadSupportScreenshot,
  type NewTicketInput,
} from '../../lib/support';
import { fetchMyOrgResult } from '../../lib/host';
import { haptic } from '../../lib/haptics';

const ICONS: Record<string, LucideIcon> = {
  Bug, CalendarRange, Users, Receipt, ShieldCheck, Sparkles, MessageCircle,
};

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;
const MAX_SHOT_BYTES = 5 * 1024 * 1024;

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 focus:outline-none focus:border-[color:var(--color-accent)]/50 transition-colors';

/** The slug from /e/:slug/... when the opener did not name one. */
function slugFromPath(pathname: string): string | null {
  const m = /^\/e\/([^/]+)/.exec(pathname);
  return m ? m[1] : null;
}

export default function SupportDialog() {
  const { isOpen, prefill, close } = useSupportStore();
  const { session } = useSession();
  const { pathname } = useLocation();

  const [category, setCategory] = useState<SupportCategory>('bug');
  const [touchedCategory, setTouchedCategory] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [shot, setShot] = useState<File | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [phase, setPhase] = useState<'form' | 'sending' | 'sent'>('form');
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const signedIn = Boolean(session);
  const source = prefill?.source ?? 'host_rail';
  const eventSlug = prefill?.eventSlug ?? slugFromPath(pathname);

  // Reset every time the dialog opens, so a previous report never bleeds in.
  useEffect(() => {
    if (!isOpen) return;
    setSubject(prefill?.subject ?? '');
    setBody(prefill?.body ?? '');
    setCategory(prefill?.category ?? 'bug');
    setTouchedCategory(prefill?.category !== undefined);
    setEmail('');
    setShot(null);
    setShotError(null);
    setShowDiag(false);
    setPhase('form');
    setError(null);
    setRef(null);
    setEmailed(false);
  }, [isOpen, prefill]);

  const ordered = useMemo(
    () => suggestCategories(source, pathname, `${subject} ${body}`),
    [source, pathname, subject, body],
  );

  // Until the user picks one themselves, follow the suggestion as they type.
  useEffect(() => {
    if (!touchedCategory && ordered.length > 0) setCategory(ordered[0]);
  }, [ordered, touchedCategory]);

  const diagnostics = useMemo(
    () => (isOpen ? collectDiagnostics(prefill?.diagnostics) : {}),
    [isOpen, prefill],
  );

  if (!isOpen) return null;

  const pickShot = (f: File | null) => {
    setShotError(null);
    if (f === null) { setShot(null); return; }
    if (!f.type.startsWith('image/')) { setShotError('That needs to be an image.'); return; }
    if (f.size > MAX_SHOT_BYTES) { setShotError('That image is over 5 MB.'); return; }
    setShot(f);
  };

  // A ticket has to be routable to somebody (migration 026): a signed-in user,
  // an email to reply to, or an event whose host will see it. Only the last
  // case — an anonymous reporter with no event — genuinely needs the address.
  const needsEmail = !signedIn && eventSlug === null;
  const canSend =
    subject.trim() !== '' &&
    body.trim() !== '' &&
    (!needsEmail || email.trim() !== '') &&
    phase === 'form';

  async function submit() {
    if (!canSend) return;
    setPhase('sending');
    setError(null);
    haptic('tap');

    const input: NewTicketInput = {
      subject: subject.trim().slice(0, MAX_SUBJECT),
      body: body.trim().slice(0, MAX_BODY),
      category,
      source,
      eventSlug,
      sessionId: telemetrySessionId,
      reporterEmail: signedIn ? null : (email.trim() || null),
      diagnostics,
    };

    const { data, error: err } = await createTicket(input);
    if (err !== null || data === null) {
      setPhase('form');
      setError(
        err === 'rate_limited'
          // The 024 guard raises rather than dropping silently, so we can say
          // something true here instead of pretending it was sent.
          ? "You've sent a few reports already. Email us directly at dapo@rethinkreality.ai and we'll pick it up."
          : err === 'network'
            ? "We couldn't reach the server. Check your connection and try again — or email dapo@rethinkreality.ai."
            : "Something went wrong sending that. Please email dapo@rethinkreality.ai and we'll pick it up.",
      );
      return;
    }

    // The screenshot is a nice-to-have on a ticket that already exists: it is
    // uploaded AFTER, and a failure here never turns a filed report into an error.
    if (shot !== null && signedIn) {
      const { org } = await fetchMyOrgResult();
      if (org !== null) await uploadSupportScreenshot(org.orgId, data.ticket.id, shot);
    }

    setRef(data.ticket.publicRef);
    setEmailed(data.emailed);
    setPhase('sent');
  }

  /* ---------------------------------------------------------------- */

  if (phase === 'sent') {
    return (
      <Modal title="" onClose={close} maxWidthClass="max-w-md" dismissOnScrim zClass="z-[90]">
        <div className="text-center py-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4">
            <Check className="w-6 h-6 text-emerald-400" />
          </div>
          <h2 className="font-serif text-xl text-foil-static mb-2">We've got it.</h2>
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed mb-4">
            A real person reads every one of these.{' '}
            {emailed
              ? 'A copy is on its way to your inbox.'
              : signedIn
                ? "You'll find the conversation under Support."
                : "We'll get back to you as soon as we've looked into it."}
          </p>
          {ref !== null && (
            <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 mb-6">
              Reference {ref}
            </p>
          )}
          <button
            onClick={close}
            className="pressable w-full min-h-11 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px]"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Tell us what happened"
      onClose={close}
      maxWidthClass="max-w-lg"
      dismissOnScrim={false}
      zClass="z-[90]"
    >
      <div className="space-y-5">
        {/* Category pills — pre-ordered by context, one already chosen. */}
        <div>
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 mb-2.5">
            What kind of thing is it?
          </p>
          <div className="flex flex-wrap gap-2">
            {ordered.map((id, i) => {
              const def = categoryDef(id);
              const Icon = ICONS[def.icon] ?? MessageCircle;
              const active = category === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setCategory(id); setTouchedCategory(true); haptic('tap'); }}
                  aria-pressed={active}
                  className={`pressable inline-flex items-center gap-1.5 rounded-full px-3 py-2 min-h-9
                    font-label uppercase tracking-luxe text-[10px] border transition-colors ${
                    active
                      ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg'
                      : 'bg-white/[0.03] border-white/10 text-brand-muted/60 hover:text-brand-fg hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {def.label}
                  {/* The lead pill is our guess; say so rather than hiding it. */}
                  {i === 0 && !touchedCategory && (
                    <span className="text-[8px] text-[color:var(--color-accent)]/80">suggested</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="font-sans text-xs text-brand-muted/50 mt-2.5">{categoryDef(category).hint}</p>
        </div>

        <div>
          <label htmlFor="support-subject" className="sr-only">One-line summary</label>
          <input
            id="support-subject"
            className={inputClass}
            placeholder="One line: what went wrong?"
            value={subject}
            maxLength={MAX_SUBJECT}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="support-body" className="sr-only">What happened</label>
          <textarea
            id="support-body"
            className={`${inputClass} min-h-32 resize-y`}
            placeholder="What were you doing when it happened? The more detail the faster we can fix it."
            value={body}
            maxLength={MAX_BODY}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {!signedIn && (
          <div>
            <input
              className={inputClass}
              type="email"
              inputMode="email"
              placeholder={needsEmail ? 'Your email' : 'Your email (so we can reply)'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required={needsEmail}
            />
            <p className="font-sans text-xs text-brand-muted/50 mt-2">
              {needsEmail
                ? "We need this to reply — it's the only way to reach you."
                : "Optional — but without it we have no way to tell you when it's fixed."}
            </p>
          </div>
        )}

        {/* Screenshots are signed-in only: the support bucket has no anonymous
            insert policy, because an anon-writable prefix is free file hosting. */}
        {signedIn ? (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickShot(e.target.files?.[0] ?? null)}
            />
            {shot === null ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="pressable inline-flex items-center gap-2 rounded-xl px-3 py-2.5 min-h-11 bg-white/[0.04] border border-white/10 text-brand-muted/70 hover:text-brand-fg font-label uppercase tracking-luxe text-[10px]"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Add a screenshot
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-white/[0.04] border border-white/10">
                <Paperclip className="w-3.5 h-3.5 text-[color:var(--color-accent)] shrink-0" />
                <span className="font-sans text-xs text-brand-fg truncate flex-1">{shot.name}</span>
                <button
                  type="button"
                  onClick={() => pickShot(null)}
                  aria-label="Remove the screenshot"
                  className="p-1 rounded-lg text-brand-muted/50 hover:text-brand-fg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {shotError !== null && (
              <p className="font-sans text-xs text-amber-300 mt-2">{shotError}</p>
            )}
          </div>
        ) : (
          <p className="font-sans text-xs text-brand-muted/40">
            Sign in to attach a screenshot.
          </p>
        )}

        {/* Nothing is attached invisibly. */}
        <div className="rounded-xl border border-white/[0.07] overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDiag((v) => !v)}
            aria-expanded={showDiag}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-3 text-left hover:bg-white/[0.03] transition-colors"
          >
            <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">
              What we'll include
            </span>
            <ChevronDown className={`w-4 h-4 text-brand-muted/40 transition-transform ${showDiag ? 'rotate-180' : ''}`} />
          </button>
          {showDiag && (
            <div className="px-3.5 pb-3.5 space-y-1">
              {Object.entries(diagnostics).map(([k, v]) => (
                <div key={k} className="flex gap-2 font-sans text-[11px]">
                  <span className="text-brand-muted/40 shrink-0 w-20">{k}</span>
                  <span className="text-brand-muted/70 break-all">{String(v)}</span>
                </div>
              ))}
              <p className="font-sans text-[11px] text-brand-muted/40 pt-2 leading-relaxed">
                Sign-in tokens are stripped before anything is sent. We never include
                your password or session.
              </p>
            </div>
          )}
        </div>

        {error !== null && (
          <p className="font-sans text-sm text-amber-300 leading-relaxed" role="alert">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="pressable min-h-11 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/70 font-label uppercase tracking-luxe text-[10px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="pressable flex-1 min-h-11 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {phase === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
            {phase === 'sending' ? 'Sending' : 'Send report'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
