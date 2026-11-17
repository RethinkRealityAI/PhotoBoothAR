/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The sales hub's CRM tab. Self-contained: no router layout, no page chrome,
 * its own ToastProvider — the hub just renders `<SalesCrm />`.
 *
 * The hub page is a hidden link and its decks are not secret; THIS tab holds
 * third parties' contact details, so it has a real sign-in and the data is
 * behind RLS (migration 041). The gate below is UX only — Postgres decides.
 *
 * States: session loading → skeleton · signed out → sign-in card ·
 * signed in, not on the team → friendly "ask Dapo" card · member → CRM.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Lock, LogOut, RefreshCw } from 'lucide-react';
import { ToastProvider } from '../../../components/ui/Toast';
import { signInWithEmail, signOut, useSession } from '../../../lib/auth';
import { checkIsPlatformAdmin } from '../../../lib/admin';
import { copyText } from '../../../lib/clipboard';
import { isSalesMember } from '../../../lib/crmApi';
import CrmWorkspace from './CrmWorkspace';
import { btnPrimary, btnQuiet, Field, inputCls } from './ui';

export default function SalesCrm() {
  return (
    <ToastProvider>
      <CrmGate />
    </ToastProvider>
  );
}

type Access =
  | { state: 'checking' }
  | { state: 'error'; message: string }
  | { state: 'ready'; member: boolean; admin: boolean };

function CrmGate() {
  const { session, loading } = useSession();
  const uid = session?.user?.id ?? null;
  const email = session?.user?.email ?? '';
  const [access, setAccess] = useState<Access>({ state: 'checking' });

  const check = useCallback(async () => {
    setAccess({ state: 'checking' });
    const [member, admin] = await Promise.all([isSalesMember(), checkIsPlatformAdmin()]);
    if (member.error !== null) { setAccess({ state: 'error', message: member.error }); return; }
    setAccess({ state: 'ready', member: member.data === true, admin });
  }, []);

  useEffect(() => {
    if (uid === null) return;
    void check();
  }, [uid, check]);

  if (loading) return <Skeleton />;
  if (session === null || uid === null) return <SignInCard />;
  if (access.state === 'checking') return <Skeleton />;
  if (access.state === 'error') {
    return (
      <Card>
        <h2 className="font-serif text-2xl text-foil-static">Couldn’t open the CRM</h2>
        <p role="alert" className="mt-2 font-sans text-sm text-brand-muted leading-relaxed">{access.message}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => void check()} className={btnPrimary}>
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <button type="button" onClick={() => void signOut()} className={btnQuiet}>
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </Card>
    );
  }
  if (!access.member) return <NotMember email={email} />;
  return <CrmWorkspace userId={uid} userEmail={email} isAdmin={access.admin} />;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <div className="liquid-glass-raised rounded-3xl p-6 sm:p-8">{children}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" aria-busy="true" aria-label="Loading the CRM">
      <div className="liquid-glass rounded-3xl p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-white/[0.06] motion-safe:animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-white/[0.07] motion-safe:animate-pulse" />
          <div className="h-3 w-56 rounded bg-white/[0.05] motion-safe:animate-pulse" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="liquid-glass rounded-2xl h-20 motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function SignInCard() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (email.trim() === '' || password === '') { setError('Enter your email and password.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await signInWithEmail(email.trim(), password);
      // On success useSession picks the new session up; nothing else to do.
      if (err !== null) {
        setError(/invalid login/i.test(err.message) ? 'That email and password don’t match.' : err.message);
      }
    } catch {
      setError('Can’t reach Beamwall right now — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className="inline-flex w-10 h-10 items-center justify-center rounded-2xl bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]">
          <Lock className="w-4 h-4" aria-hidden="true" />
        </span>
        <h2 className="font-serif text-2xl text-foil-static">Sign in to the CRM</h2>
      </div>
      <p className="mt-3 font-sans text-sm text-brand-muted leading-relaxed">
        The decks are open, but this list holds real people’s contact details — so it sits behind your Beamwall sign-in.
      </p>
      <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-3.5" noValidate>
        <Field label="Email">
          {(a) => (
            <input {...a} type="email" autoComplete="email" inputMode="email" value={email}
              onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" />
          )}
        </Field>
        <Field label="Password">
          {(a) => (
            <input {...a} type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          )}
        </Field>
        {error !== null && <p role="alert" className="font-sans text-xs text-amber-300">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="mt-4 flex flex-col gap-2 font-sans text-xs text-brand-muted">
        <a href="/forgot-password" className="underline-offset-4 hover:underline hover:text-brand-fg min-h-11 inline-flex items-center w-fit">
          Forgot password?
        </a>
        <p className="leading-relaxed">
          No account yet? Create one at{' '}
          <a href="/signup" className="text-brand-fg underline underline-offset-4">/signup</a>, then ask Dapo to add you.
        </p>
      </div>
    </Card>
  );
}

function NotMember({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card>
      <h2 className="font-serif text-2xl text-foil-static">Almost there</h2>
      <p className="mt-3 font-sans text-sm text-brand-muted leading-relaxed">
        You’re signed in as <span className="text-brand-fg break-all">{email}</span> but not on the sales team yet.
        Send Dapo this email address and he’ll add you — then refresh.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            void copyText(email).then((ok) => {
              setCopied(ok);
              if (ok) setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy my email'}
        </button>
        <button type="button" onClick={() => void signOut()} className={btnQuiet}>
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </Card>
  );
}
