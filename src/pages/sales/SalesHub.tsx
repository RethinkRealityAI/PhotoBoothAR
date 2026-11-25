/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The partnerships hub (SALES_HUB_PATH) — internal, unlinked, noindex.
 *
 * The daily home of the Director of Partnerships: learn the product, present
 * the decks (with speaker notes), copy prospect links and outreach, track the
 * 30-day plan and the day's targets, and work the CRM. Mobile-first: most of
 * this happens on a phone between meetings.
 *
 * The market switch (Nigeria first) filters decks, packages, templates, links
 * and sourcing. The hub is the ONLY surface that shows notes, internal
 * audiences and placeholder prices — prospects get /pitch links, never this.
 *
 * Layout: one section at a time, like tabs. The top bar and the section nav
 * stay put and the open section scrolls on its own inside the viewport (the
 * app shell is h-screen overflow-hidden). The open tab lives in the URL hash
 * (#decks, #plan, …) so a refresh or a shared hub link lands on the same tab.
 * The CRM is its own full page (SALES_CRM_PATH); its nav item links there.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, BookOpen, CalendarCheck, ClipboardList, Compass, ExternalLink, Library, Link2, MessageSquareText, Play,
  Presentation, Search, ShieldAlert, Sparkles, Target, Users, type LucideIcon,
} from 'lucide-react';
import {
  CHEAT_SHEET, DAILY_TARGETS, DECKS, DISCOVERY_QUESTIONS, OBJECTIONS, RESEARCH_NOTES, SALES_CONTACT, SOURCING,
} from '../../lib/salesContent';
import { offersFor } from '../../lib/salesOffers';
import { buildShareLink, normalizeRef, parseMarket, searchObjections } from '../../lib/salesHub';
import { COLLATERAL, ICP_IDS, MARKETS, PITCH_BASE, SALES_CRM_PATH, type Deck, type Market } from '../../lib/salesTypes';
import { usePageTitle } from '../../lib/usePageTitle';
import CopyButton from './components/CopyButton';
import SlideDeck, { SlideThumb, type DeckEnv } from './components/SlideDeck';
import HubTemplates from './components/HubTemplates';
import HubDeliver from './components/HubDeliver';
import HubShowcase from './components/HubShowcase';
import { HubPlan, HubTargets } from './components/HubPlan';
import HubFeatures from './components/HubFeatures';
import { LayoutGrid } from 'lucide-react';
import { HubTopBar, ICP_LABEL, PlaceholderBadge, SectionHead } from './components/hubUi';
import { asksFor, contactLine, offersFromIds } from './components/deckEnv';
import { useNoIndex, useStoredString } from './components/pageMeta';
import { BEAMY } from './salesImages';
import Tooltip from '../../components/ui/Tooltip';
import RailToggle from '../../components/ui/RailToggle';
import { useRailCollapsed } from '../../lib/useRailCollapsed';

const SECTIONS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: 'start', label: 'Start here', Icon: Compass },
  { id: 'features', label: 'Features', Icon: LayoutGrid },
  { id: 'decks', label: 'Decks', Icon: Presentation },
  { id: 'guide', label: 'Selling guide', Icon: BookOpen },
  { id: 'deliver', label: 'Deliver an event', Icon: ClipboardList },
  { id: 'plan', label: '30-day plan', Icon: CalendarCheck },
  { id: 'targets', label: 'Daily targets', Icon: Target },
  { id: 'templates', label: 'Templates', Icon: MessageSquareText },
  { id: 'links', label: 'Links', Icon: Link2 },
  { id: 'showcase', label: 'Showcase events', Icon: Sparkles },
  { id: 'sourcing', label: 'Find prospects', Icon: Search },
  { id: 'research', label: 'Research', Icon: Library },
];
const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));

/** The tab named by the URL hash, or 'start' for none / an unknown one. */
function tabFromHash(hash: string): string {
  const id = hash.replace(/^#/, '');
  return SECTION_IDS.has(id) ? id : 'start';
}

function MarketSwitch({ market, onChange }: { market: Market; onChange: (m: Market) => void }) {
  return (
    <div role="radiogroup" aria-label="Market" className="liquid-glass flex shrink-0 rounded-full p-1">
      {MARKETS.map((m) => {
        const on = m.id === market;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.id)}
            className={`min-h-10 whitespace-nowrap rounded-full px-2.5 font-label text-[10px] font-bold uppercase tracking-[0.08em] transition sm:text-[10.5px] sm:tracking-[0.14em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:px-4 ${
              on ? 'bg-foil text-white shadow-[0_6px_20px_-8px_rgba(91,140,255,0.8)]' : 'text-brand-muted hover:text-brand-fg'
            }`}
          >
            <span className="sm:hidden">{m.id === 'ng' ? 'Nigeria' : 'N. America'}</span>
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function RefInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-[13px] text-brand-muted">Your ref code <span className="text-brand-muted/60">(optional)</span></span>
      <input
        value={value}
        onChange={(e) => onChange(normalizeRef(e.target.value))}
        placeholder="e.g. james"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="min-h-11 w-full rounded-xl liquid-glass-inset px-3.5 text-[15px] text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:w-48"
      />
    </label>
  );
}

/** One tab's panel. Only the open tab renders. */
function Section({ id, active, children }: { id: string; active: string; children: ReactNode }) {
  if (id !== active) return null;
  return (
    <section id={id} aria-labelledby={`tab-${id}`} className="pb-16 pt-6 md:pt-10">
      {children}
    </section>
  );
}

/** The CRM nav item: a link to its own page, styled like a tab but marked as
 *  leaving the hub. */
function CrmNavLink({ variant, collapsed = false }: { variant: 'rail' | 'chip'; collapsed?: boolean }) {
  if (variant === 'rail' && collapsed) {
    return (
      <Tooltip label="Open the CRM" side="right">
        <Link
          to={SALES_CRM_PATH}
          aria-label="Open the CRM"
          className="mt-3 grid place-items-center min-h-12 rounded-xl border border-[color:var(--color-accent)]/35 bg-[color:var(--color-accent)]/10 text-brand-fg transition hover:bg-[color:var(--color-accent)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          <Users className="h-[18px] w-[18px] text-accent" aria-hidden />
        </Link>
      </Tooltip>
    );
  }
  if (variant === 'chip') {
    return (
      <Link
        to={SALES_CRM_PATH}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3.5 text-[13px] font-semibold text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
      >
        <Users className="h-4 w-4" aria-hidden /> CRM <ArrowUpRight className="h-3.5 w-3.5 text-brand-muted" aria-hidden />
      </Link>
    );
  }
  return (
    <Link
      to={SALES_CRM_PATH}
      className="mt-3 flex min-h-12 items-center gap-3 rounded-xl border border-[color:var(--color-accent)]/35 bg-[color:var(--color-accent)]/10 px-3 text-[14px] font-semibold text-brand-fg transition hover:bg-[color:var(--color-accent)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
    >
      <Users className="h-4 w-4 text-accent" aria-hidden />
      <span className="flex-1">Open the CRM</span>
      <ArrowUpRight className="h-4 w-4 text-brand-muted" aria-hidden />
    </Link>
  );
}

export default function SalesHub() {
  usePageTitle('Partnerships hub · Beamwall');
  useNoIndex();

  const scrollRef = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [marketRaw, setMarketRaw] = useStoredString('beamwall.sales.market', 'ng');
  const market = parseMarket(marketRaw);
  const [refCode, setRefCode] = useStoredString('beamwall.sales.ref', '');
  const [active, setActive] = useState(() => (typeof window !== 'undefined' ? tabFromHash(window.location.hash) : 'start'));
  const [presenting, setPresenting] = useState<Deck | null>(null);
  const [objQuery, setObjQuery] = useState('');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Desktop rail only; the phone keeps its chip strip.
  const rail = useRailCollapsed('sales');
  const c = rail.collapsed;

  const decks = useMemo(() => DECKS.filter((d) => d.market === market), [market]);
  const packages = useMemo(() => offersFor(market), [market]);
  const objections = useMemo(() => searchObjections(OBJECTIONS, objQuery), [objQuery]);
  const sourcing = useMemo(() => SOURCING.filter((s) => s.market === market), [market]);
  const marketLabel = MARKETS.find((m) => m.id === market)?.label ?? '';

  // Back/forward and hand-edited hashes switch tabs too.
  useEffect(() => {
    const onHash = () => setActive(tabFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Keep the active chip visible in the phone nav strip.
  useEffect(() => {
    const strip = chipsRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (strip === null || strip === undefined || chip === null || chip === undefined) return;
    strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
  }, [active]);

  /** Open a tab: swap the panel, start it at the top, record it in the hash
   *  (replace, so tab hopping doesn't bury the browser's Back button). */
  const jump = useCallback((id: string) => {
    setActive(id);
    scrollRef.current?.scrollTo({ top: 0 });
    const url = `${window.location.pathname}${window.location.search}${id === 'start' ? '' : `#${id}`}`;
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const envFor = (d: Deck): DeckEnv => {
    const asks = asksFor(d.market, refCode);
    return {
      offersFor: offersFromIds,
      priceFor: (o) => o.price,
      placeholderBadges: true,
      primaryCta: asks.primary,
      secondaryCta: asks.secondary,
      contactLine: contactLine(),
    };
  };

  // Lock the open tab's scroll behind the presenter.
  useEffect(() => {
    const root = scrollRef.current;
    if (root === null) return;
    root.style.overflowY = presenting !== null ? 'hidden' : '';
  }, [presenting]);

  const pitchLink = (d: Deck) => buildShareLink(origin, `${PITCH_BASE}/${d.slug}`, refCode);
  const links = COLLATERAL.filter((c) => c.path !== undefined && (c.market === undefined || c.market === market));
  const todayTotal = DAILY_TARGETS.reduce((n, t) => n + t.count, 0);
  const rep = SALES_CONTACT.name.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden app-bg text-brand-fg">
      {/* Top bar (+ phone tab strip) — fixed above the scrolling panel */}
      <header className="z-40 shrink-0 border-b border-white/[0.06] bg-brand-bg/80 backdrop-blur-md">
        <HubTopBar title="Partnerships Hub" right={<MarketSwitch market={market} onChange={(m) => setMarketRaw(m)} />} />
        <nav aria-label="Hub sections" className="md:hidden">
          <div ref={chipsRef} role="tablist" className="hide-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-2.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                id={`tab-${s.id}`}
                data-chip={s.id}
                type="button"
                role="tab"
                aria-selected={active === s.id}
                aria-controls={s.id}
                onClick={() => jump(s.id)}
                className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
                  active === s.id ? 'border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/15 text-brand-fg' : 'border-white/10 bg-white/[0.03] text-brand-muted'
                }`}
              >
                <s.Icon className="h-4 w-4" aria-hidden />
                {s.label}
              </button>
            ))}
            <CrmNavLink variant="chip" />
          </div>
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Desktop rail */}
        <nav
          id="sales-rail"
          aria-label="Hub sections"
          className={`hidden shrink-0 flex-col overflow-y-auto hide-scrollbar border-r border-white/[0.06] md:flex transition-[width] duration-200 motion-reduce:transition-none ${
            c ? 'w-[4.75rem] px-2 py-4' : 'w-60 px-3 py-6 lg:w-64 lg:px-4'
          }`}
        >
          <div className={`flex mb-2 ${c ? 'justify-center' : 'justify-end -mt-3'}`}>
            <RailToggle collapsed={c} onToggle={rail.toggle} label="sections" controls="sales-rail" />
          </div>
          <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-1">
            {SECTIONS.map((s) => (
              <Tooltip key={s.id} label={s.label} side="right" disabled={!c}>
              <button
                key={s.id}
                id={`tab-${s.id}`}
                type="button"
                role="tab"
                aria-selected={active === s.id}
                aria-controls={s.id}
                onClick={() => jump(s.id)}
                aria-label={c ? s.label : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[14.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${c ? 'justify-center' : ''} ${
                  active === s.id ? 'bg-white/[0.08] font-semibold text-brand-fg' : 'text-brand-muted hover:bg-white/[0.04] hover:text-brand-fg'
                }`}
              >
                <s.Icon className={`${c ? 'h-[18px] w-[18px]' : 'h-4 w-4'} shrink-0 ${active === s.id ? 'text-accent' : ''}`} aria-hidden />
                {!c && s.label}
              </button>
              </Tooltip>
            ))}
          </div>
          <CrmNavLink variant="rail" collapsed={c} />
          {!c && (
            <p className="mt-auto px-3 pt-6 text-[11.5px] leading-snug text-brand-muted/60">
              Internal only. Prospects get /pitch links.
            </p>
          )}
        </nav>

        {/* The open tab — the only thing that scrolls */}
        <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <div className="mx-auto w-full max-w-[1500px] px-4 sm:px-6 lg:px-10 xl:px-12">
          {/* 1 · Start here */}
          <Section id="start" active={active}>
            <div className="relative overflow-hidden rounded-[32px] liquid-glass p-6 sm:p-10">
              <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[color:var(--color-accent)]/25 blur-3xl" />
              <div className="relative grid items-center gap-6 sm:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.28em] text-accent">Start here</p>
                  <h1 className="mt-2 font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[40px] font-semibold leading-[1.02] sm:text-[56px]">
                    Welcome{rep !== '' ? `, ${rep}` : ''}.<br />
                    <span className="text-foil-static">Let’s light up some walls.</span>
                  </h1>
                  <ul className="mt-5 flex flex-col gap-2 text-[15.5px] leading-relaxed text-brand-fg/90">
                    <li>Guests scan a QR code and take AR photos in their browser. No app, no queue.</li>
                    <li>Every shot beams onto a live photo wall on the venue screen as it’s taken.</li>
                    <li>Hosts keep every photo, plus keepsake cards and a highlight film.</li>
                  </ul>
                </div>
                <img
                  src={BEAMY.src}
                  width={BEAMY.width}
                  height={BEAMY.height}
                  alt="Beamy, the Beamwall mascot"
                  className="order-first h-auto w-24 motion-safe:animate-float sm:order-none sm:mx-auto sm:w-56"
                />
              </div>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/[0.07] p-4">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden />
              <p className="text-[14px] leading-relaxed text-amber-50/90">
                <strong className="font-semibold text-amber-100">This link is internal. Never forward it to a prospect.</strong>{' '}
                It holds speaker notes, unconfirmed prices and your targets. Send prospects a <span className="font-mono text-[13px]">/pitch</span> link from Decks or Links instead.
              </p>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                <h2 className="font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[24px] font-semibold">How to use this hub</h2>
                <ol className="mt-3 flex flex-col gap-2.5 text-[14.5px] leading-snug text-brand-muted">
                  {[
                    ['Pick your market', 'at the top. Nigeria is home base; the switch filters decks, templates, links and sourcing.'],
                    ['Learn the pitch', 'by presenting each deck to yourself with Notes on.'],
                    ['Each morning', 'check Daily targets, then work Templates → CRM.'],
                    ['Share a deck', 'with Copy prospect link. Add your ref code once and every link carries it.'],
                  ].map(([b, rest], i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent)]/15 font-label text-[11px] font-bold text-accent">{i + 1}</span>
                      <span><span className="font-semibold text-brand-fg">{b}</span> {rest}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <button
                type="button"
                onClick={() => jump('targets')}
                className="group flex flex-col rounded-[22px] border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
              >
                <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.22em] text-brand-muted">Today’s targets</p>
                <p className="mt-2 font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[56px] font-semibold leading-none text-foil-static">{todayTotal}</p>
                <p className="text-[13px] text-brand-muted">touches across {DAILY_TARGETS.length} activities</p>
                <ul className="mt-4 flex flex-col gap-1.5">
                  {DAILY_TARGETS.slice(0, 3).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                      <span className="truncate text-brand-fg/85">{t.label}</span>
                      <span className="font-semibold tabular-nums text-brand-fg">{t.count}</span>
                    </li>
                  ))}
                </ul>
                <span className="mt-auto pt-4 text-[12.5px] text-accent group-hover:underline">Open the scoreboard →</span>
              </button>
            </div>
          </Section>

          {/* Features: the visual cheat sheet (lib/salesFeatures.ts) */}
          <Section id="features" active={active}>
            <HubFeatures />
          </Section>

          {/* 2 · Decks */}
          <Section id="decks" active={active}>
            <SectionHead
              eyebrow={`Decks · ${marketLabel}`}
              title="Present, then share"
              intro="Present opens the full deck with your speaker notes. Copy prospect link gives you the clean /pitch version — no notes, no internal prices."
            />
            <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <RefInput value={refCode} onChange={setRefCode} />
              <p className="mt-2 text-[12px] text-brand-muted/60">Added to every link as ?ref= so signups are credited to you. Saved on this device.</p>
            </div>
            <div className="grid gap-5 lg:grid-cols-3 sm:grid-cols-2">
              {decks.map((d) => {
                const env = envFor(d);
                return (
                  <article key={d.slug} className="flex flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] transition hover:border-white/20">
                    <button
                      type="button"
                      onClick={() => setPresenting(d)}
                      className="relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-accent)]"
                      aria-label={`Present ${d.name}`}
                    >
                      <SlideThumb deck={d} env={env} />
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 font-label text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-fg backdrop-blur">
                        {d.slides.length} slides
                      </span>
                    </button>
                    <div className="flex flex-1 flex-col p-4 sm:p-5">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: `rgb(${d.rgb})`, boxShadow: `0 0 10px rgb(${d.rgb})` }} aria-hidden />
                        <p className="font-label text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-muted">{ICP_LABEL[d.id]}</p>
                      </div>
                      <h3 className="mt-1.5 font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[24px] font-semibold leading-tight">{d.name}</h3>
                      <p className="mt-1.5 text-[14px] leading-snug text-brand-fg/85">{d.oneLiner}</p>
                      <p className="mt-2 text-[12.5px] leading-snug text-brand-muted/75"><span className="text-brand-muted">For:</span> {d.audience}</p>
                      <div className="mt-auto flex flex-wrap gap-2 pt-4">
                        <button
                          type="button"
                          onClick={() => setPresenting(d)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foil px-5 font-label text-[11px] font-bold uppercase tracking-[0.16em] text-white glow-accent active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" aria-hidden /> Present
                        </button>
                        <CopyButton text={pitchLink(d)} label="Copy prospect link" variant="ghost" ariaLabel={`Copy prospect link for ${d.name}`} />
                        <a
                          href={pitchLink(d)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open the prospect view of ${d.name} in a new tab`}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-brand-fg hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden />
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {decks.length === 0 && <p className="text-brand-muted">No decks for this market yet.</p>}

            <h3 className="mt-12 font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[26px] font-semibold">Packages you can quote · {marketLabel}</h3>
{packages.some((o) => o.placeholder) ? (
            <p className="mt-1 text-[13.5px] text-brand-muted">
              <PlaceholderBadge /> means the price isn’t confirmed: never say the number. Prospects see “{packages.find((o) => o.placeholder)?.fallbackPrice ?? 'Tailored quote'}” instead.
            </p>
            ) : (
              <p className="mt-1 text-[13.5px] text-brand-muted">Prices as prospects see them. Quote these; anything custom goes to Dapo first.</p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {packages.map((o) => (
                <div key={o.id} className="flex flex-col rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14.5px] font-semibold text-brand-fg">{o.name}</p>
                    {o.placeholder && <PlaceholderBadge />}
                  </div>
                  <p className="mt-1.5 break-words font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[28px] font-semibold leading-tight">
                    {o.price} <span className="whitespace-nowrap font-sans text-[12.5px] font-normal text-brand-muted">{o.unit}</span>
                  </p>
                  <p className="mt-2 text-[13px] leading-snug text-brand-muted">{o.blurb}</p>
                  <p className="mt-2 text-[11.5px] text-brand-muted/70">For {o.icp.map((i) => ICP_LABEL[i]).join(', ')}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 3 · Selling guide */}
          <Section id="guide" active={active}>
            <SectionHead eyebrow="Selling guide" title="Know it cold" intro="The cheat sheet, the objections you’ll hear, and the questions that open a real conversation." />
            <div className="grid gap-4 md:grid-cols-2">
              {CHEAT_SHEET.map((c) => (
                <div key={c.id} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[22px] font-semibold">{c.title}</h3>
                  <ul className="mt-3 flex flex-col gap-2">
                    {c.points.map((p, i) => (
                      <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-brand-fg/85">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-accent)]" aria-hidden />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h3 className="font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[26px] font-semibold">Objections</h3>
              <label className="relative block sm:w-72">
                <span className="sr-only">Search objections</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted/60" aria-hidden />
                <input
                  type="search"
                  value={objQuery}
                  onChange={(e) => setObjQuery(e.target.value)}
                  placeholder="Search: price, app, wifi…"
                  className="min-h-11 w-full rounded-xl liquid-glass-inset pl-10 pr-3 text-[15px] text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {objections.map((o, i) => (
                <details key={`${o.objection}-${i}`} className="group rounded-2xl border border-white/10 bg-white/[0.03] open:bg-white/[0.05]">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-medium text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] [&::-webkit-details-marker]:hidden">
                    <span className="flex-1">“{o.objection}”</span>
                    {o.icp !== undefined && <span className="hidden rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-brand-muted sm:inline">{ICP_LABEL[o.icp]}</span>}
                    <span aria-hidden className="text-brand-muted transition group-open:rotate-45">+</span>
                  </summary>
                  <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end">
                    <p className="flex-1 text-[14.5px] leading-relaxed text-brand-fg/85">{o.answer}</p>
                    <CopyButton text={o.answer} variant="icon" ariaLabel="Copy answer" />
                  </div>
                </details>
              ))}
              {objections.length === 0 && (
                <p className="rounded-2xl border border-dashed border-white/12 p-5 text-center text-[14px] text-brand-muted">No objection matches “{objQuery}”.</p>
              )}
            </div>

            <h3 className="mt-10 font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[26px] font-semibold">Discovery questions</h3>
            <ol className="mt-4 grid gap-3 md:grid-cols-2">
              {DISCOVERY_QUESTIONS.map((q, i) => (
                <li key={i} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[22px] font-semibold leading-none text-foil-static">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="text-[15px] font-medium leading-snug text-brand-fg">{q.question}</p>
                    <p className="mt-1 text-[13px] leading-snug text-brand-muted/80">{q.why}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          {/* 3b · Deliver an event */}
          <Section id="deliver" active={active}>
            <SectionHead eyebrow="Deliver an event" title="From signed to shining" intro="You run what you sell. This is the delivery playbook, step by step, with a time budget for each." />
            <HubDeliver />
          </Section>

          {/* 4 · 30-day plan */}
          <Section id="plan" active={active}>
            <SectionHead eyebrow="30-day plan" title="Your first month" intro="Set the day you started and the current week lights up. Tick tasks as you go." />
            <HubPlan />
          </Section>

          {/* 5 · Daily targets */}
          <Section id="targets" active={active}>
            <SectionHead eyebrow="Daily targets" title="Today’s scoreboard" intro="Tap + as you go. Hitting these every working day is what fills the pipeline." />
            <HubTargets />
          </Section>

          {/* 6 · Templates */}
          <Section id="templates" active={active}>
            <SectionHead eyebrow={`Templates · ${marketLabel}`} title="Copy, personalise, send" intro={market === 'ng' ? 'WhatsApp is the main channel in Nigeria — start there.' : 'Email and LinkedIn first; Instagram for creators.'} />
            <HubTemplates market={market} refCode={refCode} origin={origin} />
          </Section>

          {/* 7 · Links */}
          <Section id="links" active={active}>
            <SectionHead eyebrow={`Links · ${marketLabel}`} title="Everything you can send" intro="Every link carries your ref code when you’ve set one." />
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <RefInput value={refCode} onChange={setRefCode} />
            </div>
            <ul className="flex flex-col divide-y divide-white/[0.06] overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.03]">
              {links.map((c) => {
                const url = buildShareLink(origin, c.path ?? '/', refCode);
                return (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-medium text-brand-fg">{c.label}</p>
                      <p className="truncate font-mono text-[12px] text-brand-muted/75">{url.replace(/^https?:\/\//, '')}</p>
                      {c.id === 'free-trial' && market === 'ng' && (
                        <p className="mt-0.5 text-[11.5px] text-amber-200/80">USD self-serve — not for invoiced Nigerian clients.</p>
                      )}
                    </div>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${c.label}`}
                      className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-brand-fg hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:inline-flex"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                    <CopyButton text={url} variant="icon" ariaLabel={`Copy link: ${c.label}`} />
                  </li>
                );
              })}
            </ul>
          </Section>

          {/* 7b · Showcase events */}
          <Section id="showcase" active={active}>
            <SectionHead
              eyebrow="Showcase events"
              title="Show, don’t tell"
              intro="Real events to send as proof. Pick the booth or the live wall, then copy the link, let a prospect scan the QR off your screen, or download it for a slide or flyer."
            />
            <HubShowcase />
          </Section>

          {/* 8 · Sourcing */}
          <Section id="sourcing" active={active}>
            <SectionHead eyebrow={`Find prospects · ${marketLabel}`} title="Where they are" />
            <div className="grid gap-5 lg:grid-cols-3">
              {ICP_IDS.map((icp) => {
                const rows = sourcing.filter((s) => s.icp === icp);
                if (rows.length === 0) return null;
                return (
                  <div key={icp}>
                    <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.22em] text-accent">{ICP_LABEL[icp]}</p>
                    <ul className="mt-3 flex flex-col gap-3">
                      {rows.map((s, i) => (
                        <li key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <p className="text-[15px] font-semibold text-brand-fg">{s.where}</p>
                          <p className="mt-1 text-[13.5px] leading-snug text-brand-muted">{s.how}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            {sourcing.length === 0 && <p className="text-brand-muted">No sourcing notes for this market yet.</p>}
          </Section>

          {/* 10 · Research */}
          <Section id="research" active={active}>
            <SectionHead eyebrow="Research" title="Why this plan" intro="The sourced facts behind the decks and the plan. Quote the source if a prospect asks." />
            <ul className="flex flex-col gap-3">
              {RESEARCH_NOTES.map((r, i) => (
                <li key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[14.5px] leading-snug text-brand-fg/90">{r.claim}</p>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded text-[12.5px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                  >
                    {r.source} <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </Section>
          </div>
        </main>
      </div>

      {presenting !== null && (
        <div role="dialog" aria-modal="true" aria-label={`Presenting ${presenting.name}`} className="fixed inset-0 z-[60] bg-[#03040a]">
          <div className="h-full w-full overflow-y-auto md:overflow-hidden">
            <div className="h-full px-4 pb-8 md:p-0">
              <SlideDeck deck={presenting} env={envFor(presenting)} notesAvailable onClose={() => setPresenting(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
