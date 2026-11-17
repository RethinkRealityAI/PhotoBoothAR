/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Team access — platform admins only (the button is hidden otherwise, and
 * sales_grant_access / sales_revoke_access re-check is_platform_admin()
 * server-side, so this is convenience, not the gate). The person must already
 * have a Beamwall account; the RPC raises `no_account` otherwise, which
 * friendlyCrmError turns into "ask them to sign up at /signup first".
 */
import { useState, type FormEvent } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import { useToast } from '../../../components/ui/Toast';
import { memberName, validRefCode, type TeamMember } from '../../../lib/crm';
import { grantAccess, revokeAccess } from '../../../lib/crmApi';
import { btnPrimary, chip, chipOff, chipOn, Field, iconBtn, inputCls, labelCls, Pill, Portal, Sheet } from './ui';

export default function TeamPanel({
  team, userId, reload, onClose,
}: {
  team: TeamMember[];
  userId: string;
  /** Re-fetch the roster; resolves an error sentence or null. */
  reload: () => Promise<string | null>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'rep' | 'manager'>('rep');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<{ email?: string; ref?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: typeof err = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter the email they signed up with.';
    if (ref.trim() !== '' && !validRefCode(ref)) next.ref = '2–24 lowercase letters, numbers or dashes.';
    setErr(next);
    if (next.email !== undefined || next.ref !== undefined) return;
    setBusy(true);
    const r = await grantAccess(email, role, ref.trim() === '' ? null : ref);
    setBusy(false);
    if (r.error !== null) { setErr({ form: r.error }); return; } // inputs kept
    toast.push(`${email.trim()} can now open the CRM.`, 'success');
    setEmail(''); setRef(''); setRole('rep');
    const reloadErr = await reload();
    if (reloadErr !== null) toast.push(`Added, but the list didn’t refresh: ${reloadErr}`, 'error');
  }

  async function confirmRemove() {
    if (removing === null) return;
    setRemoveBusy(true);
    const r = await revokeAccess(removing.user_id);
    setRemoveBusy(false);
    if (r.error !== null) { toast.push(r.error, 'error'); return; }
    toast.push(`${memberName(removing)} no longer has CRM access.`, 'success');
    setRemoving(null);
    await reload();
  }

  return (
    <>
      <Sheet title="Team access" onClose={onClose}>
        <p className="text-xs text-brand-muted leading-relaxed">
          Everyone on the team can see the whole pipeline; each rep can only change their own prospects. Platform admins always have access.
        </p>

        <ul className="mt-4 space-y-2">
          {team.length === 0 && <li className="text-sm text-brand-muted">No reps yet — add James below.</li>}
          {team.map((m) => (
            <li key={m.user_id} className="liquid-glass rounded-2xl px-3.5 py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-brand-fg truncate">{memberName(m)}{m.user_id === userId ? ' (you)' : ''}</p>
                <p className="text-[11px] text-brand-muted truncate">{m.email}{m.ref_code !== null ? ` · ref ${m.ref_code}` : ''}</p>
              </div>
              <Pill className="bg-white/[0.04] border-white/12 text-brand-muted">{m.role}</Pill>
              <button type="button" onClick={() => setRemoving(m)} aria-label={`Remove ${memberName(m)}`} className={`${iconBtn} hover:text-rose-200`}>
                <UserMinus className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={(e) => void add(e)} noValidate className="mt-5 pt-4 border-t border-white/[0.06] space-y-3.5">
          <h3 className={labelCls}>Add someone</h3>
          <Field label="Their Beamwall email" error={err.email}>
            {(a) => <input {...a} type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />}
          </Field>
          <div>
            <p className={labelCls} id="crm-team-role">Role</p>
            <div className="flex gap-1.5" role="radiogroup" aria-labelledby="crm-team-role">
              {(['rep', 'manager'] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)} className={`${chip} ${role === r ? chipOn : chipOff}`}>
                  {r === 'rep' ? 'Rep' : 'Manager'}
                </button>
              ))}
            </div>
          </div>
          <Field label="Ref code (optional)" error={err.ref} hint={err.ref === undefined ? 'Added to links they share, e.g. ?ref=jamesa' : undefined}>
            {(a) => <input {...a} autoCapitalize="none" spellCheck={false} value={ref} onChange={(e) => setRef(e.target.value)} className={inputCls} placeholder="jamesa" maxLength={24} />}
          </Field>
          {err.form !== undefined && <p role="alert" className="text-xs text-amber-300">{err.form}</p>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
            <UserPlus className="w-4 h-4" aria-hidden="true" /> {busy ? 'Adding…' : 'Give CRM access'}
          </button>
        </form>
      </Sheet>
      {removing !== null && (
        <Portal><ConfirmModal
          title={`Remove ${memberName(removing)}?`}
          body="They’ll lose access to the CRM straight away. Their prospects stay in the pipeline."
          confirmLabel="Remove access"
          tone="danger"
          busy={removeBusy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        /></Portal>
      )}
    </>
  );
}
