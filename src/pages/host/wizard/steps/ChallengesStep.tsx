/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 5 (optional) — photo missions. One panel, two tabs:
 *
 *   Suggested       the occasion's ideas (the same content packs the
 *                   assistant seeds) as a tick list: one tap adds or removes.
 *   Write your own  a mission, a hint and the points, then Add; the host's
 *                   own missions are listed under it.
 *
 * Each one is a real `challenges` row, live as soon as it is added.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Lightbulb, Loader2, PenLine, Plus, ScanSearch, Trash2, Trophy } from 'lucide-react';
import type { Challenge } from '../../../../types';
import { CONTENT_PACKS } from '../../../../lib/contentPacks';
import type { ChallengeDraft } from '../../../../lib/copilot';
import { normalizeValidation } from '../../../../lib/challengeValidation';
import { createChallenge, deleteChallenge, fetchChallengesResult } from '../../../../lib/db';
import { occasionById } from '../../../../lib/wizard/occasions';
import { stepDef } from '../../../../lib/wizard/wizardModel';
import { StepShell, TabPanel, WizardTabs } from '../chrome';
import { useWizard } from '../wizardContext';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const POINTS = [5, 10, 15, 20, 25] as const;
const OWN_POINTS_DEFAULT = 15;

type Tab = 'suggested' | 'own';

export default function ChallengesStep() {
  const w = useWizard();
  const { ev } = w;
  const [rows, setRows] = useState<Challenge[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [points, setPoints] = useState<number>(OWN_POINTS_DEFAULT);
  const [tab, setTab] = useState<Tab>('suggested');

  const pack = CONTENT_PACKS[occasionById(ev.event_type).id];
  useEffect(() => {
    void fetchChallengesResult(ev.slug).then((r) => { setFailed(r.failed); setRows(r.rows); });
  }, [ev.slug]);

  const suggestions = pack.challenges;
  const own = useMemo(() => (rows ?? []).filter((r) => !suggestions.some((s) => same(s.title, r.title))), [rows, suggestions]);
  const addedSuggestions = rows ? suggestions.filter((s) => rows.some((r) => same(r.title, s.title))).length : 0;

  const add = async (d: ChallengeDraft, key: string) => {
    if (!rows) return;
    setBusy(key);
    w.reportSave('saving');
    const row = await createChallenge(ev.slug, {
      title: d.title,
      description: d.description ?? null,
      emoji: d.emoji ?? '✨',
      points: d.points ?? 10,
      sort_order: rows.length,
      validation: d.validationPrompt ? normalizeValidation({ enabled: true, prompt: d.validationPrompt }) : null,
    });
    if (row) setRows([...rows, row]);
    w.reportSave(row ? 'saved' : 'error');
    setBusy(null);
    return row !== null;
  };
  const remove = async (id: string) => {
    if (!rows) return;
    setBusy(id);
    w.reportSave('saving');
    const ok = await deleteChallenge(ev.slug, id);
    if (ok) setRows(rows.filter((r) => r.id !== id));
    w.reportSave(ok ? 'saved' : 'error');
    setBusy(null);
  };

  const addOwn = async () => {
    const t = title.trim();
    if (!t) return;
    const ok = await add({ title: t, description: desc.trim() || '', emoji: '✨', points }, 'own');
    if (ok) { setTitle(''); setDesc(''); setPoints(OWN_POINTS_DEFAULT); }
  };

  const tabs = (
    <WizardTabs<Tab>
      idBase="wz-challenges"
      label="Challenges"
      className="wz-tabs-even wz-tabs-2"
      value={tab}
      onChange={setTab}
      tabs={[
        { id: 'suggested', label: 'Suggested', Icon: Lightbulb, count: addedSuggestions, ariaLabel: `Suggested, ${addedSuggestions} added` },
        { id: 'own', label: 'Write your own', short: 'Your own', Icon: PenLine, count: own.length, ariaLabel: `Write your own, ${own.length} added` },
      ]}
    />
  );

  const suggestedPanel = rows === null ? null : (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">Ideas for your {pack.theme.toLowerCase()}</h2>
        <p className="text-[13px] text-white/65">Tap to add. Guests earn points for each one.</p>
        <p className="ml-auto text-[13px] text-white/75" aria-live="polite">{addedSuggestions} of {suggestions.length} added</p>
      </div>
      <ul className="wz-list" aria-label={`Ideas for your ${pack.theme.toLowerCase()}`}>
        {suggestions.map((s, i) => {
          const row = rows.find((r) => same(r.title, s.title));
          const key = `s${i}`;
          const spinning = busy === key || (row !== undefined && busy === row.id);
          return (
            <li key={s.title}>
              <button
                type="button"
                role="checkbox"
                className="wz-pick"
                aria-checked={row !== undefined}
                disabled={busy !== null}
                onClick={() => void (row ? remove(row.id) : add(s, key))}
              >
                <span className="wz-pick-box" aria-hidden>
                  {spinning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14.5px] font-semibold leading-snug">{s.title}</span>
                  {s.description && <span className="block text-[12.5px] leading-snug text-white/68 truncate">{s.description}</span>}
                </span>
                {s.validationPrompt && (
                  <span className="shrink-0 text-white/60" title="Photo is checked automatically">
                    <ScanSearch className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Photo is checked automatically</span>
                  </span>
                )}
                <span className="w-12 text-right text-[12.5px] text-white/65 shrink-0">{s.points ?? 10} pts</span>
              </button>
            </li>
          );
        })}
      </ul>
      {suggestions.some((s) => s.validationPrompt) && (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-white/55" aria-hidden><ScanSearch className="h-3.5 w-3.5" /> means the photo is checked automatically</p>
      )}
    </>
  );

  const ownPanel = rows === null ? null : (
    <div className="flex flex-col gap-5">
      <form
        className="wz-card-inset"
        onSubmit={(e) => { e.preventDefault(); void addOwn(); }}
        aria-label="Write your own mission"
      >
        <div className="flex items-start gap-3">
          <span className="grid place-items-center h-10 w-10 rounded-full bg-white/12 shrink-0"><PenLine className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0">
            <p className="wz-display text-[18px] leading-tight">A mission of your own</p>
            <p className="mt-0.5 text-[13px] text-white/70">Something only your guests would know to do.</p>
          </div>
        </div>
        <label htmlFor="wz-ctitle" className="wz-label mt-4">Mission</label>
        <input id="wz-ctitle" className="wz-input" maxLength={60} placeholder="Selfie with the bride’s grandma" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="wz-cdesc" className="wz-label mt-4">Hint <span className="normal-case tracking-normal font-normal text-white/50">(optional)</span></label>
        <input id="wz-cdesc" className="wz-input" maxLength={140} placeholder="She’s in the blue dress near the cake." value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <p className="wz-label" id="wz-cpoints">Points</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="wz-cpoints">
              {POINTS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={points === n} className="wz-pill min-w-[48px] justify-center" onClick={() => setPoints(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={title.trim() === '' || busy !== null} className="ml-auto pressable bg-foil inline-flex items-center gap-2 rounded-full px-5 min-h-11 text-[14px] font-semibold disabled:opacity-55">
            {busy === 'own' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Add mission
          </button>
        </div>
      </form>

      <div>
        <h2 className="mb-2 text-[13px] font-semibold text-white/85">Your missions <span className="font-normal text-white/50">· {own.length}</span></h2>
        {own.length === 0 ? (
          <p className="rounded-2xl bg-white/6 px-4 py-4 text-[13.5px] text-white/65">The missions you write show up here.</p>
        ) : (
          <ul className="wz-list">
            {own.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 min-h-[52px]">
                <span className="flex-1 min-w-0">
                  <span className="block text-[14.5px] font-medium leading-snug">{r.title}</span>
                  {r.description && <span className="block text-[12.5px] text-white/65 truncate">{r.description}</span>}
                </span>
                <span className="text-[12.5px] text-white/65 shrink-0">{r.points} pts</span>
                <button type="button" aria-label={`Remove ${r.title}`} disabled={busy !== null} onClick={() => void remove(r.id)} className="grid place-items-center h-11 w-11 rounded-full hover:bg-white/10 shrink-0">
                  {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const panel = (
      <TabPanel idBase="wz-challenges" value={tab}>
        {rows === null
          ? <div className="h-32 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
          : tab === 'suggested' ? suggestedPanel : ownPanel}
      </TabPanel>
  );

  /* What a guest sees: the mission list in the booth. */
  const preview = (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="wz-phone w-[min(100%,250px)] lg:w-full">
        <div className="wz-phone-screen bg-[linear-gradient(160deg,#4A5FA8,#33318A_55%,#7E5A9E)]">
          <div className="absolute inset-0 p-[7cqw] flex flex-col gap-[3cqw] overflow-hidden">
            <p className="text-[4cqw] font-semibold uppercase tracking-[0.12em] text-white/70 mt-[8cqw]">Photo challenges</p>
            <p className="wz-display text-[8cqw] leading-tight">{rows?.length ? `${rows.length} missions` : 'No missions yet'}</p>
            {(rows ?? []).slice(0, 7).map((r) => (
              <div key={r.id} className="rounded-[4cqw] bg-white/14 px-[4cqw] py-[3cqw]">
                <p className="text-[4.4cqw] font-semibold leading-tight truncate">{r.title}</p>
                <p className="text-[3.4cqw] text-white/70 flex items-center gap-[1.5cqw]"><Trophy className="w-[3.4cqw] h-[3.4cqw]" aria-hidden /> {r.points} points</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-center text-[12.5px] text-white/65">What guests see in the booth</p>
    </div>
  );

  return (
    <StepShell
      step="challenges"
      hint="Check out existing challenges or create your own."
      aside={rows !== null && rows.length > 0 ? <span className="rounded-full bg-white/12 px-3 py-1 text-[12.5px] font-medium">{rows.length} on</span> : undefined}
      tabs={tabs}
      notice={failed ? <p role="alert" className="mb-4 rounded-2xl bg-[rgba(255,120,140,0.18)] px-4 py-3 text-[14.5px]">We couldn’t load your challenges. Check your connection and reload this step.</p> : undefined}
      preview={preview}
      sheetLabel={stepDef('challenges').title}
    >
      {panel}
    </StepShell>
  );
}
