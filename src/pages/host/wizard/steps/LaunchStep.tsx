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
import { motion, useReducedMotion } from 'motion/react';
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
    <li className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/6">
      <span className={`grid place-items-center h-10 w-10 rounded-full shrink-0 ${ok ? 'wz-tick' : 'bg-white/12'}`}>
        {ok ? <Check className="h-[18px] w-[18px]" strokeWidth={3} aria-hidden /> : <Icon className="h-[18px] w-[18px]" aria-hidden />}
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

const BURST_COLOURS = ['#FFD36E', '#FF7AB6', '#7FE7FF', '#B79CFF', '#FFFFFF', '#8CFFB5'];
const BURST_PIECES = Array.from({ length: 22 }, (_, i) => {
  // Deterministic spread (no Math.random): an even fan with alternating reach.
  const angle = (i / 22) * Math.PI * 2;
  const reach = 90 + (i % 3) * 38;
  return {
    x: Math.cos(angle) * reach,
    y: Math.sin(angle) * reach - 30,
    rotate: (i % 2 === 0 ? 1 : -1) * (160 + i * 12),
    colour: BURST_COLOURS[i % BURST_COLOURS.length],
    round: i % 3 === 0,
    delay: (i % 4) * 0.03,
  };
});

/** A short confetti pop over the share card when the host goes live. Purely
 *  decorative: no pointer events, gone after ~1.5s, never rendered when the
 *  device asks for reduced motion (the "You're live" state carries it). */
function LiveBurst({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      {BURST_PIECES.map((p, i) => (
        <motion.span
          key={i}
          className={`absolute left-[42px] top-[42px] block ${p.round ? 'h-2.5 w-2.5 rounded-full' : 'h-3 w-1.5 rounded-[2px]'}`}
          style={{ background: p.colour }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 70], opacity: [1, 1, 0], scale: 1, rotate: p.rotate }}
          transition={{ duration: 1.4, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}

export default function LaunchStep() {
  const w = useWizard();
  const { ev } = w;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [going, setGoing] = useState(false);
  const [goError, setGoError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  /** True only for the go-live that happened on this screen, not a revisit. */
  const [justLive, setJustLive] = useState(false);
  const [burst, setBurst] = useState(false);
  const reduceMotion = useReducedMotion();
  const endBurst = useCallback(() => setBurst(false), []);
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
      looks: countPicked(picks, [...cat.frames, ...cat.props, ...cat.paint, ...cat.effects]),
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
      setJustLive(true);
      if (reduceMotion !== true) setBurst(true);
    } else setGoError('We couldn’t take your event live. Check your connection and try again.');
  };

  return (
    <>
      {/* Wide screens: checklist · share card · phone, side by side, so the
          whole launch fits one screen. Narrower: the cards stack. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-5 xl:gap-6 items-start xl:items-stretch">
        <div className="contents lg:flex lg:flex-col lg:gap-5 lg:min-w-0 xl:contents">
          <section className="liquid-glass rounded-[28px] p-3 sm:p-4 wz-enter flex flex-col" aria-label="Your setup">
            <div className="px-2 pt-1"><StepHeading step="launch" /></div>
            {summary === null ? (
              <div className="h-48 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label="Checking your setup" /></div>
            ) : (
              <ul className="flex-1 flex flex-col xl:justify-evenly">
                <Row icon={CalendarDays} title={ev.name} detail={dateLabel ?? 'Date to be decided'} step="basics" ok onEdit={w.goTo} />
                <Row icon={ImageIcon} title="Welcome page" detail="Your background, border and welcome line" step="invite" ok onEdit={w.goTo} />
                <Row icon={Sparkles} title="Looks" detail={`${summary.looks} to pick from · ${summary.filters} ${summary.filters === 1 ? 'filter' : 'filters'}${summary.opening ? ` · opens with ${summary.opening}` : ''}`} step="looks" ok={summary.looks + summary.filters > 0} onEdit={w.goTo} />
                <Row icon={Zap} title="Power-ups" detail={powerUps > 0 ? `${powerUps} gesture${powerUps === 1 ? '' : 's'} on` : 'None yet (optional)'} step="powerups" ok={powerUps > 0} onEdit={w.goTo} />
                <Row icon={Trophy} title="Challenges" detail={summary.challenges > 0 ? `${summary.challenges} mission${summary.challenges === 1 ? '' : 's'}` : 'None yet (optional)'} step="challenges" ok={summary.challenges > 0} onEdit={w.goTo} />
                <Row icon={Monitor} title="Live wall" detail={`${summary.layout} wall`} step="booth" ok onEdit={w.goTo} />
              </ul>
            )}
          </section>

          <section className="relative liquid-glass rounded-[28px] p-5 sm:p-6 wz-enter min-w-0 @container" style={{ animationDelay: '60ms' }}>
            {/* Present from first render so screen readers announce the change. */}
            <p role="status" className="sr-only">{justLive ? 'You’re live!' : ''}</p>
            {burst && <LiveBurst onDone={endBurst} />}
            {live ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center h-11 w-11 rounded-full bg-white text-[#1A1740]"><PartyPopper className="h-5 w-5" aria-hidden /></span>
                  <div>
                    <p className="wz-display text-[22px]">You’re live</p>
                    <p className="text-[13.5px] text-white/75">Share the QR or put the live wall up. Guests need no app.</p>
                  </div>
                </div>
                <div className="mt-5"><ShareActions url={welcomeUrl} eventName={ev.name} slug={ev.slug} qrSize={136} layout="stacked" /></div>
                <p className="mt-3 text-[13.5px] text-white/75">Test it now: scan the QR with your phone.</p>
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
            <p className="wz-label mt-5 !mb-2">Open or print</p>
            <div className="grid grid-cols-2 @min-[420px]:grid-cols-4 gap-2">
              {[
                { href: `/e/${ev.slug}/welcome`, label: 'Welcome page', Icon: ExternalLink },
                { href: `/e/${ev.slug}/booth`, label: 'Booth', Icon: Camera },
                { href: `/e/${ev.slug}/wall`, label: 'Live wall', Icon: LayoutGrid },
                { href: `/host/events/${ev.id}/share`, label: 'Print signs', Icon: Printer },
              ].map(({ href, label, Icon }) => (
                <a key={label} href={href} target={href.startsWith('/e/') ? '_blank' : undefined} rel="noreferrer" className="pressable liquid-glass-raised flex flex-col items-center justify-center gap-1 rounded-2xl min-h-[64px] px-1 text-[12.5px] font-medium text-center whitespace-nowrap">
                  <Icon className="h-[18px] w-[18px]" aria-hidden /> {label}
                </a>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:sticky lg:top-[76px] xl:self-start flex flex-col items-center gap-3 wz-enter" style={{ animationDelay: '80ms' }}>
          <div className="wz-phone w-[270px]">
            <div className="wz-phone-screen bg-[#1F1A63]">
              {/* Laid out at a real phone width (390px) and scaled down, so the page
                  wraps exactly as it will on a guest's phone. ?preview=1 (in a
                  frame only) hides the floating "Preview" pill, which sat over
                  the event title; this card already says whether it is live. */}
              <iframe
                key={frameKey}
                title="Your welcome page"
                src={`/e/${ev.slug}/welcome?preview=1`}
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
