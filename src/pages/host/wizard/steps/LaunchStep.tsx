/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 7 — check it over, go live, share the QR. The preview here is the
 * REAL welcome page (an iframe of /e/<slug>/welcome; the host's session
 * reads its own draft), so the last thing they see is exactly what guests
 * will get.
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Camera, Check, ExternalLink, Image as ImageIcon, LayoutGrid, Loader2, Monitor, PartyPopper, Pencil, Printer, RefreshCw, Sparkles, Trophy, Zap, type LucideIcon } from 'lucide-react';
import ShareActions from '../../../../components/host/ShareActions';
import { goLive } from '../../../../lib/host';
import { fetchChallengesResult, getWallSettingsResult } from '../../../../lib/db';
import { WALL_LAYOUT_META, normalizeWallLook } from '../../../../lib/sceneThemes';
import { normalizePowerUps } from '../../../../lib/wizard/powerUps';
import { buildLookCatalog, countPicked, eventFilters } from '../../../../lib/wizard/looks';
import { currentPicks, fetchLooksData } from '../../../../lib/wizard/wizardApi';
import { formatEventDate, ymdFromIso } from '../../../../lib/wizard/occasions';
import type { WizardStepId } from '../../../../lib/wizard/wizardModel';
import { StepHeading } from '../chrome';
import { useWizard } from '../wizardContext';

interface Summary {
  looks: number;
  filters: number;
  opening: string | null;
  challenges: number;
  layout: string;
}

function Row({ icon: Icon, title, detail, step, ok, onEdit }: {
  icon: LucideIcon;
  title: string;
  detail: string;
  step: WizardStepId;
  ok: boolean;
  onEdit: (s: WizardStepId) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-white/6">
      <span className={`grid place-items-center h-10 w-10 rounded-full shrink-0 ${ok ? 'bg-[rgba(170,240,210,0.22)] text-[#D6FFEE]' : 'bg-white/12'}`}>
        {ok ? <Check className="h-[18px] w-[18px]" aria-hidden /> : <Icon className="h-[18px] w-[18px]" aria-hidden />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-[13px] text-white/70 truncate">{detail}</span>
      </span>
      <button type="button" onClick={() => onEdit(step)} className="inline-flex items-center gap-1 rounded-full px-3 min-h-10 text-[13px] hover:bg-white/10">
        <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
      </button>
    </li>
  );
}

export default function LaunchStep() {
  const w = useWizard();
  const { ev } = w;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [going, setGoing] = useState(false);
  const [goError, setGoError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const live = ev.status === 'live';

  const load = useCallback(async () => {
    const [looks, ch, wall] = await Promise.all([
      fetchLooksData(ev.slug),
      fetchChallengesResult(ev.slug),
      getWallSettingsResult(ev.slug),
    ]);
    const picks = currentPicks(ev, looks);
    const cat = buildLookCatalog(looks.library, looks.categoryNames);
    const composites = looks.library.filter((r) => r.kind === 'composite' && looks.linkedIds.includes(r.id));
    const filters = eventFilters(looks.eventRows, composites);
    const openingId = typeof ev.config.defaultExperienceId === 'string' ? ev.config.defaultExperienceId : null;
    setSummary({
      looks: countPicked(picks, [...cat.frames, ...cat.props, ...cat.effects]),
      filters: filters.length,
      opening: filters.find((f) => f.id === openingId)?.name ?? null,
      challenges: ch.rows.filter((c) => c.active).length,
      layout: WALL_LAYOUT_META[normalizeWallLook(wall.settings.wallLook, wall.settings.galleryScroll).layout].label,
    });
  }, [ev]);
  useEffect(() => { void load(); }, [load]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const welcomeUrl = `${origin}/e/${ev.slug}/welcome`;
  const powerUps = normalizePowerUps(ev.config.powerUps).length;
  const dateLabel = formatEventDate(ymdFromIso(ev.starts_at));

  const doGoLive = async () => {
    setGoing(true);
    setGoError(null);
    const ok = await goLive(ev.id);
    setGoing(false);
    if (ok) {
      w.setEv({ ...ev, status: 'live' });
      setFrameKey((k) => k + 1);
    } else setGoError('We couldn’t take your event live. Check your connection and try again.');
  };

  return (
    <>
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] gap-6 xl:gap-7 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <section className="liquid-glass rounded-[28px] p-3 sm:p-4 wz-enter" aria-label="Your setup">
            <div className="px-2 pt-1"><StepHeading step="launch" /></div>
            {summary === null ? (
              <div className="h-48 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label="Checking your setup" /></div>
            ) : (
              <ul>
                <Row icon={CalendarDays} title={ev.name} detail={dateLabel ?? 'Date to be decided'} step="basics" ok onEdit={w.goTo} />
                <Row icon={ImageIcon} title="Welcome page" detail="Your background, border and welcome line" step="invite" ok onEdit={w.goTo} />
                <Row icon={Sparkles} title="Looks" detail={`${summary.looks} to pick from · ${summary.filters} ${summary.filters === 1 ? 'filter' : 'filters'}${summary.opening ? ` · opens with ${summary.opening}` : ''}`} step="looks" ok={summary.looks + summary.filters > 0} onEdit={w.goTo} />
                <Row icon={Zap} title="Power-ups" detail={powerUps > 0 ? `${powerUps} gesture${powerUps === 1 ? '' : 's'} on` : 'None yet (optional)'} step="powerups" ok={powerUps > 0} onEdit={w.goTo} />
                <Row icon={Trophy} title="Challenges" detail={summary.challenges > 0 ? `${summary.challenges} mission${summary.challenges === 1 ? '' : 's'}` : 'None yet (optional)'} step="challenges" ok={summary.challenges > 0} onEdit={w.goTo} />
                <Row icon={Monitor} title="Big screen" detail={`${summary.layout} wall`} step="booth" ok onEdit={w.goTo} />
              </ul>
            )}
          </section>

          <section className="liquid-glass rounded-[28px] p-5 sm:p-6 wz-enter" style={{ animationDelay: '60ms' }}>
            {live ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center h-11 w-11 rounded-full bg-white text-[#1A1740]"><PartyPopper className="h-5 w-5" aria-hidden /></span>
                  <div>
                    <p className="wz-display text-[22px]">You’re live</p>
                    <p className="text-[13.5px] text-white/75">Share the QR or put the big screen up. Guests need no app.</p>
                  </div>
                </div>
                <div className="mt-5"><ShareActions url={welcomeUrl} eventName={ev.name} slug={ev.slug} qrSize={148} layout="stacked" /></div>
              </>
            ) : (
              <>
                <p className="wz-display text-[22px]">Ready to go live?</p>
                <p className="mt-1 text-[13.5px] text-white/75">Until then only you can open your pages. You can keep changing everything after.</p>
                <button type="button" onClick={() => void doGoLive()} disabled={going} className="mt-4 pressable bg-foil inline-flex items-center gap-2 rounded-full px-6 min-h-12 text-[15px] font-semibold disabled:opacity-60">
                  {going ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PartyPopper className="h-4 w-4" aria-hidden />} Go live
                </button>
                {goError && <p role="alert" className="mt-2 text-[13.5px] text-[#FFD2DA]">{goError}</p>}
              </>
            )}
            <p className="wz-label mt-6 !mb-2">Open or print</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { href: `/e/${ev.slug}/welcome`, label: 'Welcome page', Icon: ExternalLink },
                { href: `/e/${ev.slug}/booth`, label: 'Booth', Icon: Camera },
                { href: `/e/${ev.slug}/wall`, label: 'Big screen', Icon: LayoutGrid },
                { href: `/host/events/${ev.id}/share`, label: 'Print signs', Icon: Printer },
              ].map(({ href, label, Icon }) => (
                <a key={label} href={href} target={href.startsWith('/e/') ? '_blank' : undefined} rel="noreferrer" className="pressable liquid-glass-raised flex flex-col items-center justify-center gap-1.5 rounded-2xl min-h-[72px] text-[13px] font-medium text-center">
                  <Icon className="h-[18px] w-[18px]" aria-hidden /> {label}
                </a>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:sticky lg:top-[76px] flex flex-col items-center gap-3 wz-enter" style={{ animationDelay: '80ms' }}>
          <div className="wz-phone w-[270px]">
            <div className="wz-phone-screen bg-[#1F1A63]">
              {/* Laid out at a real phone width (390px) and scaled down, so the page
                  wraps exactly as it will on a guest's phone. */}
              <iframe
                key={frameKey}
                title="Your welcome page"
                src={`/e/${ev.slug}/welcome`}
                className="absolute left-0 top-0 border-0 origin-top-left"
                style={{ width: 390, height: 870, transform: `scale(${256 / 390})` }}
              />
            </div>
          </div>
          <button type="button" onClick={() => setFrameKey((k) => k + 1)} className="inline-flex items-center gap-1.5 rounded-full px-3 min-h-10 text-[13px] hover:bg-white/10">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reload preview
          </button>
          <p className="text-[12.5px] text-white/65">This is your real welcome page.</p>
        </div>
      </div>
    </>
  );
}
