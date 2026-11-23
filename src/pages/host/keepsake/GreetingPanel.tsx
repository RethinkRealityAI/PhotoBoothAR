/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keepsake editor · Greeting tab: Beamy on/off, the four copy fields with
 * live counters, and the token chips that insert at the caret of the last
 * field the host was in (rules in lib/keepsakeEditor: insertToken refuses to
 * pass a field's limit, so a full field disables its chips instead).
 */
import { useRef, useState } from 'react';
import { KEEPSAKE_COPY_MAX, type KeepsakeSettings } from '../../../lib/keepsakeSettings';
import { KEEPSAKE_TOKEN_CHIPS, copyCounter, insertToken, type KeepsakeCopyField } from '../../../lib/keepsakeEditor';
import beamyImg from '../../../assets/sales/beamy.webp';
import { Switch } from './controls';

const FIELD_LABEL: Record<KeepsakeCopyField, string> = {
  headline: 'Headline',
  message: 'Message',
  signOff: 'Sign-off',
  hostName: 'Signed by',
};

export function GreetingPanel({ draft, stored, orgName, onChange }: {
  draft: KeepsakeSettings;
  stored: KeepsakeSettings | null;
  orgName: string | null;
  onChange: (fn: (s: KeepsakeSettings) => KeepsakeSettings) => void;
}) {
  /* Token insertion targets the last copy field the host was in. */
  const fieldRefs = useRef<Partial<Record<KeepsakeCopyField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const [activeField, setActiveField] = useState<KeepsakeCopyField>('headline');

  function insertChip(token: string) {
    const el = fieldRefs.current[activeField] ?? null;
    const out = insertToken(draft.copy[activeField], token, el?.selectionStart ?? null, el?.selectionEnd ?? null, KEEPSAKE_COPY_MAX[activeField]);
    if (out === null) return;
    onChange((s) => ({ ...s, copy: { ...s.copy, [activeField]: out.value } }));
    requestAnimationFrame(() => {
      const t = fieldRefs.current[activeField];
      if (t) { t.focus(); t.setSelectionRange(out.caret, out.caret); }
    });
  }

  const prefilled = stored !== null && stored.copy.hostName === '' && orgName !== null && draft.copy.hostName === orgName.trim().slice(0, KEEPSAKE_COPY_MAX.hostName) && draft.copy.hostName !== '';

  const copyField = (field: KeepsakeCopyField, multiline = false) => {
    const max = KEEPSAKE_COPY_MAX[field];
    const value = draft.copy[field];
    const counter = copyCounter(value, max);
    const id = `keepsake-copy-${field}`;
    const common = {
      id,
      value,
      maxLength: max,
      onFocus: () => setActiveField(field),
      onChange: (e: { target: { value: string } }) => {
        const v = e.target.value.slice(0, max);
        onChange((s) => ({ ...s, copy: { ...s.copy, [field]: v } }));
      },
      'aria-describedby': `${id}-count${field === 'hostName' && prefilled ? ` ${id}-note` : ''}`,
      className: 'w-full rounded-xl glass px-4 font-sans text-sm text-brand-fg placeholder:text-brand-muted/35',
    };
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">{FIELD_LABEL[field]}</label>
          <span id={`${id}-count`} className={`font-mono text-[10px] ${counter.near ? 'text-amber-300' : 'text-brand-muted/50'}`} aria-label={`${value.length} of ${max} characters`}>{counter.text}</span>
        </div>
        {multiline ? (
          <textarea ref={(el) => { fieldRefs.current[field] = el; }} rows={3} {...common} className={`${common.className} py-3 resize-y min-h-[5.5rem]`} />
        ) : (
          <input ref={(el) => { fieldRefs.current[field] = el; }} type="text" {...common} className={`${common.className} min-h-11`} placeholder={field === 'hostName' ? 'Your name or your organisation' : undefined} />
        )}
        {field === 'hostName' && prefilled && (
          <p id={`${id}-note`} className="font-sans text-[11px] text-brand-muted/55">Filled in from your organisation’s name. Save to use it on the album.</p>
        )}
      </div>
    );
  };

  const activeMax = KEEPSAKE_COPY_MAX[activeField];
  const activeLen = draft.copy[activeField].length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl glass px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <img src={beamyImg} alt="" aria-hidden width={40} height={36} className="h-9 w-auto shrink-0" />
          <div className="flex min-w-0 flex-col">
            <span id="keepsake-beamy-label" className="font-sans text-sm text-brand-fg">Beamy says hello</span>
            <span className="font-sans text-[11px] leading-snug text-brand-muted/55">A short greeting from Beamy at the top of the album.</span>
          </div>
        </div>
        <Switch on={draft.beamy} onToggle={() => onChange((s) => ({ ...s, beamy: !s.beamy }))} labelledBy="keepsake-beamy-label" />
      </div>

      {draft.beamy ? (
        <>
          {copyField('headline')}
          {copyField('message', true)}
          <div className="grid gap-4 @md:grid-cols-2">
            {copyField('signOff')}
            {copyField('hostName')}
          </div>
          <div className="flex flex-col gap-2">
            <p id="keepsake-chips-label" className="font-sans text-[11px] text-brand-muted/60">
              Tap to add to <span className="text-brand-fg">{FIELD_LABEL[activeField]}</span>. It fills in with the real details for each guest.
            </p>
            <div role="group" aria-labelledby="keepsake-chips-label" className="flex flex-wrap gap-2">
              {KEEPSAKE_TOKEN_CHIPS.map((c) => {
                const noRoom = activeLen + c.token.length > activeMax;
                return (
                  <button
                    key={c.token}
                    type="button"
                    disabled={noRoom}
                    title={noRoom ? `No room left in ${FIELD_LABEL[activeField]}` : undefined}
                    // Keep the field's caret: a mousedown would blur it first.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertChip(c.token)}
                    className="flex min-h-11 items-center gap-1 rounded-full glass px-3.5 font-sans text-xs text-brand-fg transition hover:text-accent-2 disabled:opacity-40"
                  >
                    <span aria-hidden className="text-accent-2">+</span> {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <p className="rounded-2xl glass px-4 py-3 font-sans text-xs leading-relaxed text-brand-muted/70">
          Beamy’s greeting is off, so the album opens straight onto the photos. Switch it on to write a headline, a message and a sign-off.
        </p>
      )}
    </div>
  );
}
