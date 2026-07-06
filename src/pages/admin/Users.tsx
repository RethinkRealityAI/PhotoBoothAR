/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/users — every account on the platform. Reset password surfaces the
 * one-time recovery link in a modal for the admin to copy and send out of
 * band (never logged/audited — see admin-api's reset_password). Disable is
 * always a ban, never a delete (deleting cascades profiles/org_members and
 * orphans the org). Adjust credits only applies to users with an org.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Copy, Check } from 'lucide-react';
import { fetchUsers, resetPassword, setUserBanned, adjustCredits, type UserRow } from '../../lib/admin';
import { formatDate, formatCount } from '../../lib/adminFormat';
import { searchRows, sortRows, paginateRows } from '../../lib/adminFilters';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import StatusPill from '../../components/ui/StatusPill';
import { useToast } from '../../components/ui/Toast';

const PAGE_SIZE = 10;

function ResetLinkModal({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Password reset link" onClose={onClose} maxWidthClass="max-w-lg">
      <p className="font-sans text-xs text-brand-muted/60 mb-4">
        This link signs the user in directly — send it privately and don't reuse it. It won't be shown again.
      </p>
      <div className="glass rounded-xl p-3 mb-4">
        <p className="font-mono text-[10px] text-brand-fg/90 break-all">{link}</p>
      </div>
      <button
        onClick={() => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] px-4 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </Modal>
  );
}

function AdjustCreditsModal({
  user,
  onClose,
  onDone,
}: {
  user: UserRow;
  onClose: () => void;
  onDone: (balance: number) => void;
}) {
  const { push } = useToast();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0 || !reason.trim() || !user.orgId) return;
    setBusy(true);
    const { data, error } = await adjustCredits(user.orgId, Math.trunc(n), reason.trim());
    setBusy(false);
    if (error || !data) { push('Could not adjust credits.', 'error'); return; }
    push(`${user.orgName ?? 'Org'} credits now ${formatCount(data.balance)}.`, 'success');
    onDone(data.balance);
  };

  return (
    <Modal title={`Adjust credits — ${user.orgName ?? 'org'}`} onClose={onClose} maxWidthClass="max-w-sm">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">Delta (+/-)</span>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 50 or -20"
            className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 font-sans text-sm text-brand-fg outline-none focus:border-white/20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">Reason</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. support comp"
            className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 font-sans text-sm text-brand-fg outline-none focus:border-white/20"
          />
        </label>
        <button
          onClick={submit}
          disabled={busy || !delta.trim() || !reason.trim()}
          className="mt-1 rounded-full bg-foil px-6 py-2.5 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98] disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { push } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<UserRow | null>(null);
  const [creditsTarget, setCreditsTarget] = useState<UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await fetchUsers();
    setUsers(data?.users ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [query]);

  const filtered = useMemo(
    () => sortRows(searchRows(users, query, ['email', 'displayName', 'orgName']), 'createdAt', 'desc'),
    [users, query],
  );
  const paged = useMemo(() => paginateRows(filtered, page, PAGE_SIZE), [filtered, page]);

  const doResetPassword = async (u: UserRow) => {
    setBusyId(u.id);
    const { data, error } = await resetPassword(u.id);
    setBusyId(null);
    if (error || !data?.link) { push('Could not generate a reset link.', 'error'); return; }
    setResetLink(data.link);
  };

  const doUnban = async (u: UserRow) => {
    setBusyId(u.id);
    const { error } = await setUserBanned(u.id, false);
    setBusyId(null);
    if (error) { push('Could not unban this user.', 'error'); return; }
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, banned: false } : x)));
    push('User unbanned.', 'success');
  };

  const confirmBan = async () => {
    if (!banTarget) return;
    setBusyId(banTarget.id);
    const { error } = await setUserBanned(banTarget.id, true);
    setBusyId(null);
    if (error) { push('Could not ban this user.', 'error'); return; }
    setUsers((list) => list.map((x) => (x.id === banTarget.id ? { ...x, banned: true } : x)));
    push('User banned.', 'success');
    setBanTarget(null);
  };

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      label: 'User',
      render: (u) => (
        <div>
          <p className="text-brand-fg font-medium">{u.displayName || u.email || u.id}</p>
          {u.email && <p className="font-mono text-[10px] text-brand-muted/40">{u.email}</p>}
        </div>
      ),
    },
    {
      key: 'org',
      label: 'Organization',
      render: (u) => (u.orgName ? <span>{u.orgName} <span className="text-brand-muted/40">· {u.role}</span></span> : <span className="text-brand-muted/40">—</span>),
    },
    {
      key: 'status',
      label: 'Status',
      render: (u) => (
        <div className="flex items-center gap-1.5">
          <StatusPill status={u.banned ? 'banned' : 'active'} />
          {u.isPlatformAdmin && (
            <span className="inline-block shrink-0 px-2.5 py-1 rounded-full text-[9px] font-label uppercase tracking-widest bg-purple-500/15 text-purple-300">
              Admin
            </span>
          )}
        </div>
      ),
    },
    { key: 'joined', label: 'Joined', render: (u) => formatDate(u.createdAt) },
    { key: 'lastSignIn', label: 'Last sign-in', render: (u) => formatDate(u.lastSignInAt) },
    {
      key: 'actions',
      label: '',
      render: (u) => {
        const busy = busyId === u.id;
        return (
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => doResetPassword(u)}
              disabled={busy}
              className="rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg/80 transition-colors disabled:opacity-40"
            >
              Reset password
            </button>
            {u.orgId && (
              <button
                onClick={() => setCreditsTarget(u)}
                disabled={busy}
                className="rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg/80 transition-colors disabled:opacity-40"
              >
                Credits
              </button>
            )}
            {u.banned ? (
              <button
                onClick={() => doUnban(u)}
                disabled={busy}
                className="rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-emerald-400 transition-colors disabled:opacity-40"
              >
                Unban
              </button>
            ) : (
              <button
                onClick={() => setBanTarget(u)}
                disabled={busy}
                className="rounded-full bg-amber-500/15 hover:bg-amber-500/25 px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-amber-400 transition-colors disabled:opacity-40"
              >
                Ban
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foil-static">Users</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">{formatCount(users.length)} accounts on the platform</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="relative mb-4 max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users…"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
        />
      </div>

      <DataTable columns={columns} rows={paged.rows} getRowKey={(u) => u.id} loading={loading} emptyMessage="No users match." />
      <Pagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPageChange={setPage} />

      {resetLink && <ResetLinkModal link={resetLink} onClose={() => setResetLink(null)} />}

      {banTarget && (
        <Modal title={`Ban ${banTarget.displayName || banTarget.email || 'this user'}?`} onClose={() => setBanTarget(null)} maxWidthClass="max-w-sm">
          <p className="font-sans text-xs text-brand-muted/60 mb-5">
            They'll be signed out and blocked from signing back in until unbanned. Their data is untouched.
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmBan}
              className="flex-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 px-4 py-2.5 font-label uppercase tracking-luxe text-[10px] text-amber-400 transition-colors"
            >
              Ban user
            </button>
            <button
              onClick={() => setBanTarget(null)}
              className="flex-1 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] px-4 py-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {creditsTarget && (
        <AdjustCreditsModal
          user={creditsTarget}
          onClose={() => setCreditsTarget(null)}
          onDone={() => setCreditsTarget(null)}
        />
      )}
    </div>
  );
}
