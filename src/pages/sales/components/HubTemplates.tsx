/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hub § Templates: filter by channel / stage / ICP (market comes from the hub
 * switch), a small "fill in" form that live-fills every template through
 * fillTemplate(), and one-tap copy. Anything still unfilled stays visible as
 * a highlighted [token] so a half-filled message is obvious before it is sent.
 */
import { useMemo, useState } from 'react';
import { Instagram, Linkedin, Mail, MessageCircle, MessageSquare, Phone, type LucideIcon } from 'lucide-react';
import { DECKS, fillTemplate, SALES_CONTACT, TEMPLATES } from '../../../lib/salesContent';
import { buildShareLink, countUnfilled, filterTemplates, splitUnfilled, type TemplateFilter } from '../../../lib/salesHub';
import {
  ICP_IDS, PITCH_BASE,
  type IcpId, type Market, type MessageTemplate, type TemplateChannel, type TemplateStage, type TemplateToken,
} from '../../../lib/salesTypes';
import CopyButton from './CopyButton';
import { useStoredJson } from './pageMeta';
import { Chip, ChipRow, ICP_LABEL } from './hubUi';

export const CHANNEL_META: Record<TemplateChannel, { label: string; Icon: LucideIcon }> = {
  whatsapp: { label: 'WhatsApp', Icon: MessageCircle },
  instagram: { label: 'Instagram', Icon: Instagram },
  linkedin: { label: 'LinkedIn', Icon: Linkedin },
  email: { label: 'Email', Icon: Mail },
  sms: { label: 'SMS', Icon: MessageSquare },
  call: { label: 'Call', Icon: Phone },
};
const CHANNELS = Object.keys(CHANNEL_META) as TemplateChannel[];
const STAGES: { id: TemplateStage; label: string }[] = [
  { id: 'opener', label: 'Opener' },
  { id: 'follow-up', label: 'Follow-up' },
  { id: 'breakup', label: 'Break-up' },
  { id: 'after-call', label: 'After call' },
  { id: 'referral', label: 'Referral' },
];

interface Vars {
  firstName: string;
  company: string;
  personalHook: string;
  eventType: string;
}
const EMPTY: Vars = { firstName: '', company: '', personalHook: '', eventType: '' };
const isVars = (v: unknown): v is Vars =>
  typeof v === 'object' && v !== null && ['firstName', 'company', 'personalHook', 'eventType'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string');

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitUnfilled(text).map((s, i) =>
        s.token ? (
          <mark key={i} className="rounded-md bg-amber-300/15 px-1 text-amber-200 ring-1 ring-amber-300/30">{s.text}</mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

const FIELDS: { key: keyof Vars; label: string; placeholder: string }[] = [
  { key: 'firstName', label: 'First name', placeholder: 'Tolu' },
  { key: 'company', label: 'Company', placeholder: 'Bloom Events' },
  { key: 'eventType', label: 'Event type', placeholder: 'wedding' },
  { key: 'personalHook', label: 'Personal hook', placeholder: 'Loved the Eko Hotel reception you posted' },
];

export default function HubTemplates({ market, refCode, origin }: { market: Market; refCode: string; origin: string }) {
  const [filter, setFilter] = useState<Omit<TemplateFilter, 'market'>>({ channel: 'all', stage: 'all', icp: 'all' });
  const [vars, setVars] = useStoredJson<Vars>('beamwall.sales.tplVars', EMPTY, isVars);

  const list = useMemo(() => filterTemplates(TEMPLATES, { ...filter, market }), [filter, market]);

  const deckLinkFor = (t: MessageTemplate): string => {
    const icp: IcpId = t.icp !== 'any' ? t.icp : filter.icp !== 'all' ? filter.icp : 'planners';
    const deck = DECKS.find((d) => d.market === market && d.id === icp);
    return deck === undefined ? '' : buildShareLink(origin, `${PITCH_BASE}/${deck.slug}`, refCode);
  };

  const fill = (t: MessageTemplate, text: string) => {
    const v: Partial<Record<TemplateToken, string>> = {
      ...vars,
      senderName: SALES_CONTACT.name,
      bookingLink: SALES_CONTACT.bookingUrl,
      deckLink: deckLinkFor(t),
    };
    return fillTemplate(text, v);
  };

  const filledCount = FIELDS.filter((f) => vars[f.key].trim() !== '').length;

  return (
    <div className="flex flex-col gap-5">
      {/* Fill-in form */}
      <div className="rounded-[24px] liquid-glass p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-label text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-fg">Fill in once, every template updates</p>
          {filledCount > 0 && (
            <button
              type="button"
              onClick={() => setVars(EMPTY)}
              className="min-h-11 rounded-full px-3 font-label text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-muted hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            >
              Clear
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className={`flex flex-col gap-1.5 ${f.key === 'personalHook' ? 'sm:col-span-2' : ''}`}>
              <span className="text-[12px] font-medium text-brand-muted">{f.label}</span>
              <input
                value={vars[f.key]}
                onChange={(e) => setVars({ ...vars, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                autoComplete="off"
                className="min-h-11 rounded-xl liquid-glass-inset px-3.5 text-[15px] text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
              />
            </label>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-brand-muted/70">
          Your name, the deck link{refCode !== '' ? ' (with your ref code)' : ''} and the booking link fill in automatically.
          Anything still in <mark className="rounded bg-amber-300/15 px-1 text-amber-200">[brackets]</mark> needs you before sending.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <ChipRow label="Channel">
          <Chip active={filter.channel === 'all'} onClick={() => setFilter({ ...filter, channel: 'all' })}>All</Chip>
          {CHANNELS.map((c) => {
            const { label, Icon } = CHANNEL_META[c];
            return (
              <Chip key={c} active={filter.channel === c} onClick={() => setFilter({ ...filter, channel: c })}>
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </Chip>
            );
          })}
        </ChipRow>
        <ChipRow label="Stage">
          <Chip active={filter.stage === 'all'} onClick={() => setFilter({ ...filter, stage: 'all' })}>All</Chip>
          {STAGES.map((s) => (
            <Chip key={s.id} active={filter.stage === s.id} onClick={() => setFilter({ ...filter, stage: s.id })}>{s.label}</Chip>
          ))}
        </ChipRow>
        <ChipRow label="Who">
          <Chip active={filter.icp === 'all'} onClick={() => setFilter({ ...filter, icp: 'all' })}>All</Chip>
          {ICP_IDS.map((i) => (
            <Chip key={i} active={filter.icp === i} onClick={() => setFilter({ ...filter, icp: i })}>{ICP_LABEL[i]}</Chip>
          ))}
        </ChipRow>
      </div>

      <p className="text-[12.5px] text-brand-muted/70" aria-live="polite">
        {list.length} template{list.length === 1 ? '' : 's'}
      </p>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/12 p-6 text-center text-[14px] text-brand-muted">
          Nothing matches those filters. Try “All” on one of them.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((t) => {
            const body = fill(t, t.body);
            const subject = t.subject !== undefined ? fill(t, t.subject) : undefined;
            const open = countUnfilled(body) + (subject !== undefined ? countUnfilled(subject) : 0);
            const { label, Icon } = CHANNEL_META[t.channel];
            return (
              <article key={t.id} className="flex flex-col rounded-[22px] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-1.5 font-label text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-muted">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-brand-fg">
                    <Icon className="h-3 w-3" aria-hidden /> {label}
                  </span>
                  <span className="rounded-full bg-white/[0.04] px-2.5 py-1">{STAGES.find((s) => s.id === t.stage)?.label ?? t.stage}</span>
                  {t.icp !== 'any' && <span className="rounded-full bg-white/[0.04] px-2.5 py-1">{ICP_LABEL[t.icp]}</span>}
                </div>
                <h3 className="mt-3 text-[16px] font-semibold text-brand-fg">{t.title}</h3>
                <p className="mt-1 text-[13px] leading-snug text-brand-muted/80">{t.when}</p>
                {subject !== undefined && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 text-[13.5px]">
                    <span className="font-label text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-muted">Subject</span>
                    <span className="min-w-0 flex-1 text-brand-fg"><Highlighted text={subject} /></span>
                    <CopyButton text={subject} variant="icon" ariaLabel={`Copy subject: ${t.title}`} />
                  </div>
                )}
                <p className="mt-3 flex-1 whitespace-pre-wrap break-words rounded-xl bg-black/25 p-3.5 text-[14px] leading-relaxed text-brand-fg/90">
                  <Highlighted text={body} />
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className={`text-[12px] ${open > 0 ? 'text-amber-200/90' : 'text-emerald-300/90'}`}>
                    {open > 0 ? `${open} to fill` : 'Ready to send'}
                  </span>
                  <CopyButton text={body} label={t.channel === 'call' ? 'Copy script' : 'Copy message'} ariaLabel={`Copy message: ${t.title}`} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
