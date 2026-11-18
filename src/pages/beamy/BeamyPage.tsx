/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /beamy — the candidate landing in brand v2 (noindex while the owner reacts
 * to it; `/` is untouched). ONE viewport, six sections moved through one at a
 * time — never a document scroll:
 *
 *   intro → What applies to you? → Try it (the real booth) → 3D magic →
 *   How it works → Start
 *
 * Beamy lives in BeamyStage's full-viewport canvas above the page. Each
 * section renders an empty `[data-beamy-slot]` box where he should stand; a
 * layout effect measures it, so his home and size come from the DOM, never
 * from magic numbers. He reacts only at high-profile moments (arrival, a pick,
 * a beam, a reveal), choosing via lib/brandLanding's seeded picker so the same
 * action never plays twice in a row; Next/Back/dots get no reaction at all.
 *
 * Choreographies are async scripts against BeamyApi. Each run takes a token;
 * moving to another section bumps it and every await re-checks it, so a
 * script left behind by a fast tapper stops instead of fighting the new one.
 *
 * Nothing a visitor captures leaves the device: the wall is component state.
 * Tokens/components come from src/styles/brand.css, scoped by data-brand="2".
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Briefcase, Cake, CalendarPlus, Camera, Check, ClipboardList, Gift, Link2, Lock,
  Palette, RotateCcw, Rotate3d, Users, type LucideIcon,
} from 'lucide-react';
import CameraExperience from '../../components/landing/CameraExperience';
import ParticleBeam from '../../components/landing/ParticleBeam';
import ReportIssueButton from '../../components/support/ReportIssueButton';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';
import { salesImage } from '../sales/salesImages';
import type { Rect } from '../../lib/beamGeometry';
import {
  AUDIENCES, DELIVER_STEPS, DONE_FOR_YOU, GREETING, HELLO, POKE_LINES, audienceById,
  type Audience, type AudienceIcon, type StepIcon,
} from '../../lib/beamyTour';
import {
  FOOTER_LINKS, HERO, HOW_COPY, LOOKS, MAGIC_COPY, PICK_COPY, POKE_IDLE, PRICING_PATH, SECTIONS, SIGNUP_PATH,
  START_COPY, TRY_COPY, WHEEL_IDLE, createReactionPicker, keyToNav, navigate, pickCelebration, pokeStep,
  releaseVelocity, sectionIndex, startFacts, swipeDecision, wheelDecision,
  type Celebration, type Nav, type Reaction, type SectionId,
} from '../../lib/brandLanding';
import BeamyStage, { type BeamyApi, type BeamyClip, type Pt, type StageLayout } from './BeamyStage';

const WALL_SEED = ['event-wedding', 'event-birthday', 'event-gala', 'event-activation', 'event-conference', 'hero-wall', 'event-tradeshow'];
/** The beam's calm palette for the photo dissolve (palette[0] tints the core). */
const BEAM_PALETTE = ['#8E96FF', '#FFFFFF', '#A5ABFF', '#FFC56B'];
const AUDIENCE_ICONS: Record<AudienceIcon, LucideIcon> = { ClipboardList, Cake, Users, Briefcase, Gift };
const STEP_ICONS: Record<StepIcon, LucideIcon> = { CalendarPlus, Palette, Link2 };
/** Skipping the picker tours as the most common host. */
const DEFAULT_AUDIENCE = audienceById('family') ?? AUDIENCES[0];
/** Room above Beamy's head kept free for his speech bubble. */
const BUBBLE_ROOM = 76;
const LEAVE_MS = 300;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

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
  const [cameraOn, setCameraOn] = useState(false);
  const [shots, setShots] = useState<{ id: number; src: string }[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [propBusy, setPropBusy] = useState(false);
  const [dragHint, setDragHint] = useState(true);
  const [slotBox, setSlotBox] = useState<Rect | null>(null);

  const audience = picked ?? DEFAULT_AUDIENCE;
  const section: SectionId = SECTIONS[shownIndex].id;

  const api = useRef<BeamyApi | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hitRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const firstTileRef = useRef<HTMLDivElement | null>(null);
  const token = useRef(0);
  const nextShot = useRef(1);
  const flightKey = useRef(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const layoutRef = useRef<StageLayout>({ home: { x: vp.w / 2, y: vp.h * 0.4 }, heightPx: 180 });
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
  const showContent = arrival === 'done' || failed || slowModel || reduced;

  /* Beamy's home + size from the current section's slot box. */
  const measure = useCallback(() => {
    const el = mainRef.current?.querySelector<HTMLElement>('[data-beamy-slot]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const heightPx = Math.max(96, Math.min(r.height - BUBBLE_ROOM, r.width * 0.9, desktop ? 300 : 200));
    layoutRef.current = { home: { x: r.left + r.width / 2, y: r.bottom }, heightPx };
    setSlotBox((prev) => (prev && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
      ? prev : { left: r.left, top: r.top, width: r.width, height: r.height }));
  }, [desktop]);
  useLayoutEffect(() => { measure(); }, [measure, shownIndex, vp.w, vp.h]);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (mainRef.current) ro.observe(mainRef.current);
    // The slot itself can resize without main changing (the display face
    // swapping in reflows the copy under it), so watch it too.
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

  /* ── Entrance: beam drops, Beamy appears, then the copy rises. ──────── */
  useEffect(() => {
    if (!ready) return;
    const b = api.current;
    if (b === null) return;
    setArrival('dropping');
    void (async () => {
      await b.arrive();
      setArrival('done');
      await wait(120);
      if (indexRef.current !== 0) return;
      const r = react.current('intro');
      say(HELLO);
      await b.play(r === 'hop' ? 'Hop' : 'Wave');
    })();
  }, [ready]);
  useEffect(() => {
    const id = window.setTimeout(() => setSlowModel(true), 4000);
    return () => window.clearTimeout(id);
  }, []);

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

  /* Gaze: the pointer on desktop; the last tap on touch (then back to you). */
  useEffect(() => {
    let clear = 0;
    const onMove = (e: PointerEvent) => { if (e.pointerType === 'mouse') api.current?.look({ x: e.clientX, y: e.clientY }); };
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
    const tile = rectOf(firstTileRef.current);
    const commit = () => {
      setShots((prev) => [{ id: nextShot.current++, src }, ...prev].slice(0, 6));
      say('It’s on the wall! Every guest’s shot lands there, live.');
      celebrate();
    };
    if (b === null || vf === null || tile === null || reduced) { commit(); return; }
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
    const r = pokeStep(poke.current, performance.now());
    poke.current = r.state;
    if (r.level === 'sparkle') {
      b.sparkle('sparkle');
      say(POKE_LINES[(r.count - 1) % 2]);
      void b.play(r.count === 1 ? 'Hop' : 'SideEye');
    } else if (r.level === 'burst') {
      b.sparkle('burst');
      say(POKE_LINES[r.count === 3 ? 2 : 3]);
      void b.play(r.count === 3 ? 'Wave' : 'ShadesOn');
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

  /* ── Sections ──────────────────────────────────────────────────────── */

  const wallTiles = [
    ...shots.map((s) => ({ key: `s${s.id}`, src: s.src, mine: true })),
    ...WALL_SEED.map((k, i) => ({ key: `${k}${i}`, src: salesImage(k)?.src ?? '', mine: false })),
  ].slice(0, desktop ? 6 : 3);

  const slot = (extra = '') => <div data-beamy-slot aria-hidden className={`relative min-h-0 ${extra}`} />;

  const wall = (
    <div className={`bw-card p-3 ${desktop ? '' : 'flex h-full flex-col'}`} aria-label="Live wall" role="group">
      <p className="bw-label mb-2 flex shrink-0 items-center gap-2 px-1">
        <span className="h-2 w-2 rounded-full" style={{ background: 'var(--bw-danger)' }} aria-hidden /> Live wall
      </p>
      {/* Phone: one column whose rows share the booth's height, so the wall
          can never outgrow the row at short viewports. */}
      <div className={`grid gap-2 ${desktop ? 'grid-cols-3' : 'min-h-0 flex-1 grid-cols-1 grid-rows-3'}`}>
        {wallTiles.map((t, i) => (
          <div
            key={t.key}
            ref={i === 0 ? firstTileRef : undefined}
            className={`relative overflow-hidden rounded-[10px] ${desktop ? 'aspect-[3/4]' : 'min-h-0'}`}
            style={{ background: 'var(--bw-surface-2)', boxShadow: t.mine ? 'inset 0 0 0 1.5px var(--bw-accent)' : undefined }}
          >
            {t.src !== '' && <img src={t.src} alt={t.mine ? 'Your photo on the wall' : ''} className="h-full w-full object-cover" draggable={false} />}
          </div>
        ))}
      </div>
    </div>
  );

  const lookPills = (
    <div
      role="group"
      aria-label="Pick a look"
      data-noswipe={desktop ? undefined : true}
      className={`flex gap-2 ${desktop ? 'flex-wrap' : '-mx-4 flex-nowrap overflow-x-auto px-4 [scrollbar-width:none]'}`}
    >
      {LOOKS.map((l) => (
        <button key={l.label} type="button" className={`bw-pill ${desktop ? '' : 'shrink-0 px-3'}`} aria-pressed={look === l.kit} onClick={() => setLook(l.kit)}>
          {l.label}
        </button>
      ))}
    </div>
  );

  const booth = (
    <div
      data-noswipe
      className={`relative aspect-[9/16] overflow-hidden rounded-[24px] ${desktop ? 'w-full' : 'h-full'}`}
      style={{ background: 'var(--bw-surface)', border: '1px solid var(--bw-hairline)' }}
    >
      {cameraOn ? (
        <CameraExperience enabled videoId="beamy-booth-video" beamLabel="Beam it to the wall" onBeam={onBeam} look={look} screenRef={viewfinderRef} />
      ) : (
        <div className={`flex h-full flex-col items-center justify-center text-center ${desktop ? 'gap-4 px-5' : 'gap-3 px-3'}`}>
          <span className="bw-icon-tile" aria-hidden><Camera /></span>
          <p className="bw-small max-w-[22ch]">The real booth your guests open from a QR code.</p>
          <button type="button" className={`bw-btn bw-btn-primary bw-btn-sm ${desktop ? '' : 'h-auto w-full whitespace-normal px-3 py-2 leading-tight'}`} onClick={() => { setCameraOn(true); say('Smile! Pick a look, then tap the big button.'); }}>
            {TRY_COPY.start}
          </button>
          <p className="bw-label flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> {TRY_COPY.privacy}</p>
        </div>
      )}
    </div>
  );

  const heading = (text: string, cls = 'bw-h2') => (
    <h2 data-section-heading tabIndex={-1} className={`${cls} outline-none`}>{text}</h2>
  );

  const start = startFacts();
  const i = (n: number) => ({ ['--i' as string]: n });

  let content: ReactNode = null;
  if (section === 'intro') {
    content = (
      <div className="flex h-full flex-col items-center px-4 text-center">
        {slot('w-full max-w-[520px] flex-[1_1_0%]')}
        <div className={`flex w-full max-w-[980px] shrink-0 flex-col items-center pb-2 pt-4 ${showContent ? 'bw-rise' : 'invisible'}`}>
          <h1 data-section-heading tabIndex={-1} className="bw-display max-w-[22ch] outline-none" style={i(0)}>{HERO.headline}</h1>
          <p className="bw-body mt-4" style={i(1)}>{HERO.sub}</p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row" style={i(2)}>
            <Link to={SIGNUP_PATH} className="bw-btn bw-btn-primary bw-btn-lg">{HERO.primary}</Link>
            <button type="button" className="bw-btn bw-btn-secondary bw-btn-lg" onClick={() => goToIndex(sectionIndex('try'))}>
              {HERO.secondary}
            </button>
          </div>
        </div>
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
              className={`bw-card bw-card-interactive flex items-center gap-4 ${desktop ? 'min-h-[84px] p-4' : 'min-h-[64px] px-4 py-3'}`}
              style={i(n + 2)}
            >
              <span className="bw-icon-tile" aria-hidden><Icon /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{a.title}</span>
                <span className="bw-label mt-0.5 block">{a.hint}</span>
              </span>
              {on && <Check className="h-5 w-5 shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-accent)' }} aria-hidden />}
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
    content = desktop ? (
      <div className="mx-auto grid h-full w-full max-w-[1320px] grid-cols-[auto_minmax(220px,300px)_minmax(0,1fr)] gap-6 px-8 pb-4 pt-2">
        <div className="bw-rise flex min-h-0 items-center">
          <div style={{ ...i(1), width: 'min(380px, calc((100dvh - 190px) * 0.5625))' }}>{booth}</div>
        </div>
        {slot('h-full')}
        <div className="bw-rise flex min-h-0 flex-col justify-center gap-5">
          <div style={i(0)}>{heading(TRY_COPY.heading)}</div>
          <p className="bw-body -mt-2 max-w-[40ch]" style={i(1)}>{TRY_COPY.line}</p>
          <div style={i(2)}>{lookPills}</div>
          <div className="max-w-[440px]" style={i(3)}>{wall}</div>
        </div>
      </div>
    ) : (
      <div className="flex h-full flex-col">
        {/* Beamy alone in the band (the bubble needs the room above him);
            the phone booth and the wall sit side by side below, so the
            beam reads left-to-right like it does on desktop. */}
        <div className="flex h-[24%] min-h-[128px] shrink-0 px-4 pt-1">{slot('h-full flex-1')}</div>
        <div className="bw-rise flex min-h-0 flex-1 flex-col px-4 pb-3 pt-2">
          <div style={i(0)}>{heading(TRY_COPY.heading)}</div>
          <div className="mt-3" style={i(1)}>{lookPills}</div>
          <div className="mt-3 flex min-h-[220px] flex-1 gap-3" style={i(2)}>
            <div className="h-full shrink-0">{booth}</div>
            <div className="h-full min-w-0 flex-1">{wall}</div>
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
                <li key={d.title} className="bw-card flex items-start gap-4 p-4" style={i(n + 1)}>
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
                <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} style={{ color: 'var(--bw-accent)' }} aria-hidden /> {b}
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
  const glow = slotBox !== null ? { ['--glow-x' as string]: `${((slotBox.left + slotBox.width / 2) / vp.w) * 100}%`, ['--glow-y' as string]: `${((slotBox.top + slotBox.height * 0.62) / vp.h) * 100}%` } : undefined;

  return (
    <div data-brand="2" data-arrival={arrival} data-section={section} className="bw-root fixed inset-0 overflow-hidden">
      <div className="bw-glow pointer-events-none absolute inset-0" style={glow} aria-hidden />

      <div className="relative flex h-full flex-col">
        <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:h-16 sm:px-8">
          <button type="button" onClick={() => goToIndex(0)} className="bw-wordmark bw-focus -ml-1 min-h-11 rounded-lg px-1" aria-label="Beamwall, back to the start">
            Beamwall
          </button>
          <nav aria-label="Account" className="flex items-center gap-2 sm:gap-4">
            {desktop && <Link to="/login" className="bw-link">{START_COPY.signIn}</Link>}
            <Link to={SIGNUP_PATH} className="bw-btn bw-btn-primary bw-btn-sm">{HERO.primary}</Link>
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
          {section === 'intro' && dragHint && ready && arrival === 'done' && slotBox !== null && (
            <p
              className="bw-label pointer-events-none fixed flex items-center gap-1.5"
              style={{ left: slotBox.left + slotBox.width / 2 + layoutRef.current.heightPx * 0.42, top: slotBox.top + slotBox.height - 28, animation: reduced ? undefined : 'bw-fade 600ms var(--bw-ease) 900ms both' }}
            >
              <Rotate3d className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Drag me
            </p>
          )}
        </main>

        <footer className={`z-30 flex shrink-0 items-center gap-3 px-4 sm:px-8 ${desktop ? 'h-[72px] justify-between' : 'h-[76px] justify-between'}`} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className={desktop ? 'w-[180px]' : 'w-11'}>
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
            <span className={`bw-label ${desktop ? '-mt-1' : 'mt-2'}`} aria-live="polite">{SECTIONS[index].label}</span>
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

      {!failed && (
        <BeamyStage
          apiRef={api}
          layoutRef={layoutRef}
          bubbleRef={bubbleRef}
          hitRef={hitRef}
          startHidden
          reducedMotion={reduced}
          onReady={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}
      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        className={`bw-bubble pointer-events-none fixed left-0 top-0 z-50 max-w-[min(320px,calc(100vw-24px))] px-4 py-3 transition-opacity duration-300 ${(ready && arrival === 'done') || failed ? 'opacity-100' : 'opacity-0'}`}
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

      {flight !== null && (
        <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden>
          <ParticleBeam key={flight.key} from={flight.from} to={flight.to} shot={flight.shot} durationMs={flight.ms} onDone={flight.onDone} palette={BEAM_PALETTE} />
        </div>
      )}
    </div>
  );
}

/** Sections 2, 4-6: Beamy's column + the content panel (stacked on phones). */
function Panel({ desktop, slot, children }: { desktop: boolean; slot: ReactNode; children: ReactNode }) {
  if (desktop) {
    return (
      <div className="mx-auto grid h-full w-full max-w-[1320px] grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 px-8 pb-4">
        {/* Centred and capped so Beamy stands level with the copy instead of
            sinking to the bottom-left of a tall column. */}
        <div className="relative flex min-h-0 items-center py-6">
          <div className="h-full max-h-[540px] w-full">{slot}</div>
        </div>
        <div className="flex min-h-0 flex-col justify-center overflow-y-auto py-4 pr-2">
          <div className="w-full max-w-[620px]">{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto h-[30%] min-h-[150px] w-full max-w-[480px] shrink-0 px-4 pt-1">{slot}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">{children}</div>
    </div>
  );
}
