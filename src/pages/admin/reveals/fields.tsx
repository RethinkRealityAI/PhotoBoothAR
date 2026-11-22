/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small form parts the reveal editor's panels share: a labelled text field
 * with a character counter, a group heading and the theme swatch.
 */
import type { ReactNode } from 'react';
import { counter } from '../../../lib/reveals/revealEditor';
import type { ThemePalette } from '../../../lib/reveals/revealModel';

export function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] text-white/65">{hint}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function TextField({ id, label, value, cap, onChange, multiline = false, rows = 3, placeholder, hint, error, prefix, inputMode }: {
  id: string;
  label: string;
  value: string;
  cap: number;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: ReactNode;
  error?: string | null;
  /** Fixed text inside the field before the value ("/reveal/"). */
  prefix?: string;
  inputMode?: 'url' | 'text';
}) {
  const c = counter(value, cap);
  const tone = c.tone === 'full' ? 'text-[#FFD2DA]' : c.tone === 'near' ? 'text-[#FFE3A8]' : 'text-white/50';
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    value,
    maxLength: cap,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  } as const;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="wz-label !mb-1.5">{label}</label>
        <span className={`text-[12px] tabular-nums ${tone}`} aria-hidden>{c.text}</span>
      </div>
      {multiline ? (
        <textarea
          {...common}
          rows={rows}
          className="wz-input !min-h-0 py-2.5 !text-[15px] leading-relaxed resize-none"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : prefix ? (
        <div className="wz-input !min-h-11 !px-0 flex items-center focus-within:shadow-[inset_0_0_0_2px_#fff]">
          <span className="pl-4 text-[15px] text-white/55 select-none whitespace-nowrap">{prefix}</span>
          <input
            {...common}
            type="text"
            inputMode={inputMode}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none pr-4 py-2.5 text-[15px] text-white"
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      ) : (
        <input
          {...common}
          type={inputMode === 'url' ? 'url' : 'text'}
          inputMode={inputMode}
          className="wz-input !min-h-11 !text-[15px]"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-[12.5px] text-white/60">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1.5 text-[13px] text-[#FFD2DA]">{error}</p>}
    </div>
  );
}

/** A theme as solid shapes (backdrop, panel, accent and core lights). No gradient fills. */
export function ThemeSwatch({ palette, size = 'md' }: { palette: ThemePalette; size?: 'sm' | 'md' }) {
  if (size === 'sm') {
    return (
      <span aria-hidden className="relative inline-block h-7 w-7 shrink-0 rounded-full overflow-hidden" style={{ background: palette.bgTop, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)' }}>
        <span className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: palette.bgBottom }} />
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: palette.accent }} />
      </span>
    );
  }
  return (
    <span aria-hidden className="relative block aspect-[4/3] w-full overflow-hidden rounded-[12px]" style={{ background: palette.bgTop }}>
      <span className="absolute inset-x-0 bottom-0 h-[38%]" style={{ background: palette.bgBottom }} />
      <span className="absolute left-[14%] right-[14%] top-[22%] bottom-[18%] rounded-[8px]" style={{ background: palette.panel, boxShadow: '0 0 0 1px rgba(255,255,255,0.12)' }} />
      <span className="absolute left-1/2 top-[36%] h-[24%] aspect-square -translate-x-1/2 rounded-full" style={{ background: palette.accent }} />
      <span className="absolute left-1/2 top-[43%] h-[10%] aspect-square -translate-x-1/2 rounded-full" style={{ background: palette.core }} />
      <span className="absolute left-[30%] right-[30%] bottom-[26%] h-[8%] rounded-full" style={{ background: palette.accent, opacity: 0.85 }} />
    </span>
  );
}
