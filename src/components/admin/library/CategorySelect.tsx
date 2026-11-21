/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pick a library category: a native select with the two-level tree as
 * optgroups. Native on purpose — it is the best picker a phone has.
 */
import { buildCategoryTree, type LibraryCategory } from '../../../lib/libraryTaxonomy';

const FIELD =
  'w-full px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25';

/** A native select with the tree as optgroups — works everywhere, incl. phones. */
export default function CategorySelect({
  value, onChange, categories, label = 'Category', allowNone = true, noneLabel = 'No category', disabled = false, className = '',
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  categories: LibraryCategory[];
  label?: string;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const tree = buildCategoryTree(categories);
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className={`${FIELD} ${className}`}
    >
      {allowNone && <option value="">{noneLabel}</option>}
      {tree.map((n) => (
        <optgroup key={n.category.id} label={n.category.name}>
          <option value={n.category.id}>{n.category.name} (all of it)</option>
          {n.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

