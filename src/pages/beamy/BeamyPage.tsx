/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The homepage (`/`), brand v2 (`/beamy` redirects here; the previous landing
 * lives at `/classic`, noindex). A normal, natively scrolling page over ONE fixed,
 * full-screen canvas (BeamyStage) that sits BEHIND the content:
 *
 *   hero → the pinned story (six glass cards, one 3D effect each; step 6
 *   is virtual celebrations) → What applies to you? → Try it (the real
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
 * (scroll parallax, decor bob, ambient particles) is off or softened under
 * reduced motion. Nothing follows the pointer: the page and the scene alone
 * decide where Beamy looks.
 *
 * Nothing a visitor captures leaves the device: the wall is component state.
 * Tokens/components come from src/styles/brand.css, scoped by data-brand="2".
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, Lock } from 'lucide-react';
import { Briefcase, Cake, ClipboardList, Gift, Users, type LucideIcon } from 'lucide-react';
import CameraExperience, { lookFrameUrl } from '../../components/landing/CameraExperience';
import ParticleBeam from '../../components/landing/ParticleBeam';
import ReportIssueButton from '../../components/support/ReportIssueButton';
import LiveWall, { WALL_POOL, type Pin } from '../../components/beamy/LiveWall';
import { SELFIE_CARD_FACE_STYLE, SELFIE_CARD_STYLE, flashGradient } from '../../components/beamy/selfieFx';
import { usePageTitle } from '../../lib/usePageTitle';
import type { Rect } from '../../lib/beamGeometry';
import { REDUCED_GLIDE_S, SELFIE_SPEED, flashOpacity, photoState } from '../../lib/beamySelfie';
import { SHOT_TILES, WALL_CENTRE, wallRows } from '../../lib/beamyWall';
import { AUDIENCES, GREETING, HELLO, POKE_LINES, audienceById, type Audience, type AudienceIcon } from '../../lib/beamyTour';
import {
  FOOTER_LINKS, HERO, LOOKS, NAV_LINKS, PICK_COPY, POKE_IDLE, SIGNUP_PATH, START_COPY, STORY_COPY,
  STORY_STEPS, TRY_COPY, beamyPlanCards, createReactionPicker, pickCelebration, pokeStep, pricingSection,
  startFacts, type Celebration, type Reaction, type StoryFxId,
} from '../../lib/brandLanding';
import {
  STOPS, blendSlots, pageProgress, pinProgress, storyEdgeOffsets, storyEntry, storyHeightVh, storySnapOffsets, storySnapOn, storyStep, storySwipe,
  storySwipeLeaves, weightedNight,
  type Pose, type SlotSample, type StopId,
} from '../../lib/beamyScroll';
import { LOOK_HOLD_MS, LOOK_HOLD_REDUCED_MS, nextLook, preloadUrl, type BeamyLook } from '../../lib/beamyLooks';
import { preloadModel } from '../../lib/glbCache';
import { ambientFor } from '../../lib/ambientFx';
import AmbientFx from '../../components/beamy/AmbientFx';
import ShineText from '../../components/beamy/ShineText';
import BeamyStage, { type BeamyApi, type BeamyClip, type Pt, type StageDecor, type StageLayout } from './BeamyStage';
import StoryFx, { type FxState } from './StoryFx';
import StoryScenes from './StoryScenes';
import ArPicker, { ArTabs } from './ArPicker';
import {
  DEFAULT_OPENING, arOrder, arPropScale, arStage, arTour, frameOnBeamy, demoQrUrl, standInFrame, lookAction, selectedLooks, toBeamyLook, wearStop,
  type ArSelection, type HomeLook, type LookCategory,
} from '../../lib/beamyAssets';
import { useBeamyAssets } from './useBeamyAssets';
import { motionAttrs } from '../../lib/beamyMotion';
import type { ArFxKind } from '../../lib/arFx';

/** What a tap on Beamy never steals: anything with its own tap under him. */
const POKE_SKIP = 'a, button, input, select, textarea, label, summary, [role="button"], [role="tab"], [contenteditable="true"]';
const inEllipse = (x: number, y: number, r: DOMRect) => {
  if (r.width === 0 || r.height === 0) return false;
  const nx = (x - (r.left + r.width / 2)) / (r.width / 2);
  const ny = (y - (r.top + r.height / 2)) / (r.height / 2);
  return nx * nx + ny * ny <= 1;
};

/**
 * The story pager, touch screens (lib/beamyScroll storySwipe): inside the
 * pinned story a vertical swipe moves the page with the finger, 1:1, and on
 * release settles on the next or previous step (never further, never back
 * where it began unless it was a mere touch). A swipe past either end is
 * left to the native scroll, so it leaves the story with its momentum. A
 * native flick that flies INTO the story is caught on its first or last
 * step, and a native drag left between steps settles on the nearest one.
 * Horizontal swipes (the AR carousel) and pinches are never touched.
 */
function useStoryPager(
  scrollerRef: MutableRefObject<HTMLDivElement | null>,
  storyRef: MutableRefObject<HTMLElement | null>,
  headerRef: MutableRefObject<HTMLElement | null>,
  n: number,
  reducedRef: MutableRefObject<boolean>,
) {
  useEffect(() => {
    const sc = scrollerRef.current;
    if (sc === null) return;
    const coarse = () => window.matchMedia('(pointer: coarse)').matches;
    /** The stretch in the scroller's own scrollTop: its two ends and each step's middle. */
    const geo = () => {
      const st = storyRef.current;
      if (st === null) return null;
      const vh = window.innerHeight;
      const hh = headerRef.current?.offsetHeight ?? 64;
      const base = sc.scrollTop + st.getBoundingClientRect().top;
      const [e0, e1] = storyEdgeOffsets(st.offsetHeight, vh, hh);
      const mids = storySnapOffsets(n, st.offsetHeight, vh, hh).map((m) => base + m);
      const a0 = base + e0, a1 = base + e1;
      const stepAt = (top: number) => storyStep(pinProgress(-(top - base) - hh, st.offsetHeight, vh - hh), n);
      return { a0, a1, mids, stepAt };
    };
    type G = { mode: 'pending' | 'track' | 'native'; x0: number; y0: number; top0: number; step0: number; y: number; t: number; vy: number };
    let g: G | null = null;
    let finger = false;
    let anim = 0;
    let idle = 0;
    let prevTop = sc.scrollTop;
    /** The last scroll's direction (+1 down the page), for the settle. */
    let lastDir = 0;
    /* While the pager settles, the scroller is not user-scrollable
       (overflow hidden; scrollTop still writes): that is what stops a native
       fling for good. A scrollTop write alone did not (measured: the fling
       carried on 900px past the catch, fighting the settle). */
    let unlockAt = 0;
    const unlock = () => { window.clearTimeout(unlockAt); if (sc.style.overflowY !== '') sc.style.overflowY = ''; };
    const stopAnim = () => { if (anim !== 0) { window.cancelAnimationFrame(anim); anim = 0; } unlock(); };
    /** Only scrolls that follow a real touch are the pager's (a nav link, a deep link or the step dots are left alone). */
    let touchedAt = -1e9;
    const touchy = () => performance.now() - touchedAt < 3000;
    const animateTo = (to: number) => {
      stopAnim();
      const from = sc.scrollTop;
      const d = to - from;
      if (Math.abs(d) < 1) { sc.scrollTop = to; prevTop = to; return; }
      sc.style.overflowY = 'hidden';
      const dur = reducedRef.current ? 220 : Math.min(620, Math.max(320, 260 + Math.abs(d) * 0.35));
      const t0 = performance.now();
      const frame = (now: number) => {
        const u = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - u, 3);
        sc.scrollTop = from + d * e;
        prevTop = sc.scrollTop;
        if (u < 1) anim = window.requestAnimationFrame(frame);
        // Hold the lock a moment past the end, so a fling still in flight cannot resume.
        else { anim = 0; unlockAt = window.setTimeout(unlock, 120); }
      };
      anim = window.requestAnimationFrame(frame);
    };
    /* A native drag that stopped short inside the stretch (no momentum, so
       no more scroll events): settle on the step it shows, but only onward
       in the way it was going, so a swipe leaving the story is never pulled
       back in. */
    const settleSoon = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (anim !== 0 || finger || !coarse() || !touchy()) return;
        const q = geo();
        if (q === null) return;
        const t = sc.scrollTop;
        if (t <= q.a0 + 1 || t >= q.a1 - 1) return;
        const m = q.mids[q.stepAt(t)];
        if ((lastDir > 0 && t < m - 2) || (lastDir < 0 && t > m + 2)) animateTo(m);
      }, 160);
    };
    const onStart = (e: TouchEvent) => {
      finger = true;
      touchedAt = performance.now();
      window.clearTimeout(idle);
      if (e.touches.length !== 1) { g = null; return; }
      const q = geo();
      const top = sc.scrollTop;
      const inside = q !== null && top >= q.a0 - 1 && top <= q.a1 + 1;
      if (anim !== 0 && inside) stopAnim();
      const p = e.touches[0];
      g = { mode: inside && q !== null ? 'pending' : 'native', x0: p.clientX, y0: p.clientY, top0: top, step0: q?.stepAt(top) ?? 0, y: p.clientY, t: e.timeStamp, vy: 0 };
    };
    const onMove = (e: TouchEvent) => {
      if (g === null || g.mode === 'native') return;
      if (e.touches.length !== 1) { g.mode = 'native'; return; }
      const p = e.touches[0];
      const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
      if (g.mode === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
        g.mode = Math.abs(dx) > Math.abs(dy) || storySwipeLeaves(g.step0, n, dy) ? 'native' : 'track';
        if (g.mode === 'native') return;
      }
      e.preventDefault();
      const q = geo();
      if (q === null) return;
      const dt = Math.max(1, e.timeStamp - g.t);
      g.vy = 0.6 * ((p.clientY - g.y) / dt) + 0.4 * g.vy;
      g.y = p.clientY;
      g.t = e.timeStamp;
      sc.scrollTop = Math.min(q.a1, Math.max(q.a0, g.top0 - dy));
      prevTop = sc.scrollTop;
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      finger = false;
      touchedAt = performance.now();
      const was = g;
      g = null;
      if (was === null || was.mode !== 'track') {
        // A native swipe from outside that the finger already carried inside: catch it now
        // (its momentum starts inside, so the crossing check never sees it).
        const q = geo();
        const t = sc.scrollTop;
        if (was !== null && q !== null && coarse()) {
          if (was.top0 < q.a0 - 1 && t > q.a0 + 1) { animateTo(q.mids[0]); return; }
          if (was.top0 > q.a1 + 1 && t < q.a1 - 1) { animateTo(q.mids[n - 1]); return; }
        }
        settleSoon();
        return;
      }
      const q = geo();
      if (q === null) return;
      // A finger that stopped before lifting carries no speed.
      const vy = e.timeStamp - was.t > 90 ? 0 : was.vy;
      const k = storySwipe(was.step0, n, was.y - was.y0, vy);
      animateTo(q.mids[k === 'leave' ? was.step0 : k]);
    };
    const onScroll = () => {
      const top = sc.scrollTop;
      const before = prevTop;
      prevTop = top;
      if (top !== before) lastDir = Math.sign(top - before);
      if (anim !== 0 || finger || !coarse() || !touchy()) return;
      const q = geo();
      if (q === null) return;
      const entry = storyEntry(before, top, q.a0, q.a1);
      if (entry !== null) { animateTo(q.mids[entry === 'first' ? 0 : n - 1]); return; }
      settleSoon();
    };
    sc.addEventListener('touchstart', onStart, { passive: true });
    sc.addEventListener('touchmove', onMove, { passive: false });
    sc.addEventListener('touchend', onEnd, { passive: true });
    sc.addEventListener('touchcancel', onEnd, { passive: true });
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      stopAnim();
      window.clearTimeout(idle);
      window.clearTimeout(unlockAt);
      sc.removeEventListener('touchstart', onStart);
      sc.removeEventListener('touchmove', onMove);
      sc.removeEventListener('touchend', onEnd);
      sc.removeEventListener('touchcancel', onEnd);
      sc.removeEventListener('scroll', onScroll);
    };
  }, [scrollerRef, storyRef, headerRef, n, reducedRef]);
}

/** The beam's calm palette for the photo dissolve (palette[0] tints the core). */
const BEAM_PALETTE = ['#C9CCFF', '#FFFFFF', '#A5ABFF', '#FFC56B'];
const AUDIENCE_ICONS: Record<AudienceIcon, LucideIcon> = { ClipboardList, Cake, Users, Briefcase, Gift };
/** How long each step of the AR auto tour holds (the tour stops for good at the first tap). */
const AR_HOLD_MS = 3200;
const AR_HOLD_REDUCED_MS = 5200;
/** Skipping the picker tours as the most common host. */
const DEFAULT_AUDIENCE = audienceById('family') ?? AUDIENCES[0];
/** His mouth's height over his feet, in his heights, at rest (the hero's frame keys on it). */
const MOUTH_AT = 0.485;
/** Room above Beamy's head kept free for his speech bubble (slots that show it). */
const BUBBLE_ROOM = 76;
/** How long the centre tile holds Beamy's selfie before it rejoins the rotation. */
const SELFIE_HOLD_MS = 12000;
/** Breakpoints: phones stack Beamy above the copy; the three-column hero needs a laptop. */
const PHONE_MAX = 768;
const WIDE_HERO_MIN = 1024;
const NIGHT: Record<StopId, number> = Object.fromEntries(STOPS.map((s) => [s.id, s.night])) as Record<StopId, number>;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Inside a .bw-btn-glow / .bw-btn-glass: the hover sheen, under a raised label. */
const ctaFace = (label: ReactNode) => (
  <>
    <span aria-hidden className="bw-btn-sheen" />
    <span className="relative z-[1]">{label}</span>
  </>
);

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

/** The hero's measured layout: the wall's box and rows, Beamy's spot on phones. */
interface HeroGeo {
  rows: 3 | 4;
  /** Laptops: the wall's top (in its grid), width and height. */
  wall: { top: number; width: number; height: number } | null;
  /** Phones/tablets: Beamy's height and feet x inside the wall row. */
  stand: { h: number; x: number } | null;
  /** Phones: the full-width wall's height under him (he stands on its top edge). */
  stackWallH?: number;
}

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

  const vp = useViewport();
  const phone = vp.w < PHONE_MAX;
  const wideHero = vp.w >= WIDE_HERO_MIN;
  const reduced = useReducedMotion();

  /* Asset slots: lib/beamyAssets HOME_ASSET_DEFAULTS first (an undefined
     media field there means the bundled file imported here), then the
     owner's published overrides (/admin/home-assets) once they load. */
  const A = useBeamyAssets();
  /** The live walls' photos: an override needs more than one wall's worth. */
  const PHOTO_POOL = A.wallPhotos.length > 9 ? A.wallPhotos : WALL_POOL;
  /** The AR step's picker, in category order. */
  const AR_LOOKS = useMemo(() => arOrder(A.arLooks), [A.arLooks]);
  /** The hero's try-on tour (the first is what he lands in and takes his selfie wearing). */
  const BEAMY_LOOKS = useMemo(() => A.heroLooks.map((l) => toBeamyLook(l)), [A.heroLooks]);
  /** The same, for callbacks that outlive a render (the intro, the bubble's line). */
  const looksRef = useRef(BEAMY_LOOKS);
  looksRef.current = BEAMY_LOOKS;

  const [active, setActive] = useState<StopId>('hero');
  const [step, setStep] = useState(0);
  /* The audience options wait, hidden, until Beamy arrives and beams them
     in (instantly shown without WebGL or under reduced motion). */
  const [pickLit, setPickLit] = useState(false);
  const pickLitRef = useRef(false);
  pickLitRef.current = pickLit;
  /** When the options have been on screen since (0 = not now), for the never-wait fallback. */
  const seenAt = useRef({ pick: 0 });
  const pickGridRef = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<Audience | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const [line, setLine] = useState(HELLO);
  /** What assistive tech hears: every line except the hero's auto-cycling try-on lines. */
  const [srLine, setSrLine] = useState(HELLO);
  /** The hero's try-on: which of BEAMY_LOOKS he is wearing. */
  const [lookIx, setLookIx] = useState(0);
  const lookIxRef = useRef(0);
  lookIxRef.current = lookIx;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [arrival, setArrival] = useState<'waiting' | 'dropping' | 'done'>('waiting');
  const [slowModel, setSlowModel] = useState(false);
  const [copyIn, setCopyIn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [shots, setShots] = useState<{ id: number; src: string }[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [introRunning, setIntroRunning] = useState(false);
  const [heroPin, setHeroPin] = useState<Pin | null>(null);
  const [ripple, setRipple] = useState(0);
  const [heroGeo, setHeroGeo] = useState<HeroGeo | null>(null);

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
  /** The fixed backdrop: the only layers that read the scroll progress (--bw-sp). */
  const backdropRef = useRef<HTMLDivElement | null>(null);
  /** The stage calls this first in each of its frames (see the glide below). */
  const stageFrame = useRef<(() => void) | null>(null);
  /** The AR carousel box (ArPicker), laid on the fixed AR stage (lib/beamyAssets arStage). */
  const arCarRef = useRef<HTMLDivElement | null>(null);
  /** Whether the AR stage has scaled his prop (so leaving the step puts it back to 1). */
  const arScaled = useRef(false);
  /** The frame look he wears in the hero (the Christmas look), placed around him every frame; null = none. */
  const heroFrame = useRef<BeamyLook | null>(null);
  /** The hero look worn now (index into BEAMY_LOOKS; -1 = none) and whether the intro put it on. */
  const lastWorn = useRef(-1);
  const introWorn = useRef(false);
  const scrollTop = () => scrollerRef.current?.scrollTop ?? 0;
  const heroRef = useRef<HTMLElement | null>(null);
  const heroPanelRef = useRef<HTMLDivElement | null>(null);
  const heroGridRef = useRef<HTMLDivElement | null>(null);
  const heroWallColRef = useRef<HTMLDivElement | null>(null);
  const heroRegionRef = useRef<HTMLDivElement | null>(null);
  const lookCapRef = useRef<HTMLParagraphElement | null>(null);
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLElement | null>(null);
  const storyWallRef = useRef<HTMLDivElement | null>(null);
  /** The centre tile of whichever wall the next photo flies to. */
  const heroTileRef = useRef<HTMLDivElement | null>(null);
  const tryTileRef = useRef<HTMLDivElement | null>(null);
  /** Try it's whole wall (phones scroll it into view before a shot lands). */
  const tryWallRef = useRef<HTMLDivElement | null>(null);
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
  /** What the story is doing with Beamy right now (so a step is entered once). */
  const storyOn = useRef<{ step: number; held: boolean }>({ step: -1, held: false });
  const layoutRef = useRef<StageLayout>({ home: { x: vp.w / 2, y: vp.h * 0.6 }, heightPx: 180 });
  const decorRef = useRef<StageDecor>({ panel: null, stand: null, phone, scroll: 0 });
  const fxRef = useRef<FxState>({ weights: {}, spot: null });
  const seed = useMemo(() => {
    const q = Number(new URLSearchParams(window.location.search).get('seed'));
    return Number.isFinite(q) && q > 0 ? q : (Date.now() & 0xffff) + 1;
  }, []);
  const react = useRef(createReactionPicker(seed));
  const lastCelebration = useRef<Celebration | null>(null);
  const poke = useRef(POKE_IDLE);

  const typed = useTyped(line, reduced);
  /* The hero copy never waits for the model or the choreography. */
  useEffect(() => { const id = window.setTimeout(() => setCopyIn(true), 250); return () => window.clearTimeout(id); }, []);
  const showContent = copyIn || failed || slowModel || reduced;

  const begin = useCallback(() => {
    const mine = ++token.current;
    return () => token.current === mine;
  }, []);
  const say = (t: string, quiet = false) => { setLine(t); if (!quiet) setSrLine(t); };

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

  /* ── Hero layout: a big wall that fills its side, and Beamy ──
     Laptops: the wall fills its column top to bottom (portrait tiles).
     Tablets: the wall takes the right ~60% of the row between the copy and
     the CTAs (four rows when the row is tall), Beamy stands lower left just
     in front of its corner. Phones: the wall fills that row, he stands in
     front of its lower-left corner. */
  const layoutHero = useCallback(() => {
    let next: HeroGeo;
    if (window.innerWidth >= WIDE_HERO_MIN) {
      const grid = heroGridRef.current;
      const col = heroWallColRef.current;
      if (grid === null || col === null) return;
      const gr = grid.getBoundingClientRect();
      // A big wall that fills its side of the box top to bottom (the owner:
      // "taller and a little bit wider ... utilize that space"): it reaches
      // 40px into the panel's side padding and stands a band in from the
      // panel's top and bottom; its tiles share the height (portrait tiles,
      // four rows once it is much taller than wide).
      const width = Math.min(col.getBoundingClientRect().width + 40, 540);
      const top = clamp(gr.height * 0.07, 28, 64);
      const height = Math.max(320, gr.height - top * 2);
      next = { rows: height / width > 1.32 ? 4 : 3, wall: { top, width, height }, stand: null };
    } else if (window.innerWidth < PHONE_MAX) {
      // Phones (the owner: "Beamy at the bottom in front, the wall larger
      // behind him"): the wall fills the row from its top, full width, four
      // rows once it is tall; Beamy stands at the row's bottom in front of
      // it, over its lower-left corner (never over the centre tile, where
      // his selfie lands). The CTAs follow below.
      const region = heroRegionRef.current;
      if (region === null) return;
      const rr = region.getBoundingClientRect();
      // Sized by the row's width (it never changes when the Skip chip goes),
      // so he stays a corner figure and never grows over the centre tile.
      const h = Math.round(clamp(Math.min(rr.width * 0.5, rr.height * 0.45), 110, 220));
      const wallH = Math.round(Math.max(160, rr.height - h * 0.28));
      const rows = wallRows(rr.width, wallH, 8 + 12, 24 + 12 + 12);
      // Arms out he is ~1.18× as wide as tall: his far hand stays within
      // ~12px of the row's edge (inside the panel's padding).
      next = { rows, wall: null, stand: { h, x: Math.round(Math.max(rr.width * 0.25, h * 0.59 - 12)) }, stackWallH: wallH };
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
      next = { rows, wall: null, stand: { h, x } };
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


  /* ── Lines, stops and the story's choreography ─────────────────────── */

  const lineFor = useCallback((id: StopId, a: Audience): string => {
    switch (id) {
      case 'hero': return looksRef.current[lookIxRef.current]?.line ?? HELLO;
      case 'story': return STORY_COPY.heading;
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

  /** A story step's main piece (StoryScenes marks it), viewport px. */
  const anchorRect = (id: StoryFxId) => rectOf(storyRef.current?.querySelector(`[data-fx-anchor="${id}"]`) ?? null);
  const beamToWall = () => {
    const b = api.current;
    const r = rectOf(storyWallRef.current);
    if (b === null || r === null || !readyRef.current) return;
    logStep('story:wall:beam');
    void b.beam(centre(r), undefined, 'mouth');
  };
  /**
   * A story step became active while the story holds Beamy: his clip, and
   * he lights his step's scene. The AR step dresses him (the try-on effect),
   * the wall step's own timeline has him catch and beam each shot (onCue),
   * every other step he projects onto its main piece as it materialises.
   */
  const storyEnter = (i: number): boolean => {
    const b = api.current;
    if (b === null || !readyRef.current) return false;
    storyOn.current.step = i;
    const s = STORY_STEPS[i];
    logStep(`story:${s.id}`);
    b.stopBeam();
    b.stopProject();
    if (s.id === 'prop') void b.play('Hop');
    else if (s.id === 'wall') { /* the wall's own timeline drives him (onCue) */ }
    else if (s.id === 'virtual') void b.play('Wave'); // he waves to friends far away; its timeline has him beam at the card (onCue)
    else {
      void b.play(s.clip as BeamyClip);
      const id = s.id;
      window.setTimeout(() => {
        if (storyOn.current.step === i) void b.project(() => anchorRect(id), id === 'keepsake' ? 'mouth' : 'hand', !reducedRef.current);
      }, 380);
    }
    return true;
  };
  const storyLeave = () => {
    storyOn.current.step = -1;
    api.current?.stopBeam();
    api.current?.stopProject();
  };
  const storyEnterRef = useRef(storyEnter);
  storyEnterRef.current = storyEnter;
  const storyLeaveRef = useRef(storyLeave);
  storyLeaveRef.current = storyLeave;
  /* A story scene's cue (StoryScenes' timelines): Beamy acts on the wall
     step's beats; the challenge ends with him celebrating; the shared link
     goes out with a beam at the card, and he sparkles when it is sent. */
  const onCue = useCallback((scene: string, cue: string) => {
    const b = api.current;
    logStep(`seq:${scene}:${cue}`);
    if (b === null || !readyRef.current) return;
    if (scene === 'wall' && cue === 'receive') { void b.play('Hop'); b.sparkle('sparkle'); }
    else if (scene === 'wall' && cue === 'beam') beamToWall();
    else if (scene === 'medal' && cue === 'rank') b.sparkle('sparkle');
    else if (scene === 'virtual' && cue === 'share') { const r = anchorRect('virtual'); if (r !== null) void b.beam(centre(r), undefined, 'mouth'); }
    else if (scene === 'virtual' && cue === 'deliver') b.sparkle('sparkle');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only
  }, []);
  const beamyAt = useCallback(() => (readyRef.current && api.current !== null ? api.current.mouth() : null), []);

  const onStop = (id: StopId) => {
    activeRef.current = id;
    setActive(id);
    logStep(`enter:${id}`);
    say(lineFor(id, audienceRef.current));
    if (id !== 'try') setCameraOn(false);
    if (id === 'pick' && !pickLitRef.current) {
      const b = api.current;
      const r = rectOf(pickGridRef.current);
      // Phones: no beam across the heading between him and the options.
      const narrow = window.innerWidth < PHONE_MAX;
      if (b !== null && r !== null && readyRef.current && !reducedRef.current && !narrow) void b.beam(centre(r), () => setPickLit(true), 'hand');
      else setPickLit(true);
    }
  };
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  /* ── The glide: every frame, read the slots, blend, hand the stage a target ──
     The stage runs this at the start of its own frame (so the target is this
     frame's, never last frame's); a plain rAF loop takes over whenever the
     stage is not rendering (no WebGL, a failed model). Every DOM read comes
     before any DOM write, so a frame never forces a second layout. */
  useEffect(() => {
    let raf = 0;
    let drivenAt = -1e9;
    const run = () => {
      const t0 = performance.now();
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
      let snapOn = false;
      if (st !== null) {
        const r = st.getBoundingClientRect();
        sStep = storyStep(pinProgress(r.top - headerH, r.height, vh - headerH), STORY_STEPS.length);
        snapOn = storySnapOn(r.top, r.bottom, headerH, vh);
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
      // The AR step: the frame (or the carousel around him) starts under the
      // switcher (phones) and the carousel's title above it, and the props
      // carousel's floating stops (read now, with the other reads) go to the
      // stage, which draws the real GLBs in their places.
      const onAr = card.id === 'prop';
      const arCar = arCarRef.current;
      let arTop = headerH + 8;
      const arPeeks: NonNullable<StageDecor['peeks']> = [];
      if (onAr && arCar !== null) {
        // The room above the frame: the rail (props, filters, effects) and
        // the title. The same height on every tab, so a tab change never
        // moves the frame or him.
        const topH = arCar.querySelector('.bw-ar-top')?.getBoundingClientRect().height ?? 0;
        const tabsEl = vw < WIDE_HERO_MIN ? main.querySelector('.bw-ar .bw-ar-tabs') : null;
        arTop = Math.max(arTop, tabsEl !== null ? tabsEl.getBoundingClientRect().bottom + 6 : 0) + topH + 6;
        if (arCar.closest('.bw-ar[data-on="true"]') !== null) {
          // A peek gliding in or out carries its prop with it, and lets go
          // of it as it fades (its transition's live opacity).
          arCar.querySelectorAll<HTMLElement>('.bw-ar-peek[data-prop-url]').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 4 && Number(getComputedStyle(el).opacity) > 0.08) arPeeks.push({ url: el.dataset.propUrl ?? '', x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width });
          });
        }
      }
      // The AR step is ONE fixed stage (lib/beamyAssets arStage): a 9:16
      // frame box filling the room under the title, and his stand inside it,
      // set by the reference frame's window. Every frame renders in that box
      // and he stands there on every tab and item; only the looks move.
      // Phones: right under the switcher, side gutters for the carousel's
      // stops. Laptops: centred on his story slot, clear of the caption.
      let arAt: ReturnType<typeof arStage> | null = null;
      const storyAt = onAr && arCar !== null ? samples.find((x) => x.id === 'story') : undefined;
      if (storyAt !== undefined) {
        if (vw < WIDE_HERO_MIN) {
          const gut = clamp(vw * 0.12, 46, 72);
          arAt = arStage({ box: { top: arTop, bottom: vh - 10, left: gut, right: vw - gut }, align: 'top' });
        } else {
          // As tall as the room (at most 0.6 of the width), centred on his
          // slot unless that would run under the caption card (1024: it
          // shifts right to clear it).
          const cx = storyAt.rect.left + storyAt.rect.width / 2;
          const capR = main.querySelector('#how .bw-glass-card')?.getBoundingClientRect().right ?? 0;
          const fw = (Math.min(vh - 8 - arTop, ((vw * 0.6) * 16) / 9) * 9) / 16;
          // The rail above the frame is wider than it: clear the caption by whichever is wider.
          const half = Math.max(fw / 2, (arCar.querySelector('.bw-ar-top')?.getBoundingClientRect().width ?? 0) / 2);
          const c = Math.min(Math.max(cx, capR + 24 + half), vw - 24 - half);
          arAt = arStage({ box: { top: arTop, bottom: vh - 8, left: c - fw / 2, right: c + fw / 2 } });
        }
        const s0 = arAt.stand;
        storyAt.rect = { left: s0.x - (s0.heightPx * 1.1) / 2, top: s0.y - s0.heightPx, width: s0.heightPx * 1.1, height: s0.heightPx };
        storyAt.pose.fit = 1;
      }
      // Laptops, the hero's frame look (the Holiday cover): the frame fills
      // the gap between the copy and the wall and he shrinks to stand INSIDE
      // its window (lib/beamyAssets standInFrame), his antlers free to pop
      // above it. Phones/tablets place the frame on him instead (below).
      const hf0 = heroFrame.current;
      let heroIn: ReturnType<typeof standInFrame> | null = null;
      const heroSample = hf0 !== null && (vw >= WIDE_HERO_MIN || isPhone) ? samples.find((x) => x.id === 'hero') : undefined;
      // Phones: a smaller cover in the wall's lower-left corner (it used to
      // hide most of the wall's left half), him standing inside its window.
      const regP = isPhone && heroSample !== undefined ? rectOf(heroRegionRef.current) : null;
      if (hf0 !== null && heroSample !== undefined && regP !== null) {
        const fw = regP.width * 0.46;
        const fh = Math.min(regP.height, (fw * 16) / 9);
        const panelL = rectOf(heroPanelRef.current)?.left ?? 0;
        heroIn = standInFrame({
          opening: hf0.opening ?? DEFAULT_OPENING,
          box: { top: regP.top + regP.height - fh, bottom: regP.top + regP.height, left: regP.left, right: regP.left + fw },
          // His selfie arm stays inside the hero panel.
          clearLeft: { x: panelL + 6, reach: 0.66 },
        });
      } else if (hf0 !== null && heroSample !== undefined && !isPhone) {
        const copyR = main.querySelector('[data-card-avoid]')?.getBoundingClientRect();
        const wallR = heroWallColRef.current?.firstElementChild?.getBoundingClientRect();
        const panelR = rectOf(heroPanelRef.current);
        if (copyR !== undefined && wallR !== undefined && panelR !== null && wallR.left - copyR.right > 120) {
          heroIn = standInFrame({
            opening: hf0.opening ?? DEFAULT_OPENING,
            box: { top: Math.max(panelR.top + 12, headerH + 8), bottom: panelR.top + panelR.height - 12, left: copyR.right + 12, right: wallR.left - 12 },
            // His selfie arm and phone reach ~0.61 of his height to his left
            // (measured): keep them clear of the headline.
            clearLeft: { x: copyR.right + 8, reach: 0.66 },
          });
        }
      }
      if (heroIn !== null && heroSample !== undefined) {
        const st0 = heroIn.stand;
        heroSample.rect = { left: st0.x - st0.heightPx, top: st0.y - st0.heightPx, width: st0.heightPx * 2, height: st0.heightPx };
        heroSample.pose.fit = 1;
        heroSample.pose.ax = 0.5;
      }
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
        bubbleAway: isPhone || slotId === 'story' || !settled,
        // A tap on him works wherever he has settled, phones included (the
        // bubble's rules above are about room for text, not about taps).
        hitAway: !settled,
      };
      const hp = rectOf(heroPanelRef.current);
      const heroSlot = samples.find((x) => x.id === 'hero');
      decorRef.current = {
        panel: hp !== null && hp.top + hp.height > -40 ? hp : null,
        stand: heroSlot !== undefined ? (() => { const r = heroSlot.rect; const h = Math.min(r.height * heroSlot.pose.fit, r.width / 1.1); return { feet: { x: r.left + r.width / 2, y: r.top + r.height }, heightPx: h }; })() : null,
        phone: isPhone,
        scroll: Math.min(sc.scrollTop, heroRef.current?.offsetHeight ?? vh),
      };
      // The hero's frame look (the Christmas one) stands around him, placed
      // like the AR step's (lib/beamyAssets frameOnBeamy: whole frame in its
      // box, his face in the window, the antlers shrunk into it if they must)
      // but from his slot's settled stand, so a hop or the selfie never swings
      // it. Laptops: the box is the gap between the copy and the wall, so it
      // never covers either; phones/tablets: the wall's row.
      const hf = heroFrame.current;
      const stApi = api.current;
      let frameAt: StageLayout['frameAt'] = null;
      if (hf !== null && stApi !== null && readyRef.current && (slotId === 'hero' || activeRef.current === 'hero')) {
        const copyR = main.querySelector('[data-card-avoid]')?.getBoundingClientRect();
        const wallR = heroWallColRef.current?.firstElementChild?.getBoundingClientRect();
        const reg = rectOf(heroRegionRef.current);
        const panelR = hp;
        const box = vw >= WIDE_HERO_MIN && copyR !== undefined && wallR !== undefined && panelR !== null
          ? { top: Math.max(panelR.top + 12, headerH + 8), bottom: panelR.top + panelR.height - 12, left: copyR.right + 12, right: wallR.left - 12 }
          : reg !== null ? { top: Math.max(reg.top, headerH + 8), bottom: reg.top + reg.height, left: reg.left, right: reg.left + reg.width } : null;
        if (heroIn !== null) {
          frameAt = heroIn.frame;
          stApi.wornScale(1);
          if (STEP_LOG) (window as unknown as { __beamyHeroFrame?: unknown }).__beamyHeroFrame = { ...heroIn.frame, stand: heroIn.stand, propScale: 1, fits: true, inWindow: true };
        } else if (box !== null && box.right - box.left > 40 && box.bottom - box.top > 40) {
          const hpx = b.heightPx;
          const g = frameOnBeamy({
            x: b.x, tip: b.y - hpx * 1.02, mouth: b.y - hpx * MOUTH_AT, heightPx: hpx,
            lift: stApi.wornLiftAt(1) * hpx, liftBase: stApi.wornLiftAt(0) * hpx,
            opening: hf.opening ?? DEFAULT_OPENING, box,
          });
          frameAt = { left: g.left, top: g.top, h: g.h };
          stApi.wornScale(g.propScale);
          if (STEP_LOG) (window as unknown as { __beamyHeroFrame?: unknown }).__beamyHeroFrame = { ...g, box };
        }
      }
      layoutRef.current.frameAt = frameAt;
      // Phones: the try-on caption rides just above whatever he wears, kept
      // inside the hero's free corner.
      const cap = lookCapRef.current;
      const capStand = decorRef.current.stand;
      let capBottom: string | null = null;
      if (cap !== null && capStand !== null && cap.dataset.stack !== 'true') {
        const room = (heroRegionRef.current?.clientHeight ?? 0) - cap.offsetHeight;
        const want = capStand.heightPx * (1.04 + (api.current?.wornLift() ?? 0)) + 10;
        capBottom = `${Math.max(0, Math.min(want, room)).toFixed(1)}px`;
      }
      const fx = fxRef.current;
      fx.weights = b.fx as Partial<Record<StoryFxId, number>>;
      fx.spot = anchorRect(card.id);
      // The story holds Beamy: run its step (once per step), or let go.
      const inStory = slotId === 'story' && b.share > 0.8;
      if (inStory && storyOn.current.step !== sStep) storyEnterRef.current(sStep);
      else if (!inStory && storyOn.current.step >= 0) storyLeaveRef.current();
      // Options he beams in: shown anyway once on screen for a moment,
      // whether or not he got there (a stop that never settles, a slow stage).
      const now = performance.now();
      const pg = pickGridRef.current;
      if (!pickLitRef.current && pg !== null) {
        const q = pg.getBoundingClientRect();
        if (q.top > vh * 0.85 || q.bottom < headerH + 40) seenAt.current.pick = 0;
        else if (seenAt.current.pick === 0) seenAt.current.pick = now;
        else if (now - seenAt.current.pick > 1800) setPickLit(true);
      }
      if (settled && slotId !== activeRef.current) onStopRef.current(slotId);
      // Header progress, the colour journey, the hero's scroll depth: read…
      const y = sc.scrollTop;
      const sp = pageProgress(y, sc.scrollHeight, vh);
      const secs: { top: number; height: number; night: number }[] = [];
      main.querySelectorAll<HTMLElement>('[data-stop]').forEach((el) => {
        const r = el.getBoundingClientRect();
        secs.push({ top: r.top, height: r.height, night: NIGHT[el.dataset.stop as StopId] ?? 1 });
      });
      const nightV = weightedNight(secs, vh);
      const hero = heroRef.current;
      const hs = hero !== null ? Math.min(y, hero.offsetHeight).toFixed(0) : null;
      // …then write. The backdrop (a small fixed subtree) takes the exact
      // values; the page-wide night mix (glass edges read it) moves in 0.05
      // steps, so most frames restyle nothing outside the backdrop.
      if (cap !== null && capBottom !== null && cap.style.bottom !== capBottom) cap.style.bottom = capBottom;
      const bar = progressRef.current;
      if (bar !== null) bar.style.transform = `scaleX(${sp.toFixed(4)})`;
      // Touch screens snap one step per swipe, only inside the pinned story (brand.css).
      const snapAttr = snapOn ? 'on' : 'off';
      if (sc.dataset.storySnap !== snapAttr) sc.dataset.storySnap = snapAttr;
      const bd = backdropRef.current;
      if (bd !== null) {
        if (!reducedRef.current) bd.style.setProperty('--bw-sp', sp.toFixed(4));
        const n3 = nightV.toFixed(3);
        if (bd.style.getPropertyValue('--bw-night-mix') !== n3) bd.style.setProperty('--bw-night-mix', n3);
      }
      const night = (Math.round(nightV * 20) / 20).toFixed(2);
      if (sc.style.getPropertyValue('--bw-night-mix') !== night) sc.style.setProperty('--bw-night-mix', night);
      if (hero !== null && hs !== null && !reducedRef.current && hero.style.getPropertyValue('--hs') !== hs) hero.style.setProperty('--hs', hs);
      // The AR stage (fixed, above): the carousel box and the frame sit on
      // it, and his prop is scaled to the reference window, once, so a frame
      // or tab change never resizes him or it. Off the step, the prop goes
      // back to its fitted size.
      const bw = api.current;
      if (arAt !== null && arCar !== null) {
        const f = arAt.frame;
        const tf = `translate(${f.left.toFixed(1)}px, ${f.top.toFixed(1)}px)`;
        const hh = `${f.h.toFixed(1)}px`;
        if (arCar.style.transform !== tf || arCar.style.height !== hh) { arCar.style.transform = tf; arCar.style.height = hh; }
        if (bw !== null && readyRef.current) {
          const hp0 = arAt.stand.heightPx;
          const k = arPropScale({ stand: arAt.stand, frame: f, lift: bw.wornLiftAt(1) * hp0, liftBase: bw.wornLiftAt(0) * hp0 });
          bw.wornScale(k);
          arScaled.current = true;
          if (STEP_LOG) (window as unknown as { __beamyAr?: unknown }).__beamyAr = { frame: f, stand: arAt.stand, propScale: k, beamy: bw.where() };
        }
        // Settled on the step, the stage steps in front of the page so what
        // he wears draws over the frame; the frame images on show (the worn
        // one first) and the frame arrows still cover his body (the stage
        // masks it, decor.arOver).
        if (settled && arCar.closest('.bw-ar[data-on="true"]') !== null) {
          const frames: { at: number; url: string; left: number; top: number; width: number; height: number; a: number }[] = [];
          arCar.querySelectorAll<HTMLImageElement>('.bw-ar-track[data-cat="frame"] .bw-ar-item[data-kind="frame"] > img').forEach((img) => {
            const item = img.parentElement as HTMLElement;
            const r = img.getBoundingClientRect();
            const a = Number(getComputedStyle(item).opacity);
            if (r.width > 4 && a > 0.02 && r.right > 0 && r.left < vw) frames.push({ at: Math.abs(Number(item.dataset.at ?? 9)), url: img.currentSrc || img.src, left: r.left, top: r.top, width: r.width, height: r.height, a });
          });
          frames.sort((p, q) => p.at - q.at);
          const holes: { x: number; y: number; r: number }[] = [];
          arCar.querySelectorAll<HTMLElement>(':scope > .bw-ar-arrow').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width > 4) holes.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 });
          });
          decorRef.current.arOver = { frames: frames.slice(0, 3), holes: holes.slice(0, 2) };
        } else decorRef.current.arOver = undefined;
      } else {
        decorRef.current.arOver = undefined;
        if (bw !== null && arScaled.current) {
          arScaled.current = false;
          bw.wornScale(1);
        }
      }
      decorRef.current.peeks = arPeeks;
      layoutRef.current.tickMs = performance.now() - t0;
    };
    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      if (performance.now() - drivenAt < 60) return;
      run();
    };
    stageFrame.current = () => { drivenAt = performance.now(); run(); };
    raf = window.requestAnimationFrame(tick);
    const scroller = scrollerRef.current;
    // Keyboard scrolling (arrows, space, page keys) goes to the focused
    // scroller: take focus once, without moving or painting a ring.
    if (scroller !== null && (document.activeElement === null || document.activeElement === document.body)) scroller.focus({ preventScroll: true });
    return () => { window.cancelAnimationFrame(raf); stageFrame.current = null; };
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
    const ms = reducedRef.current ? REDUCED_GLIDE_S * 1000 : Math.round(1250 / SELFIE_SPEED);
    // He turns to the wall and beams the shot onto it (reduced motion: he
    // only turns; the glide is the trip); then back to you once it lands.
    const b = api.current;
    const at = { x: tile.left + tile.width / 2, y: tile.top + tile.height / 2 };
    if (b !== null) {
      if (reducedRef.current) b.face(at.x);
      else { logStep('selfie:beam'); void b.zap(at, 'mouth', ms); }
    }
    setFlight({
      key: ++flightKey.current, from, to: tile, shot: photo, ms,
      onDone: () => { setFlight(null); api.current?.face(null); landSelfie(photo, onTry); },
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
      // A framed selfie is the whole 9:16 frame (the card's photo window, 86% ×
      // 74% of it, then holds 9:16); a plain one is a 4:5 portrait.
      const cw = Math.max(44, f.heightPx * (f.framed ? 0.24 : 0.3));
      const ch = cw * (f.framed ? (0.86 / 0.74) * (16 / 9) : 1.2);
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
    }, { shades: false }); // the intro selfie shows the Christmas look only
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
      // Christmas first: the Holiday cover goes up around him and the antlers
      // pop on, then he takes the selfie in them (that photo goes to the wall).
      const first = looksRef.current[0];
      if (first !== undefined && first.kind !== 'none') {
        heroFrame.current = first.kind === 'frame' ? first : null;
        lastWorn.current = 0;
        introWorn.current = true;
        await Promise.race([b.wear(first), wait(reduced ? 2500 : 4000)]);
        if (!alive()) { setIntroRunning(false); return; }
        logStep(`look:${first.id}:intro`);
        b.sparkle('sparkle');
        await wait(reduced ? 500 : 350);
      }
      await runSelfie(alive);
      if (alive()) logStep('intro:done');
      setIntroRunning(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is in
  }, [ready]);
  useEffect(() => {
    const id = window.setTimeout(() => setSlowModel(true), 4000);
    // Warm the Christmas look so it is on him the moment he lands.
    const first = BEAMY_LOOKS[0];
    if (first?.prop !== undefined) void preloadModel(first.prop.url);
    else if (first?.kind === 'prop' && first.url !== undefined) void preloadModel(first.url);
    if (first?.kind === 'frame' && first.url !== undefined) { const im = new Image(); im.src = first.url; }
    return () => window.clearTimeout(id);
  }, []);

  /* ── The hero's try-on: once the intro is over and he stands in the hero,
     he wears BEAMY_LOOKS[lookIx] (real library props, a guide-pack frame)
     and says its line; every few seconds, or on a tap, he moves to the next.
     Leaving the hero takes it off; coming back puts it on again. ────── */
  // Beamed-in content never waits on him for long: no stage, or a slow one,
  // shows it anyway (the glide tick lights it after a short look; see seenAt).
  const pickOn = pickLit || failed || reduced;

  const inStoryAR = active === 'story' && STORY_STEPS[step]?.id === 'prop';
  const tryOn = ready && !failed && arrival === 'done' && !introRunning && active === 'hero';
  useEffect(() => {
    const b = api.current;
    if (b === null) return;
    if (!tryOn) {
      // The intro dresses him while tryOn is still off: leave that look on
      // until the intro is over or he leaves the hero.
      if (introRunning && activeRef.current === 'hero') return;
      if (lastWorn.current >= 0) { void b.wear(null); lastWorn.current = -1; heroFrame.current = null; introWorn.current = false; }
      return;
    }
    const look = BEAMY_LOOKS[lookIx] ?? BEAMY_LOOKS[0];
    if (lastWorn.current >= 0 && lastWorn.current !== lookIx) b.sparkle('sparkle');
    // The intro already put this one on: keep it (no second pop).
    const kept = introWorn.current && lastWorn.current === lookIx;
    introWorn.current = false;
    lastWorn.current = lookIx;
    heroFrame.current = look.kind === 'frame' ? look : null;
    let live = true;
    let hold = 0;
    const advance = () => { if (live) setLookIx((k) => nextLook(k, BEAMY_LOOKS.length)); };
    // The hold starts once he is actually wearing it (a slow prop is never
    // skipped); a load that never settles still moves on.
    const stuck = window.setTimeout(advance, 15000);
    void (kept ? Promise.resolve() : b.wear(look)).then(() => {
      if (!live) return;
      window.clearTimeout(stuck);
      logStep(`look:${look.id}`);
      say(look.line, true);
      hold = window.setTimeout(advance, reduced ? LOOK_HOLD_REDUCED_MS : LOOK_HOLD_MS);
    });
    // Warm the next look so the swap is instant.
    const nx = preloadUrl(lookIx, BEAMY_LOOKS);
    if (nx !== null) { if (nx.endsWith('.glb')) void preloadModel(nx); else { const im = new Image(); im.src = nx; } }
    return () => { live = false; window.clearTimeout(stuck); window.clearTimeout(hold); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- say/api are stable
  }, [tryOn, lookIx, reduced, introRunning, active, BEAMY_LOOKS]);

  /* ── The story's AR step: the picker drives what he wears, ONE look per
     category, combined (lib/beamyAssets wearStop): the prop on his head,
     the filter as his tint, the effect on a loop, and the frame in front of
     him (ArPicker draws it; the stage never wears it here). Until the first
     tap it tours on its own, building a look up one category at a time
     (arTour); any tap or tab ends the tour for good. ── */
  const [arSel, setArSel] = useState<ArSelection>(() => arTour(0, AR_LOOKS).sel);
  const [arTab, setArTab] = useState<LookCategory>(() => arTour(0, AR_LOOKS).tab);
  const [arTouched, setArTouched] = useState(false);
  const arK = useRef(0);
  const arOn = ready && !failed && arrival === 'done' && inStoryAR;
  const wearAr = useCallback((c: LookCategory, stop: HomeLook | null) => {
    logStep(`ar:pick:${stop?.id ?? `none:${c}`}`);
    setArTouched(true);
    setArTab(c);
    setArSel((s) => wearStop(s, c, stop));
  }, []);
  const tabAr = useCallback((c: LookCategory) => {
    logStep(`ar:tab:${c}`);
    setArTouched(true);
    setArTab(c);
  }, []);
  useEffect(() => {
    if (!arOn || arTouched) return;
    const id = window.setInterval(() => {
      arK.current += 1;
      const t = arTour(arK.current, AR_LOOKS);
      setArSel(t.sel);
      setArTab(t.tab);
    }, reduced ? AR_HOLD_REDUCED_MS : AR_HOLD_MS);
    return () => window.clearInterval(id);
  }, [arOn, arTouched, reduced, AR_LOOKS]);
  // The owner's AR looks arrived after first paint: the untouched tour restarts on them.
  const arLooksSeen = useRef(AR_LOOKS);
  useEffect(() => {
    if (arLooksSeen.current === AR_LOOKS) return;
    arLooksSeen.current = AR_LOOKS;
    if (arTouched) return;
    const t = arTour(arK.current, AR_LOOKS);
    setArSel(t.sel);
    setArTab(t.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new list restarts it
  }, [AR_LOOKS]);
  /** The prop the AR step has on him (null = none); undefined = the step is not dressing him. */
  const arWorn = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const b = api.current;
    if (b === null) return;
    if (!arOn) {
      if (arWorn.current !== undefined) { arWorn.current = undefined; void b.wear(null); b.tint(null); }
      return;
    }
    const worn = selectedLooks(arSel, AR_LOOKS);
    const prop = worn.find((l) => l.category === 'prop');
    const filter = worn.find((l) => l.category === 'filter');
    const fa = filter !== undefined ? lookAction(filter) : null;
    logStep(`ar:${worn.map((l) => l.id).join('+') || 'none'}`);
    if (arWorn.current !== undefined) b.sparkle('sparkle');
    b.tint(fa !== null && fa.kind === 'tint' ? fa.color : null);
    const pid = prop?.id ?? null;
    if (arWorn.current !== pid) void b.wear(prop !== undefined ? toBeamyLook(prop) : null);
    arWorn.current = pid;
    // Warm the tour's next files so the swap is instant.
    if (!arTouched) {
      for (const n of selectedLooks(arTour(arK.current + 1, AR_LOOKS).sel, AR_LOOKS)) {
        const na = lookAction(n);
        if (na.kind === 'prop') void preloadModel(na.url);
        else if (na.kind === 'frame') { const im = new Image(); im.src = na.url; }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arTouched only gates the warm-up
  }, [arOn, arSel, AR_LOOKS]);
  // Effects: the sparkle burst repeats on the stage while it is on; every
  // other effect is drawn round him by ArFx (lib/arFx), and he never moves for one.
  const arFx = arSel.effect;
  const arFxLook = arFx === undefined ? undefined : AR_LOOKS.find((x) => x.id === arFx);
  const arFxAction = arFxLook !== undefined ? lookAction(arFxLook) : null;
  const arFxKind: ArFxKind | null = arOn && arFxAction !== null && arFxAction.kind === 'fx' && arFxAction.fx !== 'sparkles' ? arFxAction.fx : null;
  const arSparkles = arOn && arFxAction !== null && arFxAction.kind === 'fx' && arFxAction.fx === 'sparkles';
  useEffect(() => {
    const b = api.current;
    if (b === null || !arSparkles) return;
    const run = () => b.sparkle('burst');
    run();
    const id = window.setInterval(run, 1300);
    return () => window.clearInterval(id);
  }, [arSparkles]);

  /* ── The booth hands over a shot: Beamy catches it, then beams it. ─── */
  const onBeam = useCallback((src: string) => {
    logStep('try:shot');
    // Phones stack the booth above Beamy and the wall: first bring Beamy and
    // the wall up to fill the screen, then the shot leaves the phone (now
    // just above), Beamy catches it and beams it down onto the wall.
    const sc = scrollerRef.current;
    const wallBox = rectOf(tryWallRef.current);
    if (window.innerWidth < PHONE_MAX && sc !== null && wallBox !== null) {
      const by = wallBox.top + wallBox.height - (window.innerHeight - 14);
      if (by > 4) {
        logStep('try:scroll');
        sc.scrollTo({ top: sc.scrollTop + by, behavior: reduced ? 'auto' : 'smooth' });
        // He glides to his slot as the page moves; give both a beat to settle.
        window.setTimeout(() => beamShot(src), reduced ? 120 : 900);
        return;
      }
    }
    beamShot(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- beamShot is recreated with the same deps
  }, [begin, celebrate, reduced]);
  const beamShot = (src: string) => {
    const b = api.current;
    const vf = rectOf(viewfinderRef.current);
    const tile = rectOf(tryTileRef.current);
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
  };

  /* ── A tap on Beamy. His hit button is a fixed element over the canvas,
     and a touch that starts on a fixed element scrolls the VIEWPORT, not
     this page's own scroller: every swipe that began on him was dead
     (measured: 0px moved). So the button takes no pointer events (it
     stays focusable for the keyboard) and the page hit-tests taps instead,
     letting anything interactive under him keep its own tap. ── */
  const onBeamy = (x: number, y: number, target: EventTarget | null): boolean => {
    const hit = hitRef.current;
    if (hit === null || hit.dataset.away === 'true' || hit.style.visibility === 'hidden') return false;
    if (target instanceof Element && target.closest(POKE_SKIP) !== null) return false;
    return inEllipse(x, y, hit.getBoundingClientRect());
  };
  const onRootClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!e.defaultPrevented && onBeamy(e.clientX, e.clientY, e.target)) onPoke();
  };
  const onRootHover = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const on = onBeamy(e.clientX, e.clientY, e.target) ? 'true' : 'false';
    if (e.currentTarget.dataset.beamyHover !== on) e.currentTarget.dataset.beamyHover = on;
  };

  /* ── A tap on Beamy's own hit area (nothing else captures). ─────────── */
  const onPoke = () => {
    const b = api.current;
    if (b === null) return;
    if (activeRef.current === 'hero') {
      // During the intro a tap is just a sparkle (it is short); once it
      // has settled, a tap tries on the next look (with a little hop).
      if (introRunning) { b.sparkle('sparkle'); return; }
      logStep('look:tap');
      setLookIx((k) => nextLook(k));
      void b.play('Hop');
      return;
    }
    const r = pokeStep(poke.current, performance.now());
    poke.current = r.state;
    logStep(`poke:${r.level}`);
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
  /* ── Pieces ─────────────────────────────────────────────────────────── */

  const shotPins = useMemo(() => {
    const out: Record<number, Pin> = {};
    shots.forEach((s, n) => { out[SHOT_TILES[n]] = { src: s.src, key: `s${s.id}`, mine: true }; });
    return out;
  }, [shots]);
  /* Phones: his framed selfie stands over the wall's left half, so his photo
     lands on the right column's middle tile, in full view. */
  const heroTile = phone ? WALL_CENTRE + 1 : WALL_CENTRE;
  const heroPins = useMemo<Record<number, Pin>>(() => (heroPin === null ? {} : { [heroTile]: heroPin }), [heroPin, heroTile]);

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
  // Phones now show the booth full width too, so it always wears the full-size dress.
  const big = true;
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
  const plans = beamyPlanCards();
  /* The header is a floating glass pill: this is the band it reserves (pill + its margins). */
  const headerH = phone ? 66 : 84;

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
    <div data-slot={id} data-yaw={phone ? 0 : yaw} data-bubble={phone ? 'none' : undefined} aria-hidden className={phone ? 'mx-auto mb-8 h-[30svh] w-[64%] max-w-[260px]' : cls} />
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
      <Link to={SIGNUP_PATH} className={`bw-btn bw-btn-glow ${wideHero ? 'bw-btn-lg' : 'w-full sm:w-auto'}`}>{ctaFace(HERO.primary)}</Link>
      <button type="button" className={`bw-btn bw-btn-glass ${wideHero ? 'bw-btn-lg' : 'w-full sm:w-auto'}`} onClick={() => scrollToStop('try')}>
        {ctaFace(HERO.secondary)}
      </button>
    </div>
  );
  const heroHeadline = (
    <>
      {/* The headline first; its payoff set in capitals with a shimmering
          rim (components/beamy/ShineText: the glow CTA's travelling light, on the
          outline only; the fill stays solid ink). */}
      <h1 className="bw-display" style={wideHero ? { ...i(0), fontSize: 'clamp(40px, min(22px + 3vw, 7.4dvh), 76px)' } : i(0)}>
        <span className="bw-light block">{HERO.lead}</span>
        <span className="bw-hl-caps block">
          <ShineText text={HERO.strong} />
        </span>
      </h1>
      {/* Full ink here: the hero's sheen and floor light sit behind these lines. */}
      <p className={`bw-hl-line ${wideHero ? 'mt-5' : 'mt-2.5'}`} style={{ ...i(1), color: 'var(--bw-ink)' }}>{HERO.line}</p>
      <p className={`bw-hl-beats ${wideHero ? 'mt-2' : 'mt-1'}`} style={i(2)}>{HERO.sub}</p>
    </>
  );
  const heroRows = heroGeo?.rows ?? 3;
  const heroWall = (
    <div className="bw-wall-mount bw-wall-glint h-full" style={{ ['--wall-yaw' as string]: wideHero ? '-7deg' : phone ? '0deg' : '-5deg' }}>
      <LiveWall
        key={heroRows}
        pool={PHOTO_POOL} pins={heroPins} dim={introRunning} compact={!wideHero} centreRef={heroTileRef} centre={heroTile} ripple={ripple} seed={seed}
        rows={heroRows} fill
      />
    </div>
  );
  const heroSlotChildren = (
    <>
      {/* A faint pool of light on the floor under his feet. */}
      <span aria-hidden className="bw-floor-pool" />
      {!ready && !failed && (
        <p className="bw-label pointer-events-none absolute inset-x-0 top-[55%] text-center">Beamy is on his way&hellip;</p>
      )}
    </>
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
      style={{ height: heroH, minHeight: wideHero ? undefined : phone ? 'max(calc(100svh - var(--bw-header-h)), 700px)' : 'calc(100svh - var(--bw-header-h))' }}
    >
      <div ref={heroPanelRef} className="bw-hero-pane absolute" style={{ inset: panelInset, ['--bw-radius-panel' as string]: `${radius}px` }}>
        {/* The glass box: frost, the recessed back wall with its deep inner
            shadow, the floor. One pane, nothing else in front of the field. */}
        <div className="bw-glass" aria-hidden />
        <div aria-hidden className="bw-hero-back" style={{ borderRadius: radius }} />
        <div aria-hidden className="bw-hero-floor" style={{ borderRadius: `0 0 ${radius}px ${radius}px` }} />
        {/* Ambient decor for the look he wears: snow for Christmas, glints for a party (never takes a tap). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
          <AmbientFx kind={ambientFor(BEAMY_LOOKS[lookIx]?.id)} reduced={reduced} className="block h-full w-full" />
        </div>
        {wideHero ? (
          <div ref={heroGridRef} className={`relative grid h-full items-center gap-6 px-[clamp(28px,3.4vw,64px)] ${vp.w < 1280 ? 'grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1.36fr)_minmax(0,0.74fr)_minmax(0,1.1fr)]'}`}>
            <div data-card-avoid data-bubble-left className={`relative z-10 flex flex-col ${showContent ? 'bw-rise' : 'invisible'}`}>
              {heroHeadline}
              {heroCtas}
            </div>
            <div className="relative h-full">
              {/* His box is wider than the column (his arms reach over the
                  gaps), so he can stand big without squeezing the copy. */}
              {slot('absolute bottom-[clamp(72px,10vh,112px)] left-[-34%] right-[-16%] h-[78%]', { max: Math.min(400, vp.h * 0.44) }, heroSlotChildren)}
            </div>
            <div ref={heroWallColRef} className={`flex h-full items-start justify-end ${showContent ? 'bw-rise' : 'invisible'}`}>
              <div data-bubble-right className="relative" style={{ ...i(2), marginTop: heroGeo?.wall?.top ?? 0, marginRight: heroGeo?.wall != null ? -40 : 0, width: heroGeo?.wall?.width ?? 'min(420px, 100%)', height: heroGeo?.wall?.height ?? 'auto' }}>{heroWall}</div>
            </div>
          </div>
        ) : (
          <div className="relative flex h-full flex-col px-4 pb-4 pt-4 sm:px-8">
            <div data-card-avoid className={`shrink-0 ${showContent ? 'bw-rise' : 'invisible'}`}>{heroHeadline}</div>
            {/* The wall fills the right ~60% of the row between the copy and the
                CTAs; Beamy stands lower left, just in front of its corner. */}
            <div ref={heroRegionRef} className={`relative mt-3 flex-1 ${phone ? 'min-h-[300px]' : 'min-h-[200px]'}`}>
              {/* Phones: a full-width wall from the top, Beamy standing in
                  front of its lower-left corner. Tablets: the wall fills the right ~60% and he
                  stands lower left, just in front of its corner. */}
              {phone ? (
                <div className={`absolute inset-x-0 top-0 ${showContent ? 'bw-rise' : 'invisible'}`} style={{ ...i(2), height: heroGeo?.stackWallH ?? '80%' }}>{heroWall}</div>
              ) : (
                <div className={`absolute bottom-0 right-0 top-0 w-[57%] ${showContent ? 'bw-rise' : 'invisible'}`} style={i(2)}>{heroWall}</div>
              )}
              {heroGeo?.stand != null && slot(
                'absolute bottom-0',
                { max: heroGeo.stand.h, bubble: false },
                heroSlotChildren,
                { left: heroGeo.stand.x - heroGeo.stand.h / 0.85 / 2, width: heroGeo.stand.h / 0.85, height: heroGeo.stand.h, bottom: 0 },
              )}
              {/* The floating bubble stays away from the hero here, so his
                  try-on line sits beside his head (phones) or over it, left
                  of the wall (tablets). */}
              {tryOn && active === 'hero' && heroGeo?.stand != null && (heroGeo.stackWallH !== undefined ? (
                <p
                  ref={lookCapRef}
                  aria-hidden
                  data-tail="left"
                  data-stack="true"
                  className="bw-bubble pointer-events-none absolute right-0 w-[44%] px-3 py-2 text-[13px] leading-[1.35]"
                  style={{ bottom: heroGeo.stand.h * 0.56 }}
                >{line}</p>
              ) : (
                <p
                  ref={lookCapRef}
                  aria-hidden
                  data-tail="down"
                  className="bw-bubble pointer-events-none absolute left-0 w-[41%] px-3 py-2 text-[13px] leading-[1.35]"
                  style={{ bottom: heroGeo.stand.h * 1.04 + 10, '--tail-x': `${clamp(heroGeo.stand.x, 22, 120)}px` } as CSSProperties}
                >{line}</p>
              ))}
            </div>
            <div className={`mt-4 shrink-0 ${showContent ? 'bw-rise' : 'invisible'}`}>{heroCtas}</div>
          </div>
        )}
        {/* The front pane: a crisp rim and a soft sheen that slides with the pointer. */}
        <div aria-hidden className="bw-hero-front" style={{ borderRadius: radius }} />
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
  useStoryPager(scrollerRef, storyRef, headerRef, n, reducedRef);
  // Phones and portrait tablets stack the scene above him; wide screens set it round him.
  const stacked = phone || vp.w < WIDE_HERO_MIN;
  const storyIds = STORY_STEPS.map((s) => s.id);
  /** His slot in the story. */
  // Phones: on the AR step he steps up under the picker so his frame fills the
  // screen with no dead band (wide screens keep him where he stands). A
  // layout marker only: it never takes a tap (the frames carousel sits on it).
  const storySlotCls = `${stacked ? 'left-[15%] right-[15%] h-[46%]' : 'bottom-[3%] left-[30%] right-[30%] h-[58%]'} ${
    stacked ? (inStoryAR ? 'bottom-[11%]' : 'bottom-[1%]') : ''} pointer-events-none transition-[bottom] duration-700 ease-out`;
  const qrUrl = demoQrUrl(window.location.origin, A.demoEventSlug ?? 'demo');
  const storyDots = (
    <div className="bw-cap-dots" role="group" aria-label="Steps">
      {STORY_STEPS.map((s, k) => (
        <button key={s.id} type="button" aria-label={`Step ${k + 1}: ${s.title}`} aria-current={k === step ? 'step' : undefined} onClick={() => goStep(k)}><span /></button>
      ))}
    </div>
  );
  const storyCaption = (
    <div className={`bw-glass-card bw-pane ${stacked ? 'px-4 pb-3 pt-1.5' : 'w-[min(420px,34vw)] px-6 pb-2.5 pt-5'}`}>
      {/* Phones: the eyebrow and the step dots share one header row (a shorter card). */}
      <div className={stacked ? 'flex items-center justify-between gap-2' : ''}>
        <p className={`bw-eyebrow after:hidden ${stacked ? 'text-[12px]' : ''}`}>{STORY_COPY.eyebrow}</p>
        {stacked && <div className="-mr-2">{storyDots}</div>}
      </div>
      <h2 id="h-story" className="sr-only">{STORY_COPY.heading}</h2>
      {/* Every step stays in the document; only the active one shows. */}
      <ol className={`bw-cap-steps ${stacked ? 'mt-0.5' : 'mt-2.5'}`}>
        {STORY_STEPS.map((s, k) => (
          <li key={s.id} data-active={k === step ? 'true' : 'false'}>
            <div className={`flex items-center ${stacked ? 'gap-2.5' : 'gap-3'}`}>
              <span className="bw-story-num" aria-hidden>{String(k + 1).padStart(2, '0')}</span>
              <h3 className={`bw-h3 min-w-0 ${stacked ? 'text-[17px] leading-tight' : ''}`}>{s.title}</h3>
            </div>
            <p className={`bw-small ${stacked ? 'mt-1 text-[13px] leading-snug' : 'mt-1.5 pl-12'}`}>{s.body}</p>
          </li>
        ))}
      </ol>
      {!stacked && <div className="mt-2 pl-12">{storyDots}</div>}
    </div>
  );
  const storyScenes = (
    <>
      <StoryScenes step={step} live={active === 'story'} ids={storyIds} stacked={stacked} qrUrl={qrUrl} wallCentreRef={storyWallRef} seed={seed} beamyAt={beamyAt} onCue={onCue} />
      <ArPicker looks={AR_LOOKS} sel={arSel} tab={arTab} onTab={tabAr} onWear={wearAr} active={inStoryAR} stacked={stacked} carRef={arCarRef} fx={arFxKind} reduced={reduced} />
    </>
  );
  const story = (
    <section ref={storyRef} id="how" data-stop="story" aria-labelledby="h-story" className="bw-sec relative" style={{ height: `${storyHeightVh(n, phone)}vh` }}>
      {/* Touch screens: the story pager (useStoryPager) settles every swipe on one step. */}
      <div className="sticky overflow-hidden" style={{ top: 'var(--bw-header-h)', height: 'calc(100svh - var(--bw-header-h))' }}>
        {stacked ? (
          <div className="flex h-full flex-col px-4 pb-3 pt-3 sm:px-8">
            <div className="relative z-10 mx-auto w-full max-w-[560px] shrink-0">{storyCaption}</div>
            {/* The scene rises above his head; he stands big below it. */}
            <div className="relative mx-auto mt-3 min-h-0 w-full max-w-[640px] flex-1">
              {storyScenes}
              <div data-slot="story" data-bubble="none" aria-hidden className={`absolute ${storySlotCls}`} />
            </div>
          </div>
        ) : (
          <div className="relative mx-auto h-full max-w-[1480px]">
            {storyScenes}
            {/* Big and centred; the scene stands on both sides of him and above. */}
            <div data-slot="story" data-bubble="none" aria-hidden className={`absolute ${storySlotCls}`} />
            <div className="absolute left-[clamp(24px,4vw,64px)] top-[clamp(16px,3.5vh,36px)] z-10">
              {storyCaption}
              {/* The AR step's switcher, right under the card (phones: ArPicker puts it above him). */}
              <div className="bw-ar-tabs-under" data-on={inStoryAR ? 'true' : 'false'} inert={!inStoryAR}>
                <ArTabs sel={arSel} tab={arTab} onTab={tabAr} />
              </div>
            </div>
          </div>
        )}
      </div>
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
          {/* He beams the options in, one after another, when he gets here. */}
          <div ref={pickGridRef} className={`bw-beam-group mt-7 grid gap-3 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`} data-beam={pickOn ? 'lit' : 'wait'}>
            {AUDIENCES.map((a, k) => {
              const Icon = AUDIENCE_ICONS[a.icon];
              const on = selectedId === a.id;
              return (
                <div key={a.id} className="bw-beam-in" style={{ ['--k' as string]: k }}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={(e) => { void pickAudience(a, e.currentTarget); }}
                  className={`bw-in bw-glass-card bw-pane bw-interactive flex w-full items-center gap-4 ${phone ? 'min-h-[64px] px-4 py-3' : 'min-h-[84px] p-4'}`}
                  style={i(k)}
                >
                  <span className="bw-icon-tile" aria-hidden><Icon /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{a.title}</span>
                    <span className="bw-label mt-0.5 block">{a.hint}</span>
                  </span>
                  {on && <Check className="h-5 w-5 shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-ink)' }} aria-hidden />}
                </button>
                </div>
              );
            })}
          </div>
        </>
      ))}
    </section>
  );

  /* ── Try it ────────────────────────────────────────────────────────── */
  const tryWall = (
    // Flat, no pointer tilt: angled, this wall read as squished (owner, 2026-11-23).
    <div ref={tryWallRef} className="bw-wall-mount" style={{ transform: 'none' }}>
      <LiveWall pool={PHOTO_POOL} pins={shotPins} dim={false} compact={phone} centreRef={tryTileRef} ripple={0} seed={seed + 7} />
    </div>
  );
  // Wider than the other sections and higher up: the phone sits far left, the wall far right.
  const tryClass = `bw-sec relative mx-auto w-full max-w-[1440px] ${phone ? 'px-5 pb-14 pt-10' : 'px-[clamp(32px,4vw,72px)] pb-[clamp(64px,10vh,120px)] pt-[clamp(36px,6vh,72px)]'}`;
  const tryIt = (
    <section id="demo" data-stop="try" aria-labelledby="h-try" className={tryClass}>
      <div className={`bw-in ${phone ? '' : 'flex flex-wrap items-end justify-between gap-x-8 gap-y-4'}`}>
        <div>
          <h2 id="h-try" className="bw-h2">{TRY_COPY.heading}</h2>
          <p className="bw-body mt-2 max-w-[46ch]">{TRY_COPY.line}</p>
        </div>
        <div className={phone ? 'mt-4' : ''}>{lookPills}</div>
      </div>
      {phone ? (
        // Phones: stacked like the original demo. The booth phone first, as
        // big as the screen allows; below it Beamy stands on top of a
        // full-width wall. A shot scrolls Beamy and the wall up into view,
        // leaves the phone, and he beams it down onto the wall.
        <div className="mt-5 flex flex-col">
          <div className="bw-in mx-auto" style={{ height: 'min(70svh, calc((100vw - 40px) * 16 / 9))' }}>{booth}</div>
          <div data-slot="try" data-yaw="0" data-bubble="none" aria-hidden className="mt-4 h-[26svh] w-full" />
          <div className="bw-in -mt-1.5" style={i(1)}>{tryWall}</div>
        </div>
      ) : (
        <div className={`mt-6 flex items-stretch justify-between gap-[clamp(12px,2vw,32px)] ${vp.w >= WIDE_HERO_MIN ? 'h-[min(700px,74vh)]' : 'h-[min(480px,58vh)]'}`}>
          <div className="bw-in min-h-0">{booth}</div>
          <div className="flex w-[clamp(140px,19vw,320px)] shrink-0 flex-col justify-end">
            <div data-slot="try" data-max="340" aria-hidden className="relative h-[80%] min-h-0 w-full" />
          </div>
          <div className="bw-in flex min-h-0 items-center" style={i(1)}>
            <div style={{ width: 'min(506px, 37vw)' }}>{tryWall}</div>
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
            <p className="bw-small mt-2 max-w-[56ch]">{pricing.fairUse}</p>
          </div>
          <div className={`mt-10 grid gap-x-4 gap-y-6 ${planCols}`}>
            {plans.map((t, k) => (
              <div key={t.name} className="bw-in bw-glass-card bw-pane bw-plan flex flex-col p-6" style={i(k)} data-popular={t.popular === true ? 'true' : undefined}>
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
                <Link to={SIGNUP_PATH} className={`bw-btn mt-6 w-full ${t.popular === true ? 'bw-btn-glow' : 'bw-btn-glass'}`}>{ctaFace(pricing.cta(t.name))}</Link>
              </div>
            ))}
          </div>
        </>
      ))}
    </section>
  );

  /* ── Start + footer ────────────────────────────────────────────────── */
  const startCta = (
    <div className={`bw-in relative mx-auto flex max-w-[640px] flex-col items-center ${phone ? 'px-5 py-9' : 'px-10 py-12'}`}>
      {/* The hero's glass pane, holding the close. */}
      <div className="bw-glass" aria-hidden style={{ borderRadius: phone ? 24 : 32 }} />
      <h2 id="h-start" className="bw-display relative">{start.heading}</h2>
      <p className="bw-body relative mt-3 max-w-[42ch]">{start.line}</p>
      <ul className="relative mt-5 flex flex-col items-center gap-2.5">
        {start.bullets.map((b) => (
          <li key={b} className="flex items-center gap-3 text-[16px]" style={{ color: 'var(--bw-ink)' }}>
            <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-success)' }} aria-hidden /> {b}
          </li>
        ))}
      </ul>
      <Link to={SIGNUP_PATH} className="bw-btn bw-btn-glow bw-btn-lg mt-8">{ctaFace(HERO.primary)}</Link>
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
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,600px)_minmax(0,1fr)] items-center gap-[clamp(24px,3vw,48px)]">
          <div className="flex justify-start">{stand('start', 0.38, 'h-[min(380px,46vh)] w-full max-w-[260px]')}</div>
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

  return (
    <div
      data-brand="2"
      {...motionAttrs(reduced)}
      data-arrival={arrival}
      data-stop-active={active}
      ref={scrollerRef}
      onClick={onRootClick}
      onPointerMove={onRootHover}
      tabIndex={-1}
      className="bw-root bw-scroll relative h-full overflow-y-auto overflow-x-clip"
      style={{ outline: 'none', ['--bw-header-h' as string]: `${headerH}px` }}
    >
      <div aria-hidden className="bw-backdrop" ref={backdropRef}>
        {/* The journey: a midnight field with faint violet / indigo / teal
            glows, deepest mid-page, lifting a little at the hero and the close
            (--bw-night-mix 0..1, blended per frame like the slots). */}
        <div className="bw-night">
          <span className="bw-night-glow bw-night-violet" />
          <span className="bw-night-glow bw-night-indigo" />
          <span className="bw-night-glow bw-night-teal" />
        </div>
        {/* Colour over the whole journey: cool and warm washes plus four soft
            glows that drift apart with the scroll (brand.css .bw-hues). */}
        <div className="bw-hues">
          <span className="bw-hue bw-hue-teal" />
          <span className="bw-hue bw-hue-lilac" />
          <span className="bw-hue bw-hue-rose" />
          <span className="bw-hue bw-hue-amber" />
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
          frameRef={stageFrame}
          sceneProps={A.sceneProps}
          startHidden
          reducedMotion={reduced}
          onReady={() => { logStep('model:ready'); setReady(true); }}
          onError={() => { logStep('model:failed'); setFailed(true); }}
        >
          <StoryFx fxRef={fxRef} lite={phone} reduced={reduced} />
        </BeamyStage>
      )}

      {/* Padding, not margin: a margin would collapse through the sticky
          header and let the pill ride up against the viewport's top edge. */}
      <header ref={headerRef} className={`pointer-events-none sticky top-0 z-30 ${phone ? 'pt-2' : 'pt-3'}`} style={{ height: headerH }}>
        <div className={`bw-navpill pointer-events-auto relative mx-auto flex items-center justify-between gap-3 ${phone ? 'h-[52px] w-[calc(100%-20px)] pl-3 pr-1.5' : 'h-[60px] w-[min(1080px,calc(100%-48px))] pl-5 pr-2'}`}>
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
            <Link to={SIGNUP_PATH} className="bw-btn bw-btn-glow bw-btn-sm">{ctaFace(phone ? HERO.primaryShort : HERO.primary)}</Link>
          </nav>
          {/* Scroll progress: a hairline along the pill's lower edge. */}
          <div aria-hidden className="bw-progress"><span ref={progressRef} /></div>
        </div>
      </header>

      <main ref={mainRef} className="relative z-10">
        {hero}
        {story}
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
        <span className="sr-only">{srLine}</span>
        <span aria-hidden>{typed}</span>
      </div>
      {ready && (
        <button
          ref={hitRef}
          type="button"
          onClick={onPoke}
          data-beamy-hit
          aria-label="Tap Beamy"
          className="bw-focus pointer-events-none fixed left-0 top-0 z-[45] rounded-full"
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
