/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /beamy — the candidate landing in brand v2 (noindex while the owner reacts
 * to it; `/` is untouched). ONE viewport, six stops moved through one at a
 * time — never a document scroll:
 *
 *   intro → What applies to you? → Try it (the real booth) → 3D magic →
 *   How it works → Start
 *
 * The scene is "liquid glass": a soft periwinkle field, and every stop's
 * content (nav and progress bar included) inside ONE frosted glass panel.
 * Beamy lives in BeamyStage's full-viewport canvas above the page, with a few
 * faceted crystals around the panel. Each stop renders an empty
 * `[data-beamy-slot]` box where he should stand; a layout effect measures it
 * (and the panel), so his home, size, the floor line and the crystals come
 * from the DOM, never from magic numbers.
 *
 * The intro (first visit per session): the panel fades in with the live wall
 * already cycling dimly; a beam drops onto the floor and Beamy lands; he
 * takes a selfie (the GLB's `Selfie` clip, on the main stage); the photo card
 * pops out and rides a beam to the wall's centre tile, which holds it for a
 * while with a ripple through its neighbours. The copy and CTAs are up within
 * ~250ms and usable throughout; any click skips the rest. Reduced motion: he
 * is simply there and his portrait fades into the centre tile.
 *
 * Choreographies are async scripts against BeamyApi. Each run takes a token;
 * moving to another stop bumps it and every await re-checks it, so a script
 * left behind by a fast tapper stops instead of fighting the new one.
 *
 * Nothing a visitor captures leaves the device: the wall is component state.
 * Tokens/components come from src/styles/brand.css, scoped by data-brand="2".
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
  type HTMLAttributes, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Briefcase, Cake, CalendarPlus, Camera, Check, ClipboardList, Gift, Link2, Lock,
  Palette, RotateCcw, Rotate3d, Users, type LucideIcon,
} from 'lucide-react';
import CameraExperience, { lookFrameUrl } from '../../components/landing/CameraExperience';
import ParticleBeam from '../../components/landing/ParticleBeam';
import ReportIssueButton from '../../components/support/ReportIssueButton';
import { SELFIE_CARD_FACE_STYLE, SELFIE_CARD_STYLE, flashGradient } from '../../components/beamy/selfieFx';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';
import { salesImage } from '../sales/salesImages';
import { HERO_SLOT_IMAGES } from '../../lib/landingAssets';
import type { Rect } from '../../lib/beamGeometry';
import type { BoxRoom } from '../../lib/beamyBox';
import { REDUCED_GLIDE_S, flashOpacity, photoState } from '../../lib/beamySelfie';
import { SHOT_TILES, WALL_CENTRE, initialWall, nextSwap, rippleRings, swapDelay, type WallState } from '../../lib/beamyWall';
import {
  AUDIENCES, DELIVER_STEPS, DONE_FOR_YOU, GREETING, HELLO, POKE_LINES, audienceById,
  type Audience, type AudienceIcon, type StepIcon,
} from '../../lib/beamyTour';
import {
  FOOTER_LINKS, HERO, HOW_COPY, LOOKS, MAGIC_COPY, NAV_LINKS, PICK_COPY, POKE_IDLE, PRICING_PATH, SECTIONS, SIGNUP_PATH,
  START_COPY, TRY_COPY, WALL_LABEL, WHEEL_IDLE, createReactionPicker, keyToNav, navigate, pickCelebration, pokeStep,
  releaseVelocity, sectionIndex, seededRandom, startFacts, swipeDecision, wheelDecision,
  type Celebration, type Nav, type Reaction, type SectionId,
} from '../../lib/brandLanding';
import BeamyStage, { type BeamyApi, type BeamyClip, type Pt, type StageDecor, type StageLayout } from './BeamyStage';

const WALL_SEED = ['event-wedding', 'event-birthday', 'event-gala', 'event-activation', 'event-conference', 'hero-wall', 'event-tradeshow'];
/** The wall's photos: the landing's hero-carousel illustrations + the event cards (13, so 4 spares). */
const WALL_POOL = [...HERO_SLOT_IMAGES, ...WALL_SEED.map((k) => salesImage(k)?.src ?? '')].filter((s) => s !== '');
/** The beam's calm palette for the photo dissolve (palette[0] tints the core). */
const BEAM_PALETTE = ['#C9CCFF', '#FFFFFF', '#A5ABFF', '#FFC56B'];
const AUDIENCE_ICONS: Record<AudienceIcon, LucideIcon> = { ClipboardList, Cake, Users, Briefcase, Gift };
const STEP_ICONS: Record<StepIcon, LucideIcon> = { CalendarPlus, Palette, Link2 };
/** Skipping the picker tours as the most common host. */
const DEFAULT_AUDIENCE = audienceById('family') ?? AUDIENCES[0];
/** Room above Beamy's head kept free for his speech bubble. */
const BUBBLE_ROOM = 76;
const LEAVE_MS = 300;
/** How long the centre tile holds Beamy's selfie before it rejoins the rotation. */
const SELFIE_HOLD_MS = 12000;
const FLOOR_STOPS: SectionId[] = ['pick', 'magic', 'how', 'start'];

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
const sameRect = (a: Rect | null, b: Rect) => a !== null && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

/** The scroll container an event started in, if it can still scroll that way. */
function scrollsInside(target: EventTarget | null, root: Element | null, dy: number): boolean {
  let el = target instanceof Element ? target : null;
  while (el !== null && el !== root) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
        if (dy < 0 && el.scrollTop > 0) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

interface Flight { from: Rect; to: Rect; shot: string; ms: number; onDone: () => void; key: number; }
interface Pin { src: string; key: string; mine: boolean; }

export default function BeamyPage() {
  usePageTitle('Beamwall · Your immersive photo booth');
  useNoIndex();

  const vp = useViewport();
  const desktop = vp.w >= 1024;
  const reduced = useReducedMotion();

  const [index, setIndex] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('s');
    const i = SECTIONS.findIndex((s) => s.id === q);
    return i < 0 ? 0 : i;
  });
  const [shownIndex, setShownIndex] = useState(index);
  const [leaving, setLeaving] = useState(false);
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
  const [slotBox, setSlotBox] = useState<Rect | null>(null);
  const [floorTop, setFloorTop] = useState<number | null>(null);
  /** Beamy's x across the panel (%), where the floor's pool of light sits. */
  const [stageX, setStageX] = useState(50);
  /** The Try stop's booth·Beamy·wall row width, so its header lines up with it. */
  const [tryRowW, setTryRowW] = useState<number | null>(null);
  const [introRunning, setIntroRunning] = useState(false);
  const [heroPin, setHeroPin] = useState<Pin | null>(null);
  const [ripple, setRipple] = useState(0);

  const audience = picked ?? DEFAULT_AUDIENCE;
  const section: SectionId = SECTIONS[shownIndex].id;

  const api = useRef<BeamyApi | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hitRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const glassRef = useRef<HTMLDivElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  /** The centre tile of whichever wall is on screen (the beam's landing spot). */
  const centreTileRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardImgRef = useRef<HTMLImageElement | null>(null);
  /** A snapped selfie that has not reached the wall yet (a skip lands it at once). */
  const pendingSelfie = useRef<string | null>(null);
  const token = useRef(0);
  const nextShot = useRef(1);
  const flightKey = useRef(0);
  const pinTimer = useRef(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const sectionRef = useRef(section);
  sectionRef.current = section;
  /** The intro has played (or been skipped) in THIS page view: every full load plays it. */
  const introSeen = useRef(false);
  const layoutRef = useRef<StageLayout>({ home: { x: vp.w / 2, y: vp.h * 0.4 }, heightPx: 180 });
  const decorRef = useRef<StageDecor>({ panel: null, hero: section === 'intro', phone: !desktop });
  const seed = useMemo(() => {
    const q = Number(new URLSearchParams(window.location.search).get('seed'));
    return Number.isFinite(q) && q > 0 ? q : (Date.now() & 0xffff) + 1;
  }, []);
  const react = useRef(createReactionPicker(seed));
  const lastCelebration = useRef<Celebration | null>(null);
  const poke = useRef(POKE_IDLE);
  const wheel = useRef(WHEEL_IDLE);
  const drag = useRef<{ id: number; x0: number; y0: number; dragging: boolean; samples: { x: number; t: number }[]; suppressClick: boolean } | null>(null);

  const typed = useTyped(line, reduced);
  /* The hero copy never waits for the model or the choreography. */
  useEffect(() => { const id = window.setTimeout(() => setCopyIn(true), 250); return () => window.clearTimeout(id); }, []);
  const showContent = copyIn || failed || slowModel || reduced;

  /* Beamy's home + size from the current stop's slot box; the panel feeds
     the crystals and the floor line. */
  const measure = useCallback(() => {
    const pr = rectOf(panelRef.current);
    decorRef.current = { panel: pr, hero: sectionRef.current === 'intro', phone: !desktop };
    const el = mainRef.current?.querySelector<HTMLElement>('[data-beamy-slot]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const room = el.dataset.bubble === 'none' ? 0 : BUBBLE_ROOM;
    const capAttr = el.dataset.max;
    const cap = capAttr !== undefined ? Number(capAttr) : (desktop ? 300 : 200);
    const heightPx = Math.max(96, Math.min(r.height - room, r.width * 0.9, cap));
    // The glass box Beamy stands in: between the things beside him (the same
    // fences the bubble uses), never past the panel, never over the copy.
    let boxRoom: BoxRoom | null = null;
    if (pr !== null) {
      const root = mainRef.current;
      const lEl = desktop ? root?.querySelector('[data-bubble-left]') ?? null : null;
      const rEl = desktop ? root?.querySelector('[data-bubble-right]') ?? null : null;
      const inset = desktop ? 16 : 12;
      const left = lEl !== null ? lEl.getBoundingClientRect().right + 10 : pr.left + inset;
      const right = rEl !== null ? rEl.getBoundingClientRect().left - 10 : pr.left + pr.width - inset;
      const bottom = desktop
        ? Math.max(r.bottom + 4, Math.min(r.bottom + heightPx * 0.18, pr.top + pr.height - 80))
        : r.bottom + 6;
      boxRoom = { left: Math.max(left, pr.left + inset), top: r.top, right: Math.min(right, pr.left + pr.width - inset), bottom };
    }
    layoutRef.current = { home: { x: r.left + r.width / 2, y: r.bottom }, heightPx, room: boxRoom };
    const box = { left: r.left, top: r.top, width: r.width, height: r.height };
    setSlotBox((prev) => (sameRect(prev, box) ? prev : box));
    if (pr !== null) {
      const top = Math.round(r.bottom - pr.top - heightPx * 0.16);
      setFloorTop((prev) => (prev === top ? prev : top));
      const sx = Math.round(((r.left + r.width / 2 - pr.left) / Math.max(1, pr.width)) * 100);
      setStageX((prev) => (prev === sx ? prev : sx));
    }
    // Fence the speech bubble between the things beside Beamy it must never
    // cover (marked data-bubble-left / data-bubble-right); BeamyStage clamps
    // to it. Phones stack Beamy above the content, so no fence there.
    const bub = bubbleRef.current;
    if (bub !== null) {
      const root = mainRef.current;
      const lEl = desktop ? root?.querySelector('[data-bubble-left]') ?? null : null;
      const rEl = desktop ? root?.querySelector('[data-bubble-right]') ?? null : null;
      const lo = lEl !== null ? Math.round(lEl.getBoundingClientRect().right + 10) : null;
      const hi = rEl !== null ? Math.round(rEl.getBoundingClientRect().left - 10) : null;
      const span = (hi ?? window.innerWidth - 12) - (lo ?? 12);
      const fenced = (lo !== null || hi !== null) && span >= 160;
      if (fenced && lo !== null) bub.dataset.minX = String(lo); else delete bub.dataset.minX;
      if (fenced && hi !== null) bub.dataset.maxX = String(hi); else delete bub.dataset.maxX;
      bub.style.maxWidth = fenced ? `${Math.min(300, span)}px` : '';
    }
    const row = desktop ? mainRef.current?.querySelector<HTMLElement>('[data-try-row]') ?? null : null;
    const first = row?.firstElementChild ?? null;
    const last = row?.lastElementChild ?? null;
    const rw = first !== null && last !== null ? Math.round(last.getBoundingClientRect().right - first.getBoundingClientRect().left) : null;
    setTryRowW((prev) => (prev === rw ? prev : rw));
  }, [desktop]);
  useLayoutEffect(() => { measure(); }, [measure, shownIndex, vp.w, vp.h]);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (mainRef.current) ro.observe(mainRef.current);
    // The slot itself can resize without main changing (the display face
    // swapping in reflows the copy beside it), so watch it too.
    const slotEl = mainRef.current?.querySelector<HTMLElement>('[data-beamy-slot]');
    if (slotEl) ro.observe(slotEl);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    return () => { live = false; ro.disconnect(); };
  }, [measure, shownIndex]);

  const begin = useCallback(() => {
    const mine = ++token.current;
    return () => token.current === mine;
  }, []);
  const say = (t: string) => setLine(t);

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
  const landSelfie = useCallback((src: string) => {
    pendingSelfie.current = null;
    logStep(`selfie:land:${sectionRef.current}`);
    if (sectionRef.current === 'try') {
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
    const tile = rectOf(centreTileRef.current);
    if (tile === null) { pendingSelfie.current = null; return; }
    // Reduced motion: the same trip, as a slow glide (no particles).
    logStep(`selfie:flight:${reduced ? 'glide' : 'particles'}`);
    setFlight({
      key: ++flightKey.current, from, to: tile, shot: photo, ms: reduced ? REDUCED_GLIDE_S * 1000 : 1250,
      onDone: () => { setFlight(null); landSelfie(photo); },
    });
  }, [landSelfie, reduced]);

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
      // Never across the copy (phones stack Beamy right under the subline):
      // if the card's column meets the copy block, it pops no higher than
      // just below it (0.62 = half its height plus the pop's overshoot).
      const copy = rectOf(document.querySelector('[data-card-avoid]'));
      if (copy !== null && x + cw / 2 > copy.left && x - cw / 2 < copy.left + copy.width) y = Math.max(y, copy.top + copy.height + ch * 0.62 + 4);
      if (f.t >= f.tl.photo.flightStart) {
        // Hand the card to the beam: it dissolves and rides across to the
        // wall. A slow device can skip the card's whole visible window in
        // one frame, so launch from wherever it would be now in that case.
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
    // false = no Selfie clip in the GLB, or the clip was stopped/replaced early.
    if (!played) logStep('selfie:stopped');
    if (!launched) hideSelfieFx();
  }, [hideSelfieFx, launchSelfie]);

  /* ── Entrance: beam drops, Beamy lands, takes a selfie, beams it to the wall ── */
  useEffect(() => {
    if (!ready) return;
    const b = api.current;
    if (b === null) return;
    // Every full load plays it, for every motion preference: this IS the
    // page's content. Reduced motion gets the gentle variants (a soft column
    // instead of a falling beam and flash, a glide instead of particles).
    setArrival('dropping');
    logStep(`arrive:start:${reduced ? 'soft' : 'full'}`);
    const alive = begin();
    const onIntro = indexRef.current === 0;
    if (onIntro) setIntroRunning(true);
    void (async () => {
      await b.arrive();
      logStep('arrive:landed');
      setArrival('done');
      if (!alive() || indexRef.current !== 0) { setIntroRunning(false); return; }
      say(HELLO);
      await runSelfie(alive);
      if (alive()) { introSeen.current = true; logStep('intro:done'); }
      setIntroRunning(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the model is in
  }, [ready]);
  useEffect(() => {
    const id = window.setTimeout(() => setSlowModel(true), 4000);
    return () => window.clearTimeout(id);
  }, []);

  /* Only the Skip chip (or leaving the stop) skips the intro: a stray click
     anywhere no longer cancels the page's main moment. */
  const skipIntro = useCallback(() => {
    logStep('intro:skip');
    begin();
    const b = api.current;
    b?.skipArrival();
    b?.stopSelfie();
    hideSelfieFx();
    setArrival('done');
    setIntroRunning(false);
    introSeen.current = true;
    const p = pendingSelfie.current;
    if (p !== null && sectionRef.current === 'intro') landSelfie(p);
  }, [begin, hideSelfieFx, landSelfie]);

  /* ── Section navigation ───────────────────────────────────────────── */
  const lineFor = useCallback((id: SectionId, a: Audience): string => {
    switch (id) {
      case 'intro': return HELLO;
      case 'pick': return GREETING;
      case 'try': return a.lines.snap;
      case 'magic': return a.lines.prop;
      case 'how': return a.lines.deliver;
      case 'start': return a.lines.go;
    }
  }, []);

  const goToIndex = useCallback((to: number) => {
    const from = indexRef.current;
    if (to === from) return;
    begin();
    api.current?.clearProp();
    setIndex(to);
    indexRef.current = to;
    setLeaving(true);
    window.setTimeout(() => {
      setShownIndex(to);
      setLeaving(false);
    }, reduced ? 120 : LEAVE_MS);
  }, [begin, reduced]);

  const nav = useCallback((n: Nav) => goToIndex(navigate(indexRef.current, n)), [goToIndex]);

  /* Entering a section: its line, camera off elsewhere, focus its heading. */
  useEffect(() => {
    if (leaving) return;
    if (section !== 'try') setCameraOn(false);
    if (section !== 'intro') setDragHint(false);
    say(lineFor(section, audience));
    const h = mainRef.current?.querySelector<HTMLElement>('[data-section-heading]');
    if (h && document.activeElement !== h && shownIndex !== 0) h.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per section entry
  }, [shownIndex, leaving]);

  /* Keys, wheel, swipe. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const onControl = t !== null && t.closest('button, a, [role="button"]') !== null;
      const n = keyToNav(e.key, inField, onControl);
      if (n === null || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      nav(n);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      if (scrollsInside(e.target, mainRef.current, e.deltaY)) return;
      e.preventDefault();
      const r = wheelDecision(wheel.current, e.deltaY, performance.now());
      wheel.current = r.state;
      if (r.nav !== null) nav(r.nav);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('wheel', onWheel); };
  }, [nav]);

  const touch = useRef<{ x: number; y: number; t: number; target: EventTarget | null } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || (e.target as Element).closest('[data-noswipe]')) { touch.current = null; return; }
    touch.current = { x: t.clientX, y: t.clientY, t: performance.now(), target: e.target };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (s === null) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - s.y;
    if (scrollsInside(s.target, mainRef.current, -dy)) return;
    const n = swipeDecision(t.clientX - s.x, dy, performance.now() - s.t);
    if (n !== null) nav(n);
  };

  /* Gaze + crystal parallax + the glass sheen: the pointer on desktop; the
     last tap on touch (then back to you). */
  useEffect(() => {
    let clear = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      api.current?.look({ x: e.clientX, y: e.clientY });
      glassRef.current?.style.setProperty('--sheen-dx', `${(((e.clientX / Math.max(1, window.innerWidth)) - 0.5) * 36).toFixed(1)}%`);
      // The wall turns with the box; held still under reduced motion.
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        mainRef.current?.style.setProperty('--tilt-x', (((e.clientX / Math.max(1, window.innerWidth)) - 0.5) * 2).toFixed(3));
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      api.current?.look({ x: e.clientX, y: e.clientY });
      window.clearTimeout(clear);
      clear = window.setTimeout(() => api.current?.look(null), 1600);
    };
    const onLeave = () => api.current?.look(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.clearTimeout(clear);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  /* ── The pick: a varied reaction, the card changes as the light lands. ─ */
  const pickAudience = async (a: Audience, el: HTMLElement) => {
    const alive = begin();
    setPicked(a);
    setLook(a.kit);
    say(a.lines.intro);
    const b = api.current;
    const target = centre(rectOf(el) ?? { left: 0, top: 0, width: 0, height: 0 });
    const land = () => { if (alive()) setSelectedId(a.id); };
    if (b === null || reduced) {
      land();
      if (b !== null) void b.play('Wave');
    } else {
      const r = react.current('pick');
      if (r === 'handBeam') {
        await b.beam(target, land, 'hand');
      } else if (r === 'walk') {
        const box = el.getBoundingClientRect();
        await b.walkTo({ x: Math.max(60, box.left + 40), y: box.bottom - 4 }, desktop ? 0.45 : 0.6);
        if (!alive()) return;
        land();
        await b.play('Wave');
        if (!alive()) return;
        void b.goHome();
      } else {
        await b.drift(target);
        land();
      }
    }
    if (!alive()) return;
    await wait(reduced ? 700 : 1100);
    if (alive() && indexRef.current === sectionIndex('pick')) goToIndex(sectionIndex('try'));
  };

  /* ── The prop reveal (3D magic). ───────────────────────────────────── */
  /** The prop appears in the section's `[data-prop-spot]` box, beside Beamy. */
  const propSpot = (): { at: Pt; size: number } => {
    const L = layoutRef.current;
    const spot = rectOf(mainRef.current?.querySelector('[data-prop-spot]') ?? null);
    if (spot === null) return { at: { x: L.home.x + L.heightPx, y: L.home.y - L.heightPx * 0.62 }, size: L.heightPx * 0.6 };
    const size = Math.min(spot.width * 0.8, L.heightPx * 0.66);
    return { at: { x: spot.left + spot.width / 2, y: L.home.y - L.heightPx * 0.6 }, size };
  };

  const runReveal = async (a: Audience, alive: () => boolean) => {
    const b = api.current;
    if (b === null) return;
    setPropBusy(true);
    const { at, size } = propSpot();
    const r: Reaction = react.current('reveal');
    await b.reveal(a.prop.url, at, size, r === 'handSparks' ? 'hand' : 'mouth');
    setPropBusy(false);
    if (!alive()) return;
    say(`Ta-da! A ${a.prop.name.toLowerCase()}, tracked in 3D on every guest.`);
  };
  useEffect(() => {
    if (leaving || section !== 'magic' || !ready) return;
    const alive = begin();
    void (async () => { await wait(reduced ? 0 : 280); if (alive()) await runReveal(audience, alive); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per entry
  }, [section, leaving, ready]);

  /* ── The booth hands over a shot: Beamy catches it, then beams it. ─── */
  const onBeam = useCallback((src: string) => {
    const b = api.current;
    const vf = rectOf(viewfinderRef.current);
    const tile = rectOf(centreTileRef.current);
    logStep('try:shot');
    const commit = () => {
      logStep('try:land');
      setShots((prev) => [{ id: nextShot.current++, src }, ...prev].slice(0, SHOT_TILES.length));
      say('It’s on the wall! Every guest’s shot lands there, live.');
      celebrate();
    };
    if (b === null || vf === null || tile === null) { logStep('try:no-flight'); commit(); return; }
    if (reduced) {
      // Reduced motion: the shot still travels to the wall, as one slow glide.
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
    if (sectionRef.current === 'intro') {
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
      // The fourth poke in a streak earns a selfie, beamed to the wall if one is on screen.
      if (r.count === 3) void b.play('Wave');
      else void runSelfie(begin());
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

  /* ── Stops ─────────────────────────────────────────────────────────── */

  const slot = (extra = '', opts: { max?: number; bubble?: boolean } = {}) => (
    <div
      data-beamy-slot
      data-max={opts.max !== undefined ? String(Math.round(opts.max)) : undefined}
      data-bubble={opts.bubble === false ? 'none' : undefined}
      aria-hidden
      className={`relative min-h-0 ${extra}`}
    />
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
      data-noswipe={desktop ? undefined : true}
      className={`flex gap-2 ${desktop ? 'flex-wrap' : '-mx-4 flex-nowrap overflow-x-auto px-4 [scrollbar-width:none]'}`}
    >
      {LOOKS.map((l) => (
        <button key={l.label} type="button" className={`bw-glass-chip ${desktop ? '' : 'shrink-0 px-3'}`} aria-pressed={look === l.kit} onClick={() => setLook(l.kit)}>
          {l.label}
        </button>
      ))}
    </FadeScroll>
  );

  /* The booth: a phone at a natural phone aspect, in a slim deep frame. */
  const idleFrame = lookFrameUrl(look);
  const booth = (
    <div
      data-noswipe
      className={`relative overflow-hidden ${desktop ? 'aspect-[9/17] h-full rounded-[34px] p-[7px]' : 'aspect-[9/16] h-full rounded-[22px] p-[5px]'}`}
      style={{ background: 'var(--bw-deep-2)', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.25), 0 24px 50px -24px var(--bw-shadow)' }}
    >
      <div className={`relative h-full w-full overflow-hidden ${desktop ? 'rounded-[28px]' : 'rounded-[18px]'}`} style={{ background: 'var(--bw-deep)' }}>
        {cameraOn ? (
          <CameraExperience enabled videoId="beamy-booth-video" beamLabel="Beam it to the wall" onBeam={onBeam} look={look} screenRef={viewfinderRef} />
        ) : (
          <div className="relative h-full">
            {/* Before the camera: the selected look's frame over a soft
                screen glow, so each pill visibly changes the phone. */}
            <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(80% 55% at 50% 36%, #7A72EC 0%, #4A42C8 55%, #2B2A8C 100%)' }} />
            {idleFrame !== null && (
              <img key={idleFrame} src={idleFrame} alt="" aria-hidden draggable={false} data-look-preview className="absolute inset-0 h-full w-full object-cover" style={{ animation: reduced ? undefined : 'bw-fade 360ms var(--bw-ease) both' }} />
            )}
            <div aria-hidden className={`absolute inset-x-0 bottom-0 ${desktop ? 'h-[64%]' : 'h-[82%]'}`} style={{ background: desktop ? 'linear-gradient(to top, rgba(26,23,64,0.92) 0%, rgba(26,23,64,0.84) 52%, rgba(26,23,64,0) 100%)' : 'linear-gradient(to top, rgba(26,23,64,0.95) 0%, rgba(26,23,64,0.9) 62%, rgba(26,23,64,0) 100%)' }} />
            <div className={`relative flex h-full flex-col items-center justify-end text-center ${desktop ? 'gap-3 px-5 pb-7' : 'gap-2 px-2.5 pb-3'}`}>
              <span className="bw-icon-tile" aria-hidden><Camera /></span>
              <p className="bw-small max-w-[20ch]" style={{ color: 'var(--bw-ink)' }}>The real booth your guests open from a QR code.</p>
              <button type="button" className={`bw-btn bw-btn-primary bw-btn-sm ${desktop ? '' : 'h-auto w-full whitespace-normal px-3 py-2 leading-tight'}`} onClick={() => { setCameraOn(true); say('Smile! Pick a look, then tap the big button.'); }}>
                {TRY_COPY.start}
              </button>
              <p className="bw-label flex items-center gap-1.5" style={{ color: 'var(--bw-ink)' }}><Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden /> {TRY_COPY.privacy}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const heading = (text: string, cls = 'bw-h2') => (
    <h2 data-section-heading tabIndex={-1} className={`${cls} outline-none`}>{text}</h2>
  );

  const start = startFacts();
  const i = (n: number) => ({ ['--i' as string]: n });

  const heroCtas = (
    <div className={`flex gap-3 ${desktop ? 'mt-8 flex-wrap' : 'flex-col'}`} style={i(3)}>
      <Link to={SIGNUP_PATH} className={`bw-btn bw-btn-primary ${desktop ? 'bw-btn-lg' : 'w-full'}`}>{HERO.primary}</Link>
      <button type="button" className={`bw-btn bw-btn-secondary ${desktop ? 'bw-btn-lg' : 'w-full'}`} onClick={() => goToIndex(sectionIndex('try'))}>
        {HERO.secondary}
      </button>
    </div>
  );
  const heroHeadline = (
    <>
      <p className={`bw-eyebrow ${desktop ? '' : 'text-[14px] after:hidden'}`} style={i(0)}>{HERO.eyebrow}</p>
      <h1 data-section-heading tabIndex={-1} className={`bw-display outline-none ${desktop ? 'mt-6' : 'mt-2'}`} style={desktop ? { ...i(1), fontSize: 'clamp(40px, min(22px + 3vw, 7.4dvh), 76px)' } : i(1)}>
        <span className="bw-light block">{HERO.lead}</span>
        <span className="block">{HERO.strong}</span>
      </h1>
      <p className={`bw-body ${desktop ? 'mt-5 max-w-[34ch]' : 'mt-2 max-w-[36ch]'}`} style={i(2)}>{HERO.sub}</p>
    </>
  );

  let content: ReactNode = null;
  if (section === 'intro') {
    const wall = (
      <div className="bw-wall-mount" style={{ ['--wall-yaw' as string]: desktop ? '-9deg' : '-5deg' }}>
        <LiveWall
          pool={WALL_POOL}
          pins={heroPins}
          dim={introRunning}
          compact={!desktop}
          centreRef={centreTileRef}
          ripple={ripple}
          seed={seed}
        />
      </div>
    );
    content = desktop ? (
      <div className="relative grid h-full grid-cols-[minmax(0,1.36fr)_minmax(0,0.92fr)_minmax(0,0.86fr)] items-center gap-6 px-[clamp(28px,3.4vw,64px)]">
        <div data-card-avoid data-bubble-left className={`relative z-10 flex flex-col ${showContent ? 'bw-rise' : 'invisible'}`}>
          {heroHeadline}
          {heroCtas}
        </div>
        <div className="flex h-full flex-col justify-end pb-[5%]">
          {slot('h-[82%] w-full', { max: Math.min(410, vp.h * 0.45) })}
        </div>
        <div className={`flex justify-end ${showContent ? 'bw-rise' : 'invisible'}`}>
          <div data-bubble-right style={{ ...i(2), width: 'min(370px, 100%, calc((100dvh - 330px) * 0.74))' }}>{wall}</div>
        </div>
      </div>
    ) : (
      <div className="flex h-full flex-col px-4 pb-3 pt-1">
        <div data-card-avoid className={`shrink-0 ${showContent ? 'bw-rise' : 'invisible'}`}>{heroHeadline}</div>
        {vp.h >= 740 ? (
          // Tall phones: Beamy stands on the floor right above his wall, filling the height.
          <div className="mt-2 flex min-h-0 flex-1 flex-col items-center gap-3">
            {slot('min-h-0 w-full flex-1', { max: Math.min(230, vp.h * 0.27), bubble: false })}
            <div className="w-[64%] max-w-[250px] shrink-0">{wall}</div>
          </div>
        ) : (
          <div className="mt-3 flex min-h-0 flex-1 items-end gap-3">
            {slot('h-full min-w-0 flex-1', { max: Math.min(230, vp.h * 0.3), bubble: false })}
            <div className="mb-1 w-[46%] max-w-[200px] shrink-0">{wall}</div>
          </div>
        )}
        <div className={`mt-3 shrink-0 ${showContent ? 'bw-rise' : 'invisible'}`}>{heroCtas}</div>
      </div>
    );
  } else if (section === 'pick') {
    const cards = (
      <div className={`grid gap-3 ${desktop ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {AUDIENCES.map((a, n) => {
          const Icon = AUDIENCE_ICONS[a.icon];
          const on = selectedId === a.id;
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              onClick={(e) => { void pickAudience(a, e.currentTarget); }}
              className={`bw-glass-card bw-interactive flex items-center gap-4 ${desktop ? 'min-h-[84px] p-4' : 'min-h-[64px] px-4 py-3'}`}
              style={i(n + 2)}
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
    );
    content = (
      <Panel desktop={desktop} slot={slot('h-full w-full')}>
        <div className="bw-rise">
          <div style={i(0)}>{heading(PICK_COPY.heading)}</div>
          <p className="bw-body mt-2" style={i(1)}>{PICK_COPY.sub}</p>
          <div className="mt-6">{cards}</div>
        </div>
      </Panel>
    );
  } else if (section === 'try') {
    const wall = (
      <div className="bw-wall-mount" style={{ ['--wall-yaw' as string]: desktop ? '-6deg' : '-4deg' }}>
        <LiveWall pool={WALL_POOL} pins={shotPins} dim={false} compact={!desktop} centreRef={centreTileRef} ripple={0} seed={seed + 7} />
      </div>
    );
    content = desktop ? (
      <div className="mx-auto flex h-full w-full max-w-[1240px] flex-col px-[clamp(28px,3.4vw,64px)] pb-3">
        <div className="bw-rise mx-auto flex w-fit max-w-full shrink-0 flex-wrap items-end justify-between gap-x-8 gap-y-3" style={tryRowW !== null ? { minWidth: tryRowW } : undefined}>
          <div>
            <div style={i(0)}>{heading(TRY_COPY.heading)}</div>
            <p className="bw-body mt-2 max-w-[46ch]" style={i(1)}>{TRY_COPY.line}</p>
          </div>
          <div style={i(2)}>{lookPills}</div>
        </div>
        {/* Booth · Beamy · wall, all one height, centred: nothing reads empty. */}
        <div data-try-row className="mt-5 flex min-h-0 flex-1 items-stretch justify-center gap-[clamp(16px,2.4vw,40px)]">
          <div data-bubble-left className="bw-rise min-h-0"><div className="h-full" style={i(2)}>{booth}</div></div>
          <div className="flex w-[clamp(150px,13vw,210px)] shrink-0 flex-col justify-end">{slot('h-[72%] w-full', { max: 230 })}</div>
          <div className="bw-rise flex min-h-0 items-center">
            <div data-bubble-right style={{ ...i(3), width: 'min(380px, calc((100dvh - 330px) * 0.74))' }}>{wall}</div>
          </div>
        </div>
      </div>
    ) : (
      <div className="flex h-full flex-col">
        {/* Beamy alone in the band (the bubble needs the room above him);
            the phone booth and the wall sit side by side below, so the
            beam reads left-to-right like it does on desktop. */}
        <div className="flex h-[22%] min-h-[118px] shrink-0 px-4 pt-1">{slot('h-full flex-1')}</div>
        <div className="bw-rise flex min-h-0 flex-1 flex-col px-4 pb-3 pt-1">
          <div style={i(0)}>{heading(TRY_COPY.heading)}</div>
          <div className="mt-3" style={i(1)}>{lookPills}</div>
          <div className="mt-3 flex min-h-[200px] flex-1 items-center gap-3" style={i(2)}>
            {/* The booth may take ~56% of the row, so the wall stays readable beside it. */}
            <div className="shrink-0" style={{ height: 'min(100%, calc((100vw - 52px) * 0.56 * 16 / 9))' }}>{booth}</div>
            <div className="min-w-0 flex-1">{wall}</div>
          </div>
        </div>
      </div>
    );
  } else if (section === 'magic') {
    content = (
      <Panel desktop={desktop} slot={<div className="flex h-full w-full">{slot('h-full w-[56%]')}<div data-prop-spot aria-hidden className="h-full flex-1" /></div>}>
        <div className="bw-rise">
          <div style={i(0)}>{heading(MAGIC_COPY.heading)}</div>
          <p className="bw-body mt-3 max-w-[40ch]" style={i(1)}>{MAGIC_COPY.line}</p>
          <div className="mt-6 flex flex-wrap gap-3" style={i(2)}>
            <button type="button" className="bw-btn bw-btn-secondary" disabled={propBusy} onClick={() => { const alive = begin(); void runReveal(audience, alive); }}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden /> {MAGIC_COPY.again}
            </button>
            <button type="button" className="bw-link" onClick={() => goToIndex(sectionIndex('try'))}>
              Try it on <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </div>
      </Panel>
    );
  } else if (section === 'how') {
    content = (
      <Panel desktop={desktop} slot={slot('h-full w-full')}>
        <div className="bw-rise">
          <div style={i(0)}>{heading(HOW_COPY.heading)}</div>
          <ol className="mt-6 flex flex-col gap-3">
            {DELIVER_STEPS.map((d, n) => {
              const Icon = STEP_ICONS[d.icon];
              return (
                <li key={d.title} className="bw-glass-card flex items-start gap-4 p-4" style={i(n + 1)}>
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
          <p className="bw-small mt-5" style={i(4)}>{DONE_FOR_YOU}</p>
        </div>
      </Panel>
    );
  } else {
    content = (
      <Panel desktop={desktop} slot={slot('h-full w-full')}>
        <div className="bw-rise">
          <div style={i(0)}>{heading(start.heading, 'bw-display')}</div>
          <p className="bw-body mt-3 max-w-[42ch]" style={i(1)}>{start.line}</p>
          <ul className="mt-5 flex flex-col gap-2.5" style={i(2)}>
            {start.bullets.map((b) => (
              <li key={b} className="flex items-center gap-3 text-[16px]" style={{ color: 'var(--bw-ink)' }}>
                <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-success)' }} aria-hidden /> {b}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3" style={i(3)}>
            <Link to={SIGNUP_PATH} className="bw-btn bw-btn-primary bw-btn-lg">{HERO.primary}</Link>
            <Link to={PRICING_PATH} className="bw-link">{START_COPY.pricing} <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden /></Link>
          </div>
          <nav aria-label="Footer" className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1" style={i(4)}>
            {FOOTER_LINKS.map((f) => f.to !== null ? (
              <Link key={f.label} to={f.to} className="bw-link bw-link-quiet">{f.label}</Link>
            ) : (
              <ReportIssueButton key={f.label} label={f.label} showIcon={false} prefill={{ source: 'landing' }} className="bw-link bw-link-quiet" />
            ))}
          </nav>
        </div>
      </Panel>
    );
  }

  const atFirst = index === 0;
  const atLast = index === SECTIONS.length - 1;
  const panelInset = desktop ? clamp(Math.round(vp.w * 0.026), 20, 44) : 10;
  const radius = desktop ? 36 : 24;
  const showFloor = floorTop !== null && (section === 'intro' || (desktop && FLOOR_STOPS.includes(section)));
  const bubbleHidden = section === 'intro' && !desktop;

  return (
    <div data-brand="2" data-arrival={arrival} data-section={section} className="bw-root fixed inset-0 overflow-hidden">
      {/* Orbs behind the glass: whatever the panel covers, it visibly frosts. */}
      <div aria-hidden className="bw-orb" style={{ width: '36vmax', height: '36vmax', right: '-12vmax', top: '-14vmax', opacity: 0.45 }} />
      <div aria-hidden className="bw-orb" style={{ width: '26vmax', height: '26vmax', left: '-9vmax', bottom: '-11vmax', opacity: 0.45 }} />

      <div ref={panelRef} className="absolute" style={{ inset: panelInset, ['--bw-radius-panel' as string]: `${radius}px` }}>
        <div ref={glassRef} className="bw-glass" aria-hidden />
        {/* Decor clipped to the panel: the floor line and the ghost word. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
          {showFloor && <div className="bw-floor" style={{ top: floorTop ?? 0, ['--stage-x' as string]: `${stageX}%` }} />}
          {/* Lower-left, inside the floor: on the hero that corner holds no
              control (no Back button on the first stop) and sits under the CTAs. */}
          {section === 'intro' && desktop && !introRunning && (
            <span className="bw-ghost absolute bottom-[-0.1em] left-[2.2%]" style={{ fontSize: 'clamp(110px, 9.5vw, 180px)' }}>Beam</span>
          )}
        </div>

        <div className="relative flex h-full flex-col">
          <header className={`z-30 grid shrink-0 items-center gap-3 ${desktop ? 'h-[76px] grid-cols-[1fr_auto_1fr] px-[clamp(24px,2.6vw,48px)]' : 'h-14 grid-cols-[1fr_auto] px-3'}`}>
            <div>
              <button type="button" onClick={() => goToIndex(0)} className="bw-wordmark bw-focus -ml-1 min-h-11 rounded-lg px-1" aria-label="Beamwall, back to the start">
                Beamwall
              </button>
            </div>
            {desktop && (
              <nav aria-label="Main" className="flex items-center gap-1">
                {NAV_LINKS.map((n) => n.section !== null ? (
                  <button
                    key={n.label}
                    type="button"
                    className="bw-navlink"
                    aria-current={index === sectionIndex(n.section) ? 'page' : undefined}
                    onClick={() => goToIndex(sectionIndex(n.section as SectionId))}
                  >
                    {n.label}
                  </button>
                ) : (
                  <Link key={n.label} to={n.href ?? '/'} className="bw-navlink">{n.label}</Link>
                ))}
              </nav>
            )}
            <nav aria-label="Account" className="flex items-center justify-end gap-2 sm:gap-4">
              {desktop && <Link to="/login" className="bw-link">{START_COPY.signIn}</Link>}
              <Link to={SIGNUP_PATH} className="bw-btn bw-btn-primary bw-btn-sm">{desktop ? HERO.primary : HERO.primaryShort}</Link>
            </nav>
          </header>

          <main
            ref={mainRef}
            aria-label={`${SECTIONS[shownIndex].label}, section ${shownIndex + 1} of ${SECTIONS.length}`}
            className={`relative min-h-0 flex-1 ${leaving ? 'bw-leave' : ''}`}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div key={section} className="h-full">{content}</div>
            {!ready && !failed && slotBox !== null && (
              <p className="bw-label pointer-events-none fixed text-center" style={{ left: slotBox.left, width: slotBox.width, top: slotBox.top + slotBox.height * 0.55 }}>
                Beamy is on his way&hellip;
              </p>
            )}
            {section === 'intro' && desktop && dragHint && ready && arrival === 'done' && !introRunning && slotBox !== null && (
              <p
                className="bw-label pointer-events-none fixed flex items-center gap-1.5 rounded-full px-2.5 py-0.5"
                // A small frosted tag: it sits on the box's front floor edge, so it carries its own ground.
                style={{ left: slotBox.left + slotBox.width / 2 - 50, top: slotBox.top + slotBox.height + 6, color: 'var(--bw-ink)', background: 'rgba(26, 23, 64, 0.58)', WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)', animation: reduced ? undefined : 'bw-fade 600ms var(--bw-ease) 900ms both' }}
              >
                <Rotate3d className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Drag me
              </p>
            )}
          </main>

          <footer className={`z-30 flex shrink-0 items-center justify-between gap-3 ${desktop ? 'h-[72px] px-[clamp(24px,2.6vw,48px)]' : 'h-16 px-3'}`} style={{ paddingBottom: desktop ? undefined : 'env(safe-area-inset-bottom)' }}>
            <div className={desktop ? 'w-[180px]' : 'min-w-11'}>
              {atFirst && introRunning && (
                <button type="button" className="bw-btn bw-btn-secondary bw-btn-sm" onClick={skipIntro} data-skip-intro>
                  {desktop ? 'Skip intro' : 'Skip'}
                </button>
              )}
              {!atFirst && (desktop ? (
                <button type="button" className="bw-btn bw-btn-secondary bw-btn-sm" onClick={() => nav('back')}>
                  <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Back
                </button>
              ) : (
                <button type="button" className="bw-btn bw-btn-secondary bw-btn-sm" style={{ width: 44, padding: 0 }} onClick={() => nav('back')} aria-label="Back">
                  <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              ))}
            </div>
            <div className="flex flex-col items-center">
              {desktop ? (
                <div className="flex items-center" role="group" aria-label="Sections">
                  {SECTIONS.map((s, n) => (
                    <button
                      key={s.id}
                      type="button"
                      className="bw-dot"
                      aria-label={`${s.label}, section ${n + 1} of ${SECTIONS.length}`}
                      aria-current={n === index ? 'step' : undefined}
                      title={s.label}
                      onClick={() => goToIndex(n)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2" aria-hidden>
                  {SECTIONS.map((s, n) => (
                    <span key={s.id} className="h-2 rounded-full transition-[width,background-color] duration-300" style={{ width: n === index ? 18 : 8, background: n === index ? 'var(--bw-core)' : 'var(--bw-faint)' }} />
                  ))}
                </div>
              )}
              <span className={`bw-label ${desktop ? '-mt-1' : 'mt-1.5'}`} aria-live="polite">{SECTIONS[index].label}</span>
            </div>
            <div className={`flex justify-end ${desktop ? 'w-[180px]' : 'min-w-11'}`}>
              {!atLast && (
                <button type="button" className="bw-btn bw-btn-primary bw-btn-sm" onClick={() => nav('next')}>
                  {index === sectionIndex('pick') && selectedId === null ? PICK_COPY.skip : 'Next'} <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              )}
            </div>
          </footer>
        </div>
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
        />
      )}
      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        className={`bw-bubble pointer-events-none fixed left-0 top-0 z-50 max-w-[min(300px,calc(100vw-24px))] px-4 py-3 transition-opacity duration-300 ${((ready && arrival === 'done') || failed) && !bubbleHidden ? 'opacity-100' : 'opacity-0'}`}
        style={failed ? { transform: 'translate3d(16px, 72px, 0)' } : undefined}
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
          className="bw-focus fixed left-0 top-0 z-[45] cursor-grab touch-none rounded-full active:cursor-grabbing"
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
 * The live wall: a 3×3 grid in a slim deep-indigo frame whose tiles swap
 * photos on the pure scheduler in lib/beamyWall (one tile every 1.5–2.5s,
 * never the same tile twice in a row, never a duplicate on the wall). Pinned
 * tiles (Beamy's selfie, a visitor's shots) are frozen out of the rotation.
 */
function LiveWall({ pool, pins, dim, compact, centreRef, ripple, seed }: {
  pool: string[];
  pins: Record<number, Pin>;
  dim: boolean;
  compact: boolean;
  centreRef: MutableRefObject<HTMLDivElement | null>;
  ripple: number;
  seed: number;
}) {
  const rand = useRef<() => number>(seededRandom(seed));
  const wallRef = useRef<WallState>(initialWall(pool.length, rand.current));
  const prevRef = useRef<(number | null)[]>(wallRef.current.tiles.map(() => null));
  const freshRef = useRef<number | null>(null);
  const frozenRef = useRef(new Set<number>());
  frozenRef.current = new Set(Object.keys(pins).map(Number));
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const rings = useMemo(() => rippleRings(), []);

  useEffect(() => {
    let id = 0;
    const schedule = () => {
      id = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          const s = wallRef.current;
          const r = nextSwap(s, pool.length, rand.current, frozenRef.current);
          if (r !== null) {
            prevRef.current[r.tile] = s.tiles[r.tile];
            freshRef.current = r.tile;
            wallRef.current = r.state;
            bump();
          }
        }
        schedule();
      }, swapDelay(rand.current));
    };
    schedule();
    return () => window.clearTimeout(id);
  }, [pool.length]);

  const tiles = wallRef.current.tiles;
  return (
    <div className="bw-wall" data-dim={dim} role="group" aria-label={WALL_LABEL} style={compact ? { padding: 6, borderRadius: 14 } : undefined}>
      <p className={`bw-label flex items-center gap-2 px-1 ${compact ? 'mb-1.5 text-[12px]' : 'mb-2'}`} style={{ color: 'var(--bw-ink)' }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--bw-danger)' }} aria-hidden /> {WALL_LABEL}
      </p>
      <div className={`grid grid-cols-3 ${compact ? 'gap-[4px]' : 'gap-[7px]'}`}>
        {tiles.map((img, n) => {
          const pin = pins[n];
          const prev = prevRef.current[n];
          return (
            <div
              key={n}
              ref={n === WALL_CENTRE ? (el) => { centreRef.current = el; } : undefined}
              className={`bw-tile ${compact ? 'aspect-square' : 'aspect-[4/5]'}`}
              style={pin?.mine === true ? { boxShadow: '0 0 0 1.5px var(--bw-core)' } : undefined}
            >
              {prev !== null && <img src={pool[prev]} alt="" draggable={false} />}
              <img key={pool[img]} src={pool[img]} alt="" draggable={false} className={freshRef.current === n ? 'bw-tile-in' : undefined} />
              {pin !== undefined && (
                <img key={pin.key} src={pin.src} alt={pin.mine ? 'Your photo on the wall' : 'Beamy’s selfie on the wall'} draggable={false} className="bw-tile-in" style={{ opacity: 1 }} />
              )}
              {ripple > 0 && rings[n] > 0 && <span key={`r${ripple}`} className="bw-tile-flash" style={{ ['--ripple' as string]: rings[n] }} aria-hidden />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A scroller whose still-scrollable edge fades out (brand.css .bw-fade-x/y),
 * so content cut off at the panel's edge reads as "more this way". Tracks the
 * live scroll position, size changes, and the end of each child's entrance
 * animation (a rising child briefly overflows by its 24px offset).
 */
function FadeScroll({ axis, className, children, ...rest }: { axis: 'x' | 'y'; className: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const update = () => {
      const pos = axis === 'y' ? el.scrollTop : el.scrollLeft;
      const max = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      // The trailing padding is not content: once only it is left, the last
      // item is fully in view and its edge must not be faded.
      const cs = getComputedStyle(el);
      const padEnd = parseFloat(axis === 'y' ? cs.paddingBottom : cs.paddingRight) || 0;
      const start = pos > 2;
      const end = pos < max - 2 - padEnd;
      const v = start && end ? 'both' : end ? 'end' : start ? 'start' : 'none';
      if (el.dataset.fade !== v) el.dataset.fade = v;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('animationend', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => { el.removeEventListener('scroll', update); el.removeEventListener('animationend', update); ro.disconnect(); };
  }, [axis]);
  return <div ref={ref} className={`${axis === 'y' ? 'bw-fade-y' : 'bw-fade-x'} ${className}`} {...rest}>{children}</div>;
}

/** Stops 2, 4-6: Beamy's column + the content (stacked on phones). */
function Panel({ desktop, slot, children }: { desktop: boolean; slot: ReactNode; children: ReactNode }) {
  if (desktop) {
    return (
      <div className="mx-auto grid h-full w-full max-w-[1320px] grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 px-[clamp(28px,3.4vw,64px)] pb-2">
        {/* Feet low in the column, so he stands on the panel's floor. */}
        <div className="relative flex min-h-0 items-end pb-[4%]">
          <div className="h-[88%] max-h-[540px] w-full">{slot}</div>
        </div>
        <FadeScroll axis="y" data-bubble-right className="flex min-h-0 flex-col justify-center overflow-y-auto py-4 pr-2">
          <div className="w-full max-w-[620px]">{children}</div>
        </FadeScroll>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto h-[28%] min-h-[140px] w-full max-w-[480px] shrink-0 px-4 pt-1">{slot}</div>
      <FadeScroll axis="y" className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">{children}</FadeScroll>
    </div>
  );
}
