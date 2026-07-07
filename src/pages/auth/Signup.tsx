/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform signup page. On success shows a "check your email" state
 * (Supabase default email confirmation); confirmed users land at /host.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { signUpWithEmail } from '../../lib/auth';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

export default function Signup() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await signUpWithEmail(email.trim(), password, displayName.trim());
      if (err) {
        setError(err.message);
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full app-bg flex items-center justify-center px-5 py-12 overflow-y-auto">
      <div className="w-full max-w-sm animate-rise-in">
        <div className="glass-strong rounded-3xl px-8 py-10 shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
          <Link
            to="/"
            className="block text-center font-serif text-4xl font-semibold tracking-wide text-foil-static"
          >
            Beamwall
          </Link>

          {submitted ? (
            <div className="mt-8 text-center">
              <p className="font-label uppercase tracking-luxe text-[10px] text-accent">
                One last step
              </p>
              <h2 className="mt-3 font-serif text-2xl text-brand-fg">Check your email</h2>
              <p className="mt-3 text-sm leading-relaxed text-brand-muted/80">
                We sent a confirmation link to{' '}
                <span className="text-brand-fg">{email.trim()}</span>. Click it to activate your
                account — once confirmed, you&rsquo;ll land in your studio at{' '}
                <span className="text-accent">/host</span>.
              </p>
              <p className="mt-6 text-sm text-brand-muted/60">
                Already confirmed?{' '}
                <Link to="/login" className="text-accent underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-center font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">
                Create your event studio
              </p>

              <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">
                    Display name
                  </span>
                  <input
                    type="text"
                    required
                    autoComplete="name"
                    maxLength={80}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Alex Rivera"
                    className={inputClass}
                  />
                </label>

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
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
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
                  {submitting ? 'Creating account…' : 'Create account'}
                </button>
              </form>

              <p className="mt-7 text-center text-sm text-brand-muted/70">
                Already have an account?{' '}
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
