/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /beamy — the candidate landing in brand v2 (noindex while the owner reacts
 * to it; `/` is untouched). A normal, natively scrolling page, presented by
 * Beamy: he lives on one fixed, full-viewport, transparent canvas
 * (BeamyStage) and travels down the page with you.
 *
 *   hero → the idea (three explainers) → four feature films → What applies
 *   to you? → Try it (the real booth) → 3D magic → How it works → Pricing →
 *   Start
 *
 * Every section ("stop", lib/beamyScroll) renders an empty `[data-beamy-slot]`
 * where he stands. One measure pass (on resize, font load and content
 * resizes — never per frame) caches each stop's box and his feet in DOCUMENT
 * px; on every scroll the pure director turns those plus scrollY into his
 * target, and the stage glides him there. Phones stand him in a fixed dock
 * under the content instead (the hero keeps its in-flow spot).
 *
 * The first time a stop becomes active he PRESENTS it, once per page view:
 * beams each explainer card into being, projects each film with a soft cone
 * (the frame powers on as the cone lands), drifts light onto the audience
 * cards, blasts the booth on, conjures the 3D prop… All content is in the DOM
 * from the start at reduced opacity; it reveals when his action lands, and at
 * once if the visitor scrolls on, the fallback timer runs out, or the model
 * never loads. Scrolling back shows the settled state.
 *
 * Motion: content motion (his travel, beams, reveals, the projector) plays for
 * everyone, gently under reduced motion (glides and fades, no strobes or
 * particle storms). Decorative motion (pointer parallax and tilt, scroll
 * parallax, crystal bob, hop) is off under reduced motion.
 *
 * Nothing a visitor captures leaves the device: the wall is component state.
 * Tokens/components come from src/styles/brand.css, scoped by data-brand="2".
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Briefcase, Cake, CalendarPlus, Camera, Check, ClipboardList, Gift, Link2, Lock,
  Palette, RotateCcw, Rotate3d, Users, type LucideIcon,
} from 'lucide-react';
import CameraExperience, { lookFrameUrl } from '../../components/landing/CameraExperience';
import ParticleBeam from '../../components/landing/ParticleBeam';
import ReportIssueButton from '../../components/support/ReportIssueButton';
import FilmEmbed from '../../components/ui/FilmEmbed';
import { BoothIcon, CardIcon, ChallengeIcon, WallIcon, type BeamIconProps } from '../../components/ui/BeamIcons';
import LiveWall, { WALL_POOL, type Pin } from '../../components/beamy/LiveWall';
import { SELFIE_CARD_FACE_STYLE, SELFIE_CARD_STYLE, flashGradient } from '../../components/beamy/selfieFx';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';
import { STEP_CREATE_CUTOUT, STEP_QR_CUTOUT, STEP_WALL_CUTOUT } from '../../lib/landingAssets';
import type { Rect } from '../../lib/beamGeometry';
import { REDUCED_GLIDE_S, flashOpacity, photoState } from '../../lib/beamySelfie';
import { SHOT_TILES, WALL_CENTRE, wallRows } from '../../lib/beamyWall';
import HeroPhone, { type Box, type HeroPhoneHandle } from './HeroPhone';
import {
  AUDIENCES, DELIVER_STEPS, DONE_FOR_YOU, GREETING, HELLO, POKE_LINES, audienceById,
  type Audience, type AudienceIcon, type StepIcon,
} from '../../lib/beamyTour';
import {
  EXPLAIN_COPY, EXPLAIN_STEPS, FILMS, FOOTER_LINKS, HERO, HOW_COPY, LOOKS, MAGIC_COPY, NAV_LINKS, PICK_COPY, POKE_IDLE,
  SIGNUP_PATH, START_COPY, TRY_COPY, createReactionPicker, pickCelebration, planCards, pokeStep, pricingSection,
  releaseVelocity, startFacts, type Celebration, type FilmId, type Reaction,
} from '../../lib/brandLanding';
import {
  FOCUS, STOPS, directBeamy, mustRevealNow, nightAt, pageProgress, stopIndex,
  type BeamyTarget, type Side, type StopAnchor, type StopId,
} from '../../lib/beamyScroll';
import BeamyStage, { type BeamyApi, type BeamyClip, type Pt, type StageDecor, type StageLayout } from './BeamyStage';

import boothFilm from '../../assets/landing/booth-feature.mp4';
import boothPoster from '../../assets/landing/booth-feature-poster.jpg';
import wallFilm from '../../assets/landing/wall-feature.mp4';
import wallPoster from '../../assets/landing/wall-feature-poster.jpg';
import challengesFilm from '../../assets/landing/challenges-feature.mp4';
import challengesPoster from '../../assets/landing/challenges-feature-poster.jpg';
import cardsFilm from '../../assets/landing/cards-feature.mp4';
import cardsPoster from '../../assets/landing/cards-feature-poster.jpg';

/** The beam's calm palette for the photo dissolve (palette[0] tints the core). */
const BEAM_PALETTE = ['#C9CCFF', '#FFFFFF', '#A5ABFF', '#FFC56B'];
/** Backdrop shapes: position (in the fixed backdrop) and how far they rise over the whole page (--k, vh). */
const BACKDROP_SHAPES = [
  { x: '-14vw', y: '40vh', s: '62vmax', k: 90 },
  { x: '64vw', y: '120vh', s: '54vmax', k: 170 },
  { x: '-10vw', y: '230vh', s: '58vmax', k: 260 },
];
/** Glass shards at the page edges (never where copy is): x, y, width px, rise (vh), turn, blur (depth). */
const BACKDROP_SHARDS = [
  { x: '1.2vw', y: '70vh', w: 54, k: 160, r: -16, blur: 2 },
  { x: '94vw', y: '130vh', w: 72, k: 240, r: 22, blur: 4 },
  { x: '2.4vw', y: '210vh', w: 38, k: 300, r: 30, blur: 1.5 },
  { x: '95vw', y: '300vh', w: 46, k: 380, r: -24, blur: 3 },
  { x: '0.8vw', y: '380vh', w: 66, k: 440, r: 12, blur: 5 },
];
const AUDIENCE_ICONS: Record<AudienceIcon, LucideIcon> = { ClipboardList, Cake, Users, Briefcase, Gift };
const STEP_ICONS: Record<StepIcon, LucideIcon> = { CalendarPlus, Palette, Link2 };
const EXPLAIN_ART = [STEP_CREATE_CUTOUT, STEP_QR_CUTOUT, STEP_WALL_CUTOUT];
const FILM_MEDIA: Record<FilmId, { src: string; poster: string; Icon: (p: BeamIconProps) => ReactNode }> = {
  booth: { src: boothFilm, poster: boothPoster, Icon: BoothIcon },
  wall: { src: wallFilm, poster: wallPoster, Icon: WallIcon },
  challenges: { src: challengesFilm, poster: challengesPoster, Icon: ChallengeIcon },
  cards: { src: cardsFilm, poster: cardsPoster, Icon: CardIcon },
};
const FILM_STOP: Record<FilmId, StopId> = { booth: 'film-booth', wall: 'film-wall', challenges: 'film-challenges', cards: 'film-cards' };
/** Skipping the picker tours as the most common host. */
const DEFAULT_AUDIENCE = audienceById('family') ?? AUDIENCES[0];
/** Room above Beamy's head kept free for his speech bubble (in-flow stops). */
const BUBBLE_ROOM = 76;
/** How long the centre tile holds Beamy's selfie before it rejoins the rotation. */
const SELFIE_HOLD_MS = 12000;
/** A stop's content fully shown. */
const ALL = 99;
/** Breakpoints: phones dock Beamy; the three-column hero needs a laptop. */
const PHONE_MAX = 768;
const WIDE_HERO_MIN = 1024;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * A step log for verifying the choreography in a browser: in dev, or with
 * `?beamylog` on the URL, every step pushes `{ step, t }` onto
 * `window.__beamyLog`. Off (a no-op) everywhere else.
 */
const STEP_LOG = import.meta.env.DEV || new URLSearchParams(window.location.search).has('beamylog');
function logStep(step: string): void {
  if (!STEP_LOG) return;
  const w = window as unknown as { __beamyLog?: { step: string; t: number }[] };
  (w.__beamyLog ??= []).push({ step, t: Math.round(performance.now()) });
}

/** Typewriter for Beamy's lines; reduced motion gets the whole line at once. */
function useTyped(text: string, reduced: boolean): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) { setN(text.length); return; }
    setN(0);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? (window.clearInterval(id), v) : v + 2)), 22);
    return () => window.clearInterval(id);
  }, [text, reduced]);
  return text.slice(0, n);
}

function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return vp;
}

function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [r, setR] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setR(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return r;
}

const rectOf = (el: Element | null): Rect | null => {
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const centre = (r: Rect): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

interface Flight { from: Rect; to: Rect; shot: string; ms: number; onDone: () => void; key: number; }

/** Everything measured once per layout change, in DOCUMENT px. */
interface Cache {
  stops: StopAnchor[];
  /** Per stop: the x range the bubble must stay inside (null = viewport edge). */
  fences: { minX: number | null; maxX: number | null }[];
  heroPanel: Rect | null;
  heroStand: { feet: Pt; heightPx: number } | null;
  films: Partial<Record<FilmId, Rect>>;
  propSpot: Rect | null;
  headerH: number;
  dockY: number;
  dockH: number;
  band: { top: number; bottom: number };
  heroH: number;
  /** Phones: the bottom of the hero copy (document px); the bubble never rises over it. */
  heroCopyBottom: number | null;
}

/** The hero's measured layout: the wall's box and rows, Beamy's spot on phones, the phone accent. */
interface HeroGeo {
  rows: 3 | 4;
  /** Laptops: the wall's top (in its grid), width and height. */
  wall: { top: number; width: number; height: number } | null;
  /** Phones/tablets: Beamy's height and feet x inside the wall row. */
  stand: { h: number; x: number } | null;
  /** The phone accent's box in the hero pane (null: no room for it). */
  accent: Box | null;
}
/** The hero's flight time for a photo card riding the beam (the wall swaps as it lands). */
const ACCENT_FLIGHT_MS = 1150;

export default function BeamyPage() {
  usePageTitle('Beamwall · Your immersive photo booth');
  useNoIndex();

  const vp = useViewport();
  const phone = vp.w < PHONE_MAX;
  const wideHero = vp.w >= WIDE_HERO_MIN;
  const reduced = useReducedMotion();

  const [active, setActive] = useState(0);
  const [rev, setRev] = useState<Partial<Record<StopId, number>>>({ hero: ALL });
  const [picked, setPicked] = useState<Audience | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const [line, setLine] = useState(HELLO);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [arrival, setArrival] = useState<'waiting' | 'dropping' | 'done'>('waiting');
  const [slowModel, setSlowModel] = useState(false);
  const [copyIn, setCopyIn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [shots, setShots] = useState<{ id: number; src: string }[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [propBusy, setPropBusy] = useState(false);
  const [dragHint, setDragHint] = useState(true);
  const [introRunning, setIntroRunning] = useState(false);
  const [heroPin, setHeroPin] = useState<Pin | null>(null);
  const [ripple, setRipple] = useState(0);
  const [heroGeo, setHeroGeo] = useState<HeroGeo | null>(null);
  const [accentOn, setAccentOn] = useState(false);

  const audience = picked ?? DEFAULT_AUDIENCE;
  const audienceRef = useRef(audience);
  audienceRef.current = audience;

  const api = useRef<BeamyApi | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hitRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  /* The app shell is a fixed-height, overflow-hidden box, so the page scrolls
     inside its own root (as the platform landing does): this is the scroller. */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollTop = () => scrollerRef.current?.scrollTop ?? 0;
  const heroRef = useRef<HTMLElement | null>(null);
  const heroPanelRef = useRef<HTMLDivElement | null>(null);
  const heroGridRef = useRef<HTMLDivElement | null>(null);
  const heroH1Ref = useRef<HTMLHeadingElement | null>(null);
  const heroWallColRef = useRef<HTMLDivElement | null>(null);
  const heroMidRef = useRef<HTMLDivElement | null>(null);
  const heroRegionRef = useRef<HTMLDivElement | null>(null);
  const accentRef = useRef<HeroPhoneHandle | null>(null);
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const boothRef = useRef<HTMLDivElement | null>(null);
  /** The centre tile of whichever wall the next photo flies to. */
  const heroTileRef = useRef<HTMLDivElement | null>(null);
  const tryTileRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardImgRef = useRef<HTMLImageElement | null>(null);
  /** A snapped selfie that has not reached the wall yet (a skip lands it at once). */
  const pendingSelfie = useRef<string | null>(null);
  const token = useRef(0);
  const nextShot = useRef(1);
  const flightKey = useRef(0);
  const pinTimer = useRef(0);
  const activeRef = useRef(0);
  const readyRef = useRef(false);
  readyRef.current = ready && !failed;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const revRef = useRef(rev);
  revRef.current = rev;
  const entered = useRef(new Map<StopId, number>());
  const revealLogged = useRef(new Set<StopId>());
  const lastTarget = useRef<BeamyTarget | null>(null);
  const cache = useRef<Cache | null>(null);
  const stopEls = useRef<Partial<Record<StopId, HTMLElement>>>({});
  const stopRef = useMemo(() => {
    const out = {} as Record<StopId, (el: HTMLElement | null) => void>;
    for (const s of STOPS) out[s.id] = (el) => { if (el === null) delete stopEls.current[s.id]; else stopEls.current[s.id] = el; };
    return out;
  }, []);
  const layoutRef = useRef<StageLayout>({ home: { x: vp.w / 2, y: vp.h * 0.6 }, heightPx: 180 });
  const decorRef = useRef<StageDecor>({ panel: null, stand: null, phone, scroll: 0 });
  const seed = useMemo(() => {
    const q = Number(new URLSearchParams(window.location.search).get('seed'));
    return Number.isFinite(q) && q > 0 ? q : (Date.now() & 0xffff) + 1;
  }, []);
  const react = useRef(createReactionPicker(seed));
  const lastCelebration = useRef<Celebration | null>(null);
  const poke = useRef(POKE_IDLE);
  const drag = useRef<{ id: number; x0: number; y0: number; dragging: boolean; samples: { x: number; t: number }[]; suppressClick: boolean } | null>(null);

  const typed = useTyped(line, reduced);
  /* The hero copy never waits for the model or the choreography. */
  useEffect(() => { const id = window.setTimeout(() => setCopyIn(true), 250); return () => window.clearTimeout(id); }, []);
  const showContent = copyIn || failed || slowModel || reduced;

  const begin = useCallback(() => {
    const mine = ++token.current;
    return () => token.current === mine;
  }, []);
  const say = (t: string) => setLine(t);

  /* ── Reveals ───────────────────────────────────────────────────────── */

  /** Show a stop's content up to `n` (0 = its heading, k = its first k items, ALL). */
  const revealTo = useCallback((id: StopId, n: number, how: string) => {
    const cur = revRef.current[id] ?? -1;
    if (cur >= n) return;
    revRef.current = { ...revRef.current, [id]: n };
    setRev((prev) => ((prev[id] ?? -1) >= n ? prev : { ...prev, [id]: n }));
    if (n >= ALL && !revealLogged.current.has(id)) { revealLogged.current.add(id); logStep(`reveal:${id}:${how}`); }
  }, []);
  /** Entered stops whose action has not landed yet: reveal when the visitor has moved on. */
  const sweepReveals = useCallback(() => {
    const now = performance.now();
    const t = lastTarget.current;
    for (const [id, at] of entered.current) {
      if ((revRef.current[id] ?? -1) >= ALL) continue;
      const i = stopIndex(id);
      const isActive = t !== null && t.active === i;
      const ok = mustRevealNow({ active: isActive, progress: isActive && t !== null ? t.progress : 0, sinceEnterMs: now - at, modelReady: readyRef.current });
      if (!ok) continue;
      const why = !readyRef.current ? 'nomodel' : !isActive || (t !== null && t.progress > 0.7) ? 'fast' : 'timeout';
      revealTo(id, ALL, why);
    }
  }, [revealTo]);
  useEffect(() => {
    const id = window.setInterval(sweepReveals, 400);
    return () => window.clearInterval(id);
  }, [sweepReveals]);
  /* The model failed (or never came): show everything entered. */
  useEffect(() => { if (failed) sweepReveals(); }, [failed, sweepReveals]);

  /* ── Measure (layout changes only) + direct (every scroll) ─────────── */

  const direct = useCallback(() => {
    const c = cache.current;
    if (c === null) return;
    const y = scrollTop();
    const vh = window.innerHeight;
    const t = directBeamy({ stops: c.stops, scrollY: y, vpH: vh, dockY: c.dockY, band: c.band });
    lastTarget.current = t;
    const S = c.stops[t.active];
    const docked = S?.docked === true;
    layoutRef.current = {
      home: { x: t.x, y: t.y },
      heightPx: t.heightPx,
      yaw: t.yaw,
      presence: t.presence,
      floor: t.active === 0 && !docked && !t.travelling,
      // In the dock: inside the dock glass (its top is vh - dockH). Phone hero:
      // never up over the copy.
      bubbleMinY: docked ? vh - c.dockH + 6 : t.active === 0 && c.heroCopyBottom !== null ? Math.max(c.headerH + 8, c.heroCopyBottom - y + 6) : c.headerH + 8,
      bubbleSide: docked,
      bubbleAway: t.travelling,
      bubbleMaxY: docked ? c.dockY : vh - 12,
    };
    const hp = c.heroPanel;
    decorRef.current = {
      panel: hp !== null && hp.top + hp.height - y > -40 ? { left: hp.left, top: hp.top - y, width: hp.width, height: hp.height } : null,
      stand: c.heroStand !== null ? { feet: { x: c.heroStand.feet.x, y: c.heroStand.feet.y - y }, heightPx: c.heroStand.heightPx } : null,
      phone: window.innerWidth < PHONE_MAX,
      scroll: Math.min(y, c.heroH),
    };
    const bar = progressRef.current;
    const sp = pageProgress(y, scrollerRef.current?.scrollHeight ?? vh, vh);
    if (bar !== null) bar.style.transform = `scaleX(${sp.toFixed(4)})`;
    // The backdrop's slow tonal shift and drifting shapes (decorative: held still when reduced).
    if (!reducedRef.current) scrollerRef.current?.style.setProperty('--bw-sp', sp.toFixed(4));
    // The colour journey (a colour, not motion: it follows the scroll for everyone).
    const night = nightAt(c.stops, y + vh * FOCUS).toFixed(3);
    const sc = scrollerRef.current;
    if (sc !== null && sc.style.getPropertyValue('--bw-night-mix') !== night) sc.style.setProperty('--bw-night-mix', night);
    // Scroll depth on the hero's decor (decorative: off when reduced).
    const hero = heroRef.current;
    if (hero !== null && !reducedRef.current) hero.style.setProperty('--hs', Math.min(y, c.heroH).toFixed(0));
    const dock = dockRef.current;
    if (dock !== null) {
      const on = c.stops.length > 1 && c.stops[1].docked && (t.active > 0 || (t.travelling && t.presence < 0.5));
      if ((dock.dataset.on === 'true') !== on) dock.dataset.on = on ? 'true' : 'false';
    }
    const bub = bubbleRef.current;
    if (bub !== null) {
      const f = c.fences[t.active];
      const lo = f?.minX ?? null;
      const hi = f?.maxX ?? null;
      if (lo !== null) bub.dataset.minX = String(lo); else delete bub.dataset.minX;
      if (hi !== null) bub.dataset.maxX = String(hi); else delete bub.dataset.maxX;
      const maxW = docked ? Math.max(150, Math.round(window.innerWidth * 0.6) - 24) : lo !== null || hi !== null ? Math.min(300, (hi ?? window.innerWidth - 12) - (lo ?? 12)) : 300;
      const mw = `${maxW}px`;
      if (bub.style.maxWidth !== mw) bub.style.maxWidth = mw;
    }
    if (t.active !== activeRef.current) onActiveRef.current(t.active, activeRef.current);
    sweepReveals();
  }, [sweepReveals]);

  const measure = useCallback(() => {
    const root = mainRef.current;
    if (root === null) return;
    const y = scrollTop();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isPhone = vw < PHONE_MAX;
    const headerH = Math.round(headerRef.current?.getBoundingClientRect().height ?? 64);
    const dockH = vh < 700 ? 96 : 108;
    const dockY = vh - 14;
    const stops: StopAnchor[] = [];
    const fences: Cache['fences'] = [];
    let heroStand: Cache['heroStand'] = null;
    for (const def of STOPS) {
      const el = stopEls.current[def.id];
      if (el === undefined) return; // not all mounted yet
      const r = el.getBoundingClientRect();
      const docked = isPhone && def.id !== 'hero';
      let feet: Pt;
      let heightPx: number;
      if (docked) {
        feet = { x: def.side === 'right' ? vw * 0.8 : vw * 0.2, y: 0 };
        heightPx = dockH - 22;
      } else {
        const slot = el.querySelector<HTMLElement>('[data-beamy-slot]');
        const sr = slot?.getBoundingClientRect();
        if (sr === undefined || sr.width < 2 || sr.height < 2) {
          feet = { x: vw / 2, y: r.top + y + r.height * 0.6 };
          heightPx = 160;
        } else {
          const room = slot?.dataset.bubble === 'none' ? 0 : BUBBLE_ROOM;
          const capAttr = slot?.dataset.max;
          const cap = capAttr !== undefined ? Number(capAttr) : (vw >= WIDE_HERO_MIN ? 260 : 220);
          heightPx = Math.max(96, Math.min(sr.height - room, sr.width * 0.9, cap));
          feet = { x: sr.left + sr.width / 2, y: sr.bottom + y };
        }
      }
      if (def.id === 'hero') heroStand = { feet, heightPx };
      stops.push({ top: r.top + y, bottom: r.bottom + y, feet, heightPx, side: def.side, docked });
      const lEl = !isPhone ? el.querySelector('[data-bubble-left]') : null;
      const rEl = !isPhone ? el.querySelector('[data-bubble-right]') : null;
      fences.push({
        minX: lEl !== null ? Math.round(lEl.getBoundingClientRect().right + 10) : null,
        maxX: rEl !== null ? Math.round(rEl.getBoundingClientRect().left - 10) : null,
      });
    }
    const hp = rectOf(heroPanelRef.current);
    const films: Cache['films'] = {};
    for (const f of FILMS) {
      const fr = rectOf(stopEls.current[FILM_STOP[f.id]]?.querySelector('[data-film-frame]') ?? null);
      if (fr !== null) films[f.id] = { ...fr, top: fr.top + y };
    }
    const ps = rectOf(root.querySelector('[data-prop-spot]'));
    const heroR = stopEls.current.hero?.getBoundingClientRect();
    cache.current = {
      stops, fences, heroStand, films, headerH, dockY, dockH,
      heroPanel: hp !== null ? { ...hp, top: hp.top + y } : null,
      propSpot: ps !== null ? { ...ps, top: ps.top + y } : null,
      band: { top: headerH + 6, bottom: isPhone ? dockY : vh - 18 },
      heroH: heroR?.height ?? vh,
      heroCopyBottom: isPhone ? (() => { const r = rectOf(root.querySelector('[data-card-avoid]')); return r !== null ? r.top + r.height + y : null; })() : null,
    };
    direct();
  }, [direct]);

  useLayoutEffect(() => { measure(); }, [measure, vp.w, vp.h, phone, wideHero]);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => { raf = 0; direct(); });
    };
    const scroller = scrollerRef.current;
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    // Keyboard scrolling (arrows, space, page keys) goes to the focused
    // scroller: take focus once, without moving or painting a ring.
    if (scroller !== null && (document.activeElement === null || document.activeElement === document.body)) scroller.focus({ preventScroll: true });
    // Content that changes size (images decoding, the booth starting) re-measures.
    let mraf = 0;
    const ro = new ResizeObserver(() => {
      if (mraf !== 0) return;
      mraf = window.requestAnimationFrame(() => { mraf = 0; measure(); });
    });
    if (mainRef.current) ro.observe(mainRef.current);
    // A slot can change size inside a fixed-height section (the hero's flex
    // column as fonts and photos settle): watch each one too.
    mainRef.current?.querySelectorAll('[data-beamy-slot]').forEach((el) => ro.observe(el));
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    return () => {
      live = false;
      scroller?.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(mraf);
      ro.disconnect();
    };
  }, [direct, measure]);

  /* ── Hero layout: a big wall that fills its side, Beamy and the phone accent ──
     Laptops: the wall's top meets the headline's cap height and it grows into
     its column (square tiles, so it stays clear of the floor). Phones and
     tablets: the wall takes the right ~60% of the row between the copy and
     the CTAs (four rows when the row is tall), Beamy stands lower left just
     in front of its corner, and the phone accent floats in the gap above him. */
  const layoutHero = useCallback(() => {
    const pane = heroPanelRef.current;
    if (pane === null) return;
    const pr = pane.getBoundingClientRect();
    const rel = (r: DOMRect): Box => ({ left: r.left - pr.left, top: r.top - pr.top, width: r.width, height: r.height });
    let next: HeroGeo;
    if (window.innerWidth >= WIDE_HERO_MIN) {
      const grid = heroGridRef.current;
      const h1 = heroH1Ref.current;
      const col = heroWallColRef.current;
      const mid = heroMidRef.current;
      if (grid === null || h1 === null || col === null || mid === null) return;
      const gr = grid.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(h1).fontSize) || 60;
      // The wall's frame top meets the headline's cap line.
      const top = Math.max(16, h1.getBoundingClientRect().top - gr.top + fs * 0.12 - 10);
      // Square tiles: 3 tiles + 2 gaps of 7 + 8px padding a side; label row 26.
      const chromeW = 14 + 16;
      const chromeH = 14 + 16 + 26;
      // It may reach 24px into the panel's side padding.
      let width = Math.min(col.getBoundingClientRect().width + 24, 450);
      const maxH = gr.height - top - 36;
      if (((width - chromeW) / 3) * 3 + chromeH > maxH) width = Math.max(200, ((maxH - chromeH) / 3) * 3 + chromeW);
      const height = ((width - chromeW) / 3) * 3 + chromeH;
      // The accent: in the middle column, clear above Beamy's head and his bubble.
      const slotEl = mid.querySelector<HTMLElement>('[data-beamy-slot]');
      const mr = mid.getBoundingClientRect();
      const sr = slotEl?.getBoundingClientRect();
      let accent: Box | null = null;
      if (sr !== undefined && sr.height > 2) {
        const cap = Number(slotEl?.dataset.max ?? 260);
        const bh = Math.max(96, Math.min(sr.height - BUBBLE_ROOM, sr.width * 0.9, cap));
        const headY = sr.bottom - bh;
        const availTop = mr.top + 18;
        const availBottom = headY - BUBBLE_ROOM - 12;
        const ah = Math.min(210, (availBottom - availTop) * 0.92);
        if (ah >= 110) {
          const aw = ah * 0.5;
          const cx = mr.left + mr.width * 0.42;
          accent = rel(new DOMRect(cx - aw / 2, availTop + (availBottom - availTop - ah) * 0.4, aw, ah));
        }
      }
      next = { rows: 3, wall: { top, width, height }, stand: null, accent };
    } else {
      const region = heroRegionRef.current;
      if (region === null) return;
      const rr = region.getBoundingClientRect();
      const wallW = Math.round(rr.width * 0.57);
      const wallLeft = rr.width - wallW;
      // Compact wall: 3 tiles + 2 gaps of 4 + 6px padding a side; label row ~24.
      const rows = wallRows(wallW, rr.height, 8 + 12, 24 + 12 + 12);
      // With his arms out Beamy is ~1.18× as wide as he is tall: he fills the
      // gap left of the wall (his far hand may reach ~20px into the panel's
      // side padding) and his near arm overlaps the wall's corner by ~24px.
      const h = Math.max(96, Math.min(rr.height * 0.6, (wallLeft + 24 + 20) / 1.18, 300));
      const x = wallLeft - h * 0.59 + 24;
      const avail = rr.height - h - 22;
      const ah = Math.min(avail * 0.8, 190, 2 * (wallLeft - 24));
      const accent = ah >= 64
        ? rel(new DOMRect(rr.left + (wallLeft - ah * 0.5) / 2 - 4, rr.top + 6 + (avail - ah) / 2, ah * 0.5, ah))
        : null;
      next = { rows, wall: null, stand: { h, x }, accent };
    }
    setHeroGeo((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  useLayoutEffect(() => { layoutHero(); }, [layoutHero, vp.w, vp.h, wideHero, showContent]);
  // A new hero geometry moves Beamy's slot: re-measure his anchor.
  useLayoutEffect(() => { measure(); }, [heroGeo, measure]);
  useEffect(() => {
    const ro = new ResizeObserver(() => layoutHero());
    if (heroPanelRef.current !== null) ro.observe(heroPanelRef.current);
    if (heroRegionRef.current !== null) ro.observe(heroRegionRef.current);
    if (heroGridRef.current !== null) ro.observe(heroGridRef.current);
    void document.fonts?.ready.then(() => layoutHero());
    return () => ro.disconnect();
  }, [layoutHero, wideHero]);

  /* The accent appears once the selfie has landed (or at once on a skip, a
     failed model, or a visitor who scrolled on before the intro). */
  useEffect(() => {
    if (accentOn) return;
    if (failed || (arrival === 'done' && !introRunning)) { setAccentOn(true); return; }
    const id = window.setTimeout(() => setAccentOn(true), 20000);
    return () => window.clearTimeout(id);
  }, [accentOn, failed, arrival, introRunning]);
  /** The wall is about to swap a tile: a photo card leaves the phone and lands there as it swaps. */
  const onHeroUpcoming = useCallback((tile: HTMLDivElement, src: string) => {
    accentRef.current?.fly(tile, src, ACCENT_FLIGHT_MS);
  }, []);

  /* Deep link: ?s=<stop> scrolls there on load. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('s');
    const el = q !== null ? stopEls.current[q as StopId] : undefined;
    if (el !== undefined) window.setTimeout(() => el.scrollIntoView({ block: 'start' }), 60);
  }, []);

  const scrollToStop = useCallback((id: StopId) => {
    const el = stopEls.current[id];
    if (el === undefined) return;
    logStep(`goto:${id}`);
    el.scrollIntoView({ behavior: reducedRef.current ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const celebrate = useCallback(() => {
    const c = pickCelebration(lastCelebration.current, Math.random());
    lastCelebration.current = c;
    void api.current?.play(c as BeamyClip);
  }, []);

  /* ── The selfie: flash, photo card, beam to the wall's centre tile ──── */

  const hideSelfieFx = useCallback(() => {
    if (flashRef.current) flashRef.current.style.opacity = '0';
    if (cardRef.current) cardRef.current.style.opacity = '0';
  }, []);

  /** The photo reaches the wall: the hero's centre tile holds it; on Try it joins the visitor's shots. */
  const landSelfie = useCallback((src: string, onTry: boolean) => {
    pendingSelfie.current = null;
    logStep(`selfie:land:${onTry ? 'try' : 'intro'}`);
    if (onTry) {
      setShots((prev) => [{ id: nextShot.current++, src }, ...prev].slice(0, SHOT_TILES.length));
      return;
    }
    setHeroPin({ src, key: `selfie${Date.now()}`, mine: false });
    setRipple((r) => r + 1);
    window.clearTimeout(pinTimer.current);
    pinTimer.current = window.setTimeout(() => setHeroPin(null), SELFIE_HOLD_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(pinTimer.current), []);

  const launchSelfie = useCallback((from: Rect, photo: string) => {
    const onTry = STOPS[activeRef.current]?.id === 'try';
    const tile = rectOf(onTry ? tryTileRef.current : heroTileRef.current);
    if (tile === null) { pendingSelfie.current = null; return; }
    // Reduced motion: the same trip, as a slow glide (no particles).
    logStep(`selfie:flight:${reducedRef.current ? 'glide' : 'particles'}`);
    setFlight({
      key: ++flightKey.current, from, to: tile, shot: photo, ms: reducedRef.current ? REDUCED_GLIDE_S * 1000 : 1250,
      onDone: () => { setFlight(null); landSelfie(photo, onTry); },
    });
  }, [landSelfie]);

  /** Play the Selfie clip on the main stage and drive the flash + card from its frames. */
  const runSelfie = useCallback(async (alive: () => boolean): Promise<void> => {
    const b = api.current;
    if (b === null) return;
    let launched = false;
    let flashed = false;
    let cardBox: Rect | null = null;
    logStep('selfie:start');
    const played = await b.selfie((f) => {
      if (!alive()) { hideSelfieFx(); b.stopSelfie(); return; }
      if (!flashed && flashOpacity(f.t, f.tl) > 0.01) { flashed = true; logStep(`selfie:flash:${f.tl.reducedMotion ? 'soft' : 'full'}`); }
      if (f.photo !== undefined) {
        logStep(f.photo === null ? 'selfie:snap:no-photo' : 'selfie:snap');
        pendingSelfie.current = f.photo;
        const img = cardImgRef.current;
        if (img !== null) { if (f.photo !== null) img.src = f.photo; else img.removeAttribute('src'); }
      }
      const fl = flashRef.current;
      if (fl !== null) {
        fl.style.opacity = flashOpacity(f.t, f.tl).toFixed(3);
        fl.style.background = flashGradient(f.phone.x, f.phone.y, f.tl.reducedMotion);
      }
      const card = cardRef.current;
      if (card === null || launched) return;
      const st = photoState(f.t, f.tl);
      const cw = Math.max(44, f.heightPx * 0.3);
      const ch = cw * 1.2;
      const x = clamp(f.phone.x, cw / 2 + 4, window.innerWidth - cw / 2 - 4);
      let y = Math.max(ch / 2 + 4, lerp(f.phone.y, f.phone.y - f.heightPx * 0.36, st.visible ? st.pop : 1));
      // Never across the copy (phones stack Beamy right under the subline).
      const copy = rectOf(document.querySelector('[data-card-avoid]'));
      if (copy !== null && x + cw / 2 > copy.left && x - cw / 2 < copy.left + copy.width) y = Math.max(y, copy.top + copy.height + ch * 0.62 + 4);
      if (f.t >= f.tl.photo.flightStart) {
        // Hand the card to the beam: it dissolves and rides across to the wall.
        launched = true;
        card.style.opacity = '0';
        const photo = pendingSelfie.current;
        const from = cardBox ?? { left: x - cw / 2, top: y - ch / 2, width: cw, height: ch };
        if (photo !== null) launchSelfie(from, photo);
        return;
      }
      card.style.opacity = st.visible ? st.opacity.toFixed(3) : '0';
      if (!st.visible) return;
      card.style.width = `${cw.toFixed(1)}px`;
      card.style.height = `${ch.toFixed(1)}px`;
      card.style.transform = `translate3d(${(x - cw / 2).toFixed(1)}px, ${(y - ch / 2).toFixed(1)}px, 0) rotate(${st.tiltDeg.toFixed(2)}deg) scale(${Math.max(0.001, st.scale).toFixed(3)})`;
      cardBox = { left: x - cw / 2, top: y - ch / 2, width: cw, height: ch };
    });
    if (!played) logStep('selfie:stopped');
    if (!launched) hideSelfieFx();
  }, [hideSelfieFx, launchSelfie]);

  /* ── Entrance: beam drops, Beamy lands, takes a selfie, beams it to the wall ── */
  useEffect(() => {
    if (!ready) return;
    const b = api.current;
    if (b === null) return;
    // Every full load plays it, for every motion preference: this IS the
    // page's content. Reduced motion gets the gentle variants.
    setArrival('dropping');
    logStep(`arrive:start:${reduced ? 'soft' : 'full'}`);
    const alive = begin();
    const onIntro = activeRef.current === 0;
    if (onIntro) setIntroRunning(true);
    void (async () => {
      await b.arrive();
      logStep('arrive:landed');
      setArrival('done');
      if (!alive() || activeRef.current !== 0) {
        setIntroRunning(false);
        // Landed somewhere further down (a deep link): present that stop now.
        if (activeRef.current !== 0) onActiveRef.current(activeRef.current, -1);
        return;
      }
      say(HELLO);
      await runSelfie(alive);
      if (alive()) logStep('intro:done');
      setIntroRunning(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is in
  }, [ready]);
  useEffect(() => {
    const id = window.setTimeout(() => setSlowModel(true), 4000);
    return () => window.clearTimeout(id);
  }, []);

  /* Only the Skip chip skips the intro (or scrolling on). */
  const skipIntro = useCallback(() => {
    logStep('intro:skip');
    begin();
    const b = api.current;
    b?.skipArrival();
    b?.stopSelfie();
    hideSelfieFx();
    setArrival('done');
    setIntroRunning(false);
    const p = pendingSelfie.current;
    if (p !== null) landSelfie(p, false);
  }, [begin, hideSelfieFx, landSelfie]);

  /* ── Presenting: what Beamy does the first time a stop is active ───── */

  const lineFor = useCallback((id: StopId, a: Audience): string => {
    switch (id) {
      case 'hero': return HELLO;
      case 'explain': return EXPLAIN_COPY.line;
      case 'film-booth': return FILMS[0].beamy;
      case 'film-wall': return FILMS[1].beamy;
      case 'film-challenges': return FILMS[2].beamy;
      case 'film-cards': return FILMS[3].beamy;
      case 'pick': return GREETING;
      case 'try': return a.lines.snap;
      case 'magic': return a.lines.prop;
      case 'how': return a.lines.deliver;
      case 'pricing': return pricingSection().line;
      case 'start': return a.lines.go;
    }
  }, []);

  /** Wait until he has (nearly) reached his spot, at most ~1.5s. */
  const arrived = async (alive: () => boolean) => {
    const t0 = performance.now();
    while (alive() && performance.now() - t0 < 1500) {
      const b = api.current;
      if (b === null) return;
      const w = b.where();
      const h = layoutRef.current.home;
      if (Math.hypot(w.x - h.x, w.y - h.y) < 14) return;
      await wait(60);
    }
  };

  /** A viewport getter for something cached in document px (no per-frame DOM reads). */
  const docRect = (r: Rect) => (): Rect => ({ left: r.left, top: r.top - scrollTop(), width: r.width, height: r.height });
  const filmTarget = (id: FilmId) => {
    const r = cache.current?.films[id];
    return r !== undefined ? docRect(r) : () => null;
  };
  const propSpot = (): { at: () => Pt; size: number } => {
    const r = cache.current?.propSpot ?? null;
    const L = layoutRef.current;
    if (r === null) return { at: () => ({ x: L.home.x + L.heightPx, y: L.home.y - L.heightPx * 0.62 }), size: L.heightPx * 0.6 };
    const size = Math.min(r.width * 0.8, L.heightPx * 0.7, 220);
    return { at: () => ({ x: r.left + r.width / 2, y: r.top - scrollTop() + r.height * 0.5 }), size };
  };

  const runReveal = async (a: Audience, alive: () => boolean, instant = false) => {
    const b = api.current;
    if (b === null) return;
    setPropBusy(true);
    const { at, size } = propSpot();
    const r: Reaction = react.current('reveal');
    await b.reveal(a.prop.url, at, size, r === 'handSparks' ? 'hand' : 'mouth', instant);
    setPropBusy(false);
    if (!alive() || instant) return;
    say(`Ta-da! A ${a.prop.name.toLowerCase()}, tracked in 3D on every guest.`);
  };

  const present = async (id: StopId, alive: () => boolean) => {
    const def = STOPS[stopIndex(id)];
    const b = api.current;
    if (b === null || !readyRef.current) { revealTo(id, ALL, 'nomodel'); return; }
    await arrived(alive);
    if (!alive()) return;
    const el = stopEls.current[id];
    logStep(`action:${id}:${def.presenting}`);
    // The fallback clock runs from the action, not from the entry: the walk
    // over (up to ~1.5s) must not eat the time the action itself needs.
    entered.current.set(id, performance.now());
    revealTo(id, 0, 'beam');
    switch (def.presenting) {
      case 'handZap': {
        void b.play('Wave');
        await wait(320);
        const targets = Array.from(el?.querySelectorAll<HTMLElement>('[data-beam-target]') ?? []);
        for (let n = 0; n < targets.length; n++) {
          if (!alive()) return;
          // Aim at the card's art, or else at the card's near edge: never through its copy.
          const art = rectOf(targets[n].querySelector<HTMLElement>('[data-beam-at]'));
          const r = rectOf(targets[n]);
          if (r === null) continue;
          const hx = layoutRef.current.home.x;
          // Art above the copy (the 3-up cards) is a clear line; art beside it is not.
          const clear = art !== null && art.top + art.height <= r.top + r.height * 0.5;
          const at = clear && art !== null ? centre(art) : { x: hx > r.left + r.width / 2 ? r.left + r.width - 6 : r.left + 6, y: r.top + r.height / 2 };
          void b.zap(at, 'hand', 380);
          await wait(140);
          revealTo(id, n + 1, 'beam');
          logStep(`zap:${id}:${n}`);
          await wait(310);
        }
        break;
      }
      case 'mouthCone':
      case 'handCone': {
        const film = FILMS.find((f) => FILM_STOP[f.id] === id);
        if (film === undefined) break;
        const from = def.presenting === 'mouthCone' ? 'mouth' : 'hand';
        void b.play(from === 'mouth' ? 'BeamyBlast' : 'Wave');
        await wait(from === 'mouth' ? 1000 : 260);
        if (!alive()) return;
        await b.project(filmTarget(film.id), from, true);
        logStep(`cone:${id}:landed`);
        break;
      }
      case 'drift': {
        const g = rectOf(el?.querySelector('[data-drift-target]') ?? null);
        if (g !== null) await b.drift(centre(g));
        break;
      }
      case 'blast': {
        const r = rectOf(boothRef.current);
        if (r !== null) await new Promise<void>((res) => { void b.beam(centre(r), () => { revealTo(id, ALL, 'beam'); res(); }, 'mouth'); });
        break;
      }
      case 'sparks': {
        await wait(reducedRef.current ? 0 : 200);
        if (alive()) await runReveal(audienceRef.current, alive);
        break;
      }
      case 'hop': {
        b.sparkle('burst');
        void b.play('Hop');
        await wait(260);
        break;
      }
      case 'intro':
        break;
    }
    revealTo(id, ALL, 'beam');
  };

  /** A stop became active (from = the previous one, −1 when re-presenting after landing). */
  const onActive = (i: number, from: number) => {
    activeRef.current = i;
    setActive(i);
    const id = STOPS[i].id;
    const prevId = from >= 0 ? STOPS[from].id : null;
    logStep(`enter:${id}`);
    const alive = begin();
    say(lineFor(id, audienceRef.current));
    if (id !== 'hero') setDragHint(false);
    if (id !== 'try') setCameraOn(false);
    const b = api.current;
    if (prevId !== null && prevId.startsWith('film-')) b?.stopProject();
    if (prevId === 'magic' && id !== 'magic') b?.clearProp();
    // Leaving a stop mid-action reveals it at once (never stranded).
    sweepReveals();
    if (id === 'hero') return;
    if (!entered.current.has(id)) {
      entered.current.set(id, performance.now());
      if (b === null || !readyRef.current) { revealTo(id, ALL, 'nomodel'); return; }
      void present(id, alive);
      return;
    }
    // Back on a stop already presented: its settled state.
    if (b === null || !readyRef.current) return;
    const film = FILMS.find((f) => FILM_STOP[f.id] === id);
    if (film !== undefined) void b.project(filmTarget(film.id), STOPS[i].presenting === 'handCone' ? 'hand' : 'mouth', false);
    if (id === 'magic') void runReveal(audienceRef.current, alive, true);
  };
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  /* Gaze + hero depth: the pointer on desktop (lerped CSS vars on the hero
     for the parallax layers, the panel tilt, the wall turn and the sheen);
     the last tap on touch turns his head, then back to you. */
  useEffect(() => {
    let clear = 0;
    let raf = 0;
    const cur = { x: 0, y: 0 };
    const tgt = { x: 0, y: 0 };
    const tick = () => {
      raf = 0;
      cur.x += (tgt.x - cur.x) * 0.08;
      cur.y += (tgt.y - cur.y) * 0.08;
      const h = heroRef.current;
      if (h !== null) {
        h.style.setProperty('--px', cur.x.toFixed(4));
        h.style.setProperty('--py', cur.y.toFixed(4));
        h.style.setProperty('--tilt-x', cur.x.toFixed(4));
        h.style.setProperty('--sheen-dx', `${(cur.x * 18).toFixed(1)}%`);
      }
      if (Math.abs(tgt.x - cur.x) > 0.001 || Math.abs(tgt.y - cur.y) > 0.001) raf = window.requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      api.current?.look({ x: e.clientX, y: e.clientY });
      // Decorative depth: held still under reduced motion.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      tgt.x = clamp((e.clientX / Math.max(1, window.innerWidth)) * 2 - 1, -1, 1);
      tgt.y = clamp((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1, -1, 1);
      if (raf === 0) raf = window.requestAnimationFrame(tick);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      api.current?.look({ x: e.clientX, y: e.clientY });
      window.clearTimeout(clear);
      clear = window.setTimeout(() => api.current?.look(null), 1600);
    };
    const onLeave = () => { api.current?.look(null); tgt.x = 0; tgt.y = 0; if (raf === 0) raf = window.requestAnimationFrame(tick); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.clearTimeout(clear);
      window.cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  /* Film starts, for the log (the films autoplay muted when lit and in view). */
  useEffect(() => {
    const vids = Array.from(mainRef.current?.querySelectorAll<HTMLVideoElement>('[data-film-frame] video') ?? []);
    const ons = vids.map((v, n) => { const on = () => logStep(`film:play:${FILMS[n]?.id ?? n}`); v.addEventListener('play', on); return () => v.removeEventListener('play', on); });
    return () => { for (const off of ons) off(); };
  }, []);

  /* ── The pick: a varied reaction, then on to the demo. ─────────────── */
  const pickAudience = async (a: Audience, el: HTMLElement) => {
    const alive = begin();
    setPicked(a);
    setLook(a.kit);
    say(a.lines.intro);
    logStep(`pick:${a.id}`);
    const b = api.current;
    const target = centre(rectOf(el) ?? { left: 0, top: 0, width: 0, height: 0 });
    const land = () => { if (alive()) setSelectedId(a.id); };
    if (b === null || reduced) {
      land();
      if (b !== null) void b.play('Wave');
    } else {
      const r = react.current('pick');
      if (r === 'handBeam') await b.beam(target, land, 'hand');
      else { await b.drift(target); land(); }
    }
    if (!alive()) return;
    await wait(reduced ? 700 : 1000);
    if (alive() && STOPS[activeRef.current]?.id === 'pick') scrollToStop('try');
  };

  /* ── The booth hands over a shot: Beamy catches it, then beams it. ─── */
  const onBeam = useCallback((src: string) => {
    const b = api.current;
    const vf = rectOf(viewfinderRef.current);
    const tile = rectOf(tryTileRef.current);
    logStep('try:shot');
    const commit = () => {
      logStep('try:land');
      setShots((prev) => [{ id: nextShot.current++, src }, ...prev].slice(0, SHOT_TILES.length));
      say('It’s on the wall! Every guest’s shot lands there, live.');
      celebrate();
    };
    if (b === null || vf === null || tile === null) { logStep('try:no-flight'); commit(); return; }
    if (reduced) {
      logStep('try:flight:glide');
      say('Beaming it to the wall…');
      setFlight({ key: ++flightKey.current, from: vf, to: tile, shot: src, ms: REDUCED_GLIDE_S * 1000, onDone: () => { setFlight(null); commit(); } });
      return;
    }
    logStep('try:flight:particles');
    const alive = begin();
    const r = react.current('snap');
    const fromHand = r === 'handBeam';
    say('Ooh, nice one! Let me catch it…');
    const o = fromHand ? b.hand() : b.mouth();
    const catchRect: Rect = { left: o.x - 22, top: o.y - 38, width: 44, height: 76 };
    b.face(vf.left + vf.width / 2);
    setFlight({
      key: ++flightKey.current, from: vf, to: catchRect, shot: src, ms: 1100,
      onDone: () => {
        setFlight(null);
        if (!alive()) { commit(); return; }
        say('And… beam!');
        void b.beam(centre(tile), () => {
          const o2 = fromHand ? b.hand() : b.mouth();
          setFlight({
            key: ++flightKey.current,
            from: { left: o2.x - 22, top: o2.y - 38, width: 44, height: 76 },
            to: tile, shot: src, ms: 1250,
            onDone: () => { setFlight(null); commit(); },
          });
        }, fromHand ? 'hand' : 'mouth');
      },
    });
  }, [begin, celebrate, reduced]);

  /* ── Poke + drag on Beamy's own hit area (nothing else captures). ──── */
  const onPoke = () => {
    const b = api.current;
    if (b === null) return;
    if (STOPS[activeRef.current]?.id === 'hero') {
      // During the intro a tap is just a sparkle (only Skip skips); once it
      // has settled, tapping him on the hero replays the selfie.
      if (introRunning) { b.sparkle('sparkle'); return; }
      logStep('selfie:replay');
      void runSelfie(begin());
      return;
    }
    const r = pokeStep(poke.current, performance.now());
    poke.current = r.state;
    if (r.level === 'sparkle') {
      b.sparkle('sparkle');
      say(POKE_LINES[(r.count - 1) % 2]);
      void b.play(r.count === 1 ? 'Hop' : 'SideEye');
    } else if (r.level === 'burst') {
      b.sparkle('burst');
      say(POKE_LINES[r.count === 3 ? 2 : 3]);
      if (r.count === 3) void b.play('Wave');
      else void b.play('ShadesOn');
    } else {
      b.sparkle('burst');
      b.spin();
      say(POKE_LINES[4]);
      void b.play('Dance');
    }
  };
  const onHitDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dragging: false, samples: [{ x: e.clientX, t: performance.now() }], suppressClick: false };
  };
  const onHitMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.dragging && Math.hypot(dx, e.clientY - d.y0) > 6) { d.dragging = true; api.current?.dragStart(); setDragHint(false); }
    if (!d.dragging) return;
    api.current?.dragMove(dx);
    const now = performance.now();
    d.samples.push({ x: e.clientX, t: now });
    while (d.samples.length > 2 && now - d.samples[0].t > 90) d.samples.shift();
  };
  const onHitUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    if (d.dragging) {
      api.current?.dragEnd(releaseVelocity(d.samples));
      d.suppressClick = true;
    }
    d.dragging = false;
  };
  const onHitClick = () => {
    const d = drag.current;
    if (d !== null && d.suppressClick) { d.suppressClick = false; return; }
    onPoke();
  };

  /* ── Pieces ─────────────────────────────────────────────────────────── */

  const shown = (id: StopId, n: number) => (rev[id] ?? -1) >= n;
  /** A revealed block: dim and lowered until Beamy brings it up; it condenses out of light when beamed. */
  const reveal = (id: StopId, n: number, extra = '') => ({
    className: `bw-reveal ${extra}`,
    'data-on': shown(id, n) ? 'true' : 'false',
  });

  const slot = (extra = '', opts: { max?: number; bubble?: boolean } = {}, children?: ReactNode, style?: CSSProperties) => (
    <div
      data-beamy-slot
      data-max={opts.max !== undefined ? String(Math.round(opts.max)) : undefined}
      data-bubble={opts.bubble === false ? 'none' : undefined}
      aria-hidden
      className={`${extra.includes('absolute') ? '' : 'relative'} min-h-0 ${extra}`}
      style={style}
    >
      {children}
    </div>
  );

  const shotPins = useMemo(() => {
    const out: Record<number, Pin> = {};
    shots.forEach((s, n) => { out[SHOT_TILES[n]] = { src: s.src, key: `s${s.id}`, mine: true }; });
    return out;
  }, [shots]);
  const heroPins = useMemo<Record<number, Pin>>(() => (heroPin === null ? {} : { [WALL_CENTRE]: heroPin }), [heroPin]);

  const lookPills = (
    <FadeScroll
      axis="x"
      role="group"
      aria-label="Pick a look"
      className={`flex gap-2 ${phone ? '-mx-4 flex-nowrap overflow-x-auto px-4 [scrollbar-width:none]' : 'flex-wrap'}`}
    >
      {LOOKS.map((l) => (
        <button key={l.label} type="button" className={`bw-glass-chip ${phone ? 'shrink-0 px-3' : ''}`} aria-pressed={look === l.kit} onClick={() => setLook(l.kit)}>
          {l.label}
        </button>
      ))}
    </FadeScroll>
  );

  /* The booth: a phone at a natural phone aspect, in a slim deep frame. */
  const idleFrame = lookFrameUrl(look);
  const big = !phone;
  const booth = (
    <div
      ref={boothRef}
      data-booth-ui
      className={`relative overflow-hidden ${big ? 'aspect-[9/17] h-full rounded-[34px] p-[7px]' : 'aspect-[9/16] h-full rounded-[22px] p-[5px]'}`}
      style={{ background: 'var(--bw-deep-2)', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.25), 0 24px 50px -24px var(--bw-shadow)' }}
    >
      <div className={`relative h-full w-full overflow-hidden ${big ? 'rounded-[28px]' : 'rounded-[18px]'}`} style={{ background: 'var(--bw-deep)' }}>
        {cameraOn ? (
          <CameraExperience enabled videoId="beamy-booth-video" beamLabel="Beam it to the wall" onBeam={onBeam} look={look} screenRef={viewfinderRef} />
        ) : (
          <div className="relative h-full">
            <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(80% 55% at 50% 36%, #7A72EC 0%, #4A42C8 55%, #2B2A8C 100%)' }} />
            {idleFrame !== null && (
              <img key={idleFrame} src={idleFrame} alt="" aria-hidden draggable={false} data-look-preview className="absolute inset-0 h-full w-full object-cover" style={{ animation: reduced ? undefined : 'bw-fade 360ms var(--bw-ease) both' }} />
            )}
            <div aria-hidden className={`absolute inset-x-0 bottom-0 ${big ? 'h-[64%]' : 'h-[82%]'}`} style={{ background: big ? 'linear-gradient(to top, rgba(26,23,64,0.92) 0%, rgba(26,23,64,0.84) 52%, rgba(26,23,64,0) 100%)' : 'linear-gradient(to top, rgba(26,23,64,0.95) 0%, rgba(26,23,64,0.9) 62%, rgba(26,23,64,0) 100%)' }} />
            <div className={`relative flex h-full flex-col items-center justify-end text-center ${big ? 'gap-3 px-5 pb-7' : 'gap-2 px-2.5 pb-3'}`}>
              <span className="bw-icon-tile" aria-hidden><Camera /></span>
              <p className="bw-small max-w-[20ch]" style={{ color: 'var(--bw-ink)' }}>The real booth your guests open from a QR code.</p>
              <button type="button" className={`bw-btn bw-btn-primary bw-btn-sm ${big ? '' : 'h-auto w-full whitespace-normal px-3 py-2 leading-tight'}`} onClick={() => { setCameraOn(true); say('Smile! Pick a look, then tap the big button.'); }}>
                {TRY_COPY.start}
              </button>
              <p className="bw-label flex items-center gap-1.5" style={{ color: 'var(--bw-ink)' }}><Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden /> {TRY_COPY.privacy}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const i = (n: number) => ({ ['--i' as string]: n });
  const start = startFacts();
  const pricing = pricingSection();
  const plans = planCards();

  /* Two columns: Beamy's column on `side`, the content on the other. Phones: content only (he is docked). */
  const split = (side: Side, beamyCol: ReactNode, content: ReactNode, opts: { align?: 'center' | 'start' } = {}) => {
    if (phone) return <div className="flex flex-col">{content}</div>;
    const left = side === 'left';
    return (
      <div className={`grid items-${opts.align ?? 'center'} gap-[clamp(20px,3vw,56px)] ${left ? 'grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)]'}`}>
        {left ? (
          <>
            <div className="flex justify-center">{beamyCol}</div>
            <div data-bubble-right className="min-w-0">{content}</div>
          </>
        ) : (
          <>
            <div data-bubble-left className="min-w-0">{content}</div>
            <div className="flex justify-center">{beamyCol}</div>
          </>
        )}
      </div>
    );
  };
  const stand = (extra = '') => slot(`w-full max-w-[300px] ${extra || 'h-[min(380px,52vh)]'}`);
  const heading = (text: string, id: string, cls = 'bw-h2') => <h2 id={id} className={cls}>{text}</h2>;
  /* Every section sits in its own glass pane (brand.css .bw-stop::before),
     inset inside the section's padding; the gap between two panes is the
     gutter Beamy crosses the page in. */
  const stopClass = `bw-stop relative mx-auto w-full max-w-[1320px] ${phone ? 'px-6 py-16' : 'px-[clamp(48px,6.5vw,104px)] py-[clamp(96px,14vh,156px)]'}`;

  /* ── Hero ──────────────────────────────────────────────────────────── */
  const heroCtas = (
    <div className={`flex gap-3 ${wideHero ? 'mt-8 flex-wrap' : 'flex-col sm:flex-row'}`} style={i(3)}>
      <Link to={SIGNUP_PATH} className={`bw-btn bw-btn-primary ${wideHero ? 'bw-btn-lg' : 'w-full sm:w-auto'}`}>{HERO.primary}</Link>
      <button type="button" className={`bw-btn bw-btn-secondary ${wideHero ? 'bw-btn-lg' : 'w-full sm:w-auto'}`} onClick={() => scrollToStop('try')}>
        {HERO.secondary}
      </button>
    </div>
  );
  const heroHeadline = (
    <>
      <p className={`bw-eyebrow ${wideHero ? '' : 'text-[14px] after:hidden'}`} style={i(0)}>{HERO.eyebrow}</p>
      <h1 ref={heroH1Ref} className={`bw-display ${wideHero ? 'mt-6' : 'mt-2'}`} style={wideHero ? { ...i(1), fontSize: 'clamp(40px, min(22px + 3vw, 7.4dvh), 76px)' } : i(1)}>
        <span className="bw-light block">{HERO.lead}</span>
        <span className="block">{HERO.strong}</span>
      </h1>
      {/* Full ink here: the hero's sheen and floor light sit behind this line. */}
      <p className={`bw-body ${wideHero ? 'mt-5 max-w-[34ch]' : 'mt-2 max-w-[36ch]'}`} style={{ ...i(2), color: 'var(--bw-ink)' }}>{HERO.sub}</p>
    </>
  );
  const heroRows = heroGeo?.rows ?? 3;
  const flying = accentOn && !reduced && heroGeo?.accent != null;
  const heroWall = (
    <div className="bw-wall-mount bw-wall-glint h-full" style={{ ['--wall-yaw' as string]: wideHero ? '-9deg' : '-5deg' }}>
      <LiveWall
        key={heroRows}
        pool={WALL_POOL} pins={heroPins} dim={introRunning} compact={!wideHero} centreRef={heroTileRef} ripple={ripple} seed={seed}
        rows={heroRows} fill lead={flying ? ACCENT_FLIGHT_MS : 0} onUpcoming={flying ? onHeroUpcoming : undefined}
      />
    </div>
  );
  const accent = accentOn && heroGeo?.accent != null && (
    <HeroPhone
      ref={accentRef}
      box={heroGeo.accent}
      wall={() => heroTileRef.current?.closest<HTMLElement>('.bw-wall') ?? null}
      photo={WALL_POOL[0]}
      frame={lookFrameUrl(null)}
      reduced={reduced}
      depth={wideHero ? { dx: 12, dy: 8, ds: -0.06 } : { dx: 0, dy: 0, ds: -0.04 }}
    />
  );
  const heroSlotChildren = (
    <>
      {/* A faint pool of light on the floor under his feet. */}
      <span aria-hidden className="bw-floor-pool" />
      {!ready && !failed && (
        <p className="bw-label pointer-events-none absolute inset-x-0 top-[55%] text-center">Beamy is on his way&hellip;</p>
      )}
      {wideHero && dragHint && ready && arrival === 'done' && !introRunning && (
        <p
          className="bw-label pointer-events-none absolute left-1/2 top-full mt-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5"
          style={{ color: 'var(--bw-ink)', background: 'rgba(26, 23, 64, 0.58)', WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)', animation: reduced ? undefined : 'bw-fade 600ms var(--bw-ease) 900ms both' }}
        >
          <Rotate3d className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Drag me
        </p>
      )}
    </>
  );
  const skipChip = introRunning && (
    <button type="button" className="bw-btn bw-btn-secondary bw-btn-sm" onClick={skipIntro} data-skip-intro>
      {wideHero ? START_COPY.skipIntro : START_COPY.skipShort}
    </button>
  );
  const panelInset = wideHero ? clamp(Math.round(vp.w * 0.022), 18, 40) : 10;
  const radius = wideHero ? 36 : 24;
  const heroH = wideHero ? `max(640px, calc(100svh - var(--bw-header-h)))` : undefined;

  const hero = (
    <section
      ref={(el) => { heroRef.current = el; stopRef.hero(el); }}
      id="hello"
      data-stop="hero"
      aria-label="Beamwall"
      className="bw-hero relative"
      style={{ height: heroH, minHeight: wideHero ? undefined : 'calc(100svh - var(--bw-header-h))' }}
    >
      {/* Far plane: soft shapes behind the box, moving least. */}
      {/* (Each depth layer is a still clipping box with the moving layer
          inside it, so a layer never slides out past the hero.) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="bw-depth absolute inset-0" style={{ ['--dx' as string]: -10, ['--dy' as string]: -6, ['--ds' as string]: 0.25 }}>
          <span className="bw-far-blob" style={{ width: '38vmax', height: '38vmax', right: '-12vmax', top: '-16vmax' }} />
          <span className="bw-far-blob" style={{ width: '28vmax', height: '28vmax', left: '-10vmax', bottom: '-14vmax' }} />
        </div>
      </div>
      <div ref={heroPanelRef} className="bw-hero-pane absolute" style={{ inset: panelInset, ['--bw-radius-panel' as string]: `${radius}px` }}>
        {/* The glass box: frost, the recessed back wall with its deep inner
            shadow, the shadows the copy / wall / Beamy cast on it, the floor. */}
        <div className="bw-glass" aria-hidden />
        <div aria-hidden className="bw-hero-back" style={{ borderRadius: radius }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
         <div className="bw-depth absolute inset-0" style={{ ['--dx' as string]: -16, ['--dy' as string]: -10, ['--ds' as string]: 0.12 }}>
          {wideHero ? (
            <>
              <span className="bw-cast" style={{ left: '6%', top: '30%', width: '36%', height: '46%' }} />
              <span className="bw-cast" style={{ left: '44%', top: '40%', width: '18%', height: '46%' }} />
              <span className="bw-cast" style={{ left: '73%', top: '26%', width: '24%', height: '56%' }} />
            </>
          ) : (
            <span className="bw-cast" style={{ left: '14%', top: '38%', width: '72%', height: '44%' }} />
          )}
         </div>
        </div>
        <div aria-hidden className="bw-hero-floor" style={{ borderRadius: `0 0 ${radius}px ${radius}px` }} />
        {wideHero ? (
          <div ref={heroGridRef} className="relative grid h-full grid-cols-[minmax(0,1.36fr)_minmax(0,0.78fr)_minmax(0,1fr)] items-center gap-6 px-[clamp(28px,3.4vw,64px)]">
            <div data-card-avoid data-bubble-left className={`relative z-10 flex flex-col ${showContent ? 'bw-rise' : 'invisible'}`}>
              {heroHeadline}
              {heroCtas}
            </div>
            <div ref={heroMidRef} className="flex h-full flex-col justify-end pb-[clamp(96px,13vh,132px)]">
              {slot('h-[72%] w-full', { max: Math.min(380, vp.h * 0.42) }, heroSlotChildren)}
            </div>
            <div ref={heroWallColRef} className={`flex h-full items-start justify-end ${showContent ? 'bw-rise' : 'invisible'}`}>
              {/* Back plane: big out-of-focus crystals behind the wall. */}
              <span aria-hidden className="bw-crystal-far" style={{ right: 0, top: `calc(${heroGeo?.wall?.top ?? 120}px - 40px)`, width: 150, height: 190, rotate: '18deg' }} />
              <span aria-hidden className="bw-crystal-far" style={{ right: `calc(${heroGeo?.wall?.width ?? 360}px - 50px)`, top: `calc(${(heroGeo?.wall?.top ?? 120) + (heroGeo?.wall?.height ?? 400)}px - 110px)`, width: 110, height: 140, rotate: '-24deg' }} />
              <div data-bubble-right className="relative" style={{ ...i(2), marginTop: heroGeo?.wall?.top ?? 0, marginRight: heroGeo?.wall != null ? -24 : 0, width: heroGeo?.wall?.width ?? 'min(370px, 100%)', height: heroGeo?.wall?.height ?? 'auto' }}>{heroWall}</div>
            </div>
            <div className="absolute bottom-5 left-[clamp(28px,3.4vw,64px)]">{skipChip}</div>
          </div>
        ) : (
          <div className="relative flex h-full flex-col px-4 pb-4 pt-4 sm:px-8">
            <div data-card-avoid className={`shrink-0 ${showContent ? 'bw-rise' : 'invisible'}`}>{heroHeadline}</div>
            {/* The wall fills the right ~60% of the row between the copy and the
                CTAs; Beamy stands lower left, just in front of its corner. */}
            <div ref={heroRegionRef} className="relative mt-3 min-h-[200px] flex-1">
              <span aria-hidden className="bw-crystal-far" style={{ right: 0, top: '-6%', width: 90, height: 120, rotate: '18deg' }} />
              <div className={`absolute bottom-0 right-0 top-0 w-[57%] ${showContent ? 'bw-rise' : 'invisible'}`} style={i(2)}>{heroWall}</div>
              {heroGeo?.stand != null && slot(
                'absolute bottom-0',
                { max: heroGeo.stand.h, bubble: false },
                heroSlotChildren,
                { left: heroGeo.stand.x - heroGeo.stand.h / 0.85 / 2, width: heroGeo.stand.h / 0.85, height: heroGeo.stand.h },
              )}
            </div>
            <div className={`mt-4 shrink-0 ${showContent ? 'bw-rise' : 'invisible'}`}>{heroCtas}</div>
            {introRunning && <div className="mt-3 flex justify-center">{skipChip}</div>}
          </div>
        )}
        {accent}
        {/* The front pane: a crisp rim and a soft sheen that slides with the pointer. */}
        <div aria-hidden className="bw-hero-front" style={{ borderRadius: radius }} />
      </div>
      {/* Near plane: glass shards in front of the box, slightly out of focus, moving most. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
       <div className="bw-depth absolute inset-0" style={{ ['--dx' as string]: 26, ['--dy' as string]: 14, ['--ds' as string]: -0.35 }}>
        <span className="bw-shard" style={{ left: wideHero ? '1.5%' : '-4%', bottom: wideHero ? '7%' : '18%', width: wideHero ? 92 : 56, height: wideHero ? 120 : 72, transform: 'rotate(-18deg)' }} />
        {!phone && <span className="bw-shard bw-shard-b" style={{ right: '2.5%', top: '12%', width: 64, height: 80, transform: 'rotate(24deg)' }} />}
       </div>
      </div>
    </section>
  );

  /* ── Explainers ────────────────────────────────────────────────────── */
  const explainCols = vp.w >= 1180 ? 'grid-cols-3' : 'grid-cols-1';
  const explain = (
    <section ref={stopRef.explain} id="idea" data-stop="explain" aria-labelledby="h-explain" className={stopClass}>
      {split('right', stand(), (
        <>
          <div {...reveal('explain', 0)}>
            <p className="bw-eyebrow after:hidden">How it works</p>
            {heading(EXPLAIN_COPY.heading, 'h-explain', 'bw-h2 mt-3 max-w-[22ch]')}
            <p className="bw-body mt-3">{EXPLAIN_COPY.sub}</p>
          </div>
          <ol className={`mt-8 grid gap-4 ${explainCols}`}>
            {EXPLAIN_STEPS.map((s, n) => (
              <li key={s.title} data-beam-target {...reveal('explain', n + 1, `bw-glass-card bw-card-lift bw-condense flex ${explainCols === 'grid-cols-3' ? 'flex-col' : 'items-center'} gap-4 p-5`)}>
                <div data-beam-at className={`relative flex shrink-0 items-center justify-center ${explainCols === 'grid-cols-3' ? 'h-36' : 'h-24 w-24'}`}>
                  <span aria-hidden className="bw-art-glow" />
                  <img src={EXPLAIN_ART[n]} alt="" aria-hidden loading="lazy" draggable={false} className="relative h-full w-auto object-contain drop-shadow-[0_16px_28px_rgba(22,18,78,0.55)]" />
                </div>
                <div className="min-w-0">
                  <span className="bw-label block">Step {n + 1}</span>
                  <h3 className="bw-h3 mt-1">{s.title}</h3>
                  <p className="bw-small mt-1.5">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      ))}
    </section>
  );

  /* ── Films ─────────────────────────────────────────────────────────── */
  const films = FILMS.map((f) => {
    const id = FILM_STOP[f.id];
    const def = STOPS[stopIndex(id)];
    const m = FILM_MEDIA[f.id];
    const lit = shown(id, ALL);
    return (
      <section key={f.id} ref={stopRef[id]} id={`film-${f.id}`} data-stop={id} aria-labelledby={`h-${id}`} className={stopClass}>
        {split(def.side, stand(), (
          <>
            <div {...reveal(id, 0)}>
              <p className="bw-eyebrow flex-row items-center gap-2.5 after:hidden">
                <span className="bw-icon-tile !h-9 !w-9" aria-hidden><m.Icon size={20} from="#FFFFFF" to="#C9CCFF" /></span>
                {f.eyebrow}
              </p>
              {heading(f.title, `h-${id}`, 'bw-h2 mt-3 max-w-[20ch]')}
              <p className="bw-body mt-3 max-w-[46ch]">{f.line}</p>
            </div>
            <div data-film-frame data-lit={lit ? 'true' : 'false'} className="bw-film mt-7">
              <FilmEmbed src={m.src} poster={m.poster} label={`${f.title}: feature film`} hold={!lit} chipClassName="bw-film-chip" />
            </div>
          </>
        ))}
      </section>
    );
  });

  /* ── What applies to you? ──────────────────────────────────────────── */
  const pick = (
    <section ref={stopRef.pick} id="for-you" data-stop="pick" aria-labelledby="h-pick" className={stopClass}>
      {split('left', stand(), (
        <>
          <div {...reveal('pick', 0)}>
            {heading(PICK_COPY.heading, 'h-pick')}
            <p className="bw-body mt-2">{PICK_COPY.sub}</p>
          </div>
          <div data-drift-target {...reveal('pick', ALL, `mt-7 grid gap-3 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`)}>
            {AUDIENCES.map((a) => {
              const Icon = AUDIENCE_ICONS[a.icon];
              const on = selectedId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={(e) => { void pickAudience(a, e.currentTarget); }}
                  className={`bw-glass-card bw-interactive flex items-center gap-4 ${phone ? 'min-h-[64px] px-4 py-3' : 'min-h-[84px] p-4'}`}
                >
                  <span className="bw-icon-tile" aria-hidden><Icon /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{a.title}</span>
                    <span className="bw-label mt-0.5 block">{a.hint}</span>
                  </span>
                  {on && <Check className="h-5 w-5 shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-ink)' }} aria-hidden />}
                </button>
              );
            })}
          </div>
        </>
      ))}
    </section>
  );

  /* ── Try it ────────────────────────────────────────────────────────── */
  const tryWall = (
    <div className="bw-wall-mount" style={{ ['--wall-yaw' as string]: phone ? '-4deg' : '-6deg' }}>
      <LiveWall pool={WALL_POOL} pins={shotPins} dim={false} compact={phone} centreRef={tryTileRef} ripple={0} seed={seed + 7} />
    </div>
  );
  const tryIt = (
    <section ref={stopRef.try} id="demo" data-stop="try" aria-labelledby="h-try" className={stopClass}>
      <div {...reveal('try', 0, phone ? '' : 'flex flex-wrap items-end justify-between gap-x-8 gap-y-4')}>
        <div>
          {heading(TRY_COPY.heading, 'h-try')}
          <p className="bw-body mt-2 max-w-[46ch]">{TRY_COPY.line}</p>
        </div>
        <div className={phone ? 'mt-4' : ''}>{lookPills}</div>
      </div>
      {phone ? (
        <div {...reveal('try', ALL, 'mt-5 flex items-center gap-3')}>
          <div className="shrink-0" style={{ height: 'min(70svh, calc((100vw - 52px) * 0.56 * 16 / 9))' }}>{booth}</div>
          <div className="min-w-0 flex-1">{tryWall}</div>
        </div>
      ) : (
        <div className={`mt-8 flex items-stretch justify-center gap-[clamp(16px,2.4vw,40px)] ${vp.w >= WIDE_HERO_MIN ? 'h-[min(560px,66vh)]' : 'h-[min(480px,58vh)]'}`}>
          <div data-bubble-left {...reveal('try', ALL, 'min-h-0')}>{booth}</div>
          <div className="flex w-[clamp(140px,13vw,210px)] shrink-0 flex-col justify-end">{slot('h-[72%] w-full', { max: 230 })}</div>
          <div {...reveal('try', ALL, 'flex min-h-0 items-center')}>
            <div data-bubble-right style={{ width: 'min(360px, 30vw)' }}>{tryWall}</div>
          </div>
        </div>
      )}
    </section>
  );

  /* ── 3D magic ──────────────────────────────────────────────────────── */
  const magic = (
    <section ref={stopRef.magic} id="magic" data-stop="magic" aria-labelledby="h-magic" className={stopClass}>
      {split('left', (
        <div className="flex h-[min(360px,48vh)] w-full max-w-[420px]">
          {slot('h-full w-[56%]')}
          <div data-prop-spot aria-hidden className="h-full flex-1" />
        </div>
      ), (
        <div {...reveal('magic', 0)}>
          {heading(MAGIC_COPY.heading, 'h-magic')}
          <p className="bw-body mt-3 max-w-[40ch]">{MAGIC_COPY.line}</p>
          {phone && <div data-prop-spot aria-hidden className="mx-auto mt-6 h-40 w-40" />}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" className="bw-btn bw-btn-secondary" disabled={propBusy} onClick={() => { const alive = begin(); void runReveal(audience, alive); }}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden /> {MAGIC_COPY.again}
            </button>
            <button type="button" className="bw-link min-h-11" onClick={() => scrollToStop('try')}>
              Try it on <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      ))}
    </section>
  );

  /* ── How it works ──────────────────────────────────────────────────── */
  const how = (
    <section ref={stopRef.how} id="how" data-stop="how" aria-labelledby="h-how" className={stopClass}>
      {split('right', stand(), (
        <>
          <div {...reveal('how', 0)}>{heading(HOW_COPY.heading, 'h-how')}</div>
          <ol className="mt-6 flex flex-col gap-3">
            {DELIVER_STEPS.map((d, n) => {
              const Icon = STEP_ICONS[d.icon];
              return (
                <li key={d.title} data-beam-target {...reveal('how', n + 1, 'bw-glass-card bw-card-lift bw-condense flex items-start gap-4 p-4')}>
                  <span className="bw-icon-tile" aria-hidden><Icon /></span>
                  <span className="min-w-0">
                    <span className="bw-label block">Step {n + 1}</span>
                    <span className="bw-h3 mt-0.5 block">{d.title}</span>
                    <span className="bw-small mt-1 block">{d.body}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p {...reveal('how', ALL, 'bw-small mt-5')}>{DONE_FOR_YOU}</p>
        </>
      ))}
    </section>
  );

  /* ── Pricing ───────────────────────────────────────────────────────── */
  const planCols = phone ? 'grid-cols-1' : vp.w >= 1100 ? 'grid-cols-2' : 'grid-cols-1';
  const planGrid = (
    <div data-drift-target {...reveal('pricing', ALL, `mt-10 grid gap-x-4 gap-y-6 ${planCols}`)}>
      {plans.map((t) => (
        <div key={t.name} className="bw-glass-card bw-card-lift bw-plan flex flex-col p-6" data-popular={t.popular === true ? 'true' : undefined}>
          {t.popular === true && <span className="bw-plan-badge">{pricing.recommended}</span>}
          <h3 className="bw-label" style={{ color: 'var(--bw-ink)' }}>{t.name}</h3>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="bw-price">{t.price}</span>
            <span className="bw-label">{t.unit}</span>
          </p>
          <p className="bw-small mt-2">{t.blurb}</p>
          <ul className="mt-5 flex flex-1 flex-col gap-2.5">
            {t.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[14px] leading-snug" style={{ color: 'var(--bw-ink)' }}>
                <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-success)' }} aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link to={SIGNUP_PATH} className={`bw-btn mt-6 w-full ${t.popular === true ? 'bw-btn-primary' : 'bw-btn-secondary'}`}>{pricing.cta(t.name)}</Link>
        </div>
      ))}
    </div>
  );
  /* Desktop: the plans sit in the content column, so the column he stands in
     stays clear however far the visitor scrolls through them. */
  const pricingSec = (
    <section ref={stopRef.pricing} id="pricing" data-stop="pricing" aria-labelledby="h-pricing" className={stopClass}>
      {split('left', stand('h-[min(300px,40vh)]'), (
        <>
          <div {...reveal('pricing', 0)}>
            {heading(pricing.heading, 'h-pricing')}
            <p className="bw-body mt-3 max-w-[56ch]">{pricing.intro}</p>
            <p className="bw-small mt-3 max-w-[56ch]">{pricing.pro}</p>
          </div>
          {planGrid}
        </>
      ))}
    </section>
  );

  /* ── Start + footer ────────────────────────────────────────────────── */
  /* Desktop: he stands beside the centred call to action, never over it. */
  const startCta = (
    <div {...reveal('start', 0, 'mx-auto flex max-w-[640px] flex-col items-center')}>
      {heading(start.heading, 'h-start', 'bw-display')}
      <p className="bw-body mt-3 max-w-[42ch]">{start.line}</p>
      <ul className="mt-5 flex flex-col items-center gap-2.5">
        {start.bullets.map((b) => (
          <li key={b} className="flex items-center gap-3 text-[16px]" style={{ color: 'var(--bw-ink)' }}>
            <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-success)' }} aria-hidden /> {b}
          </li>
        ))}
      </ul>
      <Link to={SIGNUP_PATH} className="bw-btn bw-btn-primary bw-btn-lg mt-8">{HERO.primary}</Link>
    </div>
  );
  const startSec = (
    <section ref={stopRef.start} id="start" data-stop="start" aria-labelledby="h-start" className={`${stopClass} text-center`}>
      {phone ? startCta : !wideHero ? (
        // Tablets: no room for a side column; Beamy stands above the call to action.
        <div className="flex flex-col items-center">
          {slot('h-[min(300px,34vh)] w-full max-w-[240px]')}
          <div className="w-full max-w-[640px]">{startCta}</div>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,640px)_minmax(0,1fr)] items-center gap-[clamp(16px,2vw,32px)]">
          <div className="flex justify-end">{slot('h-[min(320px,42vh)] w-full max-w-[240px]')}</div>
          <div data-bubble-right>{startCta}</div>
          <div aria-hidden />
        </div>
      )}
      <nav aria-label="Footer" className="mt-16 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        <span className="bw-wordmark mr-2 text-[18px]">Beamwall</span>
        {FOOTER_LINKS.map((f) => f.to !== null ? (
          <Link key={f.label} to={f.to} className="bw-link bw-link-quiet min-h-11">{f.label}</Link>
        ) : (
          <ReportIssueButton key={f.label} label={f.label} showIcon={false} prefill={{ source: 'landing' }} className="bw-link bw-link-quiet min-h-11" />
        ))}
      </nav>
    </section>
  );

  const bubbleHidden = active === 0 && !wideHero;
  const headerH = phone ? 60 : 72;

  return (
    <div
      data-brand="2"
      data-arrival={arrival}
      data-stop-active={STOPS[active]?.id}
      ref={scrollerRef}
      tabIndex={-1}
      className="bw-root bw-scroll relative h-full overflow-y-auto overflow-x-clip"
      style={{ outline: 'none',  ['--bw-header-h' as string]: `${headerH}px`, ['--bw-dock-h' as string]: phone ? `${vp.h < 700 ? 96 : 108}px` : '0px' }}
    >
      <div aria-hidden className="bw-backdrop">
        {/* Large soft shapes and glass shards behind the panes, drifting past
            at different depths as the page scrolls (--bw-sp, 0..1). They sit
            behind the glass, so the frost softens them; only the page edges
            show them crisp, and no copy lives there. */}
        {BACKDROP_SHAPES.map((b, n) => (
          <span key={`b${n}`} className="bw-backdrop-shape" style={{ left: b.x, top: b.y, width: b.s, height: b.s, ['--k' as string]: b.k }} />
        ))}
        {/* The journey: the bright field deepens through indigo into the
            midnight atmosphere mid-page, then lifts again for the close
            (--bw-night-mix 0..1 from the scroll position; a crossfade, so no seams). */}
        <div className="bw-night">
          <span className="bw-night-glow bw-night-violet" />
          <span className="bw-night-glow bw-night-indigo" />
          <span className="bw-night-glow bw-night-teal" />
        </div>
        {!phone && BACKDROP_SHARDS.map((b, n) => (
          <span key={`s${n}`} className="bw-drift" style={{ left: b.x, top: b.y, width: b.w, height: b.w * 1.3, ['--k' as string]: b.k, ['--r' as string]: `${b.r}deg`, ['--b' as string]: `${b.blur}px` }} />
        ))}
        {/* Grit: a still film grain and a soft vignette over the field, under every pane. */}
        <div className="bw-vignette" />
        <div className="bw-grain" />
      </div>

      <header ref={headerRef} className="bw-header sticky top-0 z-30" style={{ height: headerH }}>
        <div className={`mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 ${phone ? 'px-3' : 'px-[clamp(20px,2.6vw,48px)]'}`}>
          <button type="button" onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })} className="bw-wordmark bw-focus -ml-1 min-h-11 rounded-lg px-1" aria-label="Beamwall, back to the top">
            Beamwall
          </button>
          {!phone && (
            <nav aria-label="Main" className="flex items-center gap-1">
              {NAV_LINKS.map((n) => (
                <a
                  key={n.label}
                  href={`#${stopEls.current[n.stop]?.id ?? n.stop}`}
                  className="bw-navlink"
                  aria-current={STOPS[active]?.id === n.stop ? 'true' : undefined}
                  onClick={(e) => { e.preventDefault(); scrollToStop(n.stop); }}
                >
                  {n.label}
                </a>
              ))}
            </nav>
          )}
          <nav aria-label="Account" className="flex items-center justify-end gap-2 sm:gap-4">
            {vp.w >= WIDE_HERO_MIN && <Link to="/login" className="bw-link min-h-11">{START_COPY.signIn}</Link>}
            <Link to={SIGNUP_PATH} className="bw-btn bw-btn-primary bw-btn-sm">{phone ? HERO.primaryShort : HERO.primary}</Link>
          </nav>
        </div>
        {/* Scroll progress: a hairline under the header. */}
        <div aria-hidden className="bw-progress"><span ref={progressRef} /></div>
      </header>

      <main ref={mainRef} className="relative z-10" style={{ paddingBottom: phone ? 'calc(var(--bw-dock-h) + 16px)' : undefined }}>
        {hero}
        {explain}
        {films}
        {pick}
        {tryIt}
        {magic}
        {how}
        {pricingSec}
        {startSec}
      </main>

      {/* Phones: the stage Beamy stands on under the content. */}
      {phone && <div ref={dockRef} aria-hidden data-on="false" className="bw-dock" />}

      {!failed && (
        <BeamyStage
          apiRef={api}
          layoutRef={layoutRef}
          bubbleRef={bubbleRef}
          hitRef={hitRef}
          decorRef={decorRef}
          startHidden
          reducedMotion={reduced}
          onReady={() => { logStep('model:ready'); setReady(true); }}
          onError={() => { logStep('model:failed'); setFailed(true); }}
        />
      )}
      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        className={`bw-bubble pointer-events-none fixed left-0 top-0 z-50 px-4 py-3 transition-opacity duration-300 ${phone ? 'text-[14px]' : ''} ${((ready && arrival === 'done') || failed) && !bubbleHidden && !failed ? 'opacity-100' : 'opacity-0'}`}
        style={{ maxWidth: 'min(300px, calc(100vw - 24px))' }}
      >
        <span className="sr-only">{line}</span>
        <span aria-hidden>{typed}</span>
      </div>
      {ready && (
        <button
          ref={hitRef}
          type="button"
          onClick={onHitClick}
          onPointerDown={onHitDown}
          onPointerMove={onHitMove}
          onPointerUp={onHitUp}
          onPointerCancel={onHitUp}
          aria-label="Poke Beamy (drag to spin him)"
          className="bw-focus fixed left-0 top-0 z-[45] cursor-grab touch-pan-y rounded-full active:cursor-grabbing"
          style={{ visibility: arrival === 'done' ? 'visible' : 'hidden' }}
        />
      )}

      {/* The selfie's flash and photo card (driven per frame by runSelfie). */}
      <div ref={flashRef} aria-hidden className="pointer-events-none fixed inset-0 z-[55]" style={{ opacity: 0 }} />
      <div ref={cardRef} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[56]" style={{ opacity: 0, willChange: 'opacity, transform', ...SELFIE_CARD_STYLE }}>
        <div style={SELFIE_CARD_FACE_STYLE}>
          <img ref={cardImgRef} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      </div>

      {flight !== null && (
        <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden>
          {reduced
            ? <GlideFlight key={flight.key} from={flight.from} to={flight.to} shot={flight.shot} ms={flight.ms} onDone={flight.onDone} />
            : <ParticleBeam key={flight.key} from={flight.from} to={flight.to} shot={flight.shot} durationMs={flight.ms} onDone={flight.onDone} palette={BEAM_PALETTE} />}
        </div>
      )}
    </div>
  );
}

/**
 * Reduced motion's photo trip: the shot itself glides from where it was taken
 * to the wall tile on one slow ease, no particles, no strobe. `onDone` fires
 * once, after the glide (a timer, so a missed transitionend cannot strand it).
 */
function GlideFlight({ from, to, shot, ms, onDone }: { from: Rect; to: Rect; shot: string; ms: number; onDone: () => void }) {
  const ref = useRef<HTMLImageElement | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let raf = window.requestAnimationFrame(() => {
      raf = window.requestAnimationFrame(() => {
        const el = ref.current;
        if (el === null) return;
        el.style.transition = ['left', 'top', 'width', 'height'].map((p) => `${p} ${ms}ms cubic-bezier(0.45, 0, 0.2, 1)`).join(', ');
        el.style.left = `${to.left}px`;
        el.style.top = `${to.top}px`;
        el.style.width = `${to.width}px`;
        el.style.height = `${to.height}px`;
      });
    });
    const id = window.setTimeout(() => done.current(), ms + 80);
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one glide per mount (keyed by flight)
  }, []);
  return (
    <img
      ref={ref}
      src={shot}
      alt=""
      draggable={false}
      data-glide
      style={{ position: 'fixed', left: from.left, top: from.top, width: from.width, height: from.height, objectFit: 'cover', borderRadius: 10, boxShadow: '0 0 0 1.5px rgba(255,255,255,0.7), 0 18px 40px -16px rgba(22,18,78,0.6)' }}
    />
  );
}

/**
 * A scroller whose still-scrollable edge fades out (brand.css .bw-fade-x/y),
 * so content cut off at an edge reads as "more this way".
 */
function FadeScroll({ axis, className, children, ...rest }: { axis: 'x' | 'y'; className: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const update = () => {
      const pos = axis === 'y' ? el.scrollTop : el.scrollLeft;
      const max = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      const cs = getComputedStyle(el);
      const padEnd = parseFloat(axis === 'y' ? cs.paddingBottom : cs.paddingRight) || 0;
      const start = pos > 2;
      const end = pos < max - 2 - padEnd;
      const v = start && end ? 'both' : end ? 'end' : start ? 'start' : 'none';
      if (el.dataset.fade !== v) el.dataset.fade = v;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [axis]);
  return <div ref={ref} className={`${axis === 'y' ? 'bw-fade-y' : 'bw-fade-x'} ${className}`} {...rest}>{children}</div>;
}
