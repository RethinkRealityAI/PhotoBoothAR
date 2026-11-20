/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 1 — a name, a date and what kind of event. In create mode Continue
 * creates the event (as a draft) and seeds its starting look; in edit mode it
 * saves the name and date.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Cake, CalendarDays, Check, Gem, PartyPopper, Pencil, Sparkles, type LucideIcon } from 'lucide-react';
import type { TemplateId } from '../../../../lib/eventTemplates';
import { createEvent, isSlugVisiblyTaken, updateEventDate, updateEventName } from '../../../../lib/host';
import { slugify } from '../../../../lib/slug';
import { normalizeScene, type EventScene } from '../../../../lib/sceneThemes';
import { OCCASIONS, formatEventDate, initialEventConfig, occasionById, slugProblem, ymdFromIso } from '../../../../lib/wizard/occasions';
import { saveConfig as saveEventConfig, type WizardEvent } from '../../../../lib/wizard/wizardApi';
import { WIZARD_STEPS, setupPercent } from '../../../../lib/wizard/wizardModel';
import { StepHeading, WizardFooter, WizardFrame } from '../chrome';
import { useWizard } from '../wizardContext';
import WelcomePreview from '../WelcomePreview';

const ICONS: Record<TemplateId, LucideIcon> = { wedding: Gem, birthday: Cake, party: PartyPopper, gala: Sparkles, corporate: Briefcase };

type Props = { mode: 'create'; onCreated: (ev: WizardEvent) => void } | { mode: 'edit' };

interface Fields {
  name: string;
  occasion: TemplateId;
  date: string;
  noDate: boolean;
  slug: string;
  slugTouched: boolean;
}

function Form({ f, set, mode, slugNote, heading }: {
  heading: React.ReactNode;
  f: Fields;
  set: (p: Partial<Fields>) => void;
  mode: 'create' | 'edit';
  slugNote: string | null;
}) {
  const [editingLink, setEditingLink] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mode === 'create') nameRef.current?.focus(); }, [mode]);
  const origin = typeof window !== 'undefined' ? window.location.host : 'beamwall.app';
  return (
    <div className="liquid-glass rounded-[28px] p-5 sm:p-6 flex flex-col gap-6 wz-enter">
      <div className="-mb-2">{heading}</div>
      <div>
        <label htmlFor="wz-name" className="wz-label">Event name</label>
        <input
          id="wz-name"
          ref={nameRef}
          className="wz-input wz-input-hero"
          value={f.name}
          maxLength={80}
          placeholder="Ada & Tolu’s wedding"
          autoComplete="off"
          onChange={(e) => set({ name: e.target.value })}
        />
        {mode === 'create' && (
          <div className="mt-2.5 text-[13.5px] text-white/75 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Guest link:</span>
            {editingLink ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-white/60">{origin}/e/</span>
                <input
                  aria-label="Event link"
                  className="wz-input !min-h-9 !text-[14px] !px-3 !w-[200px]"
                  value={f.slug}
                  onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''), slugTouched: true })}
                />
              </span>
            ) : (
              <>
                <span className="text-white font-medium break-all">{origin}/e/{f.slug || '…'}</span>
                <button type="button" onClick={() => setEditingLink(true)} className="inline-flex items-center gap-1 underline underline-offset-2 text-white/85 hover:text-white min-h-8">
                  <Pencil className="h-3.5 w-3.5" aria-hidden /> Change
                </button>
              </>
            )}
            {slugNote && <span className="w-full text-[#FFD2DA]" role="alert">{slugNote}</span>}
          </div>
        )}
      </div>

      {mode === 'create' && <fieldset>
        <legend className="wz-label">What are you celebrating?</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" role="radiogroup" aria-label="Occasion">
          {OCCASIONS.map((o) => {
            const Icon = ICONS[o.id];
            const on = f.occasion === o.id;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={on} className="wz-choice" onClick={() => set({ occasion: o.id })}>
                <span className={`grid place-items-center h-9 w-9 rounded-full ${on ? 'bg-white text-[#1A1740]' : 'bg-white/12'}`}><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                <span className="text-[14.5px] font-medium leading-tight">{o.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>}

      <div>
        <label htmlFor="wz-date" className="wz-label">When is it?</label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/70" aria-hidden />
            <input
              id="wz-date"
              type="date"
              className="wz-input !pl-12 !w-[230px] [color-scheme:dark]"
              value={f.noDate ? '' : f.date}
              disabled={f.noDate}
              onChange={(e) => set({ date: e.target.value })}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-[14.5px] min-h-11 cursor-pointer">
            <input type="checkbox" className="h-5 w-5 accent-white" checked={f.noDate} onChange={(e) => set({ noDate: e.target.checked })} />
            Not sure yet
          </label>
        </div>
      </div>
    </div>
  );
}

export default function BasicsStep(props: Props) {
  if (props.mode === 'create') return <CreateBasics onCreated={props.onCreated} />;
  return <EditBasics />;
}

function previewOf(f: Fields, scene: EventScene | undefined) {
  return {
    scene,
    copy: { name: f.name.trim(), dateLabel: f.noDate ? null : formatEventDate(f.date), intro: null },
  };
}

function Layout({ form, preview }: { form: React.ReactNode; preview: React.ReactNode }) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-6 lg:gap-8 items-start">
      {form}
      <div className="lg:sticky lg:top-[76px] wz-enter" style={{ animationDelay: '80ms' }}>{preview}</div>
    </div>
  );
}

function CreateBasics({ onCreated }: { onCreated: (ev: WizardEvent) => void }) {
  const [f, setF] = useState<Fields>({ name: '', occasion: 'party', date: '', noDate: false, slug: '', slugTouched: false });
  const [slugNote, setSlugNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Fields>) => setF((prev) => {
    const next = { ...prev, ...p };
    if (p.name !== undefined && !next.slugTouched) next.slug = slugify(p.name);
    return next;
  });
  useEffect(() => { setSlugNote(null); }, [f.slug]);

  const blocked = f.name.trim() === ''
    ? 'Give your event a name.'
    : !f.noDate && f.date === '' ? 'Pick a date, or tick “Not sure yet”.' : null;

  const create = async () => {
    const problem = slugProblem(f.slug);
    if (problem) { setSlugNote(problem); return; }
    setBusy(true);
    setError(null);
    try {
      let slug = f.slug;
      // Quietly step past a link this account can already see taken.
      for (let i = 2; i < 6 && (await isSlugVisiblyTaken(slug)); i++) slug = `${f.slug}-${i}`.slice(0, 63);
      // Still taken after -5: a short random tail rather than a dead end.
      if (await isSlugVisiblyTaken(slug)) slug = `${f.slug.slice(0, 57)}-${Math.random().toString(36).slice(2, 6)}`;
      const startsAt = !f.noDate && f.date ? new Date(`${f.date}T00:00:00`).toISOString() : undefined;
      const res = await createEvent({ eventName: f.name.trim(), slug, eventType: f.occasion, startsAt });
      if (!res.event) {
        if (res.error === 'slug_taken' || res.error === 'reserved_slug' || res.error === 'invalid_slug') {
          setSlugNote(res.error === 'slug_taken' ? 'That link is taken. Try another.' : 'That link can’t be used. Try another.');
        } else {
          setError(res.error === 'unauthorized' ? 'Your session expired. Sign in again and retry.' : 'We couldn’t create your event. Please try again.');
        }
        return;
      }
      const base: WizardEvent = {
        id: res.event.id,
        slug: res.event.slug,
        name: res.event.name,
        status: res.event.status,
        event_type: res.event.event_type,
        starts_at: startsAt ?? null,
        config: (res.event.config ?? {}) as Record<string, unknown>,
      };
      // The starting look. Retried once; the event exists either way and the
      // next steps write the same fields again.
      const seed = initialEventConfig(f.occasion, f.name.trim(), new Date().toISOString());
      const seeded = (await saveEventConfig(base, seed)) ?? (await saveEventConfig(base, seed)) ?? base;
      onCreated(seeded);
    } finally {
      setBusy(false);
    }
  };

  const p = previewOf(f, { kind: 'template', id: occasionById(f.occasion).sceneId });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <WizardFrame
      eventName={null}
      saveState="idle"
      rail={<CreateRail />}
      footer={<WizardFooter onBack={null} onSkip={null} onContinue={() => void create()} continueLabel="Create my event" busy={busy} blocked={blocked} />}
    >
      {error && <p role="alert" className="mb-4 rounded-2xl bg-[rgba(255,120,140,0.18)] px-4 py-3 text-[14.5px]">{error}</p>}
      <Layout
        form={(
          <Form
            heading={(
              <StepHeading step="basics">
                <p className="mt-2 text-[13px] text-white/65">
                  Rather describe it in a sentence? <Link to="/host/new/assistant" className="underline underline-offset-2 text-white">Use the assistant</Link>
                </p>
              </StepHeading>
            )}
            f={f}
            set={set}
            mode="create"
            slugNote={slugNote}
          />
        )}
        preview={<WelcomePreview scene={p.scene} copy={p.copy} url={`${origin}/e/${f.slug || 'your-event'}/welcome`} />}
      />
    </WizardFrame>
  );
}

/** Before the event exists only step 1 is reachable; the rest is the map. */
function CreateRail() {
  // Starts ahead: the account is already a step done (setupPercent).
  const pct = setupPercent(null);
  return (
    <>
      <nav aria-label="Setup steps" className="hidden lg:block">
        <div className="sticky top-[76px]"><div className="liquid-glass rounded-[24px] p-2">
          <div className="px-2.5 pt-2 pb-2.5">
            <div className="flex items-baseline justify-between">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/60">Your setup</p>
              <p className="text-[11.5px] text-white/60">{pct}%</p>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-white/15 overflow-hidden" aria-hidden>
              <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ol className="flex flex-col gap-0.5">
            <li>
              <span className="wz-rail-step wz-rail-static">
                <span className="wz-rail-dot is-done" aria-hidden><Check className="h-4 w-4" strokeWidth={3} /></span>
                <span className="flex-1 min-w-0 truncate">Account created</span>
                <span className="sr-only"> (done)</span>
              </span>
            </li>
            {WIZARD_STEPS.map((s, i) => (
              <li key={s.id}>
                <span className="wz-rail-step" aria-current={i === 0 ? 'step' : undefined} style={i === 0 ? undefined : { opacity: 0.55 }}>
                  <span className="wz-rail-dot" aria-hidden>{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate">{s.label}</span>
                  {s.optional && <span className="text-[10.5px] text-white/45">Optional</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="px-2.5 pt-2.5 pb-1 text-[12px] leading-snug text-white/60">About 5 minutes. Everything saves as you go, so you can stop and come back.</p>
        </div></div>
      </nav>
      <div className="lg:hidden">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-1.5 flex-1 rounded-full bg-[#5FD9A8]" />
          {WIZARD_STEPS.map((s, i) => <span key={s.id} className={`h-1.5 flex-1 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/18'}`} />)}
        </div>
        <p className="mt-2 text-[12.5px] text-white/70">Step 1 of {WIZARD_STEPS.length} · About 5 minutes, saves as you go</p>
      </div>
    </>
  );
}

function EditBasics() {
  const w = useWizard();
  const { ev } = w;
  const startYmd = ymdFromIso(ev.starts_at);
  const [f, setF] = useState<Fields>({
    name: ev.name,
    occasion: occasionById(ev.event_type).id,
    date: startYmd,
    noDate: startYmd === '',
    slug: ev.slug,
    slugTouched: true,
  });
  const set = (p: Partial<Fields>) => setF((prev) => ({ ...prev, ...p }));
  const fRef = useRef(f);
  fRef.current = f;

  const blocked = f.name.trim() === '' ? 'Give your event a name.' : null;
  useEffect(() => { w.setBlocked(blocked); }, [blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    w.setBeforeContinue(async () => {
      const cur = fRef.current;
      const name = cur.name.trim();
      const date = cur.noDate ? '' : cur.date;
      let ok = true;
      w.reportSave('saving');
      if (name !== ev.name) ok = (await updateEventName(ev.id, name)) && ok;
      if (date !== startYmd) ok = (await updateEventDate(ev.id, date)) && ok;
      w.reportSave(ok ? 'saved' : 'error');
      if (ok) w.setEv({ ...ev, name, starts_at: date ? new Date(`${date}T00:00:00`).toISOString() : null });
      return ok;
    });
    return () => w.setBeforeContinue(null);
  }, [ev]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = previewOf(f, normalizeScene(ev.config.scene));
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <>
      <Layout
        form={<Form heading={<StepHeading step="basics" />} f={f} set={set} mode="edit" slugNote={null} />}
        preview={<WelcomePreview scene={p.scene} copy={p.copy} url={`${origin}/e/${ev.slug}/welcome`} />}
      />
    </>
  );
}
