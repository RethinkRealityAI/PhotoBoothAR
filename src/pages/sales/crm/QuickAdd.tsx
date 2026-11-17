/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Quick-add sheet: the 15-second capture between DMs. Only a name is
 * required; one box takes a handle, email, phone or link and files it in the
 * right column (crm.quickContactToDraft). Everything else hides under
 * "More details". On a failed save the sheet stays open with every keystroke
 * intact; closing a sheet with typed input asks first.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import {
  CRM_ICPS, DEFAULT_MARKET, LIMITS, quickContactToDraft, SOCIAL_KEYS, SOCIAL_LABELS, toInsertPayload,
  validateProspectDraft, type CrmIcp, type DraftField, type ProspectDraft, type ProspectWrite, type SocialKey,
} from '../../../lib/crm';
import { MARKETS, type Market } from '../../../lib/salesTypes';
import { AutoTextarea, btnPrimary, btnQuiet, chip, chipOff, chipOn, Field, inputCls, labelCls, Portal, Sheet, SOCIAL_ICONS } from './ui';

interface More {
  company: string; role: string; email: string; phone: string; location: string;
  source: string; dealValue: string; nextFollowUp: string; notes: string;
}
const EMPTY_MORE: More = {
  company: '', role: '', email: '', phone: '', location: '', source: '', dealValue: '', nextFollowUp: '', notes: '',
};

export default function QuickAdd({
  onClose, create,
}: {
  onClose: () => void;
  /** Resolves null on success, or an error sentence. */
  create: (payload: ProspectWrite) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [channel, setChannel] = useState<SocialKey>('instagram');
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET);
  const [icp, setIcp] = useState<CrmIcp>('planners');
  const [more, setMore] = useState<More>(EMPTY_MORE);
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // The sheet's dialog hook focuses its first control (Close); capture starts
  // at the name. Child effects run first, so this one wins.
  useEffect(() => { document.getElementById('crm-qa-name')?.focus(); }, []);

  const dirty = name.trim() !== '' || contact.trim() !== '' || Object.values(more).some((v) => v.trim() !== '');
  const symbol = MARKETS.find((m) => m.id === market)?.symbol ?? '$';

  function buildDraft(): { draft: ProspectDraft; fromContact: Array<DraftField> } {
    const c = quickContactToDraft(contact, channel);
    const fromContact: DraftField[] = [];
    if (c.email !== undefined) fromContact.push('email');
    if (c.phone !== undefined) fromContact.push('phone');
    if (c.website !== undefined) fromContact.push('website');
    if (c.socials !== undefined) for (const k of SOCIAL_KEYS) if (c.socials[k] !== undefined) fromContact.push(`socials.${k}`);
    // An explicit "more details" field wins over the quick box.
    const draft: ProspectDraft = {
      name, market, icp,
      ...more,
      email: more.email.trim() !== '' ? more.email : c.email ?? '',
      phone: more.phone.trim() !== '' ? more.phone : c.phone ?? '',
      website: c.website ?? '',
      socials: c.socials ?? {},
    };
    return { draft, fromContact };
  }

  async function save(again: boolean) {
    if (busy) return;
    const { draft, fromContact } = buildDraft();
    const v = validateProspectDraft(draft);
    setErrors(v.errors);
    setSaveErr(null);
    if (!v.ok) {
      const hidden: DraftField[] = ['company', 'role', 'location', 'source', 'dealValue', 'nextFollowUp', 'notes'];
      const contactOnly = (f: DraftField) => fromContact.includes(f);
      if (hidden.some((f) => v.errors[f] !== undefined)
        || ((v.errors.email !== undefined || v.errors.phone !== undefined) && !contactOnly('email') && !contactOnly('phone'))) {
        setShowMore(true);
      }
      return;
    }
    setBusy(true);
    const err = await create(toInsertPayload(draft));
    setBusy(false);
    if (err !== null) { setSaveErr(err); return; }
    if (again) {
      setName(''); setContact(''); setMore(EMPTY_MORE); setErrors({}); setShowMore(false);
      // Keep market / ICP / channel: a batch from one event is usually alike.
      document.getElementById('crm-qa-name')?.focus();
    } else {
      onClose();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save(false);
  }

  const contactErr = (() => {
    const { fromContact } = buildDraft();
    for (const f of fromContact) if (errors[f] !== undefined) return errors[f];
    return undefined;
  })();

  const setM = (k: keyof More) => (e: { target: { value: string } }) => setMore((m) => ({ ...m, [k]: e.target.value }));

  return (
    <>
      <Sheet
        title="New prospect"
        onClose={() => (dirty ? setConfirmClose(true) : onClose())}
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <button type="button" onClick={() => void save(true)} disabled={busy} className={`${btnQuiet} sm:flex-1`}>
              Save &amp; add another
            </button>
            <button type="submit" form="crm-quick-add" disabled={busy} className={`${btnPrimary} sm:flex-1`}>
              {busy ? 'Saving…' : 'Save prospect'}
            </button>
          </div>
        }
      >
        <form id="crm-quick-add" onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Name" error={errors.name} id="crm-qa-name">
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                autoCapitalize="words"
                maxLength={LIMITS.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tolu Adebayo"
                className={inputCls}
              />
            )}
          </Field>

          <div>
            <Field label="Handle, email or phone" error={contactErr} hint={contactErr === undefined ? 'A @handle goes to the platform picked below.' : undefined}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="@handle, name@company.com, 0803…"
                  className={inputCls}
                />
              )}
            </Field>
            <div className="mt-2 -mx-1 px-1 flex gap-1.5 overflow-x-auto hide-scrollbar" role="radiogroup" aria-label="Handle platform">
              {SOCIAL_KEYS.map((k) => {
                const Icon = SOCIAL_ICONS[k];
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={channel === k}
                    onClick={() => setChannel(k)}
                    className={`${chip} ${channel === k ? chipOn : chipOff}`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />{SOCIAL_LABELS[k]}
                  </button>
                );
              })}
            </div>
          </div>

          <ChipGroup label="Market">
            {MARKETS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={market === m.id} onClick={() => setMarket(m.id)}
                className={`${chip} ${market === m.id ? chipOn : chipOff}`}>
                {m.label}
              </button>
            ))}
          </ChipGroup>

          <ChipGroup label="Type">
            {CRM_ICPS.map((i) => (
              <button key={i.id} type="button" role="radio" aria-checked={icp === i.id} onClick={() => setIcp(i.id)}
                className={`${chip} ${icp === i.id ? chipOn : chipOff}`}>
                {i.label}
              </button>
            ))}
          </ChipGroup>

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            aria-controls="crm-qa-more"
            className="inline-flex items-center gap-1.5 min-h-11 font-label uppercase tracking-[0.2em] text-[10px] text-brand-muted hover:text-brand-fg"
          >
            <ChevronDown className={`w-4 h-4 motion-safe:transition-transform ${showMore ? 'rotate-180' : ''}`} aria-hidden="true" />
            More details
          </button>

          {showMore && (
            <div id="crm-qa-more" className="grid sm:grid-cols-2 gap-3.5">
              <Field label="Company" error={errors.company}>
                {(a) => <input {...a} value={more.company} onChange={setM('company')} className={inputCls} maxLength={LIMITS.company} />}
              </Field>
              <Field label="Role" error={errors.role}>
                {(a) => <input {...a} value={more.role} onChange={setM('role')} className={inputCls} maxLength={LIMITS.role} placeholder="Lead planner" />}
              </Field>
              <Field label="Email" error={contactErr === undefined ? errors.email : undefined}>
                {(a) => <input {...a} type="email" inputMode="email" autoCapitalize="none" value={more.email} onChange={setM('email')} className={inputCls} />}
              </Field>
              <Field label="Phone" error={errors.phone}>
                {(a) => <input {...a} type="tel" inputMode="tel" value={more.phone} onChange={setM('phone')} className={inputCls} placeholder={market === 'ng' ? '0803 123 4567' : '+1 416 555 0100'} />}
              </Field>
              <Field label="Location" error={errors.location}>
                {(a) => <input {...a} value={more.location} onChange={setM('location')} className={inputCls} placeholder={market === 'ng' ? 'Lagos' : 'Toronto'} />}
              </Field>
              <Field label="Where you found them" error={errors.source}>
                {(a) => <input {...a} value={more.source} onChange={setM('source')} className={inputCls} placeholder="IG explore, referral…" />}
              </Field>
              <Field label={`Deal value (${symbol})`} error={errors.dealValue}>
                {(a) => <input {...a} inputMode="decimal" value={more.dealValue} onChange={setM('dealValue')} className={inputCls} placeholder="1,500" />}
              </Field>
              <Field label="Next follow-up" error={errors.nextFollowUp}>
                {(a) => <input {...a} type="date" value={more.nextFollowUp} onChange={setM('nextFollowUp')} className={`${inputCls} [color-scheme:dark]`} />}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes" error={errors.notes}>
                  {(a) => <AutoTextarea {...a} value={more.notes} onChange={setM('notes')} maxLength={LIMITS.notes} placeholder="What they’re planning, what caught your eye…" />}
                </Field>
              </div>
            </div>
          )}

          {saveErr !== null && (
            <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3.5 py-2.5 text-xs text-amber-100">
              {saveErr} Your details are still here — try again.
            </p>
          )}
        </form>
      </Sheet>
      {confirmClose && (
        <Portal><ConfirmModal
          title="Discard this prospect?"
          body="What you typed hasn’t been saved."
          confirmLabel="Discard"
          onConfirm={() => { setConfirmClose(false); onClose(); }}
          onCancel={() => setConfirmClose(false)}
        /></Portal>
      )}
    </>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={labelCls} id={`crm-qa-${label}`}>{label}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={`crm-qa-${label}`}>{children}</div>
    </div>
  );
}
