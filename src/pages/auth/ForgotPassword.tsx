/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Forgot password" — collects an email and sends a Supabase recovery link
 * that returns to /reset-password. Matches the Login page's premium glass look.
 * We always show the same confirmation whether or not the email exists, so the
 * form can't be used to probe which addresses have accounts.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { sendPasswordReset } from '../../lib/auth';
import { usePageTitle } from '../../lib/usePageTitle';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

export default function ForgotPassword() {
  usePageTitle('Reset your password — Beamwall');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await sendPasswordReset(email.trim());
      // Only surface configuration/network errors — never "no such user",
      // which Supabase doesn't return here anyway (it succeeds either way).
      if (err) {
        setError(err.message);
        return;
      }
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-full w-full app-bg flex items-center justify-center px-5 py-12 overflow-y-auto">
      <div className="w-full max-w-sm animate-rise-in">
        <div className="glass-strong rounded-3xl px-8 py-10 shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
          <Link
            to="/"
            className="block text-center font-serif text-4xl font-semibold tracking-wide text-foil-static"
          >
            Beamwall
          </Link>

          {sent ? (
            <div className="mt-8 flex flex-col items-center text-center">
              <MailCheck className="h-10 w-10 text-accent" />
              <h1 className="mt-4 font-serif text-2xl text-brand-fg">Check your email</h1>
              <p className="mt-2 text-sm leading-relaxed text-brand-muted/70">
                If an account exists for <span className="text-brand-fg">{email.trim()}</span>, we’ve sent a
                link to reset your password. It expires shortly, so use it soon.
              </p>
              <Link
                to="/login"
                className="mt-8 w-full rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-center font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-2 text-center font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">
                Reset your password
              </p>
              <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Email</span>
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

                {error && (
                  <p role="alert" className="text-sm text-red-400">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-1 w-full rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="mt-7 text-center text-sm text-brand-muted/70">
                Remembered it?{' '}
                <Link to="/login" className="text-accent underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
