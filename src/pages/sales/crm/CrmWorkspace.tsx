/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The CRM proper (a signed-in sales member). Owns the data and every write;
 * children only render and call back. All writes are optimistic: the UI moves
 * first, and a failure rolls back ONLY the fields that write touched (so a
 * second in-flight edit is not undone with it) and says so in a toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Download, Plus, RefreshCw, Search, UserPlus, Users, X,
} from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';
import {
  applyCollateral, CRM_ICPS, DAILY_TOUCH_TARGET, filterProspects, followUpLabel, followUpState,
  formatCentsCompact, icpDef, isTouchKind, localDateKey, memberName, pipelineSummary, PROSPECT_STATUSES,
  prospectsToCsv, sortForWorklist, startOfLocalDayIso, statusDef, touchesToday, SOCIAL_KEYS, SOCIAL_LABELS,
  type Activity, type ActivityKind, type CrmIcp, type Prospect, type ProspectStatus, type TeamMember,
} from '../../../lib/crm';
import {
  createProspect, deleteProspect, listMyActivitiesSince, listProspects, logActivity, teamList,
  toggleCollateral, updateProspect, type ProspectPatch,
} from '../../../lib/crmApi';
import { MARKETS, type Market } from '../../../lib/salesTypes';
import { signOut } from '../../../lib/auth';
import ProspectDetail from './ProspectDetail';
import QuickAdd from './QuickAdd';
import TeamPanel from './TeamPanel';
import { btnPrimary, btnQuiet, chip, chipOff, chipOn, iconBtn, Pill, ProgressRing, SOCIAL_ICONS, Spinner } from './ui';

export interface CrmActions {
  patch: (id: string, patch: ProspectPatch) => Promise<boolean>;
  toggleCollateral: (id: string, collateralId: string, sent: boolean) => Promise<boolean>;
  /** Writes the activity; returns the saved row or null (already toasted). */
  log: (prospectId: string, kind: ActivityKind, channel: string | null, body: string | null) => Promise<Activity | null>;
  remove: (id: string) => Promise<boolean>;
}

type StatusFilter = ProspectStatus | 'open' | null;
type DueFilter = 'due' | 'soon' | null;

export default function CrmWorkspace({
  userId, userEmail, isAdmin,
}: { userId: string; userEmail: string; isAdmin: boolean }) {
  const toast = useToast();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [myActs, setMyActs] = useState<Activity[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [now, setNow] = useState(() => new Date());

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [icp, setIcp] = useState<CrmIcp | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [due, setDue] = useState<DueFilter>(null);
  const [mineOnly, setMineOnly] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  // Latest list for rollbacks computed outside a setState updater.
  const listRef = useRef<Prospect[]>([]);
  useEffect(() => { listRef.current = prospects; }, [prospects]);

  // The clock: "today" must roll over at local midnight without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayKey = localDateKey(now);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([listProspects(), teamList()]);
    setLoadErr(p.error);
    // On failure keep whatever we already had on screen.
    if (p.data !== null) setProspects(p.data);
    if (t.data !== null) setTeam(t.data);
    setLoaded(true);
  }, []);

  const loadTeam = useCallback(async () => {
    const t = await teamList();
    if (t.data !== null) setTeam(t.data);
    return t.error;
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let live = true;
    void listMyActivitiesSince(startOfLocalDayIso(new Date())).then((r) => {
      if (live && r.data !== null) setMyActs(r.data);
    });
    return () => { live = false; };
  }, [todayKey]);

  const touches = touchesToday(myActs, userId, now);
  const summary = useMemo(() => pipelineSummary(prospects, now), [prospects, now]);
  const ownerNames = useMemo(() => new Map(team.map((m) => [m.user_id, memberName(m)])), [team]);
  const showOwner = team.length > 1;
  const me = team.find((m) => m.user_id === userId);
  const senderName = me !== undefined ? memberName(me) : (userEmail.split('@')[0] ?? '');

  const visible = useMemo(
    () => sortForWorklist(
      filterProspects(prospects, {
        query, status, icp, market, owner: mineOnly ? userId : null, due,
      }, now),
      now,
    ),
    [prospects, query, status, icp, market, mineOnly, userId, due, now],
  );
  const anyFilter = query.trim() !== '' || status !== 'open' || icp !== null || market !== null || due !== null || mineOnly;
  const selected = selectedId === null ? null : prospects.find((p) => p.id === selectedId) ?? null;

  // ── writes ────────────────────────────────────────────────────────────────

  const setRow = useCallback((id: string, fn: (p: Prospect) => Prospect) => {
    setProspects((list) => list.map((p) => (p.id === id ? fn(p) : p)));
  }, []);

  const patch = useCallback<CrmActions['patch']>(async (id, change) => {
    const before = listRef.current.find((p) => p.id === id);
    if (before === undefined) return false;
    const keys = Object.keys(change) as Array<keyof ProspectPatch>;
    const prev: Record<string, unknown> = {};
    for (const k of keys) prev[k] = (before as unknown as Record<string, unknown>)[k];
    setRow(id, (p) => ({ ...p, ...change } as Prospect));
    const r = await updateProspect(id, change);
    if (r.data === null) {
      setRow(id, (p) => ({ ...p, ...prev } as Prospect));
      toast.push(r.error ?? 'That change didn’t save.', 'error');
      return false;
    }
    const server = r.data as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { updated_at: r.data.updated_at };
    for (const k of keys) merged[k] = server[k];
    setRow(id, (p) => ({ ...p, ...merged } as Prospect));
    return true;
  }, [setRow, toast]);

  const toggle = useCallback<CrmActions['toggleCollateral']>(async (id, collateralId, sent) => {
    const before = listRef.current.find((p) => p.id === id);
    if (before === undefined) return false;
    const prevStamp = before.collateral[collateralId];
    setRow(id, (p) => ({ ...p, collateral: applyCollateral(p.collateral, collateralId, sent, new Date().toISOString()) }));
    const r = await toggleCollateral({ id }, collateralId, sent);
    if (r.data === null) {
      setRow(id, (p) => {
        const c = { ...p.collateral };
        if (prevStamp === undefined) delete c[collateralId]; else c[collateralId] = prevStamp;
        return { ...p, collateral: c };
      });
      toast.push(r.error ?? 'Couldn’t update that checklist item.', 'error');
      return false;
    }
    const server = r.data;
    setRow(id, (p) => ({ ...p, collateral: server.collateral, updated_at: server.updated_at }));
    return true;
  }, [setRow, toast]);

  const log = useCallback<CrmActions['log']>(async (prospectId, kind, channel, body) => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const temp: Activity = {
      id: tempId, prospect_id: prospectId, actor_id: userId, kind, channel, body,
      created_at: new Date().toISOString(),
    };
    if (isTouchKind(kind)) setMyActs((a) => [temp, ...a]);
    const r = await logActivity(prospectId, kind, channel, body);
    if (r.data === null) {
      setMyActs((a) => a.filter((x) => x.id !== tempId));
      toast.push(r.error ?? 'That touch didn’t save.', 'error');
      return null;
    }
    const saved = r.data.activity;
    setMyActs((a) => a.map((x) => (x.id === tempId ? saved : x)));
    const lca = r.data.lastContactedAt;
    if (lca !== null) setRow(prospectId, (p) => ({ ...p, last_contacted_at: lca }));
    return saved;
  }, [setRow, toast, userId]);

  const remove = useCallback<CrmActions['remove']>(async (id) => {
    const idx = listRef.current.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    const row = listRef.current[idx];
    setProspects((list) => list.filter((p) => p.id !== id));
    setSelectedId((s) => (s === id ? null : s));
    const r = await deleteProspect(id);
    if (r.data === null) {
      setProspects((list) => {
        const copy = [...list];
        copy.splice(Math.min(idx, copy.length), 0, row);
        return copy;
      });
      toast.push(r.error ?? 'Couldn’t delete that prospect.', 'error');
      return false;
    }
    toast.push(`Deleted ${row.name}.`, 'success');
    return true;
  }, [toast]);

  const actions: CrmActions = { patch, toggleCollateral: toggle, log, remove };

  function exportCsv() {
    const csv = prospectsToCsv(visible, (id) => (id === null ? '' : ownerNames.get(id) ?? ''));
    try {
      // BOM so Excel reads UTF-8 (naira signs, accented names) correctly.
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `beamwall-prospects-${todayKey}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.push(`Exported ${visible.length} prospect${visible.length === 1 ? '' : 's'}.`, 'success');
    } catch {
      toast.push('Couldn’t create the CSV file on this device.', 'error');
    }
  }

  function clearFilters() {
    setQuery(''); setStatus('open'); setIcp(null); setMarket(null); setDue(null); setMineOnly(false);
  }

  function select(id: string | null) {
    setSelectedId(id);
    // On a phone the detail replaces the list — start it at the top.
    if (id !== null && typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      window.scrollTo({ top: 0 });
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const pct = Math.round((Math.min(touches, DAILY_TOUCH_TARGET) / DAILY_TOUCH_TARGET) * 100);
  const encouragement = touches === 0
    ? 'Every reply starts with one message.'
    : touches >= DAILY_TOUCH_TARGET ? 'Target hit — anything more is a bonus.'
      : `${DAILY_TOUCH_TARGET - touches} to go.`;
  const dueNow = summary.overdue + summary.dueToday;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 py-4 sm:py-6 font-sans">
      {/* ── Today ── */}
      <section aria-label="Today" className="liquid-glass-raised rounded-3xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative" role="img" aria-label={`${touches} of ${DAILY_TOUCH_TARGET} touches today, ${pct}%`}>
            <ProgressRing value={touches} target={DAILY_TOUCH_TARGET} />
            <span className="absolute inset-0 flex items-center justify-center font-sans text-lg font-medium tabular-nums text-brand-fg">{touches}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-label uppercase tracking-[0.22em] text-[10px] text-brand-muted/70">Today</p>
            <p className="font-serif text-xl sm:text-2xl text-brand-fg leading-tight lining-nums tabular-nums">
              {touches} / {DAILY_TOUCH_TARGET} touches today
            </p>
            <p className="text-xs text-brand-muted mt-0.5">{encouragement}</p>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => { setDue(due === 'due' ? null : 'due'); setStatus(null); }}
              aria-pressed={due === 'due'}
              className={`${chip} ${due === 'due' ? chipOn : dueNow > 0 ? 'bg-amber-400/10 border-amber-300/35 text-amber-100' : chipOff}`}
            >
              <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
              {dueNow === 0 ? 'No follow-ups due'
                : `${summary.overdue > 0 ? `${summary.overdue} overdue · ` : ''}${summary.dueToday} due today`}
            </button>
            {MARKETS.map((m) => (
              summary.openByMarket[m.id] > 0 && (
                <span key={m.id} className={`${chip} ${chipOff} cursor-default`} title={`Open pipeline, ${m.label}`}>
                  {m.id.toUpperCase()} · {formatCentsCompact(summary.openValueByMarket[m.id], m.id)} open
                </span>
              )
            ))}
          </div>
        </div>
      </section>

      {/* ── Toolbar ── */}
      <div className="mt-4 flex items-center gap-2">
        <label className="relative flex-1 min-w-0">
          <span className="sr-only">Search prospects</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted/50" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, company, handle, notes…"
            className="w-full min-h-11 rounded-xl liquid-glass-inset pl-10 pr-3 text-[15px] sm:text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]/50"
          />
        </label>
        <button type="button" onClick={() => setAdding(true)} className={`${btnPrimary} max-sm:hidden`}>
          <Plus className="w-4 h-4" aria-hidden="true" /> Add prospect
        </button>
        <button type="button" onClick={exportCsv} disabled={visible.length === 0} aria-label={`Export ${visible.length} prospects as CSV`} title="Export CSV" className={iconBtn}>
          <Download className="w-4 h-4" />
        </button>
        {isAdmin && (
          <button type="button" onClick={() => setTeamOpen(true)} aria-label="Team access" title="Team access" className={iconBtn}>
            <Users className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="mt-3 -mx-3 px-3 sm:-mx-4 sm:px-4 flex gap-2 overflow-x-auto hide-scrollbar pb-1" role="group" aria-label="Filter by status">
        <FilterChip on={status === null} onClick={() => setStatus(null)}>All {summary.total}</FilterChip>
        <FilterChip on={status === 'open'} onClick={() => setStatus('open')}>Open {summary.open}</FilterChip>
        {PROSPECT_STATUSES.map((s) => (
          <FilterChip key={s.id} on={status === s.id} onClick={() => setStatus(status === s.id ? 'open' : s.id)}>
            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
            {s.label} {summary.counts[s.id]}
          </FilterChip>
        ))}
      </div>
      <div className="mt-1.5 -mx-3 px-3 sm:-mx-4 sm:px-4 flex gap-2 overflow-x-auto hide-scrollbar pb-1" role="group" aria-label="More filters">
        {MARKETS.map((m) => (
          <FilterChip key={m.id} on={market === m.id} onClick={() => setMarket(market === m.id ? null : m.id)}>{m.label}</FilterChip>
        ))}
        <span className="w-px self-stretch my-2 bg-white/10 shrink-0" aria-hidden="true" />
        {CRM_ICPS.map((i) => (
          <FilterChip key={i.id} on={icp === i.id} onClick={() => setIcp(icp === i.id ? null : i.id)}>{i.label}s</FilterChip>
        ))}
        <span className="w-px self-stretch my-2 bg-white/10 shrink-0" aria-hidden="true" />
        <FilterChip on={due === 'soon'} onClick={() => setDue(due === 'soon' ? null : 'soon')}>Due soon</FilterChip>
        {showOwner && <FilterChip on={mineOnly} onClick={() => setMineOnly((v) => !v)}>Mine</FilterChip>}
        {anyFilter && (
          <button type="button" onClick={clearFilters} className={`${chip} border-transparent text-brand-muted hover:text-brand-fg`}>
            <X className="w-3.5 h-3.5" aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      {loadErr !== null && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-amber-100/90 flex-1 min-w-0">
            Couldn’t load the pipeline. {loadErr}
            {prospects.length > 0 && <span className="text-amber-100/60"> What’s below may be out of date.</span>}
          </p>
          <button type="button" onClick={() => void load()} className={btnQuiet}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-4 lg:items-start">
        {/* ── List ── */}
        <section aria-label="Prospects" className={selected !== null ? 'hidden lg:block' : ''}>
          {!loaded ? (
            <div className="liquid-glass rounded-2xl p-10 flex justify-center"><Spinner label="Loading prospects" /></div>
          ) : prospects.length === 0 && loadErr === null ? (
            <EmptyState onAdd={() => setAdding(true)} />
          ) : visible.length === 0 ? (
            <div className="liquid-glass rounded-2xl p-8 text-center">
              <p className="text-sm text-brand-muted">Nobody matches those filters.</p>
              <button type="button" onClick={clearFilters} className={`${btnQuiet} mt-3`}>Clear filters</button>
            </div>
          ) : (
            <ul className="space-y-2">
              {visible.map((p) => (
                <ProspectCard
                  key={p.id}
                  p={p}
                  now={now}
                  active={p.id === selectedId}
                  owner={showOwner && p.owner_id !== null ? ownerNames.get(p.owner_id) ?? null : null}
                  onOpen={() => select(p.id)}
                />
              ))}
            </ul>
          )}
          <div className="mt-6 flex items-center justify-between gap-3 text-[11px] text-brand-muted/60">
            <span className="truncate">Signed in as {userEmail}</span>
            <button type="button" onClick={() => void signOut()} className="min-h-11 px-2 underline-offset-4 hover:underline hover:text-brand-fg">
              Sign out
            </button>
          </div>
        </section>

        {/* ── Detail ── */}
        <section
          aria-label="Prospect details"
          className={`${selected === null ? 'hidden lg:block' : ''} lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain rounded-3xl`}
        >
          {selected === null ? (
            <div className="liquid-glass rounded-3xl p-10 text-center">
              <p className="text-sm text-brand-muted">Pick someone to see their details, log a touch or copy a message.</p>
            </div>
          ) : (
            <ProspectDetail
              key={selected.id}
              prospect={selected}
              now={now}
              userId={userId}
              isAdmin={isAdmin}
              team={team}
              ownerName={selected.owner_id !== null ? ownerNames.get(selected.owner_id) ?? null : null}
              refCode={me?.ref_code ?? null}
              senderName={senderName}
              actions={actions}
              onBack={() => select(null)}
            />
          )}
        </section>
      </div>

      {/* Phone: the add button lives under the thumb. */}
      {selected === null && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add prospect"
          className="sm:hidden fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 pressable inline-flex items-center gap-2 h-14 px-5 rounded-full bg-[color:var(--color-accent)] text-[color:var(--on-accent)] shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] font-label uppercase tracking-[0.2em] text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-[color:var(--color-accent)]"
        >
          <UserPlus className="w-5 h-5" aria-hidden="true" /> Add
        </button>
      )}

      {adding && (
        <QuickAdd
          onClose={() => setAdding(false)}
          create={async (payload) => {
            const r = await createProspect(payload);
            if (r.data === null) return r.error ?? 'Couldn’t add that prospect.';
            const created = r.data;
            setProspects((list) => [created, ...list]);
            toast.push(`Added ${created.name}.`, 'success');
            return null;
          }}
        />
      )}

      {teamOpen && isAdmin && (
        <TeamPanel team={team} userId={userId} reload={loadTeam} onClose={() => setTeamOpen(false)} />
      )}
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`${chip} ${on ? chipOn : chipOff}`}>
      {children}
    </button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="liquid-glass rounded-3xl p-8 text-center">
      <span className="inline-flex w-12 h-12 items-center justify-center rounded-2xl bg-[color:var(--color-accent)]/12 text-[color:var(--color-accent)]">
        <UserPlus className="w-5 h-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 font-serif text-2xl text-foil-static">Add your first prospect</h2>
      <p className="mt-2 text-sm text-brand-muted leading-relaxed max-w-xs mx-auto">
        Just a name and a handle is enough — you can fill in the rest after the chat.
      </p>
      <button type="button" onClick={onAdd} className={`${btnPrimary} mt-5`}>
        <Plus className="w-4 h-4" aria-hidden="true" /> Add prospect
      </button>
    </div>
  );
}

const FOLLOW_BADGE: Record<'overdue' | 'today' | 'soon', string> = {
  overdue: 'bg-rose-400/12 border-rose-300/35 text-rose-100',
  today: 'bg-amber-400/12 border-amber-300/40 text-amber-100',
  soon: 'bg-sky-400/10 border-sky-300/25 text-sky-100',
};

function ProspectCard({
  p, now, active, owner, onOpen,
}: { p: Prospect; now: Date; active: boolean; owner: string | null; onOpen: () => void }) {
  const fu = followUpState(p, now);
  const st = statusDef(p.status);
  const icpD = icpDef(p.icp);
  const socials = SOCIAL_KEYS.filter((k) => typeof p.socials[k] === 'string' && p.socials[k] !== '');
  const sub = [p.company, p.location].filter((v): v is string => v !== null && v !== '').join(' · ');
  return (
    <li
      className={`relative rounded-2xl p-3.5 border transition-colors focus-within:ring-2 focus-within:ring-[color:var(--color-accent)]/60 ${
        active ? 'bg-white/[0.08] border-[color:var(--color-accent)]/45' : 'liquid-glass border-transparent hover:bg-white/[0.05]'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          aria-current={active ? 'true' : undefined}
          className="min-w-0 flex-1 text-left font-sans text-[15px] font-medium text-brand-fg truncate focus:outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
        >
          {p.name}
        </button>
        {fu !== 'none' && p.next_follow_up !== null && (
          <Pill className={FOLLOW_BADGE[fu]}>{followUpLabel(p.next_follow_up, now)}</Pill>
        )}
      </div>
      {sub !== '' && <p className="mt-0.5 text-xs text-brand-muted truncate">{sub}</p>}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <Pill className={st.pill}>{st.label}</Pill>
        <Pill className={icpD.pill}>{icpD.label}</Pill>
        <Pill className="bg-white/[0.03] border-white/10 text-brand-muted">{p.market.toUpperCase()}</Pill>
        {p.deal_value_cents !== null && p.deal_value_cents > 0 && (
          <span className="text-[11px] text-brand-muted">{formatCentsCompact(p.deal_value_cents, p.market)}</span>
        )}
        {owner !== null && <span className="text-[11px] text-brand-muted/70 truncate max-w-[8rem]">· {owner}</span>}
        {socials.length > 0 && (
          <span className="ml-auto flex items-center gap-0.5 relative z-10">
            {socials.map((k) => {
              const Icon = SOCIAL_ICONS[k];
              return (
                <a
                  key={k}
                  href={p.socials[k]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${p.name} on ${SOCIAL_LABELS[k]} (opens in a new tab)`}
                  className="inline-flex w-11 h-11 -my-1.5 items-center justify-center rounded-lg text-brand-muted hover:text-brand-fg hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/70"
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </a>
              );
            })}
          </span>
        )}
      </div>
    </li>
  );
}
