/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The host's magazine cover editor (opened from the Looks step's Frames
 * tab). Built on EditorShell: tabs on one side, a live preview on the other,
 * all inside the viewport.
 *
 *   Style   pick the occasion's cover and turn it on for guests
 *   Words   the masthead title and the lead headline
 *   Names   who the cover is about (up to three) and whether guests are
 *           asked to put their own names on it
 *
 * Preview: the selfie Frame, or the cover standing in a room as guests see
 * it in AR. Every change saves on its own (arContent.covers).
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Check, Image as ImageIcon, Box, Type, Users, Palette, Plus, X } from 'lucide-react';
import EditorShell, { type EditorTab } from '../../editor/EditorShell';
import type { EditorSaveState } from '../../editor/SaveChip';
import FitFrame from '../../editor/FitFrame';
import { CoverRoomPreview, CoverSelfiePreview } from './CoverPreview';
import {
  COVER_HEADLINE_MAX, COVER_MAX_HONOREES, COVER_NAME_MAX, COVER_TITLE_MAX,
  normalizeCover, normalizeNames, removeCover, resolveCover, upsertCover, type CoverSettings,
} from '../../../lib/cover/spec';
import { COVER_TEMPLATES, COVER_TEMPLATE_MAP, type CoverTemplateId } from '../../../lib/cover/templates';

export interface CoverEditorProps {
  eventName: string;
  /** YYYY-MM-DD of the event day, printed on the cover. */
  eventDate?: string;
  covers: readonly CoverSettings[];
  /** Start on this template. */
  initial: CoverTemplateId;
  /** Persist the whole list; resolves false when it did not save. */
  onSave: (covers: CoverSettings[]) => Promise<boolean>;
  onClose: () => void;
  /** Where the back link points (the page the editor sits over). */
  backTo: string;
}

const TABS: readonly EditorTab[] = [
  { id: 'style', label: 'Style', Icon: Palette, blurb: 'One cover per occasion. Turn on as many as you like: guests find them first in Frames, and as 3D in Props.' },
  { id: 'words', label: 'Words', Icon: Type, blurb: 'The title across the top and the lead story. Keep the title short: it is cut in 3D letters.' },
  { id: 'names', label: 'Names', Icon: Users, blurb: 'Who the cover celebrates. Guests can add their own names as the cover stars.' },
];

const SAMPLE_GUESTS = ['Your guests'];

interface Form { title: string; headline: string; date: string; honorees: string[]; guestNames: boolean }

export default function CoverEditor({ eventName, eventDate, covers, initial, onSave, onClose, backTo }: CoverEditorProps) {
  const [list, setList] = useState<CoverSettings[]>(() => [...covers]);
  const [template, setTemplate] = useState<CoverTemplateId>(initial);
  const [tab, setTab] = useState('style');
  const [view, setView] = useState<'selfie' | 'room'>('selfie');
  const [save, setSave] = useState<EditorSaveState>('idle');
  const dirty = useRef(false);
  const listRef = useRef(list);
  listRef.current = list;

  const tpl = COVER_TEMPLATE_MAP[template];
  const current: CoverSettings | undefined = list.find((c) => c.template === template);
  const on = current !== undefined;
  // The form keeps what the host is typing (spaces, a blank name row); the
  // stored cover is its cleaned copy. Reset when the style changes.
  const formFor = (t: CoverTemplateId): Form => {
    const c = listRef.current.find((x) => x.template === t);
    return {
      title: c?.title ?? '',
      headline: c?.headline ?? '',
      date: c?.date ?? eventDate ?? '',
      honorees: c?.honorees && c.honorees.length > 0 ? [...c.honorees] : [''],
      guestNames: c?.guestNames !== false,
    };
  };
  const [form, setForm] = useState<Form>(() => formFor(initial));
  useEffect(() => { setForm(formFor(template)); }, [template]); // eslint-disable-line react-hooks/exhaustive-deps
  const draft: CoverSettings = normalizeCover({
    template, title: form.title, headline: form.headline, date: form.date, honorees: form.honorees,
    ...(form.guestNames ? {} : { guestNames: false }),
  }) ?? { template };

  const edit = (patch: Partial<Form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    // Only a cover that is ON is stored; an off one is a draft until added.
    if (!on) return;
    dirty.current = true;
    setList((l) => upsertCover(l, {
      template, title: next.title, headline: next.headline, date: next.date, honorees: next.honorees,
      ...(next.guestNames ? {} : { guestNames: false }),
    }));
  };
  const toggle = () => {
    dirty.current = true;
    setList((l) => (on ? removeCover(l, template) : upsertCover(l, draft)));
  };

  // Autosave, debounced; a failed save stays retryable from the chip.
  const runSave = async () => {
    setSave('saving');
    const ok = await onSave(listRef.current);
    setSave(ok ? 'saved' : 'error');
  };
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => void runSave(), 700);
    return () => window.clearTimeout(t);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes (after the pending save goes out).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void closeNow(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const closeNow = async () => {
    if (dirty.current && save !== 'saved') await runSave();
    onClose();
  };

  const preview = useMemo(
    () => resolveCover(draft, eventName, normalizeNames(SAMPLE_GUESTS, 3)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(draft), eventName],
  );

  const field = 'w-full rounded-xl bg-white/[0.07] border border-white/15 px-4 min-h-11 py-2.5 text-[15px] text-white placeholder-white/35 outline-none focus:border-[color:var(--color-accent)]';
  const label = 'block text-[13px] font-semibold text-white/85 mb-1.5';
  const honorees = form.honorees;

  return (
    <div className="fixed inset-0 z-[80]">
      <EditorShell
        backTo={backTo}
        backLabel="Looks"
        onBack={(e: MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); void closeNow(); }}
        title={`${tpl.label} cover`}
        titleAside={
          <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${on ? 'bg-emerald-400/20 text-emerald-100' : 'bg-white/10 text-white/70'}`}>
            {on ? 'On for guests' : 'Off'}
          </span>
        }
        saveState={save}
        onRetrySave={() => void runSave()}
        actions={
          <button
            type="button"
            onClick={toggle}
            aria-pressed={on}
            className={`pressable inline-flex items-center gap-1.5 rounded-full min-h-11 px-4 text-[14px] font-semibold ${on ? 'liquid-glass-raised' : 'bg-[color:var(--color-accent)] text-[color:var(--on-accent,#fff)]'}`}
          >
            {on ? <><X className="h-4 w-4" aria-hidden /> Turn off</> : <><Plus className="h-4 w-4" aria-hidden /> Add to booth</>}
          </button>
        }
        tabs={TABS}
        tab={tab}
        onTab={setTab}
        tabsLabel="Cover settings"
        previewBar={
          <div role="radiogroup" aria-label="Preview" className="mx-auto flex w-fit gap-1 rounded-full bg-white/[0.07] p-1">
            {([['selfie', 'Selfie', ImageIcon], ['room', 'In the room (AR)', Box]] as const).map(([id, l, Icon]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={view === id}
                onClick={() => setView(id)}
                className={`inline-flex items-center gap-1.5 rounded-full min-h-11 px-4 text-[13.5px] ${view === id ? 'bg-white/15 text-white font-semibold' : 'text-white/70 hover:text-white'}`}
              >
                <Icon className="h-4 w-4" aria-hidden /> {l}
              </button>
            ))}
          </div>
        }
        preview={
          <FitFrame width={360} height={640}>
            {() => (view === 'selfie'
              ? <CoverSelfiePreview cover={preview} className="h-full w-full" />
              : <CoverRoomPreview cover={preview} className="h-full w-full" />)}
          </FitFrame>
        }
      >
        {tab === 'style' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {COVER_TEMPLATES.map((t) => {
              const isOn = list.some((c) => c.template === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  aria-pressed={template === t.id}
                  className={`pressable relative flex flex-col items-start gap-0.5 rounded-2xl px-3.5 py-3 text-left min-h-[76px] border ${
                    template === t.id ? 'border-[color:var(--color-accent)] bg-white/[0.10]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
                  }`}
                >
                  <span className="text-[17px] leading-tight text-white" style={{ fontFamily: `"Cover ${t.masthead.font[0].toUpperCase()}${t.masthead.font.slice(1)}", Georgia, serif` }}>
                    {t.masthead.text}
                  </span>
                  <span className="text-[12.5px] text-white/65">{t.label}</span>
                  {isOn && (
                    <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-emerald-400 text-black" aria-label="On">
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'words' && (
          <div className="flex flex-col gap-5">
            <div>
              <label className={label} htmlFor="cover-title">Magazine title</label>
              <input
                id="cover-title"
                className={field}
                value={form.title}
                maxLength={COVER_TITLE_MAX}
                placeholder={tpl.masthead.text}
                onChange={(e) => edit({ title: e.target.value })}
              />
              <p className="mt-1.5 text-[12.5px] text-white/55">Up to {COVER_TITLE_MAX} letters. Leave it empty for “{tpl.masthead.text}”.</p>
            </div>
            <div>
              <label className={label} htmlFor="cover-headline">Lead headline</label>
              <input
                id="cover-headline"
                className={field}
                value={form.headline}
                maxLength={COVER_HEADLINE_MAX}
                placeholder={preview.left[0]?.head ?? 'Inside the big day'}
                onChange={(e) => edit({ headline: e.target.value })}
              />
            </div>
            <div>
              <label className={label} htmlFor="cover-date">Issue date</label>
              <input
                id="cover-date"
                type="date"
                className={field}
                value={form.date}
                onChange={(e) => edit({ date: e.target.value })}
              />
              <p className="mt-1.5 text-[12.5px] text-white/55">No date? The event name goes there instead.</p>
            </div>
          </div>
        )}

        {tab === 'names' && (
          <div className="flex flex-col gap-5">
            <div>
              <p className={label}>{tpl.honoreesLabel}</p>
              <div className="flex flex-col gap-2">
                {honorees.map((n, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={field}
                      value={n}
                      maxLength={COVER_NAME_MAX}
                      placeholder={i === 0 ? tpl.honoreesHint : 'Another name'}
                      aria-label={`${tpl.honoreesLabel}, name ${i + 1}`}
                      onChange={(e) => edit({ honorees: honorees.map((x, j) => (j === i ? e.target.value : x)) })}
                    />
                    {honorees.length > 1 && (
                      <button
                        type="button"
                        onClick={() => edit({ honorees: honorees.filter((_, j) => j !== i) })}
                        aria-label={`Remove name ${i + 1}`}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/70 hover:text-white"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {honorees.length < COVER_MAX_HONOREES && (
                <button
                  type="button"
                  onClick={() => edit({ honorees: [...honorees, ''] })}
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-white/85 hover:bg-white/10"
                >
                  <Plus className="h-4 w-4" aria-hidden /> Add a name
                </button>
              )}
              <p className="mt-1.5 text-[12.5px] text-white/55">They fill lines like “{preview.star.deck || 'Guests of Ada & Tunde’s wedding'}”.</p>
            </div>
            <label className="flex items-start gap-3 rounded-2xl bg-white/[0.05] px-4 py-3.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[color:var(--color-accent)]"
                checked={form.guestNames}
                onChange={(e) => edit({ guestNames: e.target.checked })}
              />
              <span>
                <span className="block text-[14.5px] text-white">Ask guests for their names</span>
                <span className="block text-[12.5px] text-white/60">When they pick the cover, up to three people in the shot can put their names on it, big, as the cover stars.</span>
              </span>
            </label>
          </div>
        )}
      </EditorShell>
    </div>
  );
}
