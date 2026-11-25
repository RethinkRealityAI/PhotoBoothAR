/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/connector — the Claude connector (the beamwall-mcp server).
 *
 * Mint a key, paste the URL into Claude once, and Claude can make routine
 * platform changes (events, assets, looks, challenges, library actions)
 * without a code deploy. The key is shown ONCE: the database keeps only its
 * SHA-256. Below the keys, the change log shows every call Claude made, so
 * nothing it does is invisible.
 *
 * All reads and writes go through the four admin RPCs of migration 056
 * (each asserts is_platform_admin first); the tables have no client policies.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Plug, ShieldAlert, X } from 'lucide-react';
import { AdminHeader, AdminPage, RefreshButton } from './AdminChrome';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/adminFormat';
import { useToast } from '../../components/ui/Toast';
import LoadError from '../../components/ui/LoadError';
import {
  ACCESS_PRESETS, DEFAULT_PRESET, EXPIRY_OPTIONS, connectorBaseUrl, connectorUrl, keyState, scopeSummary,
  toolLabel, type AccessPreset,
} from '../../lib/mcpConnector';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface KeyRow {
  id: string;
  label: string;
  tokenHint: string;
  ownerEmail: string | null;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  revokedAt: string | null;
}

interface ChangeRow {
  id: number;
  createdAt: string;
  tool: string;
  status: 'ok' | 'error' | 'refused' | 'dry_run';
  eventSlug: string | null;
  targetId: string | null;
  error: string | null;
  revertedBy: number | null;
  tokenLabel: string | null;
}

const STATUS_STYLE: Record<ChangeRow['status'], { label: string; cls: string }> = {
  ok: { label: 'Done', cls: 'bg-emerald-500/15 text-emerald-300' },
  dry_run: { label: 'Preview', cls: 'bg-sky-500/15 text-sky-300' },
  refused: { label: 'Refused', cls: 'bg-amber-500/15 text-amber-300' },
  error: { label: 'Failed', cls: 'bg-rose-500/15 text-rose-300' },
};

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (permissions / insecure context): the field stays selectable.
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <input
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 min-h-11 rounded-xl bg-black/30 border border-white/10 px-3 font-mono text-[12px] text-brand-fg outline-none"
      />
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="pressable flex items-center gap-1.5 min-h-11 rounded-xl bg-white/[0.08] px-4 font-sans text-sm text-brand-fg hover:bg-white/[0.12] shrink-0"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function Connector() {
  const { push } = useToast();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [label, setLabel] = useState('Claude');
  const [preset, setPreset] = useState<AccessPreset['id']>(DEFAULT_PRESET);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  /** The freshly minted key — held in memory only, never stored. */
  const [minted, setMinted] = useState<{ token: string; label: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [k, c] = await Promise.all([
      supabase.rpc('mcp_list_tokens'),
      supabase.rpc('mcp_list_audit', { p_limit: 50 }),
    ]);
    const err = k.error ?? c.error;
    setLoadError(err ? (err.message || 'load_failed') : null);
    setKeys(((k.data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      id: r.id as string,
      label: r.label as string,
      tokenHint: r.token_hint as string,
      ownerEmail: (r.owner_email as string | null) ?? null,
      scopes: (r.scopes as string[]) ?? [],
      createdAt: r.created_at as string,
      expiresAt: (r.expires_at as string | null) ?? null,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      useCount: (r.use_count as number) ?? 0,
      revokedAt: (r.revoked_at as string | null) ?? null,
    })));
    setChanges(((c.data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      id: r.id as number,
      createdAt: r.created_at as string,
      tool: r.tool as string,
      status: r.status as ChangeRow['status'],
      eventSlug: (r.event_slug as string | null) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      error: (r.error as string | null) ?? null,
      revertedBy: (r.reverted_by as number | null) ?? null,
      tokenLabel: (r.token_label as string | null) ?? null,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const mint = async () => {
    const name = label.trim();
    if (!name) return;
    setBusy(true);
    const scopes = ACCESS_PRESETS.find((p) => p.id === preset)!.scopes;
    const { data, error } = await supabase.rpc('mcp_issue_token', { p_label: name, p_scopes: scopes, p_days: days });
    setBusy(false);
    const row = Array.isArray(data) ? (data[0] as { token?: string } | undefined) : undefined;
    if (error || !row?.token) {
      push(error?.message?.includes('too_many_tokens') ? 'You already have 20 active keys. Revoke one first.' : 'Could not create a key.', 'error');
      return;
    }
    setMinted({ token: row.token, label: name });
    load();
  };

  const revoke = async (k: KeyRow) => {
    setRevoking(k.id);
    const { error } = await supabase.rpc('mcp_revoke_token', { p_id: k.id });
    setRevoking(null);
    if (error) {
      push('Could not revoke that key.', 'error');
      return;
    }
    push(`“${k.label}” revoked. Claude can no longer use it.`, 'success');
    load();
  };

  const activeCount = keys.filter((k) => keyState(k) === 'active').length;

  return (
    <AdminPage>
      <AdminHeader
        title="Claude connector"
        subtitle="Let Claude create events, upload assets and adjust looks directly, with every change logged and undoable."
        note={loading ? 'Loading…' : `${activeCount} active key${activeCount === 1 ? '' : 's'}`}
        actions={<RefreshButton onClick={load} busy={loading} />}
      />
      <div className="max-w-3xl flex flex-col gap-6">
        {loadError && <LoadError what="connector keys" code={loadError} onRetry={load} />}

        {minted && (
          <section className="glass-strong rounded-2xl p-5 border border-[color:var(--color-accent)]/40" aria-live="polite">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-sans text-base font-semibold text-brand-fg">Your connector link for “{minted.label}”</h2>
                <p className="font-sans text-sm text-brand-muted mt-1">
                  Copy it now. It is shown only once; if you lose it, revoke it and make another.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMinted(null)}
                aria-label="Hide the key"
                className="pressable grid place-items-center w-11 h-11 rounded-xl bg-white/[0.04] text-brand-muted shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <CopyField value={connectorUrl(SUPABASE_URL, minted.token)} label="connector link" />
            <ol className="mt-4 list-decimal pl-5 font-sans text-sm text-brand-muted space-y-1">
              <li>In Claude, open Settings → Connectors → Add custom connector.</li>
              <li>Name it “Beamwall” and paste the link above as the URL. Leave the OAuth fields empty.</li>
              <li>In a chat or project, turn the Beamwall connector on and ask, for example: “Create a test event called Gold Night and add a gold frame.”</li>
            </ol>
            <details className="mt-3">
              <summary className="cursor-pointer font-sans text-sm text-brand-muted min-h-11 flex items-center">Using Claude Code or a desktop config instead?</summary>
              <p className="font-sans text-sm text-brand-muted mb-2">Use the base URL and send the key as a header:</p>
              <CopyField
                value={`claude mcp add --transport http beamwall ${connectorBaseUrl(SUPABASE_URL)} --header "Authorization: Bearer ${minted.token}"`}
                label="Claude Code command"
              />
            </details>
          </section>
        )}

        <section className="glass rounded-2xl p-5">
          <h2 className="flex items-center gap-2 font-sans text-base font-semibold text-brand-fg mb-4">
            <KeyRound className="w-4 h-4" aria-hidden /> Create a key
          </h2>
          <label className="block font-sans text-sm text-brand-muted mb-1" htmlFor="mcp-label">Name</label>
          <input
            id="mcp-label"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Claude (Dapo's projects)"
            className="w-full min-h-11 rounded-xl bg-white/[0.06] border border-white/10 px-4 font-sans text-sm text-brand-fg placeholder:text-brand-muted/60 outline-none focus:border-[color:var(--color-accent)]/60 mb-4"
          />
          <fieldset className="mb-4">
            <legend className="font-sans text-sm text-brand-muted mb-2">What Claude may do</legend>
            <div className="grid gap-2">
              {ACCESS_PRESETS.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${preset === p.id ? 'border-[color:var(--color-accent)]/60 bg-white/[0.06]' : 'border-white/10 hover:bg-white/[0.03]'}`}
                >
                  <input
                    type="radio"
                    name="mcp-preset"
                    checked={preset === p.id}
                    onChange={() => setPreset(p.id)}
                    className="mt-1 accent-[color:var(--color-accent)]"
                  />
                  <span>
                    <span className="block font-sans text-sm font-semibold text-brand-fg">{p.label}</span>
                    <span className="block font-sans text-[13px] text-brand-muted">{p.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <label className="font-sans text-sm text-brand-muted">
              <span className="block mb-1">Expires after</span>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="min-h-11 rounded-xl bg-white/[0.06] border border-white/10 px-3 font-sans text-sm text-brand-fg outline-none"
              >
                {EXPIRY_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={mint}
              disabled={busy || !label.trim()}
              className="pressable flex items-center gap-1.5 min-h-11 rounded-full bg-foil px-5 font-sans text-sm font-semibold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98] disabled:opacity-40"
            >
              <Plug className="w-4 h-4" /> {busy ? 'Creating…' : 'Create connector link'}
            </button>
          </div>
          <p className="mt-4 flex items-start gap-2 font-sans text-[13px] text-brand-muted">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            Anyone with the link can act as you within its access, so keep it private. Removing you as an admin also stops your keys.
          </p>
        </section>

        <section>
          <h2 className="font-sans text-base font-semibold text-brand-fg mb-3">Keys</h2>
          {loading ? (
            <div className="h-16 glass rounded-2xl motion-safe:animate-pulse" />
          ) : keys.length === 0 ? (
            loadError ? null : <p className="glass rounded-2xl p-6 text-center font-sans text-sm text-brand-muted/80">No keys yet. Create one above to connect Claude.</p>
          ) : (
            <div className="glass rounded-2xl divide-y divide-white/[0.06]">
              {keys.map((k) => {
                const state = keyState(k);
                return (
                  <div key={k.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="font-sans text-sm text-brand-fg truncate">
                        {k.label}
                        <span className="ml-2 font-mono text-[11px] text-brand-muted/70">…{k.tokenHint}</span>
                        {state !== 'active' && (
                          <span className="ml-2 rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-brand-muted">{state === 'revoked' ? 'Revoked' : 'Expired'}</span>
                        )}
                      </p>
                      <p className="font-sans text-[12px] text-brand-muted/80">
                        {scopeSummary(k.scopes)} · {k.useCount} call{k.useCount === 1 ? '' : 's'}
                        {k.lastUsedAt ? ` · last used ${formatDate(k.lastUsedAt)}` : ' · never used'}
                        {k.expiresAt && state === 'active' ? ` · expires ${formatDate(k.expiresAt)}` : ''}
                      </p>
                    </div>
                    {state === 'active' && (
                      <button
                        type="button"
                        onClick={() => revoke(k)}
                        disabled={revoking === k.id}
                        className="pressable min-h-11 rounded-full border border-white/15 px-4 font-sans text-sm text-brand-muted hover:text-amber-300 hover:border-amber-400/40 disabled:opacity-40 shrink-0"
                      >
                        {revoking === k.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-sans text-base font-semibold text-brand-fg mb-1">What Claude changed</h2>
          <p className="font-sans text-[13px] text-brand-muted mb-3">The latest 50 calls. Ask Claude to “undo change 42” to reverse one.</p>
          {loading ? (
            <div className="h-16 glass rounded-2xl motion-safe:animate-pulse" />
          ) : changes.length === 0 ? (
            loadError ? null : <p className="glass rounded-2xl p-6 text-center font-sans text-sm text-brand-muted/80">Nothing yet.</p>
          ) : (
            <div className="glass rounded-2xl divide-y divide-white/[0.06]">
              {changes.map((c) => {
                const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.error;
                return (
                  <div key={c.id} className="px-5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-brand-muted/70">#{c.id}</span>
                      <span className="font-sans text-sm text-brand-fg">{toolLabel(c.tool)}</span>
                      {c.eventSlug && <span className="font-mono text-[12px] text-brand-muted">{c.eventSlug}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-sans ${st.cls}`}>{st.label}</span>
                      {c.revertedBy !== null && <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-brand-muted">Undone by #{c.revertedBy}</span>}
                    </div>
                    <p className="font-sans text-[12px] text-brand-muted/80 mt-0.5">
                      {formatDate(c.createdAt)}{c.tokenLabel ? ` · ${c.tokenLabel}` : ''}
                      {c.error ? ` · ${c.error}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
