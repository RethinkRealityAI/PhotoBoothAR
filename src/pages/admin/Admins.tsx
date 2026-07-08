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
import { RefreshCw, UserPlus, X } from 'lucide-react';
import { fetchAdmins, addAdmin, removeAdmin, type AdminRow } from '../../lib/admin';
import { useSession } from '../../lib/auth';
import { formatDate } from '../../lib/adminFormat';
import { canRemoveAdmin } from '../../lib/adminAuth';
import { useToast } from '../../components/ui/Toast';

export default function Admins() {
  const { session } = useSession();
  const { push } = useToast();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await fetchAdmins();
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
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Admins</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">{totalAdmins} platform admin{totalAdmins === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="flex items-center gap-2 mb-6">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); }}
          placeholder="email@example.com"
          className="flex-1 rounded-xl bg-white/[0.04] border border-white/10 px-4 py-2.5 font-sans text-sm text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-white/20"
        />
        <button
          onClick={submitAdd}
          disabled={busy || !email.trim()}
          className="flex items-center gap-1.5 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-noir-900 glow-accent transition active:scale-[0.98] disabled:opacity-40 shrink-0"
        >
          <UserPlus className="w-4 h-4" /> Add
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 glass rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="glass rounded-2xl divide-y divide-white/[0.04]">
          {admins.map((a) => {
            const check = canRemoveAdmin({ actorUserId, targetUserId: a.userId, totalAdmins });
            const busyRow = removingId === a.userId;
            return (
              <div key={a.userId} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="font-sans text-sm text-brand-fg truncate">{a.displayName || a.email || a.userId}</p>
                  <p className="font-sans text-[10px] text-brand-muted/40">
                    Added {formatDate(a.createdAt)}{a.addedByEmail ? ` by ${a.addedByEmail}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => doRemove(a)}
                  disabled={!check.ok || busyRow}
                  title={check.reason === 'cannot_remove_self' ? "You can't remove yourself" : check.reason === 'cannot_remove_last_admin' ? 'At least one admin must remain' : 'Remove'}
                  className="p-2 rounded-lg bg-white/[0.04] hover:bg-amber-500/15 text-brand-muted/50 hover:text-amber-400 transition-colors disabled:opacity-30 disabled:hover:bg-white/[0.04] disabled:hover:text-brand-muted/50 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
