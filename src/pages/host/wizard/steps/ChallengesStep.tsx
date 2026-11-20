/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 5 (optional) — photo missions. Suggestions for the occasion (the same
 * content packs the assistant seeds) switch on with one tap; the host can
 * also write their own. Each one is a real `challenges` row, live as soon as
 * it is added.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, ScanSearch, Trash2, Trophy } from 'lucide-react';
import type { Challenge } from '../../../../types';
import { CONTENT_PACKS } from '../../../../lib/contentPacks';
import type { ChallengeDraft } from '../../../../lib/copilot';
import { normalizeValidation } from '../../../../lib/challengeValidation';
import { createChallenge, deleteChallenge, fetchChallengesResult } from '../../../../lib/db';
import { occasionById } from '../../../../lib/wizard/occasions';
import { StepHeading } from '../chrome';
import { useWizard } from '../wizardContext';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export default function ChallengesStep() {
  const w = useWizard();
  const { ev } = w;
  const [rows, setRows] = useState<Challenge[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  const pack = CONTENT_PACKS[occasionById(ev.event_type).id];
  useEffect(() => {
    void fetchChallengesResult(ev.slug).then((r) => { setFailed(r.failed); setRows(r.rows); });
  }, [ev.slug]);

  const suggestions = pack.challenges;
  const own = useMemo(() => (rows ?? []).filter((r) => !suggestions.some((s) => same(s.title, r.title))), [rows, suggestions]);

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
    const ok = await add({ title: t, description: desc.trim() || '', emoji: '✨', points: 15 }, 'own');
    if (ok) { setTitle(''); setDesc(''); }
  };

  return (
    <>
      {failed && <p role="alert" className="mb-4 rounded-2xl bg-[rgba(255,120,140,0.18)] px-4 py-3 text-[14.5px]">We couldn’t load your challenges. Check your connection and reload this step.</p>}
      <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.75fr)] gap-6 xl:gap-7 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <section className="liquid-glass rounded-[28px] p-5 sm:p-6 wz-enter">
            <StepHeading step="challenges" />
            <h2 className="text-[15px] font-semibold">Ideas for your {pack.theme.toLowerCase()}</h2>
            <p className="mt-0.5 text-[13px] text-white/65">Tap to add. Guests earn points for each one.</p>
            {rows === null ? (
              <div className="h-32 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {suggestions.map((s, i) => {
                  const row = rows.find((r) => same(r.title, s.title));
                  const key = `s${i}`;
                  return (
                    <li key={s.title}>
                      <button
                        type="button"
                        className="wz-choice w-full"
                        aria-pressed={row !== undefined}
                        disabled={busy !== null}
                        onClick={() => void (row ? remove(row.id) : add(s, key))}
                      >
                        <span className={`grid place-items-center h-9 w-9 rounded-full shrink-0 ${row ? 'bg-white text-[#1A1740]' : 'bg-white/12'}`}>
                          {busy === key || (row && busy === row.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : row ? <Check className="h-4 w-4" strokeWidth={3} /> : <Plus className="h-4 w-4" />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[15px] font-semibold">{s.title}</span>
                          {s.description && <span className="block text-[13px] text-white/72">{s.description}</span>}
                          {s.validationPrompt && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-white/60"><ScanSearch className="h-3.5 w-3.5" aria-hidden /> Photo is checked automatically</span>
                          )}
                        </span>
                        <span className="text-[12.5px] text-white/65 shrink-0">{s.points ?? 10} pts</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="liquid-glass rounded-[28px] p-5 sm:p-6 wz-enter" style={{ animationDelay: '60ms' }}>
            <h2 className="text-[15px] font-semibold">Write your own</h2>
            <label htmlFor="wz-ctitle" className="wz-label mt-4">Mission</label>
            <input id="wz-ctitle" className="wz-input" maxLength={60} placeholder="Selfie with the bride’s grandma" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="wz-cdesc" className="wz-label mt-4">Hint <span className="normal-case tracking-normal font-normal text-white/50">(optional)</span></label>
            <input id="wz-cdesc" className="wz-input" maxLength={140} placeholder="She’s in the blue dress near the cake." value={desc} onChange={(e) => setDesc(e.target.value)} />
            <button type="button" onClick={() => void addOwn()} disabled={title.trim() === '' || busy !== null} className="mt-4 pressable bg-foil inline-flex items-center gap-2 rounded-full px-5 min-h-11 text-[14px] font-semibold disabled:opacity-55">
              {busy === 'own' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Add mission
            </button>
            {own.length > 0 && (
              <ul className="mt-5 flex flex-col gap-2">
                {own.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-white/7 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14.5px] font-medium">{r.title}</span>
                      {r.description && <span className="block text-[12.5px] text-white/65">{r.description}</span>}
                    </span>
                    <button type="button" aria-label={`Remove ${r.title}`} onClick={() => void remove(r.id)} className="grid place-items-center h-10 w-10 rounded-full hover:bg-white/10">
                      {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* What a guest sees: the mission list in the booth. */}
        <div className="lg:sticky lg:top-[76px] wz-enter" style={{ animationDelay: '80ms' }}>
          <div className="wz-phone w-[230px] mx-auto">
            <div className="wz-phone-screen bg-[linear-gradient(160deg,#4A5FA8,#33318A_55%,#7E5A9E)]">
              <div className="absolute inset-0 p-[7cqw] flex flex-col gap-[3cqw] overflow-hidden">
                <p className="text-[4cqw] font-semibold uppercase tracking-[0.12em] text-white/70 mt-[8cqw]">Photo challenges</p>
                <p className="wz-display text-[8cqw] leading-tight">{rows?.length ? `${rows.length} missions` : 'No missions yet'}</p>
                {(rows ?? []).slice(0, 6).map((r) => (
                  <div key={r.id} className="rounded-[4cqw] bg-white/14 px-[4cqw] py-[3cqw]">
                    <p className="text-[4.4cqw] font-semibold leading-tight truncate">{r.title}</p>
                    <p className="text-[3.4cqw] text-white/70 flex items-center gap-[1.5cqw]"><Trophy className="w-[3.4cqw] h-[3.4cqw]" aria-hidden /> {r.points} points</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[12.5px] text-white/65">What guests see in the booth</p>
        </div>
      </div>
    </>
  );
}
