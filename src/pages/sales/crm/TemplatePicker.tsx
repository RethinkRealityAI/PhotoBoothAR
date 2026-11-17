/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Copy message": the playbook's templates for THIS prospect (their ICP or
 * 'any', AND their market or 'any'), filled with what we honestly know. Tokens
 * we can't fill stay visible as [token] (fillTemplate's contract) and are
 * called out, so a half-personalised opener is never pasted by accident.
 */
import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';
import { copyText } from '../../../lib/clipboard';
import { templatesFor, templateVarsFor, type Prospect } from '../../../lib/crm';
import { fillTemplate, TEMPLATES } from '../../../lib/salesContent';
import { TEMPLATE_TOKENS, type TemplateChannel } from '../../../lib/salesTypes';
import { btnPrimary, btnQuiet, chip, chipOff, chipOn, Pill, Sheet } from './ui';

const CHANNEL_LABEL: Record<TemplateChannel, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', linkedin: 'LinkedIn', email: 'Email', sms: 'SMS', call: 'Call script',
};

function missingTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[([A-Za-z0-9_]+)\]/g)) {
    if ((TEMPLATE_TOKENS as readonly string[]).includes(m[1])) out.add(m[1]);
  }
  return [...out];
}

export default function TemplatePicker({
  prospect, senderName, refCode, bookingLink, onClose,
}: { prospect: Prospect; senderName: string; refCode: string | null; bookingLink: string | null; onClose: () => void }) {
  const toast = useToast();
  const [channel, setChannel] = useState<TemplateChannel | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const list = useMemo(() => templatesFor(TEMPLATES, prospect.icp, prospect.market), [prospect.icp, prospect.market]);
  const channels = useMemo(() => [...new Set(list.map((t) => t.channel))], [list]);
  const vars = useMemo(
    () => templateVarsFor(prospect, { name: senderName, refCode, origin: window.location.origin, bookingLink }),
    [prospect, senderName, refCode, bookingLink],
  );
  const shown = channel === null ? list : list.filter((t) => t.channel === channel);

  async function copy(key: string, text: string, what: string) {
    const ok = await copyText(text);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
      toast.push(`${what} copied — paste it in.`, 'success');
    } else {
      toast.push('This browser blocked the copy. Long-press the text to copy it instead.', 'error');
    }
  }

  return (
    <Sheet title="Copy a message" onClose={onClose} dismissOnScrim wide>
      {list.length === 0 ? (
        <p className="text-sm text-brand-muted">No templates for this type and market yet.</p>
      ) : (
        <>
          {channels.length > 1 && (
            <div className="-mx-1 px-1 mb-3 flex gap-1.5 overflow-x-auto hide-scrollbar" role="group" aria-label="Filter by channel">
              <button type="button" aria-pressed={channel === null} onClick={() => setChannel(null)} className={`${chip} ${channel === null ? chipOn : chipOff}`}>All</button>
              {channels.map((c) => (
                <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)} className={`${chip} ${channel === c ? chipOn : chipOff}`}>
                  {CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          )}
          <ul className="space-y-3">
            {shown.map((t) => {
              const body = fillTemplate(t.body, vars);
              const subject = t.subject !== undefined ? fillTemplate(t.subject, vars) : null;
              const missing = missingTokens(`${subject ?? ''} ${body}`);
              return (
                <li key={t.id} className="liquid-glass rounded-2xl p-4">
                  <div className="flex items-start gap-2 flex-wrap">
                    <h3 className="font-sans text-sm font-medium text-brand-fg flex-1 min-w-0">{t.title}</h3>
                    <Pill className="bg-white/[0.04] border-white/12 text-brand-muted">{CHANNEL_LABEL[t.channel]}</Pill>
                    <Pill className="bg-white/[0.04] border-white/12 text-brand-muted">{t.stage}</Pill>
                  </div>
                  {t.when !== '' && <p className="mt-1 text-[11px] text-brand-muted/70">{t.when}</p>}
                  {subject !== null && <p className="mt-3 text-xs text-brand-fg/90"><span className="text-brand-muted">Subject: </span>{subject}</p>}
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-brand-fg/85 select-text">{body}</p>
                  {missing.length > 0 && (
                    <p className="mt-2 text-[11px] text-amber-200/90">
                      Fill in before sending: {missing.map((m) => `[${m}]`).join(', ')}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copy(t.id, body, 'Message')} className={btnPrimary}>
                      {copied === t.id ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                      {copied === t.id ? 'Copied' : 'Copy message'}
                    </button>
                    {subject !== null && (
                      <button type="button" onClick={() => void copy(`${t.id}-s`, subject, 'Subject')} className={btnQuiet}>
                        {copied === `${t.id}-s` ? 'Copied' : 'Copy subject'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
