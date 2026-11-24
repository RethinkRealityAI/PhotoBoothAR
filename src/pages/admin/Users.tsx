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
import { Copy, Check } from 'lucide-react';
import { AdminHeader, AdminPage, AdminSearch, RefreshButton } from './AdminChrome';
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
import { copyText } from '../../lib/clipboard';

const PAGE_SIZE = 50;
/** A row action: a full 44px target (they were 27px pills in 9px type). */
const rowBtn =
  'pressable whitespace-nowrap rounded-full border px-3.5 min-h-11 font-sans text-[11px] transition-colors disabled:opacity-40';

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
        onClick={() => copyText(link).then((ok) => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 2000); })}
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
          <span className="font-sans text-[11px] text-brand-muted/75">Credits to add (negative removes)</span>
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 50 or -20"
            className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 font-sans text-sm text-brand-fg outline-none focus:border-white/20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-sans text-[11px] text-brand-muted/75">Reason (goes in the audit log)</span>
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
          <p className="text-brand-fg font-medium break-all">{u.displayName || u.email || u.id}</p>
          {/* The email is the title already when there is no display name. */}
          {u.email && u.displayName && <p className="font-mono text-[10px] text-brand-muted/70 break-all">{u.email}</p>}
        </div>
      ),
    },
    {
      key: 'org',
      label: 'Organization',
      render: (u) => (u.orgName ? <span>{u.orgName} <span className="text-brand-muted/70">· {u.role}</span></span> : <span className="text-brand-muted/60">None</span>),
    },
    {
      key: 'status',
      label: 'Status',
      render: (u) => (
        <div className="flex items-center gap-1.5">
          <StatusPill status={u.banned ? 'banned' : 'active'} />
          {/* Was a hand-rolled span duplicating StatusPill's exact classes — so
              a tone change in the shared map would silently miss this one. */}
          {u.isPlatformAdmin && <StatusPill status="admin" />}
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
              className={`${rowBtn} border-white/10 bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/90`}
            >
              Reset password
            </button>
            {u.orgId && (
              <button
                onClick={() => setCreditsTarget(u)}
                disabled={busy}
                className={`${rowBtn} border-white/10 bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/90`}
              >
                Credits
              </button>
            )}
            {u.banned ? (
              <button
                onClick={() => doUnban(u)}
                disabled={busy}
                className={`${rowBtn} border-emerald-400/25 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300`}
              >
                Unban
              </button>
            ) : (
              <button
                onClick={() => setBanTarget(u)}
                disabled={busy}
                className={`${rowBtn} border-amber-400/25 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300`}
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
    <AdminPage>
      <AdminHeader
        title="Users"
        subtitle="Every account. Reset a password, adjust credits or block a sign-in."
        note={listFootnote(list.rows.length, list.hasMore, 'account') || 'Loading…'}
        actions={<RefreshButton onClick={list.reload} busy={list.loading} />}
      />

      {list.error && <LoadError what="users" code={list.error} onRetry={list.reload} />}

      <AdminSearch
        value={list.query}
        onChange={list.setQuery}
        placeholder="Search name, email or org…"
        label="Search users"
      />

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
              disabled={busyId === banTarget.id}
              className="pressable flex-1 min-h-11 rounded-xl border border-amber-400/25 bg-amber-500/15 hover:bg-amber-500/25 px-4 font-sans text-sm text-amber-300 transition-colors disabled:opacity-40"
            >
              Ban user
            </button>
            <button
              onClick={() => setBanTarget(null)}
              className="pressable flex-1 min-h-11 rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] px-4 font-sans text-sm text-brand-fg/90 transition-colors"
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
    </AdminPage>
  );
}
