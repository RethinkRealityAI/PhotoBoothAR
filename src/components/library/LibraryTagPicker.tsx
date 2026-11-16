/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tag chips for a shared-library item: occasions · colours · styles, drawn
 * from the ONE vocabulary in src/lib/libraryPublish.ts (which the server
 * mirrors and validates against). Used by the Studio's "Publish to library"
 * dialog and by /admin/library's edit dialog, so the two cannot drift.
 */
import { Check } from 'lucide-react';
import { LIBRARY_TAG_GROUPS, TAG_GROUP_LABEL, type LibraryTags } from '../../lib/libraryPublish';

export default function LibraryTagPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: LibraryTags;
  onChange: (next: LibraryTags) => void;
  disabled?: boolean;
}) {
  const toggle = (group: keyof LibraryTags, tag: string) => {
    const has = value[group].includes(tag);
    const vocab = LIBRARY_TAG_GROUPS.find(([g]) => g === group)?.[1] ?? [];
    const picked = has ? value[group].filter((t) => t !== tag) : [...value[group], tag];
    // Keep vocabulary order so the same choice always serialises the same way.
    onChange({ ...value, [group]: vocab.filter((t) => picked.includes(t)) });
  };

  return (
    <div className="flex flex-col gap-4">
      {LIBRARY_TAG_GROUPS.map(([group, vocab]) => (
        <fieldset key={group} disabled={disabled} className="min-w-0">
          <legend className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 mb-2">
            {TAG_GROUP_LABEL[group]}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {vocab.map((tag) => {
              const on = value[group].includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(group, tag)}
                  className={`pressable inline-flex items-center gap-1 min-h-11 px-3 rounded-full font-sans text-xs capitalize transition-colors disabled:opacity-50 ${
                    on
                      ? 'bg-[color:var(--color-accent)] text-[color:var(--on-accent)]'
                      : 'bg-white/[0.05] hover:bg-white/[0.1] text-brand-fg/80'
                  }`}
                >
                  {on && <Check className="w-3 h-3" aria-hidden />}
                  {tag}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
