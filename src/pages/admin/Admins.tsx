/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/admins — the platform-admin roster. Add resolves an existing user by
 * email or invites a new one; remove is blocked for self and for the last
 * remaining admin (canRemoveAdmin pre-checks client-side so the button reads
 * as disabled rather than erroring after a round-trip — admin-api enforces
 * the same guard server-side regardless).
 */
import { useEffect, useMemo, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { AdminHeader, AdminPage, RefreshButton } from './AdminChrome';
import { fetchAdmins, addAdmin, removeAdmin, type AdminRow } from '../../lib/admin';
import { useSession } from '../../lib/auth';
import { formatDate } from '../../lib/adminFormat';
import { canRemoveAdmin } from '../../lib/adminAuth';
import { registryNote } from './registryNote';
import { useToast } from '../../components/ui/Toast';
import LoadError from '../../components/ui/LoadError';

export default function Admins() {
  const { session } = useSession();
  const { push } = useToast();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** Non-null when the last load failed — the list below is then not
   *  "no results", it is an unknown. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await fetchAdmins();
    setLoadError(error);
    setAdmins(data?.admins ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const actorUserId = session?.user?.id ?? '';

  const submitAdd = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    const { data, error } = await addAdmin(trimmed);
    setBusy(false);
    if (error) {
      push(error === 'already_admin' ? 'That person is already an admin.' : 'Could not add that admin.', 'error');
      return;
    }
    push(data?.invited ? `Invited ${trimmed} — they'll get an email to set up their account.` : `${trimmed} is now a platform admin.`, 'success');
    setEmail('');
    load();
  };

  const doRemove = async (admin: AdminRow) => {
    setRemovingId(admin.userId);
    const { error } = await removeAdmin(admin.userId);
    setRemovingId(null);
    if (error) {
      push(
        error === 'cannot_remove_self' ? "You can't remove yourself." :
        error === 'cannot_remove_last_admin' ? 'At least one admin must remain.' :
        'Could not remove this admin.',
        'error',
      );
      return;
    }
    setAdmins((list) => list.filter((a) => a.userId !== admin.userId));
    push(`${admin.email ?? 'Admin'} removed.`, 'success');
  };

  const totalAdmins = admins.length;

  return (
    <AdminPage>
      <AdminHeader
        title="Admins"
        subtitle="People who can open this admin suite. Add someone by email; new people get an invite."
        note={loading ? 'Loading…' : registryNote(totalAdmins, 'platform admin')}
        actions={<RefreshButton onClick={load} busy={loading} />}
      />
      <div className="max-w-3xl">

      {loadError && <LoadError what="platform admins" code={loadError} onRetry={load} />}

      <div className="flex items-center gap-2 mb-6">
        <input
          type="email"
          aria-label="Email of the person to make an admin"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); }}
          placeholder="email@example.com"
          className="flex-1 min-w-0 min-h-11 rounded-xl bg-white/[0.06] border border-white/10 px-4 font-sans text-sm text-brand-fg placeholder:text-brand-muted/60 outline-none focus:border-[color:var(--color-accent)]/60"
        />
        <button
          onClick={submitAdd}
          disabled={busy || !email.trim()}
          className="pressable flex items-center gap-1.5 min-h-11 rounded-full bg-foil px-5 font-sans text-sm font-semibold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98] disabled:opacity-40 shrink-0"
        >
          <UserPlus className="w-4 h-4" /> {busy ? 'Adding…' : 'Add admin'}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 glass rounded-2xl motion-safe:animate-pulse" />)}
        </div>
      ) : admins.length === 0 ? (
        // Only reachable on a failed read (the signed-in admin is always on the
        // list), which the alert above already explains.
        loadError ? null : <p className="glass rounded-2xl p-8 text-center font-sans text-sm text-brand-muted/75">No admins listed.</p>
      ) : (
        <div className="glass rounded-2xl divide-y divide-white/[0.06]">
          {admins.map((a) => {
            const check = canRemoveAdmin({ actorUserId, targetUserId: a.userId, totalAdmins });
            const busyRow = removingId === a.userId;
            return (
              <div key={a.userId} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="font-sans text-sm text-brand-fg truncate">
                    {a.displayName || a.email || a.userId}
                    {a.userId === actorUserId && <span className="ml-2 text-[11px] text-brand-muted/70">(you)</span>}
                  </p>
                  {a.displayName && a.email && <p className="font-mono text-[11px] text-brand-muted/75 truncate">{a.email}</p>}
                  <p className="font-sans text-[11px] text-brand-muted/65">
                    Added {formatDate(a.createdAt)}{a.addedByEmail ? ` by ${a.addedByEmail}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => doRemove(a)}
                  disabled={!check.ok || busyRow}
                  title={check.reason === 'cannot_remove_self' ? "You can't remove yourself" : check.reason === 'cannot_remove_last_admin' ? 'At least one admin must remain' : 'Remove'}
                  aria-label={`Remove ${a.email ?? a.displayName ?? 'this admin'} as an admin`}
                  className="pressable grid place-items-center w-11 h-11 rounded-xl bg-white/[0.04] hover:bg-amber-500/15 text-brand-muted/70 hover:text-amber-300 transition-colors disabled:opacity-30 disabled:hover:bg-white/[0.04] disabled:hover:text-brand-muted/70 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </AdminPage>
  );
}
