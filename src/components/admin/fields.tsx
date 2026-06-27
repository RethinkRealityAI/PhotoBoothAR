/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared admin form controls (used by Settings + Branding editors).
 */
export const inputCls =
  'w-full bg-noir-800/70 border border-gold-700/25 rounded-lg px-3 py-2 font-sans text-sm text-ivory/90 placeholder-champagne/25 outline-none focus:border-gold-400/55 transition-colors';

export function TextField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/45 block mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
    </label>
  );
}

export function TextArea({
  label, value, onChange, placeholder, rows = 3,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="block">
      <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/45 block mb-1">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={`${inputCls} resize-none`} />
    </label>
  );
}

/** Hex color input with a swatch picker + free-text field, kept in sync. */
export function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  // <input type=color> requires a 6-digit hex; fall back gracefully.
  const swatch = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={swatch}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 shrink-0 rounded-lg bg-transparent cursor-pointer border border-gold-700/30"
        aria-label={`${label} color`}
      />
      <label className="flex-1 min-w-0">
        <span className="font-label uppercase tracking-luxe text-[9px] text-champagne/45 block mb-1">{label}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#RRGGBB" className={`${inputCls} font-mono`} />
      </label>
    </div>
  );
}
