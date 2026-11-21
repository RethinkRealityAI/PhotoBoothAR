/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The host setup wizard — how a host makes an event without learning a tool.
 *
 *   /host/new                     step 1 (basics); Continue creates the event
 *   /host/setup/:eventId/:step?   every later step, resumable
 *
 * One idea per screen, a live preview beside it, and a sticky Back / Continue.
 * The event is created as a draft at the end of step 1, so every later step
 * saves to the real event as the host goes and a host who leaves can come
 * back to the step they left (progress lives in events.config.wizard — see
 * lib/wizard/wizardModel). The Studio stays where it was for partners; this
 * is the everyday way in.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useSession } from '../../../lib/auth';
import { usePageTitle } from '../../../lib/usePageTitle';
import { ToastProvider } from '../../../components/ui/Toast';
import {
  completeStep, isWizardStepId, nextStepId, normalizeWizardProgress, prevStepId, resumeStep, setupPath,
  stepDef, visitStep, type WizardProgress, type WizardStepId,
} from '../../../lib/wizard/wizardModel';
import { fetchWizardEvent, saveConfig as saveEventConfig, type WizardEvent } from '../../../lib/wizard/wizardApi';
import { WizardContext, type SaveState, type WizardCtx } from './wizardContext';
import { Rail, WizardFooter, WizardFrame } from './chrome';
import BasicsStep from './steps/BasicsStep';
import InviteStep from './steps/InviteStep';
import BoothStep from './steps/BoothStep';
import LooksStep from './steps/LooksStep';
import PowerUpsStep from './steps/PowerUpsStep';
import ChallengesStep from './steps/ChallengesStep';
import LaunchStep from './steps/LaunchStep';

/* ── The wizard ────────────────────────────────────────────────────── */

const STEP_COMPONENTS: Record<Exclude<WizardStepId, 'basics'>, () => ReactNode> = {
  invite: () => <InviteStep />,
  booth: () => <BoothStep />,
  looks: () => <LooksStep />,
  powerups: () => <PowerUpsStep />,
  challenges: () => <ChallengesStep />,
  launch: () => <LaunchStep />,
};

export default function EventWizard() {
  const { eventId, step: stepParam } = useParams();
  const { session, loading } = useSession();
  const { pathname } = useLocation();
  usePageTitle('Set up your event — Beamwall');

  if (!loading && !session) return <Navigate to="/login" replace state={{ from: pathname }} />;
  if (loading) {
    return (
      <div data-platform className="wz-root app-bg grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-white/80" aria-label="Loading" />
      </div>
    );
  }
  return (
    <ToastProvider>
      {eventId ? <SetupWizard key={eventId} eventUuid={eventId} stepParam={stepParam} /> : <CreateWizard />}
    </ToastProvider>
  );
}

/** Step 1 before the event exists. */
function CreateWizard() {
  const navigate = useNavigate();
  return (
    <BasicsStep
      mode="create"
      onCreated={(ev) => navigate(setupPath(ev.id, 'invite'), { replace: true })}
    />
  );
}

function SetupWizard({ eventUuid, stepParam }: { eventUuid: string; stepParam: string | undefined }) {
  const navigate = useNavigate();
  const [ev, setEv] = useState<WizardEvent | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'missing' | 'failed' | 'ready'>('loading');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const beforeContinue = useRef<(() => Promise<boolean>) | null>(null);
  const evRef = useRef<WizardEvent | null>(null);
  evRef.current = ev;

  const load = useCallback(async () => {
    setLoadState('loading');
    const res = await fetchWizardEvent(eventUuid);
    if (res === 'failed') return setLoadState('failed');
    if (res === null) return setLoadState('missing');
    setEv(res);
    setLoadState('ready');
  }, [eventUuid]);
  useEffect(() => { void load(); }, [load]);

  const progress = useMemo(() => normalizeWizardProgress(ev?.config.wizard), [ev?.config.wizard]);
  const step: WizardStepId = isWizardStepId(stepParam) ? stepParam : resumeStep(progress);

  // A bare /host/setup/:id lands on the step the host left.
  useEffect(() => {
    if (loadState === 'ready' && !isWizardStepId(stepParam)) {
      navigate(setupPath(eventUuid, resumeStep(progress)), { replace: true });
    }
  }, [loadState, stepParam, eventUuid, progress, navigate]);

  // Each step starts unblocked with no pending batch write.
  useEffect(() => {
    beforeContinue.current = null;
    setBlocked(null);
    document.getElementById('wz-scroll')?.scrollTo({ top: 0 });
  }, [step]);

  const writeConfig = useCallback(async (patch: Record<string, unknown>, nextProgress?: WizardProgress) => {
    const cur = evRef.current;
    if (!cur) return false;
    setSaveState('saving');
    const next = await saveEventConfig(cur, patch, nextProgress);
    if (next) {
      // Merge onto the LATEST event, not the one this write started from: a
      // step's own save may have landed meanwhile.
      const written = nextProgress ? { ...patch, wizard: nextProgress } : patch;
      const latest = evRef.current ?? next;
      const merged = { ...latest, config: { ...latest.config, ...written } };
      evRef.current = merged;
      setEv(merged);
      setSaveState('saved');
      return true;
    }
    setSaveState('error');
    return false;
  }, []);

  const go = useCallback(async (to: WizardStepId, mark: 'complete' | 'visit') => {
    const cur = evRef.current;
    if (!cur) return;
    const now = new Date().toISOString();
    const p = normalizeWizardProgress(cur.config.wizard);
    const next = mark === 'complete' ? completeStep(p, step, now) : visitStep(p, to, now);
    if (mark === 'complete') next.step = to;
    // Progress is a nicety: a failed pointer write never traps the host.
    void writeConfig({}, next);
    navigate(setupPath(eventUuid, to));
  }, [eventUuid, navigate, step, writeConfig]);

  const onContinue = async () => {
    setBusy(true);
    try {
      if (beforeContinue.current) {
        const ok = await beforeContinue.current();
        if (!ok) return;
      }
      const to = nextStepId(step);
      if (to) await go(to, 'complete');
      else {
        // Launch finished: stamp completion, then the dashboard.
        const cur = evRef.current;
        if (cur) await writeConfig({}, completeStep(normalizeWizardProgress(cur.config.wizard), 'launch', new Date().toISOString()));
        navigate('/host');
      }
    } finally {
      setBusy(false);
    }
  };

  const ctx: WizardCtx | null = ev ? {
    ev,
    progress,
    saveConfig: (patch) => writeConfig(patch),
    // Steps hand back whole events built from the copy they read, which can be
    // older than the progress pointer. Progress is owned here: a step's event
    // never rolls it back (that is how a finished step lost its tick).
    setEv: (next: WizardEvent) => {
      const keep = evRef.current?.config.wizard;
      const merged = keep === undefined ? next : { ...next, config: { ...next.config, wizard: keep } };
      evRef.current = merged;
      setEv(merged);
    },
    reportSave: setSaveState,
    setBeforeContinue: (fn) => { beforeContinue.current = fn; },
    setBlocked,
    goTo: (to) => void go(to, 'visit'),
  } : null;

  if (loadState !== 'ready' || !ctx) {
    return (
      <div data-platform className="wz-root app-bg grid place-items-center px-6 text-center">
        {loadState === 'loading' ? (
          <Loader2 className="h-6 w-6 animate-spin text-white/80" aria-label="Loading your event" />
        ) : (
          <div className="liquid-glass rounded-[28px] p-8 max-w-md">
            <p className="wz-display text-[24px]">{loadState === 'missing' ? 'We couldn’t find that event' : 'We couldn’t load your event'}</p>
            <p className="mt-2 text-white/80 text-[15px]">
              {loadState === 'missing' ? 'It may have been deleted, or it belongs to another account.' : 'Check your connection and try again.'}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              {loadState === 'failed' && <button type="button" onClick={() => void load()} className="pressable bg-foil rounded-full px-5 min-h-11 font-semibold">Try again</button>}
              <Link to="/host" className="pressable liquid-glass-raised rounded-full px-5 min-h-11 inline-flex items-center">Your events</Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  const def = stepDef(step);
  const prev = prevStepId(step);
  const isLast = step === 'launch';

  return (
    <WizardContext.Provider value={ctx}>
      <WizardFrame
        eventName={ev?.name ?? null}
        saveState={saveState}
        rail={<Rail current={step} progress={progress} canVisit onPick={(id) => void go(id, 'visit')} />}
        footer={
          <WizardFooter
            onBack={prev ? () => void go(prev, 'visit') : null}
            onSkip={def.optional ? () => void go(nextStepId(step)!, 'complete') : null}
            onContinue={() => void onContinue()}
            // Before launch the step's own "Go live" is the main action, so
            // the footer steps back; once live it becomes the way out.
            continueLabel={isLast ? (ev?.status === 'live' ? 'Go to my dashboard' : 'Finish later') : 'Continue'}
            continueTone={isLast && ev?.status !== 'live' ? 'secondary' : 'primary'}
            busy={busy}
            blocked={blocked}
          />
        }
      >
        <div key={step}>
          {step === 'basics' ? <BasicsStep mode="edit" /> : STEP_COMPONENTS[step]()}
        </div>
      </WizardFrame>
    </WizardContext.Provider>
  );
}
