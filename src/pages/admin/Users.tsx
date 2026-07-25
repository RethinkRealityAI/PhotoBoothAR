/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/users — every account on the platform. Reset password surfaces the
 * one-time recovery link in a modal for the admin to copy and send out of
 * band (never logged/audited — see admin-api's reset_password). Disable is
 * always a ban, never a delete (deleting cascades profiles/org_members and
 * orphans the org). Adjust credits only applies to users with an org.
 *
 * Searched and paged on the server. It used to ask GoTrue for a flat 1000
 * accounts and filter them in the browser — so past a thousand users, the
 * account an operator was looking for could simply not be on the page, with
 * nothing saying so. GoTrue's admin list API has no search parameter at all,
 * which is why the rows now come from the admin_list_users function (migration
 * 020) instead.
 */
import { useCallback, useState } from 'react';
import { Search, RefreshCw, Copy, Check } from 'lucide-react';
import { fetchUsers, resetPassword, setUserBanned, adjustCredits, type UserRow } from '../../lib/admin';
import { formatDate, formatCount } from '../../lib/adminFormat';
import { listFootnote, type ListQuery } from '../../lib/serverList';
import { useServerList } from '../../lib/useServerList';
import DataTable, { type Column } from '../../components/ui/DataTable';
import LoadError from '../../components/ui/LoadError';
import ListMore from '../../components/ui/ListMore';
import Modal from '../../components/ui/Modal';
import StatusPill from '../../components/ui/StatusPill';
import { useToast } from '../../components/ui/Toast';

const PAGE_SIZE = 50;

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
  const [formError, setFormError] = useState<string | null>(null);
  /** Second-press confirmation state for the adjustment. */
  const [confirming, setConfirming] = useState(false);

  const submit = async () => {
    const n = Number(delta);
    // These used to be a bare `return`, while the button stayed enabled for any
    // two non-blank fields — so "Apply" on a delta of 0, or on a user with no
    // org, did nothing and said nothing.
    if (!user.orgId) { setFormError('This user has no organization, so there is no balance to adjust.'); return; }
    if (!Number.isFinite(n) || n === 0) { setFormError('Enter a non-zero whole number, e.g. 50 or -20.'); return; }
    if (!reason.trim()) { setFormError('Give a reason — it is written to the audit log.'); return; }
    // Money moves on a deliberate confirm, not on one keystroke: "500" typed
    // for "50" is only reversible by a second manual adjustment. Confirmed
    // INLINE rather than in a nested dialog — this component is already a
    // Modal, and stacking two focus traps is its own bug.
    const rounded = Math.trunc(n);
    if (!confirming) { setFormError(null); setConfirming(true); return; }
    setConfirming(false);
    setFormError(null);
    setBusy(true);
    const { data, error } = await adjustCredits(user.orgId, rounded, reason.trim());
    setBusy(false);
    if (error || !data) { push('Could not adjust credits.', 'error'); return; }
    push(`${user.orgName ?? 'Org'} credits now ${formatCount(data.balance)}.`, 'success');
    onDone(data.balance);
  };

  return (
    <Modal title={`Adjust credits — ${user.orgName ?? 'org'}`} onClose={onClose} maxWidthClass="max-w-sm" dismissOnScrim={false}>
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
        {formError && (
          <p role="alert" className="font-sans text-xs text-amber-300/90 leading-relaxed">{formError}</p>
        )}
        {confirming && (
          <p role="alert" className="font-sans text-xs text-amber-300/90 leading-relaxed">
            {Number(delta) > 0 ? 'Grant' : 'Remove'} {Math.abs(Math.trunc(Number(delta)))} credit
            {Math.abs(Math.trunc(Number(delta))) === 1 ? '' : 's'}{' '}
            {Number(delta) > 0 ? 'to' : 'from'} {user.orgName ?? 'this org'}? Reversible only by a
            second manual adjustment. Press again to confirm.
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={busy || !delta.trim() || !reason.trim()}
            className="mt-1 flex-1 min-h-11 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98] disabled:opacity-40"
          >
            {confirming ? 'Confirm' : 'Apply'}
          </button>
          {confirming && (
            <button
              onClick={() => setConfirming(false)}
              className="mt-1 min-h-11 rounded-full bg-white/[0.06] px-5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/80"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { push } = useToast();
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<UserRow | null>(null);
  const [creditsTarget, setCreditsTarget] = useState<UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Server-side search across email, display name and organization name — the
  // same three fields the browser used to filter on, so nothing narrowed here.
  const fetchPage = useCallback(async (q: ListQuery) => {
    const { data, error } = await fetchUsers(q);
    return { rows: data?.users ?? [], hasMore: data?.hasMore ?? false, error };
  }, []);
  const list = useServerList<UserRow>(fetchPage, PAGE_SIZE);

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
    // Patched in place rather than reloaded: a reload would throw away every
    // page the operator has loaded past the first and scroll them back to the
    // top of a list they were working through.
    list.patchRows((rows) => rows.map((x) => (x.id === u.id ? { ...x, banned: false } : x)));
    push('User unbanned.', 'success');
  };

  const confirmBan = async () => {
    if (!banTarget) return;
    setBusyId(banTarget.id);
    const { error } = await setUserBanned(banTarget.id, true);
    setBusyId(null);
    if (error) { push('Could not ban this user.', 'error'); return; }
    list.patchRows((rows) => rows.map((x) => (x.id === banTarget.id ? { ...x, banned: true } : x)));
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
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {listFootnote(list.rows.length, list.hasMore, 'account') || 'Loading…'}
          </p>
        </div>
        <button
          onClick={list.reload}
          disabled={list.loading}
          className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${list.loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {list.error && <LoadError what="users" code={list.error} onRetry={list.reload} />}

      <div className="relative mb-4 max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/40" />
        <input
          value={list.query}
          onChange={(e) => list.setQuery(e.target.value)}
          placeholder="Search name, email or org…"
          className="w-full pl-9 pr-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-xs text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-white/20"
        />
      </div>

      <DataTable columns={columns} rows={list.rows} getRowKey={(u) => u.id} loading={list.loading} emptyMessage="No users match." />
      <ListMore
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onMore={list.loadMore}
        note={listFootnote(list.rows.length, list.hasMore, 'account')}
      />

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
