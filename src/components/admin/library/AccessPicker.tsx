/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Who can use it" for shared-library items: every host, or only the chosen
 * customers (orgs). A piece built for one client stays that client's. The
 * database enforces the choice (migration 048), so this is the whole control:
 * a two-way switch plus a customer search with chips.
 */
import { useEffect, useRef, useState } from 'react';
import { Building2, Loader2, Lock, Search, Users, X } from 'lucide-react';
import { fetchOrgs, type OrgRow } from '../../../lib/admin';
import type { AccessOrg, LibraryAccess } from '../../../lib/adminLibrary';
import { SEARCH_DEBOUNCE_MS } from '../../../lib/serverList';

export interface AccessValue {
  access: LibraryAccess;
  orgs: AccessOrg[];
}

export function sameAccess(a: AccessValue, b: AccessValue): boolean {
  if (a.access !== b.access) return false;
  if (a.access === 'everyone') return true;
  const x = a.orgs.map((o) => o.id).sort().join();
  const y = b.orgs.map((o) => o.id).sort().join();
  return x === y;
}

/** One line for a card or a list row: "Acme only", "Acme + 2 more". */
export function accessSummary(orgs: ReadonlyArray<AccessOrg>): string {
  if (orgs.length === 0) return 'Nobody yet';
  if (orgs.length === 1) return `${orgs[0].name} only`;
  return `${orgs[0].name} + ${orgs.length - 1} more`;
}

export default function AccessPicker({
  value, onChange, disabled = false,
}: {
  value: AccessValue;
  onChange: (v: AccessValue) => void;
  disabled?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<OrgRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Search customers as the operator types (debounced); stale answers dropped.
  useEffect(() => {
    if (!open || value.access !== 'orgs') return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      void fetchOrgs({ search: term.trim() || undefined, limit: 20 }).then((r) => {
        if (!alive) return;
        setLoading(false);
        setFailed(r.error !== null);
        setResults(r.data?.orgs ?? []);
      });
    }, term.trim() === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [term, open, value.access]);

  // Close the result list on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const chosen = new Set(value.orgs.map((o) => o.id));
  const add = (o: OrgRow) => {
    if (chosen.has(o.id)) return;
    onChange({ access: 'orgs', orgs: [...value.orgs, { id: o.id, name: o.name || 'Unnamed customer' }] });
    setTerm('');
  };
  const remove = (id: string) => onChange({ access: 'orgs', orgs: value.orgs.filter((o) => o.id !== id) });

  const option = (mode: LibraryAccess, label: string, icon: React.ReactNode) => {
    const on = value.access === mode;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange({ access: mode, orgs: value.orgs })}
        className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-10 rounded-lg font-sans text-xs transition-colors disabled:opacity-40 ${
          on ? 'bg-white/[0.12] text-brand-fg' : 'text-brand-muted/70 hover:text-brand-fg'
        }`}
      >
        {icon} {label}
      </button>
    );
  };

  const shown = (results ?? []).filter((o) => !chosen.has(o.id)).slice(0, 8);

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Who can use it" className="flex rounded-xl bg-white/[0.04] p-0.5">
        {option('everyone', 'Every host', <Users className="w-3.5 h-3.5" aria-hidden />)}
        {option('orgs', 'Chosen customers', <Lock className="w-3.5 h-3.5" aria-hidden />)}
      </div>

      {value.access === 'orgs' && (
        <>
          {value.orgs.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Chosen customers">
              {value.orgs.map((o) => (
                <li key={o.id} className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] pl-2.5 pr-1 py-0.5 text-[11px] text-brand-fg/90">
                  <Building2 className="w-3 h-3 text-brand-muted/60" aria-hidden />
                  {o.name}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => remove(o.id)}
                    aria-label={`Remove ${o.name}`}
                    className="p-1 rounded-full hover:bg-white/10"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-sans text-[11px] text-amber-200/85">No host can use it until you choose a customer.</p>
          )}

          <div ref={boxRef} className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/50" aria-hidden />
            <input
              type="search"
              value={term}
              disabled={disabled}
              onFocus={() => setOpen(true)}
              onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && shown.length > 0) { e.preventDefault(); add(shown[0]); }
              }}
              placeholder="Add a customer"
              aria-label="Find a customer to add"
              aria-expanded={open}
              className="w-full pl-9 pr-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25"
            />
            {open && (
              <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl glass-strong border border-white/10 shadow-2xl overflow-hidden">
                {loading && results === null ? (
                  <p className="px-3 py-3 flex items-center gap-2 text-xs text-brand-muted/70"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Finding customers…</p>
                ) : failed ? (
                  <p className="px-3 py-3 text-xs text-rose-200/90">Customers could not be loaded. Try again.</p>
                ) : shown.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-brand-muted/70">{term.trim() ? 'No customer by that name.' : 'Every customer is already chosen.'}</p>
                ) : (
                  <ul role="listbox" aria-label="Customers">
                    {shown.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => add(o)}
                          className="w-full flex items-center justify-between gap-3 min-h-11 px-3 text-left hover:bg-white/[0.06]"
                        >
                          <span className="font-sans text-sm text-brand-fg truncate">{o.name || 'Unnamed customer'}</span>
                          <span className="shrink-0 font-sans text-[11px] text-brand-muted/55">
                            {o.eventCount} event{o.eventCount === 1 ? '' : 's'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <p className="font-sans text-[11px] text-brand-muted/55 leading-snug">
            Only hosts in these customers see it in their library and can add it to an event. Events that already use it keep it.
          </p>
        </>
      )}
    </div>
  );
}
