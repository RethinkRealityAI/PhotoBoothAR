/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hub § 30-day plan and § Daily targets.
 *
 * Ticks, the start date and today's tallies live in localStorage: a per-device
 * convenience, said so in the UI. Nothing here is a record anyone else relies
 * on — the CRM is where real activity is logged.
 */
import { CheckCircle2, Circle, Minus, Plus } from 'lucide-react';
import { DAILY_ROUTINE, DAILY_TARGETS, THIRTY_DAY_PLAN } from '../../../lib/salesContent';
import { currentPlanWeek, todayIso } from '../../../lib/salesHub';
import { CHANNEL_META } from './HubTemplates';
import { useStoredJson, useStoredString } from './pageMeta';

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isTally = (v: unknown): v is Record<string, number> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((n) => typeof n === 'number' && Number.isFinite(n));

export function HubPlan() {
  const [start, setStart] = useStoredString('beamwall.sales.planStart', '');
  const [done, setDone] = useStoredJson<string[]>('beamwall.sales.planDone', [], isStringArray);
  const current = currentPlanWeek(start, new Date(), THIRTY_DAY_PLAN.length);
  const doneSet = new Set(done);
  const toggle = (key: string) => setDone(doneSet.has(key) ? done.filter((k) => k !== key) : [...done, key]);

  const total = THIRTY_DAY_PLAN.reduce((n, w) => n + w.tasks.length, 0);
  const ticked = THIRTY_DAY_PLAN.reduce((n, w) => n + w.tasks.filter((t) => doneSet.has(`${w.week}:${t.id}`)).length, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-[22px] liquid-glass p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <label className="flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-brand-fg">I started on</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="min-h-11 rounded-xl liquid-glass-inset px-3 text-[15px] text-brand-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
          />
          {start === '' && (
            <button
              type="button"
              onClick={() => setStart(todayIso())}
              className="min-h-11 rounded-full border border-white/15 px-4 font-label text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-fg hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            >
              Today
            </button>
          )}
        </label>
        <div className="flex items-center gap-3">
          <div className="h-2 w-32 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
            <div className="h-full rounded-full bg-foil" style={{ width: `${total === 0 ? 0 : (ticked / total) * 100}%` }} />
          </div>
          <span className="text-[13px] tabular-nums text-brand-muted">{ticked}/{total} done</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {THIRTY_DAY_PLAN.map((w) => {
          const isNow = current === w.week;
          const wDone = w.tasks.filter((t) => doneSet.has(`${w.week}:${t.id}`)).length;
          return (
            <section
              key={w.week}
              aria-label={`Week ${w.week}${isNow ? ' (this week)' : ''}`}
              className={`flex flex-col rounded-[22px] border p-4 sm:p-5 ${isNow ? 'border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/[0.07] shadow-[0_20px_60px_-30px_rgba(91,140,255,0.6)]' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.22em] text-brand-muted">
                  Week {w.week}
                </p>
                {isNow ? (
                  <span className="rounded-full bg-foil px-2.5 py-1 font-label text-[9.5px] font-bold uppercase tracking-[0.16em] text-white">This week</span>
                ) : (
                  <span className="text-[12px] tabular-nums text-brand-muted/70">{wDone}/{w.tasks.length}</span>
                )}
              </div>
              <h3 className="mt-1 font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[24px] font-semibold leading-tight text-brand-fg">{w.theme}</h3>
              <p className="mt-1.5 text-[13.5px] leading-snug text-brand-muted"><span className="text-brand-fg/80">Goal:</span> {w.goal}</p>
              <ul className="mt-3 flex flex-col">
                {w.tasks.map((t) => {
                  const key = `${w.week}:${t.id}`;
                  const on = doneSet.has(key);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(key)}
                        className="flex min-h-11 w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                      >
                        {on ? (
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
                        ) : (
                          <Circle className="mt-0.5 h-5 w-5 shrink-0 text-brand-muted/50" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className={`block text-[14.5px] ${on ? 'text-brand-muted line-through decoration-white/30' : 'text-brand-fg'}`}>{t.title}</span>
                          {t.detail !== undefined && <span className="mt-0.5 block text-[12.5px] leading-snug text-brand-muted/75">{t.detail}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="text-[12px] text-brand-muted/60">Ticks and your start date are saved on this device only.</p>
    </div>
  );
}

export function HubTargets() {
  const day = todayIso();
  const [tally, setTally] = useStoredJson<Record<string, number>>(`beamwall.sales.tally.${day}`, {}, isTally);
  const bump = (id: string, d: number) => setTally({ ...tally, [id]: Math.max(0, (tally[id] ?? 0) + d) });

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
        {DAILY_TARGETS.map((t) => {
          const n = tally[t.id] ?? 0;
          const pct = t.count <= 0 ? 1 : Math.min(1, n / t.count);
          const hit = n >= t.count;
          const meta = t.channel !== undefined ? CHANNEL_META[t.channel] : undefined;
          const Icon = meta?.Icon;
          return (
            <div key={t.id} className={`relative flex flex-col overflow-hidden rounded-[22px] border p-4 ${hit ? 'border-emerald-400/40 bg-emerald-400/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium leading-snug text-brand-fg">{t.label}</p>
                  {meta !== undefined && Icon !== undefined && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-brand-muted"><Icon className="h-3 w-3" aria-hidden />{meta.label}</p>
                  )}
                </div>
                <p className="shrink-0 font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[40px] font-semibold leading-none">
                  <span className={hit ? 'text-emerald-300' : 'text-foil-static'}>{n}</span>
                  <span className="text-[20px] text-brand-muted/60">/{t.count}</span>
                </p>
              </div>
              {t.note !== undefined && <p className="mt-2 text-[12.5px] leading-snug text-brand-muted/75">{t.note}</p>}
              <div className="mt-auto flex items-center gap-2 pt-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
                  <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${hit ? 'bg-emerald-400' : 'bg-foil'}`} style={{ width: `${pct * 100}%` }} />
                </div>
                <button type="button" onClick={() => bump(t.id, -1)} disabled={n === 0} aria-label={`One less: ${t.label}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 text-brand-fg disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]">
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <button type="button" onClick={() => bump(t.id, 1)} aria-label={`One more: ${t.label}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-foil text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]">
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="-mt-5 text-[12px] text-brand-muted/60">Today's tally resets each day and is saved on this device only. Log real activity in the CRM.</p>

      <div>
        <h3 className="font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[26px] font-semibold text-brand-fg">The daily rhythm</h3>
        <ol className="relative mt-4 flex flex-col gap-0 border-l border-white/10 pl-6">
          {DAILY_ROUTINE.map((b, i) => (
            <li key={i} className="relative pb-5 last:pb-0">
              <span aria-hidden className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-foil ring-4 ring-[#05060B]" />
              <p className="font-label text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{b.time}</p>
              <p className="mt-0.5 text-[15.5px] font-semibold text-brand-fg">{b.title}</p>
              <p className="mt-0.5 text-[13.5px] leading-snug text-brand-muted">{b.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
