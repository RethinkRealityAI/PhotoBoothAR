/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform sign-in page. Neutral premium look (dark, centered glass card,
 * accent-gradient "Beamwall" wordmark) — this is the platform, not an event.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithEmail, signInWithGoogle, resendConfirmation } from '../../lib/auth';
import { usePageTitle } from '../../lib/usePageTitle';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

export default function Login() {
  usePageTitle('Sign in — Beamwall');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** The sign-in failed specifically because the address is unconfirmed. */
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await signInWithEmail(email.trim(), password);
      if (err) {
        // Raw Supabase strings ("Invalid login credentials", "Email not
        // confirmed") were shown verbatim, naming no recovery step.
        const raw = err.message.toLowerCase();
        if (raw.includes('not confirmed')) {
          setNeedsConfirmation(true);
          setError('This email hasn’t been confirmed yet — check your inbox for the link.');
        } else if (raw.includes('invalid login')) {
          setError('That email and password don’t match. Check them, or use the “Forgot password?” link.');
        } else {
          setError(err.message);
        }
        return;
      }
      navigate('/host');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  /** Offer a resend when the account exists but was never confirmed — there
   *  was previously no in-app way out of that state at all. */
  async function handleResend() {
    setResendState('sending');
    const { error: err } = await resendConfirmation(email.trim());
    setResendState(err ? 'error' : 'sent');
  }

  async function handleGoogle() {
    if (googleLoading) return;
    setError(null);
    setGoogleLoading(true);
    try {
      const { error: err } = await signInWithGoogle();
      if (err) {
        setError(err.message);
        setGoogleLoading(false);
      }
      // On success the browser navigates away to Google — keep the spinner.
    } catch {
      setError('Something went wrong. Please try again.');
      setGoogleLoading(false);
    }
  }

  // items-start + my-auto rather than items-center: inside an h-screen
  // overflow-hidden shell, a centred card taller than the viewport pushes
  // its own top out of reach and cannot be scrolled back to.
  return (
    <div className="h-full w-full app-bg flex items-start justify-center px-5 py-12 overflow-y-auto">
      <div className="w-full max-w-sm my-auto animate-rise-in">
        <div className="glass-strong rounded-3xl px-8 py-10 shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
          <Link
            to="/"
            className="block text-center font-serif text-4xl font-semibold tracking-wide text-foil-static"
          >
            Beamwall
          </Link>
          {/* The page had no h1 at all — no title for a screen reader, and the
              first heading on the page was an h2. */}
          <h1 className="mt-2 text-center font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">
            Sign in to your studio
          </h1>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">
                Email
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">
                Password
              </span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </label>

            <Link
              to="/forgot-password"
              className="-mt-1 self-end text-xs text-brand-muted/60 underline-offset-4 transition hover:text-brand-fg hover:underline"
            >
              Forgot password?
            </Link>

            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            {needsConfirmation && (
              <div className="rounded-xl bg-white/[0.04] px-4 py-3">
                {resendState === 'sent' ? (
                  <p role="status" className="text-sm text-brand-muted/80">
                    Sent — check {email.trim()} for a fresh confirmation link.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendState === 'sending'}
                    className="min-h-11 font-label uppercase tracking-luxe text-[10px] text-accent disabled:opacity-60"
                  >
                    {resendState === 'sending' ? 'Sending…' : 'Send me a new confirmation link'}
                  </button>
                )}
                {resendState === 'error' && (
                  <p role="alert" className="mt-1 text-xs text-amber-300/90">
                    That didn’t send. Try again in a moment.
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
              or
            </span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {googleLoading ? 'Redirecting…' : 'Continue with Google'}
          </button>

          <p className="mt-7 text-center text-sm text-brand-muted/70">
            New here?{' '}
            <Link to="/signup" className="text-accent underline-offset-4 hover:underline">
              Create your event
            </Link>
          </p>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-brand-muted/50">
            By continuing you agree to the{' '}
            <Link to="/terms" className="underline underline-offset-2 hover:text-brand-fg">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-brand-fg">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
