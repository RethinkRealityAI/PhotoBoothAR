/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin wrappers over supabase.auth for the platform (host signup/login),
 * plus a `useSession()` hook that stays subscribed to auth state changes.
 */
import { useEffect, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Where confirmed / OAuth-redirected users land after auth completes. */
const HOST_REDIRECT = () => `${window.location.origin}/host`;

/**
 * Email + password signup. `displayName` is stored in user metadata; the
 * `handle_new_user` DB trigger copies it into public.profiles.
 * With Supabase's default email confirmation on, the returned session is null
 * until the user clicks the confirmation link.
 */
export function signUpWithEmail(email: string, password: string, displayName: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: HOST_REDIRECT(),
    },
  });
}

/** Email + password sign-in. */
export function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

/** Google OAuth — navigates away to the provider, then back to /host. */
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: HOST_REDIRECT() },
  });
}

/** Sign out of the current session. */
export function signOut() {
  return supabase.auth.signOut();
}

/**
 * Send a password-reset email. The link returns the user to /reset-password
 * with a short-lived recovery session (implicit flow, detectSessionInUrl),
 * where they set a new password via `updatePassword`.
 */
export function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
}

/** Set a new password for the currently-authenticated (or recovery) session. */
export function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

/** Current session, or null when signed out. */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Subscribe to auth state changes. Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

/**
 * React hook: the live Supabase session. `loading` is true only until the
 * initial session fetch resolves; afterwards `session` tracks auth changes.
 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSession().then((s) => {
      if (active) {
        setSession(s);
        setLoading(false);
      }
    });
    const unsubscribe = onAuthStateChange((_event, s) => {
      if (active) {
        setSession(s);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { session, loading };
}
