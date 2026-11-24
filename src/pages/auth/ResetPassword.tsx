/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Set a new password" — where the recovery link lands. The Supabase client
 * establishes a short-lived recovery session from the URL on load
 * (detectSessionInUrl); the user picks a new password and we call updateUser.
 * We always render the form and let updateUser report an invalid/expired link,
 * which sidesteps a race with the async session-from-URL detection.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { updatePassword } from '../../lib/auth';
import { usePageTitle } from '../../lib/usePageTitle';
import AuthShell from './AuthShell';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

const MIN_LENGTH = 8;

export default function ResetPassword() {
  usePageTitle('Set a new password — Beamwall');
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: err } = await updatePassword(password);
      if (err) {
        // A missing/expired recovery session is the common failure here.
        if (/session|expired|token|missing/i.test(err.message)) {
          setExpired(true);
        } else {
          setError(err.message);
        }
        return;
      }
      // Recovery leaves the user signed in — take them straight to their studio.
      navigate('/host');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Same frame as sign-in (AuthShell: Beamy beside the card on desktop, a
    // compact peek above it on phones), so the recovery pages stop looking
    // like a different product from the page that links to them.
    <AuthShell page="reset">
      <div className="w-full animate-rise-in">
        <div className="glass-strong rounded-3xl px-6 py-7 sm:px-8 sm:py-10 shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
          <Link
            to="/"
            className="block text-center font-serif text-4xl font-semibold tracking-wide text-foil-static"
          >
            Beamwall
          </Link>

          {expired ? (
            <div className="mt-8 text-center">
              <h1 className="font-serif text-2xl text-brand-fg">Link expired</h1>
              <p className="mt-2 text-sm leading-relaxed text-brand-muted/70">
                This reset link is invalid or has expired. Request a fresh one and try again.
              </p>
              <Link
                to="/forgot-password"
                className="mt-8 block w-full rounded-full bg-foil px-6 py-3.5 text-center font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
              >
                Send a new link
              </Link>
            </div>
          ) : (
            <>
              {/* The page's title (it had no h1 at all), styled like sign-in's. */}
              <h1 className="mt-2 text-center font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">
                Choose a new password
              </h1>
              <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">
                    New password
                  </span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputClass}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">
                    Confirm password
                  </span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
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
                  {submitting ? 'Saving…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
