/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /beamy — the candidate landing in brand v2 (noindex while the owner reacts
 * to it; `/` is untouched). A normal, natively scrolling page over ONE fixed,
 * full-screen canvas (BeamyStage) that sits BEHIND the content:
 *
 *   hero → the pinned story (five glass cards, one 3D effect each) → the
 *   films (Beamy projects them) → What applies to you? → Try it (the real
 *   booth) → Pricing → Start
 *
 * Slots and poses (lib/beamyScroll): every section holds an empty
 * `[data-slot]` box that CSS alone places per breakpoint, alternating left /
 * right / centre with the content (phones: above or below the copy). Every
 * frame the page reads the slots' rects and the pure blend turns them into
 * Beamy's target (Gaussian weight by distance from the viewport centre,
 * angles through sin/cos); the stage eases him there with
 * frame-rate-independent damping, so he glides behind the page between
 * sections at any scroll speed.
 *
 * The story is a pinned section (sticky 100vh panel, n × 85vh + 100vh tall,
 * 75vh a step on phones): the active card is full strength and opens its
 * line (grid-template-rows 0fr → 1fr), the others rest at half; each card's
 * data drives Beamy (turn, clip) and one 3D effect drawn beside him in the
 * canvas (StoryFx), never over text. Content reveals on scroll (opacity,
 * rise, de-blur; 70ms stagger; once).
 *
 * Motion: content motion (the intro, his glide, beams, the story's effects)
 * plays for everyone, gently under reduced motion. Decorative motion
 * (pointer parallax and tilt, crystal bob) is off under reduced motion.
 *
 * Nothing a visitor captures leaves the device: the wall is component state.
 * Tokens/components come from src/styles/brand.css, scoped by data-brand="2".
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, Lock, Rotate3d } from 'lucide-react';
import { Briefcase, Cake, ClipboardList, Gift, Users, type LucideIcon } from 'lucide-react';
import CameraExperience, { lookFrameUrl } from '../../components/landing/CameraExperience';
import ParticleBeam from '../../components/landing/ParticleBeam';
import ReportIssueButton from '../../components/support/ReportIssueButton';
import FilmEmbed from '../../components/ui/FilmEmbed';
import { BoothIcon, CardIcon, ChallengeIcon, WallIcon, type BeamIconProps } from '../../components/ui/BeamIcons';
import LiveWall, { WALL_POOL, type Pin } from '../../components/beamy/LiveWall';
import { SELFIE_CARD_FACE_STYLE, SELFIE_CARD_STYLE, flashGradient } from '../../components/beamy/selfieFx';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';
import type { Rect } from '../../lib/beamGeometry';
import { REDUCED_GLIDE_S, flashOpacity, photoState } from '../../lib/beamySelfie';
import { SHOT_TILES, WALL_CENTRE, wallRows } from '../../lib/beamyWall';
import HeroPhone, { type Box, type HeroPhoneHandle } from './HeroPhone';
import { AUDIENCES, GREETING, HELLO, POKE_LINES, audienceById, type Audience, type AudienceIcon } from '../../lib/beamyTour';
import {
  FILMS, FILMS_COPY, FOOTER_LINKS, HERO, LOOKS, NAV_LINKS, PICK_COPY, POKE_IDLE, SIGNUP_PATH, START_COPY, STORY_COPY,
  STORY_STEPS, TRY_COPY, createReactionPicker, pickCelebration, planCards, pokeStep, pricingSection, releaseVelocity,
  startFacts, type Celebration, type FilmId, type Reaction, type StoryFxId,
} from '../../lib/brandLanding';
import {
  STOPS, blendSlots, pageProgress, pinProgress, storyHeightVh, storyStep, weightedNight,
  type Pose, type SlotSample, type StopId,
} from '../../lib/beamyScroll';
import BeamyStage, { type BeamyApi, type BeamyClip, type Pt, type StageDecor, type StageLayout } from './BeamyStage';
import StoryFx, { type FxState } from './StoryFx';

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
const AUDIENCE_ICONS: Record<AudienceIcon, LucideIcon> = { ClipboardList, Cake, Users, Briefcase, Gift };
const FILM_MEDIA: Record<FilmId, { src: string; poster: string; Icon: (p: BeamIconProps) => ReactNode }> = {
  booth: { src: boothFilm, poster: boothPoster, Icon: BoothIcon },
  wall: { src: wallFilm, poster: wallPoster, Icon: WallIcon },
  challenges: { src: challengesFilm, poster: challengesPoster, Icon: ChallengeIcon },
  cards: { src: cardsFilm, poster: cardsPoster, Icon: CardIcon },
};
/** Skipping the picker tours as the most common host. */
const DEFAULT_AUDIENCE = audienceById('family') ?? AUDIENCES[0];
/** Room above Beamy's head kept free for his speech bubble (slots that show it). */
const BUBBLE_ROOM = 76;
/** How long the centre tile holds Beamy's selfie before it rejoins the rotation. */
const SELFIE_HOLD_MS = 12000;
/** Breakpoints: phones stack Beamy above the copy; the three-column hero needs a laptop. */
const PHONE_MAX = 768;
const WIDE_HERO_MIN = 1024;
/** How often Beamy beams a shot to the story's mini wall while that step is up. */
const WALL_BEAM_MS = 5200;
const NIGHT: Record<StopId, number> = Object.fromEntries(STOPS.map((s) => [s.id, s.night])) as Record<StopId, number>;

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

/** A slot's pose from its data attributes (the story's comes from its active card). */
function poseOf(el: HTMLElement, h: number): Pose {
  const d = el.dataset;
  const room = d.bubble === 'none' ? 0 : BUBBLE_ROOM;
  const max = d.max !== undefined ? Number(d.max) : Infinity;
  const fit = Math.min(Number(d.fit ?? 1), Math.max(0.2, (h - room) / Math.max(1, h)), max / Math.max(1, h));
  return {
    fit,
    fitW: 1.1,
    ax: d.ax !== undefined ? Number(d.ax) : 0.5,
    yaw: Number(d.yaw ?? 0),
    floor: d.floor === 'true',
  };
}

export default function BeamyPage() {
  usePageTitle('Beamwall · Your immersive photo booth');
  useNoIndex();

  const vp = useViewport();
  const phone = vp.w < PHONE_MAX;
  const wideHero = vp.w >= WIDE_HERO_MIN;
  const reduced = useReducedMotion();

  const [active, setActive] = useState<StopId>('hero');
  const [step, setStep] = useState(0);
  const [film, setFilm] = useState<FilmId>('booth');
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
  const headerRef = useRef<HTMLElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLElement | null>(null);
  const fxSpotRef = useRef<HTMLDivElement | null>(null);
  const filmFrameRef = useRef<HTMLDivElement | null>(null);
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
  const activeRef = useRef<StopId>('hero');
  const stepRef = useRef(0);
  const readyRef = useRef(false);
  readyRef.current = ready && !failed;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const filmRef = useRef(film);
  filmRef.current = film;
  /** What the story is doing with Beamy right now (so a step is entered once). */
  const storyOn = useRef<{ step: number; held: boolean }>({ step: -1, held: false });
  const projecting = useRef(false);
  const layoutRef = useRef<StageLayout>({ home: { x: vp.w / 2, y: vp.h * 0.6 }, heightPx: 180 });
  const decorRef = useRef<StageDecor>({ panel: null, stand: null, phone, scroll: 0 });
  const fxRef = useRef<FxState>({ weights: {}, spot: null, pulse: -1e9 });
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

  /* ── Reveal on scroll: rise, settle, de-blur; once per element. ────── */
  useEffect(() => {
    const root = mainRef.current;
    const scroller = scrollerRef.current;
    if (root === null) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLElement).dataset.on = 'true';
        io.unobserve(e.target);
      }
    }, { root: scroller, threshold: 0.08 });
    root.querySelectorAll<HTMLElement>('.bw-in:not([data-on="true"])').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [phone, wideHero]);

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
      const slotEl = mid.querySelector<HTMLElement>('[data-slot]');
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


  /* ── Lines, stops and the story's choreography ─────────────────────── */

  const lineFor = useCallback((id: StopId, a: Audience): string => {
    switch (id) {
      case 'hero': return HELLO;
      case 'story': return STORY_COPY.heading;
      case 'films': return FILMS.find((f) => f.id === filmRef.current)?.beamy ?? FILMS[0].beamy;
      case 'pick': return GREETING;
      case 'try': return a.lines.snap;
      case 'pricing': return pricingSection().line;
      case 'start': return a.lines.go;
    }
  }, []);

  const scrollToStop = useCallback((id: StopId) => {
    const el = mainRef.current?.querySelector<HTMLElement>(`[data-stop="${id}"]`);
    if (!el) return;
    logStep(`goto:${id}`);
    el.scrollIntoView({ behavior: reducedRef.current ? 'auto' : 'smooth', block: 'start' });
  }, []);

  /** The story's fx spot, viewport px (the prop and the mini wall stand in it). */
  const spotRect = () => rectOf(fxSpotRef.current);
  const runReveal = async (a: Audience, instant = false) => {
    const b = api.current;
    const r = spotRect();
    if (b === null || r === null) return;
    const size = Math.min(r.width, r.height) * 0.5;
    const r2: Reaction = react.current('reveal');
    await b.reveal(a.prop.url, () => { const q = spotRect() ?? r; return { x: q.left + q.width / 2, y: q.top + q.height * 0.42 }; }, size, r2 === 'handSparks' ? 'hand' : 'mouth', instant);
  };
  const beamToWall = () => {
    const b = api.current;
    const r = spotRect();
    if (b === null || r === null || !readyRef.current) return;
    logStep('story:wall:beam');
    void b.beam(centre(r), () => { fxRef.current.pulse = performance.now(); }, 'mouth');
  };
  /** A story step became active while the story holds Beamy: his clip, plus the step's own act. */
  const storyEnter = (i: number): boolean => {
    const b = api.current;
    if (b === null || !readyRef.current) return false;
    const prev = storyOn.current.step;
    storyOn.current.step = i;
    const s = STORY_STEPS[i];
    logStep(`story:${s.id}`);
    if (prev >= 0 && STORY_STEPS[prev]?.id === 'prop' && s.id !== 'prop') b.clearProp();
    if (s.id === 'prop') void runReveal(audienceRef.current, reducedRef.current);
    else if (s.id === 'wall') beamToWall();
    else void b.play(s.clip as BeamyClip);
    return true;
  };
  const storyLeave = () => {
    const prev = storyOn.current.step;
    storyOn.current.step = -1;
    if (prev >= 0 && STORY_STEPS[prev]?.id === 'prop') api.current?.clearProp();
  };
  const storyEnterRef = useRef(storyEnter);
  storyEnterRef.current = storyEnter;
  const storyLeaveRef = useRef(storyLeave);
  storyLeaveRef.current = storyLeave;
  /* The mini wall step keeps beaming, calmly, while it is up. */
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = storyOn.current.step;
      if (s >= 0 && STORY_STEPS[s]?.id === 'wall') beamToWall();
    }, WALL_BEAM_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only
  }, []);

  const onStop = (id: StopId) => {
    activeRef.current = id;
    setActive(id);
    logStep(`enter:${id}`);
    say(lineFor(id, audienceRef.current));
    if (id !== 'hero') setDragHint(false);
    if (id !== 'try') setCameraOn(false);
  };
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  /* ── The glide: every frame, read the slots, blend, hand the stage a target ── */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      const main = mainRef.current;
      const sc = scrollerRef.current;
      if (main === null || sc === null) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isPhone = vw < PHONE_MAX;
      const headerH = headerRef.current?.offsetHeight ?? 64;
      // The story's step: progress through its pinned stretch (under the header).
      const st = storyRef.current;
      let sStep = stepRef.current;
      if (st !== null) {
        const r = st.getBoundingClientRect();
        sStep = storyStep(pinProgress(r.top - headerH, r.height, vh - headerH), STORY_STEPS.length);
      }
      if (sStep !== stepRef.current) { stepRef.current = sStep; setStep(sStep); }
      const card = STORY_STEPS[sStep];
      // Every slot, as CSS placed it this frame.
      const samples: SlotSample[] = [];
      main.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const id = el.dataset.slot ?? '';
        const pose = poseOf(el, r.height);
        if (id === 'story') { pose.yaw = card.yaw; pose.fx = { [card.id]: 1 }; }
        samples.push({ id, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, pose });
      });
      const b = blendSlots(samples, vw, vh, isPhone);
      const slotId = (b.active >= 0 ? samples[b.active].id : activeRef.current) as StopId;
      const settled = b.share > 0.85;
      layoutRef.current = {
        home: { x: b.x, y: b.y },
        heightPx: b.heightPx,
        yaw: b.yaw,
        presence: b.presence,
        floor: b.floor,
        bubbleMinY: headerH + 8,
        bubbleMaxY: vh - 12,
        // The bubble speaks only where his slot left room for it (never on
        // phones, never in the story, never mid-glide).
        bubbleAway: isPhone || slotId === 'story' || slotId === 'films' || !settled,
      };
      const hp = rectOf(heroPanelRef.current);
      const heroSlot = samples.find((x) => x.id === 'hero');
      decorRef.current = {
        panel: hp !== null && hp.top + hp.height > -40 ? hp : null,
        stand: heroSlot !== undefined ? (() => { const r = heroSlot.rect; const h = Math.min(r.height * heroSlot.pose.fit, r.width / 1.1); return { feet: { x: r.left + r.width / 2, y: r.top + r.height }, heightPx: h }; })() : null,
        phone: isPhone,
        scroll: Math.min(sc.scrollTop, heroRef.current?.offsetHeight ?? vh),
      };
      const fx = fxRef.current;
      fx.weights = b.fx as Partial<Record<StoryFxId, number>>;
      fx.spot = rectOf(fxSpotRef.current);
      // The story holds Beamy: run its step (once per step), or let go.
      const inStory = slotId === 'story' && b.share > 0.8;
      if (inStory && storyOn.current.step !== sStep) storyEnterRef.current(sStep);
      else if (!inStory && storyOn.current.step >= 0) storyLeaveRef.current();
      // The films: a soft projector cone onto the frame while he stands beside it.
      const bApi = api.current;
      const inFilms = slotId === 'films' && b.share > 0.8 && readyRef.current && bApi !== null;
      if (inFilms && !projecting.current) { projecting.current = true; void bApi?.project(() => rectOf(filmFrameRef.current), 'mouth', !reducedRef.current); }
      else if (!inFilms && projecting.current) { projecting.current = false; bApi?.stopProject(); }
      if (settled && slotId !== activeRef.current) onStopRef.current(slotId);
      // Header progress, the colour journey, the hero's scroll depth.
      const y = sc.scrollTop;
      const sp = pageProgress(y, sc.scrollHeight, vh);
      const bar = progressRef.current;
      if (bar !== null) bar.style.transform = `scaleX(${sp.toFixed(4)})`;
      if (!reducedRef.current) sc.style.setProperty('--bw-sp', sp.toFixed(4));
      const secs: { top: number; height: number; night: number }[] = [];
      main.querySelectorAll<HTMLElement>('[data-stop]').forEach((el) => {
        const r = el.getBoundingClientRect();
        secs.push({ top: r.top, height: r.height, night: NIGHT[el.dataset.stop as StopId] ?? 1 });
      });
      const night = weightedNight(secs, vh).toFixed(3);
      if (sc.style.getPropertyValue('--bw-night-mix') !== night) sc.style.setProperty('--bw-night-mix', night);
      const hero = heroRef.current;
      if (hero !== null && !reducedRef.current) hero.style.setProperty('--hs', Math.min(y, hero.offsetHeight).toFixed(0));
    };
    raf = window.requestAnimationFrame(tick);
    const scroller = scrollerRef.current;
    // Keyboard scrolling (arrows, space, page keys) goes to the focused
    // scroller: take focus once, without moving or painting a ring.
    if (scroller !== null && (document.activeElement === null || document.activeElement === document.body)) scroller.focus({ preventScroll: true });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  /* Deep link: ?s=<stop> scrolls there on load. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('s');
    const el = q !== null ? mainRef.current?.querySelector<HTMLElement>(`[data-stop="${q}"]`) : null;
    if (el) window.setTimeout(() => el.scrollIntoView({ block: 'start' }), 60);
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
    const onTry = activeRef.current === 'try';
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
    const onIntro = activeRef.current === 'hero';
    if (onIntro) setIntroRunning(true);
    void (async () => {
      await b.arrive();
      logStep('arrive:landed');
      setArrival('done');
      if (!alive() || activeRef.current !== 'hero') {
        setIntroRunning(false);
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
    if (activeRef.current === 'hero') {
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
  const headerH = phone ? 60 : 72;

  /* A slot: an empty box CSS places; Beamy stands in it (data-* is his pose there). */
  const slot = (extra = '', opts: { max?: number; bubble?: boolean } = {}, children?: ReactNode, style?: CSSProperties) => (
    <div
      data-slot="hero"
      data-floor="true"
      data-max={opts.max !== undefined ? String(Math.round(opts.max)) : undefined}
      data-bubble={opts.bubble === false ? 'none' : undefined}
      aria-hidden
      className={`${extra.includes('absolute') ? '' : 'relative'} min-h-0 ${extra}`}
      style={style}
    >
      {children}
    </div>
  );
  /** A section's own slot for Beamy (phones: above the copy, never behind it). */
  const stand = (id: StopId, yaw: number, cls: string) => (
    <div data-slot={id} data-yaw={phone ? 0 : yaw} data-bubble={phone ? 'none' : undefined} aria-hidden className={phone ? 'mx-auto mb-4 h-[30svh] w-[64%] max-w-[260px]' : cls} />
  );
  const sectionClass = `bw-sec relative mx-auto w-full max-w-[1320px] ${phone ? 'px-5 py-14' : 'px-[clamp(40px,6vw,104px)] py-[clamp(88px,13vh,150px)]'}`;
  /** Desktop: Beamy's column on `side`, the content on the other. Phones: his slot above the content. */
  const split = (side: 'left' | 'right', beamy: ReactNode, content: ReactNode) => {
    if (phone) return <div className="flex flex-col">{beamy}{content}</div>;
    const left = side === 'left';
    return (
      <div className={`grid items-center gap-[clamp(20px,3vw,56px)] ${left ? 'grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)]'}`}>
        {left ? <><div className="flex justify-center">{beamy}</div><div className="min-w-0">{content}</div></> : <><div className="min-w-0">{content}</div><div className="flex justify-center">{beamy}</div></>}
      </div>
    );
  };

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
      ref={heroRef}
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


  /* ── The story: pinned, one card at a time, Beamy + one 3D effect beside him ── */
  const n = STORY_STEPS.length;
  const goStep = (k: number) => {
    const sc = scrollerRef.current;
    const st = storyRef.current;
    if (sc === null || st === null) return;
    const r = st.getBoundingClientRect();
    const vh = window.innerHeight;
    const top = sc.scrollTop + r.top - headerH;
    const run = r.height - (vh - headerH);
    sc.scrollTo({ top: top + ((k + 0.5) / n) * run, behavior: reduced ? 'auto' : 'smooth' });
  };
  const storyCards = (
    <ol className={`flex flex-col ${phone ? 'gap-0' : 'gap-3'}`}>
      {STORY_STEPS.map((s, k) => {
        const on = k === step;
        if (phone && !on) return null;
        return (
          <li key={s.id} className="bw-glass-card bw-thick bw-story-card" data-active={on ? 'true' : 'false'}>
            <button type="button" className="bw-story-head" aria-expanded={on} aria-controls={`story-${s.id}`} onClick={() => goStep(k)}>
              <span className="bw-story-num" aria-hidden>{String(k + 1).padStart(2, '0')}</span>
              <span className="bw-h3 min-w-0">{s.title}</span>
            </button>
            <div id={`story-${s.id}`} className="bw-story-more">
              <div className="min-h-0 overflow-hidden"><p className="bw-small pb-5 pl-[52px] pr-5">{s.body}</p></div>
            </div>
          </li>
        );
      })}
    </ol>
  );
  const storySegs = (
    <div className="bw-segs" aria-hidden>
      {STORY_STEPS.map((s, k) => <span key={s.id} data-on={k <= step ? 'true' : 'false'} />)}
    </div>
  );
  const storyHead = (
    <div className="bw-in">
      <p className={`bw-eyebrow after:hidden ${phone ? 'text-[13px]' : ''}`}>{STORY_COPY.eyebrow}</p>
      <h2 id="h-story" className={`${phone ? 'bw-h2 mt-1 text-[26px]' : 'bw-h2 mt-3 max-w-[18ch]'}`}>{STORY_COPY.heading}</h2>
    </div>
  );
  const story = (
    <section ref={storyRef} id="how" data-stop="story" aria-labelledby="h-story" className="bw-sec relative" style={{ height: `${storyHeightVh(n, phone)}vh` }}>
      <div className="sticky overflow-hidden" style={{ top: 'var(--bw-header-h)', height: 'calc(100svh - var(--bw-header-h))' }}>
        {phone ? (
          <div className="flex h-full flex-col px-5 pb-6 pt-5">
            {storyHead}
            <div className="relative mt-2 min-h-0 flex-1">
              <div data-slot="story" data-bubble="none" aria-hidden className="absolute bottom-0 left-0 h-[92%] w-[46%]" />
              <div ref={fxSpotRef} data-fx-spot aria-hidden className="absolute right-0 top-[10%] h-[78%] w-[54%]" />
            </div>
            <div className="mt-2" aria-live="polite">{storyCards}</div>
            <div className="mt-4">{storySegs}</div>
          </div>
        ) : (
          <div className="mx-auto grid h-full max-w-[1320px] grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] items-center gap-[clamp(24px,4vw,72px)] px-[clamp(24px,5vw,88px)]">
            <div className="relative h-[min(620px,80%)]">
              <div data-slot="story" data-bubble="none" aria-hidden className="absolute bottom-0 left-0 h-[76%] w-[44%]" />
              <div ref={fxSpotRef} data-fx-spot aria-hidden className="absolute right-0 top-[8%] h-[66%] w-[54%]" />
            </div>
            <div className="min-w-0">
              {storyHead}
              <div className="mt-7">{storyCards}</div>
              <div className="mt-6 max-w-[420px]">{storySegs}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );

  /* ── The films: one frame, four films; Beamy projects whichever is on ── */
  const cur = FILMS.find((f) => f.id === film) ?? FILMS[0];
  const media = FILM_MEDIA[cur.id];
  const films = (
    <section id="films" data-stop="films" aria-labelledby="h-films" className={sectionClass}>
      {split('right', stand('films', -0.5, 'h-[min(400px,50vh)] w-full max-w-[280px]'), (
        <>
          <div className="bw-in">
            <h2 id="h-films" className="bw-h2">{FILMS_COPY.heading}</h2>
          </div>
          <div role="group" aria-label="Pick a film" className="bw-in mt-5 flex flex-wrap gap-2" style={i(1)}>
            {FILMS.map((f) => {
              const M = FILM_MEDIA[f.id];
              return (
                <button key={f.id} type="button" className="bw-glass-chip" aria-pressed={film === f.id} onClick={() => { setFilm(f.id); say(f.beamy); logStep(`film:${f.id}`); }}>
                  <M.Icon size={18} from={film === f.id ? '#2B2A8C' : '#FFFFFF'} to={film === f.id ? '#5B4BE0' : '#C9CCFF'} />
                  {f.eyebrow}
                </button>
              );
            })}
          </div>
          <div ref={filmFrameRef} data-film-frame data-lit="true" className="bw-in bw-film bw-thick-frame mt-6" style={i(2)}>
            <FilmEmbed key={cur.id} src={media.src} poster={media.poster} label={`${cur.title}: feature film`} chipClassName="bw-film-chip" />
          </div>
          <p className="bw-small mt-4 max-w-[56ch]"><span className="font-semibold" style={{ color: 'var(--bw-ink)' }}>{cur.title}.</span> {cur.line}</p>
        </>
      ))}
    </section>
  );

  /* ── What applies to you? ──────────────────────────────────────────── */
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
    if (alive() && activeRef.current === 'pick') scrollToStop('try');
  };
  const pick = (
    <section id="for-you" data-stop="pick" aria-labelledby="h-pick" className={sectionClass}>
      {split('left', stand('pick', 0.42, 'h-[min(380px,50vh)] w-full max-w-[280px]'), (
        <>
          <div className="bw-in">
            <h2 id="h-pick" className="bw-h2">{PICK_COPY.heading}</h2>
            <p className="bw-body mt-2">{PICK_COPY.sub}</p>
          </div>
          <div className={`mt-7 grid gap-3 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {AUDIENCES.map((a, k) => {
              const Icon = AUDIENCE_ICONS[a.icon];
              const on = selectedId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={(e) => { void pickAudience(a, e.currentTarget); }}
                  className={`bw-in bw-glass-card bw-thick bw-interactive flex items-center gap-4 ${phone ? 'min-h-[64px] px-4 py-3' : 'min-h-[84px] p-4'}`}
                  style={i(k)}
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
    <section id="demo" data-stop="try" aria-labelledby="h-try" className={sectionClass}>
      {phone && stand('try', 0, '')}
      <div className={`bw-in ${phone ? '' : 'flex flex-wrap items-end justify-between gap-x-8 gap-y-4'}`}>
        <div>
          <h2 id="h-try" className="bw-h2">{TRY_COPY.heading}</h2>
          <p className="bw-body mt-2 max-w-[46ch]">{TRY_COPY.line}</p>
        </div>
        <div className={phone ? 'mt-4' : ''}>{lookPills}</div>
      </div>
      {phone ? (
        <div className="bw-in mt-5 flex items-center gap-3">
          <div className="shrink-0" style={{ height: 'min(70svh, calc((100vw - 52px) * 0.56 * 16 / 9))' }}>{booth}</div>
          <div className="min-w-0 flex-1">{tryWall}</div>
        </div>
      ) : (
        <div className={`mt-8 flex items-stretch justify-center gap-[clamp(16px,2.4vw,40px)] ${vp.w >= WIDE_HERO_MIN ? 'h-[min(560px,66vh)]' : 'h-[min(480px,58vh)]'}`}>
          <div className="bw-in min-h-0">{booth}</div>
          <div className="flex w-[clamp(140px,13vw,210px)] shrink-0 flex-col justify-end">
            <div data-slot="try" data-max="230" aria-hidden className="relative h-[72%] min-h-0 w-full" />
          </div>
          <div className="bw-in flex min-h-0 items-center" style={i(1)}>
            <div style={{ width: 'min(360px, 30vw)' }}>{tryWall}</div>
          </div>
        </div>
      )}
    </section>
  );

  /* ── Pricing ───────────────────────────────────────────────────────── */
  const planCols = phone ? 'grid-cols-1' : vp.w >= 1100 ? 'grid-cols-2' : 'grid-cols-1';
  const pricingSec = (
    <section id="pricing" data-stop="pricing" aria-labelledby="h-pricing" className={sectionClass}>
      {split('right', stand('pricing', -0.42, 'h-[min(320px,42vh)] w-full max-w-[260px]'), (
        <>
          <div className="bw-in">
            <h2 id="h-pricing" className="bw-h2">{pricing.heading}</h2>
            <p className="bw-body mt-3 max-w-[56ch]">{pricing.intro}</p>
            <p className="bw-small mt-3 max-w-[56ch]">{pricing.pro}</p>
          </div>
          <div className={`mt-10 grid gap-x-4 gap-y-6 ${planCols}`}>
            {plans.map((t, k) => (
              <div key={t.name} className="bw-in bw-glass-card bw-thick bw-plan flex flex-col p-6" style={i(k)} data-popular={t.popular === true ? 'true' : undefined}>
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
        </>
      ))}
    </section>
  );

  /* ── Start + footer ────────────────────────────────────────────────── */
  const startCta = (
    <div className="bw-in mx-auto flex max-w-[640px] flex-col items-center">
      <h2 id="h-start" className="bw-display">{start.heading}</h2>
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
    <section id="start" data-stop="start" aria-labelledby="h-start" className={`${sectionClass} text-center`}>
      {phone || !wideHero ? (
        <div className="flex flex-col items-center">
          {stand('start', 0, 'mb-4 h-[min(300px,34vh)] w-full max-w-[240px]')}
          <div className="w-full max-w-[640px]">{startCta}</div>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,640px)_minmax(0,1fr)] items-center gap-[clamp(16px,2vw,32px)]">
          <div className="flex justify-end">{stand('start', 0.38, 'h-[min(340px,44vh)] w-full max-w-[240px]')}</div>
          <div>{startCta}</div>
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

  const bubbleHidden = active === 'hero' && !wideHero;
  const storyPhotos = useMemo(() => WALL_POOL.slice(0, 9), []);

  return (
    <div
      data-brand="2"
      data-arrival={arrival}
      data-stop-active={active}
      ref={scrollerRef}
      tabIndex={-1}
      className="bw-root bw-scroll relative h-full overflow-y-auto overflow-x-clip"
      style={{ outline: 'none', ['--bw-header-h' as string]: `${headerH}px` }}
    >
      <div aria-hidden className="bw-backdrop">
        {/* The journey: a midnight field with faint violet / indigo / teal
            glows, deepest mid-page, lifting a little at the hero and the close
            (--bw-night-mix 0..1, blended per frame like the slots). */}
        <div className="bw-night">
          <span className="bw-night-glow bw-night-violet" />
          <span className="bw-night-glow bw-night-indigo" />
          <span className="bw-night-glow bw-night-teal" />
        </div>
        {/* Grit: a still film grain and a soft vignette over the field. */}
        <div className="bw-vignette" />
        <div className="bw-grain" />
      </div>

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
        >
          <StoryFx fxRef={fxRef} photos={storyPhotos} lite={phone} reduced={reduced} />
        </BeamyStage>
      )}

      <header ref={headerRef} className="bw-header sticky top-0 z-30" style={{ height: headerH }}>
        <div className={`mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 ${phone ? 'px-3' : 'px-[clamp(20px,2.6vw,48px)]'}`}>
          <button type="button" onClick={() => scrollerRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })} className="bw-wordmark bw-focus -ml-1 min-h-11 rounded-lg px-1" aria-label="Beamwall, back to the top">
            Beamwall
          </button>
          {!phone && (
            <nav aria-label="Main" className="flex items-center gap-1">
              {NAV_LINKS.map((nl) => (
                <a
                  key={nl.label}
                  href={`#${nl.stop}`}
                  className="bw-navlink"
                  aria-current={active === nl.stop ? 'true' : undefined}
                  onClick={(e) => { e.preventDefault(); scrollToStop(nl.stop); }}
                >
                  {nl.label}
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

      <main ref={mainRef} className="relative z-10">
        {hero}
        {story}
        {films}
        {pick}
        {tryIt}
        {pricingSec}
        {startSec}
      </main>

      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        className={`bw-bubble pointer-events-none fixed left-0 top-0 z-50 px-4 py-3 transition-opacity duration-300 ${phone ? 'text-[14px]' : ''} ${ready && arrival === 'done' && !bubbleHidden && !failed ? 'opacity-100' : 'opacity-0'}`}
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
