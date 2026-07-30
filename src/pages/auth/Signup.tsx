/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform signup page. On success shows a "check your email" state
 * (Supabase default email confirmation); confirmed users land at /host.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { signUpWithEmail, resendConfirmation } from '../../lib/auth';
import { usePageTitle } from '../../lib/usePageTitle';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

export default function Signup() {
  usePageTitle('Create your account — Beamwall');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: err } = await signUpWithEmail(email.trim(), password, displayName.trim(), promoCode);
      if (err) {
        setError(err.message);
        return;
      }
      // Supabase's anti-enumeration behavior: signing up again with an email
      // that already has a CONFIRMED account returns 200/no error but an
      // obfuscated user object with an empty `identities` array, and sends
      // no email. A populated `identities` array means a real new signup.
      if (data.user && data.user.identities?.length === 0) {
        setAlreadyRegistered(true);
      } else {
        setSubmitted(true);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  /** Same three-state resend as Login: confirmation emails go missing, and
   *  the "check your email" screen was previously a dead end when they did. */
  async function handleResend() {
    setResendState('sending');
    const { error: err } = await resendConfirmation(email.trim());
    setResendState(err ? 'error' : 'sent');
  }

  // See Login: a centred card taller than the viewport loses its own top.
  // This one has four fields, so it is the likelier of the two to overflow.
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

          {alreadyRegistered ? (
            <div className="mt-8 text-center">
              <p className="font-label uppercase tracking-luxe text-[10px] text-accent">
                Already have an account
              </p>
              <h2 className="mt-3 font-serif text-2xl text-brand-fg">
                That email&rsquo;s already confirmed
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-brand-muted/80">
                <span className="text-brand-fg">{email.trim()}</span> already has an account —
                we didn&rsquo;t send a new email. Sign in below, or reset your password if you
                don&rsquo;t remember it.
              </p>
              <div className="mt-6 flex flex-col items-center gap-2 text-sm">
                <Link to="/login" className="text-accent underline-offset-4 hover:underline">
                  Sign in
                </Link>
                <Link
                  to="/forgot-password"
                  className="text-brand-muted/60 underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            </div>
          ) : submitted ? (
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
              {promoCode.trim() !== '' && (
                <p className="mt-3 text-sm leading-relaxed text-brand-muted/80">
                  Promo code <span className="text-accent">{promoCode.trim()}</span> will be
                  applied when you create your first event.
                </p>
              )}
              <div className="mt-6 rounded-xl bg-white/[0.04] px-4 py-3">
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
              <p className="mt-6 text-sm text-brand-muted/60">
                Already confirmed?{' '}
                <Link to="/login" className="text-accent underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          ) : (
            <>
              {/* The page had no h1; its first heading was an h2. The wording
                  also matches the CTA that brings people here — this action was
                  called four different things across the funnel. */}
              <h1 className="mt-2 text-center font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">
                Create your event
              </h1>

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
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${inputClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 flex items-center px-4 text-brand-muted/50 hover:text-brand-fg transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {/* Same requirement ResetPassword enforces (MIN_LENGTH 8) —
                      stated up front instead of discovered on submit. */}
                  <span
                    className={`font-sans text-[10px] ${
                      password.length > 0 && password.length < 8 ? 'text-amber-300/90' : 'text-brand-muted/40'
                    }`}
                  >
                    Use at least 8 characters.
                  </span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">
                    Promo code <span className="text-brand-muted/40">(optional)</span>
                  </span>
                  <input
                    type="text"
                    autoComplete="off"
                    maxLength={40}
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    placeholder="Have a code? Enter it for bonus credits"
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

              <p className="mt-5 text-center text-sm text-brand-muted/70">
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
