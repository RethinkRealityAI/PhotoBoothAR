/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The owner's "AI tools for hosts" switch (migration 054,
 * `platform_settings.ai_for_hosts`). Platform admins always keep AI; this
 * decides whether every other host gets it too. Writes straight to the table —
 * its RLS policy is is_platform_admin(), so no customer can ever match it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { refreshAiAccess } from '../../lib/aiAccess';
import { useToast } from '../ui/Toast';

type State = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; on: boolean };

export default function AiHostsSwitch() {
  const toast = useToast();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'ai_for_hosts')
      .maybeSingle();
    if (error) {
      console.error('[AiHostsSwitch] read', error);
      setState({ phase: 'error' });
      return;
    }
    // A missing row reads as OFF, exactly like ai_allowed_for.
    setState({ phase: 'ready', on: (data as { value?: unknown } | null)?.value === true });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const flip = async (next: boolean) => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('platform_settings')
      .update({ value: next, updated_by: u.user?.id ?? null })
      .eq('key', 'ai_for_hosts')
      .select('value');
    setSaving(false);
    // RLS turns a refused write into ZERO rows, not an error — check both.
    if (error || !data || data.length !== 1) {
      console.error('[AiHostsSwitch] write', error ?? 'no row updated');
      toast.push('Couldn’t change the AI switch. Nothing was changed.', 'error');
      return;
    }
    setState({ phase: 'ready', on: next });
    void refreshAiAccess();
    toast.push(next ? 'AI tools are now on for every host.' : 'AI tools are now off for hosts. Admins keep them.', 'success');
  };

  const on = state.phase === 'ready' && state.on;

  return (
    <section className="liquid-glass rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-4" aria-labelledby="ai-hosts-title">
      <Sparkles className="w-5 h-5 shrink-0 text-[color:var(--color-accent)]" aria-hidden />
      <div className="flex-1 min-w-[14rem]">
        <h2 id="ai-hosts-title" className="font-sans text-sm font-semibold text-brand-fg">AI tools for hosts</h2>
        <p className="font-sans text-xs text-brand-muted/70 mt-0.5 leading-relaxed">
          AI frames, AI 3D props, the Concierge and Copilot chat, and the Studio Director.
          Platform admins always keep them. Guests’ AI photo checks are not affected.
        </p>
      </div>
      {state.phase === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-brand-muted/60" aria-label="Loading" />}
      {state.phase === 'error' && (
        <button onClick={() => void load()} className="pressable rounded-full px-4 min-h-11 text-xs liquid-glass text-brand-fg">
          Couldn’t load. Retry
        </button>
      )}
      {state.phase === 'ready' && (
        <div role="radiogroup" aria-label="AI tools for hosts" className="flex gap-1.5 rounded-full bg-white/[0.04] p-1">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              role="radio"
              aria-checked={on === v}
              disabled={saving || on === v}
              onClick={() => void flip(v)}
              className={`pressable rounded-full px-4 min-h-11 font-label uppercase tracking-luxe text-[11px] transition-colors ${
                on === v ? 'bg-[color:var(--color-accent)]/20 text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg'
              }`}
            >
              {v ? 'On for hosts' : 'Admins only'}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
