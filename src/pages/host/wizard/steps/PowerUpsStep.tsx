/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 4 (optional) — a little magic. Two kinds:
 *
 *   Gestures     a gesture sets off an effect whatever look the guest has on
 *                (stored as preset ids in events.config.powerUps; the booth
 *                merges them into its trigger engine — lib/wizard/powerUps).
 *   Power gear   ready-made filters with their own blasts (visor, wand,
 *                gauntlet), added like any other filter.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, Hand, Heart, Laugh, Loader2, PartyPopper, Smile, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import TriggerEffects, { type TriggerEffectsHandle } from '../../../../components/booth/TriggerEffects';
import { fetchExperiences } from '../../../../lib/db';
import { setOpeningLook } from '../../../../lib/host';
import { buildStarterDraft } from '../../../../lib/studio/starterScenes';
import type { Experience } from '../../../../types';
import { composeDraft, powerScenes, starterRow, wizardRefOf } from '../../../../lib/wizard/looks';
import { POWER_UP_PRESETS, normalizePowerUps, powerUpsConfig, togglePowerUp, type PowerUpId, type PowerUpPreset } from '../../../../lib/wizard/powerUps';
import { addFilterRow, removeFilterRow } from '../../../../lib/wizard/wizardApi';
import { StepPanel, StepShell, TabPanel, WizardTabs } from '../chrome';
import { stepDef } from '../../../../lib/wizard/wizardModel';
import { useWizard } from '../wizardContext';
import { useAutosave } from '../useAutosave';
import LookStage from '../LookStage';

const EFFECT_ICON: Record<PowerUpId, LucideIcon> = {
  'smile-sparkles': Sparkles,
  'mouth-confetti': PartyPopper,
  'peace-hearts': Heart,
  'palm-fireworks': Sparkles,
  'fist-beam': Zap,
  'temple-optic': Eye,
};
const GESTURE_ICON: Record<PowerUpPreset['glyph'], LucideIcon> = {
  smile: Smile, mouth: Laugh, peace: Hand, palm: Hand, fist: Hand, temple: Hand,
};

export default function PowerUpsStep() {
  const w = useWizard();
  const { ev } = w;
  const [on, setOn] = useState<PowerUpId[]>(() => normalizePowerUps(ev.config.powerUps));
  useAutosave(on, (v) => ({ powerUps: powerUpsConfig(v) }));
  const fx = useRef<TriggerEffectsHandle>(null);
  const [rows, setRows] = useState<Experience[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stageScene, setStageScene] = useState<string | null>(null);
  const [tab, setTab] = useState<'gestures' | 'gear'>('gestures');

  useEffect(() => { void fetchExperiences(ev.slug).then(setRows); }, [ev.slug]);

  const draft = useMemo(() => {
    if (stageScene) return buildStarterDraft(stageScene) ?? composeDraft({ frameId: null, effectId: null, classics: [], library: [] });
    return composeDraft({ frameId: null, effectId: null, classics: ['prop-royal-crown'], library: [] });
  }, [stageScene]);

  const tryIt = (p: PowerUpPreset) => {
    if (p.action.type === 'burst') fx.current?.fire(p.action.style);
    else fx.current?.fire('sparkles');
  };

  const toggleGear = async (sceneId: string) => {
    if (!rows) return;
    const existing = rows.find((r) => wizardRefOf(r) === `starter:${sceneId}`);
    setBusy(sceneId);
    w.reportSave('saving');
    if (existing) {
      const ok = await removeFilterRow(ev.slug, existing.id);
      if (ok) {
        setRows(rows.filter((r) => r.id !== existing.id));
        if (ev.config.defaultExperienceId === existing.id) {
          const res = await setOpeningLook({ slug: ev.slug, eventUuid: ev.id }, null);
          if (res.ok) w.setEv({ ...ev, config: { ...ev.config, defaultExperienceId: null } });
        }
      }
      w.reportSave(ok ? 'saved' : 'error');
    } else {
      const d = starterRow(sceneId);
      const row = d ? await addFilterRow(ev.slug, d) : null;
      if (row) { setRows([...rows, row]); setStageScene(sceneId); }
      w.reportSave(row ? 'saved' : 'error');
    }
    setBusy(null);
  };

  const gearOn = rows ? powerScenes().filter((s) => rows.some((r) => wizardRefOf(r) === `starter:${s.id}`)).length : 0;
  const controls = (
          <StepPanel
            step="powerups"
            tabs={(
              <WizardTabs<'gestures' | 'gear'>
                idBase="wz-powerups"
                label="Power-ups"
                className="wz-tabs-even wz-tabs-2"
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'gestures', label: 'Gestures', count: on.length },
                  { id: 'gear', label: 'Power gear', count: gearOn },
                ]}
              />
            )}
          >
            <TabPanel idBase="wz-powerups" value={tab}>
            {tab === 'gestures' && (<>
            <p className="text-[13px] text-white/65">A smile or a hand sign sets off an effect, whatever look a guest has on. Turn on as many as you like.</p>
            <ul className="mt-4 grid sm:grid-cols-2 gap-2.5">
              {POWER_UP_PRESETS.map((p) => {
                const active = on.includes(p.id);
                const G = GESTURE_ICON[p.glyph];
                const E = EFFECT_ICON[p.id];
                return (
                  <li key={p.id}>
                    <div className={`wz-choice !items-start !py-3 w-full ${active ? '' : ''}`} aria-checked={active} role="group" aria-label={`${p.gesture}: ${p.effect}`}>
                      <span className={`grid place-items-center h-11 w-11 rounded-full shrink-0 ${active ? 'bg-white text-[#1A1740]' : 'bg-white/12'}`}><E className="h-5 w-5" aria-hidden /></span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 text-[14.5px] font-semibold"><G className="h-4 w-4 text-white/70" aria-hidden /> {p.gesture}</span>
                        <span className="block text-[13px] text-white/75">{p.effect}</span>
                        {p.usesHands && <span className="block mt-0.5 text-[11.5px] text-white/50">Uses hand tracking</span>}
                        <span className="mt-2 flex gap-2">
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => setOn((cur) => togglePowerUp(cur, p.id))}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 min-h-11 text-[13px] font-semibold ${active ? 'bg-white text-[#1A1740]' : 'bg-white/14 hover:bg-white/22'}`}
                          >
                            {active ? <><Check className="h-3.5 w-3.5" aria-hidden /> On</> : 'Turn on'}
                          </button>
                          {p.action.type === 'burst' && (
                            <button type="button" onClick={() => tryIt(p)} className="rounded-full px-3 min-h-11 text-[13px] hover:bg-white/10">Preview</button>
                          )}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            </>)}
            {tab === 'gear' && (<>
            <p className="text-[13px] text-white/65">Superhero combos with their own blasts. They join your combos.</p>
            <div className="mt-4 wz-shelf">
              {powerScenes().map((s) => {
                const active = rows?.some((r) => wizardRefOf(r) === `starter:${s.id}`) ?? false;
                return (
                  <button key={s.id} type="button" className="wz-tile" aria-pressed={active} disabled={rows === null || (busy !== null && busy !== s.id)} onClick={() => void toggleGear(s.id)} onMouseEnter={() => setStageScene(s.id)} onFocus={() => setStageScene(s.id)} title={s.blurb}>
                    <span className="wz-check" aria-hidden>{busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                    <span className="wz-tile-art aspect-[3/4]"><img src={s.preview} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /></span>
                    <span className="wz-tile-name">{s.name}</span>
                  </button>
                );
              })}
            </div>
            </>)}
            </TabPanel>
          </StepPanel>
  );
  const previewNode = (
    <div className="flex flex-col items-center w-full">
          <LookStage draft={draft} caption={stageScene ? powerScenes().find((s) => s.id === stageScene)?.name : 'Tap Preview to see a gesture'}>
            <TriggerEffects ref={fx} className="absolute inset-0 w-full h-full pointer-events-none z-20" />
          </LookStage>
          <p className="mt-3 text-center text-[12.5px] text-white/65">{on.length === 0 ? 'No gestures on yet' : `${on.length} gesture${on.length === 1 ? '' : 's'} on`}</p>
    </div>
  );

  return <StepShell panel={controls} preview={previewNode} sheetLabel={stepDef('powerups').title} />;
}
