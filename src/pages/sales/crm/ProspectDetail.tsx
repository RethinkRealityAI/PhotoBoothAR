/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One prospect: reach them, log the touch, move them along, keep the record.
 * Ordered for a phone mid-conversation — quick actions and "Log a touch"
 * first, the full edit form last.
 *
 * Instant controls (status, follow-up, collateral, touches) save on tap and
 * roll back on failure (CrmWorkspace owns the writes). The details form saves
 * on "Save changes"; a failed save keeps every typed character, and a
 * background update to the same row never overwrites unsaved typing.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, ChevronDown, Copy, Globe, Handshake, Link2, Mail, MessageCircle, MessageSquare,
  Phone, PhoneCall, Send, StickyNote, Trash2, Undo2,
} from 'lucide-react';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import { useToast } from '../../../components/ui/Toast';
import { copyText } from '../../../lib/clipboard';
import {
  activityWhen, addDaysToKey, collateralFor, CRM_ICPS, dialable, displayUrl, draftFromProspect,
  followUpLabel, followUpState, formatDateKey, isTouchKind, LIMITS, localDateKey, memberName, parseDateKey,
  PIPELINE_STEPS, sentAgo, shareLink, SOCIAL_KEYS, SOCIAL_LABELS, statusAfterTouch, statusDef,
  toInsertPayload, validateProspectDraft, whatsappLink,
  type Activity, type ActivityKind, type DraftField, type Prospect, type ProspectStatus, type SocialKey, type TeamMember,
} from '../../../lib/crm';
import { listActivities } from '../../../lib/crmApi';
import { MARKETS, type CollateralItem } from '../../../lib/salesTypes';
import type { CrmActions } from './CrmWorkspace';
import TemplatePicker from './TemplatePicker';
import {
  AutoTextarea, btnPrimary, btnQuiet, chip, chipOff, chipOn, Field, iconBtn, inputCls, labelCls, Pill, Portal, SOCIAL_ICONS, Spinner,
} from './ui';

type Form = ReturnType<typeof draftFromProspect>;

const TOUCHES: Array<{ kind: ActivityKind; label: string; icon: typeof Send }> = [
  { kind: 'dm', label: 'DM', icon: MessageCircle },
  { kind: 'email', label: 'Email', icon: Mail },
  { kind: 'call', label: 'Call', icon: PhoneCall },
  { kind: 'meeting', label: 'Meeting', icon: Handshake },
  { kind: 'note', label: 'Note', icon: StickyNote },
];
const DM_CHANNELS = ['whatsapp', 'instagram', 'linkedin', 'tiktok', 'facebook', 'x'] as const;
const DM_LABEL: Record<(typeof DM_CHANNELS)[number], string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok', facebook: 'Facebook', x: 'X',
};
const KIND_LABEL: Record<ActivityKind, string> = {
  dm: 'DM', email: 'Email', call: 'Call', meeting: 'Meeting', note: 'Note', status: 'Status',
};
const KIND_ICON: Record<ActivityKind, typeof Send> = {
  dm: MessageCircle, email: Mail, call: PhoneCall, meeting: Handshake, note: StickyNote, status: Check,
};

/** Fields the details form saves. Status + follow-up have their own instant controls. */
function formPatch(form: Form) {
  const { status: _s, next_follow_up: _f, ...rest } = toInsertPayload(form);
  return rest;
}

export default function ProspectDetail({
  prospect, now, userId, isAdmin, team, ownerName, refCode, bookingLink, senderName, actions, onBack,
}: {
  prospect: Prospect;
  now: Date;
  userId: string;
  isAdmin: boolean;
  team: TeamMember[];
  ownerName: string | null;
  refCode: string | null;
  /** The rep's live booking URL, or null when they have none. */
  bookingLink: string | null;
  senderName: string;
  actions: CrmActions;
  onBack: () => void;
}) {
  const toast = useToast();
  const canEdit = isAdmin || prospect.owner_id === userId;
  const p = prospect;

  // ── timeline ──
  const [timeline, setTimeline] = useState<Activity[]>([]);
  const [tlState, setTlState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tlError, setTlError] = useState<string | null>(null);
  async function loadTimeline() {
    setTlState('loading');
    const r = await listActivities(p.id);
    if (r.data === null) { setTlError(r.error); setTlState('error'); return; }
    setTimeline(r.data);
    setTlState('ready');
  }
  useEffect(() => { void loadTimeline(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.id]);

  // ── details form ──
  const serverForm = useMemo(() => draftFromProspect(p), [p]);
  const [form, setForm] = useState<Form>(serverForm);
  const [baseline, setBaseline] = useState<Form>(serverForm);
  const [errors, setErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const dirty = JSON.stringify(formPatch(form)) !== JSON.stringify(formPatch(baseline));
  // Adopt a newer server row only while nothing is being typed.
  useEffect(() => {
    if (!dirty) { setForm(serverForm); setBaseline(serverForm); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverForm]);

  async function saveForm() {
    const v = validateProspectDraft(form);
    setErrors(v.errors);
    if (!v.ok) { toast.push('A couple of fields need a look.', 'info'); return; }
    setSaving(true);
    const ok = await actions.patch(p.id, formPatch(form));
    setSaving(false);
    if (ok) { setBaseline(form); toast.push('Saved.', 'success'); }
  }
  const set = (k: keyof Omit<Form, 'socials'>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSocial = (k: SocialKey) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, socials: { ...f.socials, [k]: e.target.value } }));

  // ── status ──
  async function changeStatus(next: ProspectStatus) {
    if (!canEdit || next === p.status) return;
    const from = statusDef(p.status).label;
    const ok = await actions.patch(p.id, { status: next });
    if (!ok) return;
    const saved = await actions.log(p.id, 'status', null, `${from} → ${statusDef(next).label}`);
    if (saved !== null) setTimeline((t) => [saved, ...t]);
  }

  // ── follow-up ──
  const todayKey = localDateKey(now);
  async function setFollowUp(key: string | null) {
    if (!canEdit) return;
    const ok = await actions.patch(p.id, { next_follow_up: key });
    if (ok) toast.push(key === null ? 'Follow-up cleared.' : `Follow-up set for ${formatDateKey(key)}.`, 'success');
  }
  const fuBase = p.next_follow_up !== null && p.next_follow_up > todayKey ? p.next_follow_up : todayKey;

  // ── touches ──
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [dmChannel, setDmChannel] = useState<(typeof DM_CHANNELS)[number]>(p.market === 'ng' ? 'whatsapp' : 'instagram');
  const [advance, setAdvance] = useState(true);
  const [logging, setLogging] = useState<ActivityKind | null>(null);
  async function touch(kind: ActivityKind) {
    if (logging !== null) return;
    const body = note.trim() === '' ? null : note.trim().slice(0, LIMITS.activityBody);
    if (kind === 'note' && body === null) { setNoteErr('Write the note first.'); return; }
    setNoteErr(null);
    const channel = kind === 'dm' ? dmChannel : kind === 'email' ? 'email' : kind === 'call' ? 'phone' : null;
    const tempId = `tmp-${Date.now()}`;
    setTimeline((t) => [{ id: tempId, prospect_id: p.id, actor_id: userId, kind, channel, body, created_at: new Date().toISOString() }, ...t]);
    setLogging(kind);
    const saved = await actions.log(p.id, kind, channel, body);
    setLogging(null);
    if (saved === null) {
      setTimeline((t) => t.filter((a) => a.id !== tempId)); // note text is kept
      return;
    }
    setTimeline((t) => t.map((a) => (a.id === tempId ? saved : a)));
    setNote('');
    toast.push(`Logged ${kind === 'note' ? 'a note' : `a ${KIND_LABEL[kind].toLowerCase()}`}.`, 'success');
    const next = statusAfterTouch(p.status, kind);
    if (advance && canEdit && next !== p.status) await changeStatus(next);
  }

  // ── collateral ──
  const { primary, other } = collateralFor(p.icp, p.market);
  async function copyLink(item: CollateralItem) {
    const url = shareLink(window.location.origin, item.path, refCode);
    if (url === null) return;
    const ok = await copyText(url);
    toast.push(ok ? `Link copied${refCode !== null ? ' (with your ref code)' : ''}.` : `Couldn’t copy. The link is ${url}`, ok ? 'success' : 'error');
  }

  // ── reach ──
  const phone = dialable(p.phone);
  const wa = whatsappLink(p.phone, p.market);
  const socials = SOCIAL_KEYS.filter((k) => typeof p.socials[k] === 'string' && p.socials[k] !== '');
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const st = statusDef(p.status);
  const fu = followUpState(p, now);
  const marketLabel = MARKETS.find((m) => m.id === p.market)?.label ?? p.market;
  const actorName = (id: string | null) => {
    if (id === userId) return 'You';
    const m = team.find((t) => t.user_id === id);
    return m !== undefined ? memberName(m) : 'A teammate';
  };

  const reach = 'pressable inline-flex items-center gap-2 min-h-11 rounded-xl px-3.5 bg-white/[0.05] hover:bg-white/[0.09] text-brand-fg/90 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/70';

  return (
    <article className="liquid-glass-raised rounded-3xl p-4 sm:p-6 animate-rise-in">
      {/* ── header ── */}
      <div className="flex items-start gap-2">
        <button type="button" onClick={onBack} aria-label="Back to the list" className={`${iconBtn} lg:hidden -ml-1`}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl sm:text-3xl text-foil-static leading-tight break-words">{p.name}</h2>
          {(p.role !== null || p.company !== null) && (
            <p className="mt-0.5 text-sm text-brand-muted">{[p.role, p.company].filter((v) => v !== null).join(' · ')}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill className={st.pill}>{st.label}</Pill>
            <Pill className="bg-white/[0.03] border-white/10 text-brand-muted">{marketLabel}</Pill>
            {fu !== 'none' && p.next_follow_up !== null && (
              <Pill className="bg-amber-400/10 border-amber-300/35 text-amber-100">{followUpLabel(p.next_follow_up, now)}</Pill>
            )}
            {ownerName !== null && <span className="text-[11px] text-brand-muted/70">Owner: {p.owner_id === userId ? 'you' : ownerName}</span>}
          </div>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${p.name}`} className={`${iconBtn} hover:text-rose-200`}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {!canEdit && (
        <p className="mt-3 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-xs text-brand-muted leading-relaxed">
          {ownerName ?? 'A teammate'} owns this prospect. You can log touches and copy messages; only they (or Dapo) can edit it.
        </p>
      )}

      {/* ── reach ── */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setPicker(true)} className={btnPrimary}>
          <Copy className="w-4 h-4" aria-hidden="true" /> Copy message
        </button>
        {wa !== null && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={reach}>
            <MessageSquare className="w-4 h-4" aria-hidden="true" /> WhatsApp
          </a>
        )}
        {p.email !== null && (
          <a href={`mailto:${encodeURIComponent(p.email).replace(/%40/g, '@')}`} className={reach}>
            <Mail className="w-4 h-4" aria-hidden="true" /> Email
          </a>
        )}
        {phone !== '' && (
          <>
            <a href={`tel:${phone}`} className={reach}><Phone className="w-4 h-4" aria-hidden="true" /> Call</a>
            <a href={`sms:${phone}`} className={reach}><MessageCircle className="w-4 h-4" aria-hidden="true" /> Text</a>
          </>
        )}
        {p.website !== null && (
          <a href={p.website} target="_blank" rel="noopener noreferrer" className={reach}>
            <Globe className="w-4 h-4" aria-hidden="true" /> <span className="truncate max-w-[10rem]">{displayUrl(p.website)}</span>
          </a>
        )}
        {socials.map((k) => {
          const Icon = SOCIAL_ICONS[k];
          return (
            <a key={k} href={p.socials[k]} target="_blank" rel="noopener noreferrer" className={iconBtn}
              aria-label={`${SOCIAL_LABELS[k]} (opens in a new tab)`} title={SOCIAL_LABELS[k]}>
              <Icon className="w-4 h-4" aria-hidden="true" />
            </a>
          );
        })}
      </div>
      {p.phone !== null && wa === null && (
        <p className="mt-2 text-[11px] text-brand-muted/60">
          Add the country code to the phone number (e.g. +234…) to get a WhatsApp button.
        </p>
      )}

      {/* ── log a touch ── */}
      <Section title="Log a touch">
        <AutoTextarea
          minRows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={LIMITS.activityBody}
          placeholder="What happened? (optional for DM / email / call)"
          aria-label="Touch note"
          aria-invalid={noteErr !== null}
        />
        {noteErr !== null && <p role="alert" className="mt-1 text-[11px] text-amber-300">{noteErr}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {TOUCHES.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.kind} type="button" onClick={() => void touch(t.kind)} disabled={logging !== null}
                className={`${btnQuiet} ${logging === t.kind ? 'opacity-60' : ''}`}>
                <Icon className="w-4 h-4" aria-hidden="true" /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="inline-flex items-center gap-2 min-h-11 text-xs text-brand-muted">
            DM via
            <select
              value={dmChannel}
              onChange={(e) => setDmChannel(e.target.value as (typeof DM_CHANNELS)[number])}
              className="min-h-9 rounded-lg liquid-glass-inset px-2 text-xs text-brand-fg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]/50"
            >
              {DM_CHANNELS.map((c) => <option key={c} value={c}>{DM_LABEL[c]}</option>)}
            </select>
          </label>
          {p.status === 'new' && canEdit && (
            <label className="inline-flex items-center gap-2 min-h-11 text-xs text-brand-muted cursor-pointer">
              <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} className="w-4 h-4 accent-[color:var(--color-accent)]" />
              Move to Contacted
            </label>
          )}
        </div>
      </Section>

      {/* ── status ── */}
      <Section title="Stage">
        <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline stage">
          {PIPELINE_STEPS.map((s, i) => {
            const d = statusDef(s);
            const curIdx = PIPELINE_STEPS.indexOf(p.status);
            const reached = curIdx >= 0 && i <= curIdx;
            return (
              <li key={s}>
                <button type="button" disabled={!canEdit} aria-pressed={p.status === s} onClick={() => void changeStatus(s)}
                  className={`${chip} ${p.status === s ? chipOn : reached ? 'bg-white/[0.06] border-white/15 text-brand-fg/80' : chipOff} disabled:cursor-default`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${reached ? d.dot : 'bg-white/20'}`} aria-hidden="true" />
                  {d.label}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['lost', 'nurture'] as const).map((s) => (
            <button key={s} type="button" disabled={!canEdit} aria-pressed={p.status === s} onClick={() => void changeStatus(s)}
              className={`${chip} ${p.status === s ? chipOn : chipOff} disabled:cursor-default`}>
              {statusDef(s).label}
            </button>
          ))}
        </div>
      </Section>

      {/* ── follow-up ── */}
      <Section title="Next follow-up">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="Next follow-up date"
            disabled={!canEdit}
            // Uncontrolled + keyed: a controlled date input snaps back on every
            // partial keystroke; the key resyncs it after a chip or a save.
            key={p.next_follow_up ?? 'none'}
            defaultValue={p.next_follow_up ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') { void setFollowUp(null); return; }
              // Desktop date fields fire per keystroke while the year is typed
              // ('0002-…'); only commit a plausible full date.
              const parts = parseDateKey(v);
              if (parts !== null && parts[0] >= 2000 && parts[0] <= 2100) void setFollowUp(v);
            }}
            className={`${inputCls} w-auto [color-scheme:dark]`}
          />
          {canEdit && (
            <>
              {([[1, '+1d'], [3, '+3d'], [7, '+1w']] as const).map(([n, label]) => (
                <button key={label} type="button" onClick={() => void setFollowUp(addDaysToKey(fuBase, n))} className={`${chip} ${chipOff}`}
                  aria-label={`Follow up ${n === 7 ? 'in a week' : `in ${n} day${n === 1 ? '' : 's'}`}`}>
                  {label}
                </button>
              ))}
              {p.next_follow_up !== null && (
                <button type="button" onClick={() => void setFollowUp(null)} className={`${chip} border-transparent text-brand-muted hover:text-brand-fg`}>
                  <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Clear
                </button>
              )}
            </>
          )}
        </div>
      </Section>

      {/* ── collateral ── */}
      <Section title="Sent so far">
        <CollateralList items={primary} prospect={p} now={now} canEdit={canEdit} actions={actions} onCopy={copyLink} />
        {other.length > 0 && (
          <details className="mt-2 group" open={other.some((c) => p.collateral[c.id] !== undefined) || undefined}>
            <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 min-h-11 font-label uppercase tracking-[0.2em] text-[10px] text-brand-muted hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/70 rounded">
              <ChevronDown className="w-4 h-4 motion-safe:transition-transform group-open:rotate-180" aria-hidden="true" />
              Other market ({other.length})
            </summary>
            <CollateralList items={other} prospect={p} now={now} canEdit={canEdit} actions={actions} onCopy={copyLink} />
          </details>
        )}
      </Section>

      {/* ── details ── */}
      <Section title="Details">
        <button type="button" onClick={() => setFormOpen((v) => !v)} aria-expanded={formOpen} aria-controls={`crm-form-${p.id}`}
          className="inline-flex items-center gap-1.5 min-h-11 text-sm text-brand-fg/85 hover:text-brand-fg">
          <ChevronDown className={`w-4 h-4 motion-safe:transition-transform ${formOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          {formOpen ? 'Hide details' : canEdit ? 'Edit contact details, socials and notes' : 'Show contact details and notes'}
          {dirty && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)]" aria-label="Unsaved changes" />}
        </button>
        {!formOpen && p.notes !== null && (
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-brand-fg/80 line-clamp-4">{p.notes}</p>
        )}
        {formOpen && (
          <form id={`crm-form-${p.id}`} noValidate onSubmit={(e) => { e.preventDefault(); void saveForm(); }} className="mt-2">
            <fieldset disabled={!canEdit} className="grid sm:grid-cols-2 gap-3.5 min-w-0">
              <Field label="Name" error={errors.name}>
                {(a) => <input {...a} value={form.name} onChange={set('name')} maxLength={LIMITS.name} className={inputCls} />}
              </Field>
              <Field label="Company" error={errors.company}>
                {(a) => <input {...a} value={form.company} onChange={set('company')} maxLength={LIMITS.company} className={inputCls} />}
              </Field>
              <Field label="Role" error={errors.role}>
                {(a) => <input {...a} value={form.role} onChange={set('role')} maxLength={LIMITS.role} className={inputCls} />}
              </Field>
              <Field label="Location" error={errors.location}>
                {(a) => <input {...a} value={form.location} onChange={set('location')} maxLength={LIMITS.location} className={inputCls} />}
              </Field>
              <div className="sm:col-span-2">
                <p className={labelCls} id={`crm-type-${p.id}`}>Type</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={`crm-type-${p.id}`}>
                  {CRM_ICPS.map((i) => (
                    <button key={i.id} type="button" role="radio" aria-checked={form.icp === i.id} onClick={() => setForm((f) => ({ ...f, icp: i.id }))}
                      className={`${chip} ${form.icp === i.id ? chipOn : chipOff}`}>{i.label}</button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className={labelCls} id={`crm-market-${p.id}`}>Market</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={`crm-market-${p.id}`}>
                  {MARKETS.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={form.market === m.id} onClick={() => setForm((f) => ({ ...f, market: m.id }))}
                      className={`${chip} ${form.market === m.id ? chipOn : chipOff}`}>{m.label}</button>
                  ))}
                </div>
              </div>
              <Field label="Email" error={errors.email}>
                {(a) => <input {...a} type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={set('email')} className={inputCls} />}
              </Field>
              <Field label="Phone" error={errors.phone} hint="Include the country code for WhatsApp.">
                {(a) => <input {...a} type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} maxLength={LIMITS.phone} className={inputCls} />}
              </Field>
              <Field label="Website" error={errors.website}>
                {(a) => <input {...a} inputMode="url" autoCapitalize="none" value={form.website} onChange={set('website')} className={inputCls} placeholder="example.com" />}
              </Field>
              <Field label={`Deal value (${MARKETS.find((m) => m.id === form.market)?.symbol ?? '$'})`} error={errors.dealValue}>
                {(a) => <input {...a} inputMode="decimal" value={form.dealValue} onChange={set('dealValue')} className={inputCls} placeholder="1,500" />}
              </Field>
              <Field label="Where you found them" error={errors.source}>
                {(a) => <input {...a} value={form.source} onChange={set('source')} maxLength={LIMITS.source} className={inputCls} />}
              </Field>
              {isAdmin && team.length > 1 && (
                <label className="block">
                  <span className={labelCls}>Owner</span>
                  <select
                    value={p.owner_id ?? ''}
                    onChange={(e) => void actions.patch(p.id, { owner_id: e.target.value === '' ? null : e.target.value })}
                    className={inputCls}
                  >
                    {p.owner_id === null && <option value="">Nobody</option>}
                    {team.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
                  </select>
                </label>
              )}
              {SOCIAL_KEYS.map((k) => (
                <Field key={k} label={SOCIAL_LABELS[k]} error={errors[`socials.${k}`]}>
                  {(a) => <input {...a} autoCapitalize="none" spellCheck={false} value={form.socials[k]} onChange={setSocial(k)} className={inputCls} placeholder="@handle or link" />}
                </Field>
              ))}
              <div className="sm:col-span-2">
                <Field label="Notes" error={errors.notes}>
                  {(a) => <AutoTextarea {...a} value={form.notes} onChange={set('notes')} maxLength={LIMITS.notes} minRows={4} />}
                </Field>
              </div>
            </fieldset>
            {canEdit && (
              <div className="mt-4 flex flex-wrap gap-2 sticky bottom-0 py-2 -mx-1 px-1">
                <button type="submit" disabled={!dirty || saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save changes'}</button>
                {dirty && (
                  <button type="button" onClick={() => { setForm(serverForm); setBaseline(serverForm); setErrors({}); }} className={btnQuiet}>
                    Discard
                  </button>
                )}
              </div>
            )}
          </form>
        )}
      </Section>

      {/* ── timeline ── */}
      <Section title="Activity">
        {tlState === 'loading' && timeline.length === 0 ? (
          <div className="py-4 flex justify-center"><Spinner label="Loading activity" /></div>
        ) : tlState === 'error' ? (
          <div role="alert" className="text-xs text-amber-200">
            Couldn’t load the activity. {tlError}{' '}
            <button type="button" onClick={() => void loadTimeline()} className="underline underline-offset-4 min-h-11">Retry</button>
          </div>
        ) : timeline.length === 0 ? (
          <p className="text-sm text-brand-muted">Nothing logged yet. Your first DM goes here.</p>
        ) : (
          <ol className="relative space-y-3 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-white/[0.08]">
            {timeline.map((a) => {
              const Icon = KIND_ICON[a.kind];
              const pending = a.id.startsWith('tmp-');
              return (
                <li key={a.id} className={`relative flex gap-3 ${pending ? 'opacity-60' : ''}`}>
                  <span className={`relative z-10 inline-flex w-8 h-8 shrink-0 items-center justify-center rounded-full border ${isTouchKind(a.kind) ? 'bg-[color:var(--color-accent)]/12 border-[color:var(--color-accent)]/30 text-[color:var(--color-accent)]' : 'bg-white/[0.04] border-white/10 text-brand-muted'}`}>
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-xs text-brand-muted">
                      <span className="text-brand-fg/90">{KIND_LABEL[a.kind]}</span>
                      {a.channel !== null && a.kind === 'dm' ? ` · ${DM_LABEL[a.channel as (typeof DM_CHANNELS)[number]] ?? a.channel}` : ''}
                      {' · '}{a.channel === 'booking' ? 'Booked online' : actorName(a.actor_id)}{' · '}{pending ? 'saving…' : activityWhen(a.created_at, now)}
                    </p>
                    {a.body !== null && <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-brand-fg/85 break-words">{a.body}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {picker && <TemplatePicker prospect={p} senderName={senderName} refCode={refCode} bookingLink={bookingLink} onClose={() => setPicker(false)} />}
      {confirmDelete && (
        <Portal><ConfirmModal
          title={`Delete ${p.name}?`}
          body="This removes them and their activity log for everyone on the team. It can’t be undone — export a CSV first if you might need it."
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={() => {
            setDeleting(true);
            void actions.remove(p.id).then((ok) => { setDeleting(false); if (ok) setConfirmDelete(false); });
          }}
          onCancel={() => setConfirmDelete(false)}
        /></Portal>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 pt-4 border-t border-white/[0.06]">
      <h3 className={labelCls}>{title}</h3>
      {children}
    </section>
  );
}

function CollateralList({
  items, prospect, now, canEdit, actions, onCopy,
}: {
  items: CollateralItem[];
  prospect: Prospect;
  now: Date;
  canEdit: boolean;
  actions: CrmActions;
  onCopy: (item: CollateralItem) => Promise<void>;
}) {
  return (
    <ul className="divide-y divide-white/[0.05]">
      {items.map((c) => {
        const stamp = prospect.collateral[c.id];
        const sent = stamp !== undefined;
        return (
          <li key={c.id} className="flex items-center gap-2">
            <label className={`flex items-center gap-3 flex-1 min-w-0 min-h-12 ${canEdit ? 'cursor-pointer' : ''}`}>
              <input
                type="checkbox"
                checked={sent}
                disabled={!canEdit}
                onChange={(e) => void actions.toggleCollateral(prospect.id, c.id, e.target.checked)}
                className="w-5 h-5 shrink-0 accent-[color:var(--color-accent)]"
              />
              <span className="min-w-0">
                <span className={`block text-sm truncate ${sent ? 'text-brand-fg' : 'text-brand-fg/80'}`}>{c.label}</span>
                {sent && <span className="block text-[11px] text-emerald-200/80">{sentAgo(stamp, now)}</span>}
              </span>
            </label>
            {c.path !== undefined && (
              <button type="button" onClick={() => void onCopy(c)} aria-label={`Copy link to ${c.label}`} title="Copy link" className={iconBtn}>
                <Link2 className="w-4 h-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
