/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /beamy — meet Beamy, a full-viewport guided tour of Beamwall (noindex while
 * it is a first cut for the owner to react to).
 *
 * Layout: a STAGE (Beamy's home: left column on desktop, a top band on a
 * phone) and a PANEL of cards. BeamyStage's canvas covers the whole viewport
 * above both, so Beamy can leave the stage, walk to a card and tap it.
 *
 * Flow: "What applies to you?" picker → per audience: intro → snap & beam
 * (the real /try booth; Beamy catches the shot and beams it onto the stage's
 * live wall) → 3D magic (sparks from Beamy's mouth assemble a library prop)
 * → how it works (Beamy walks to each card and taps it) → start.
 *
 * Choreographies are async scripts against BeamyApi. Each run takes a token;
 * moving to another stop bumps it, and every await re-checks it, so a script
 * left behind by a fast tapper stops instead of fighting the new one.
 *
 * Nothing a visitor captures leaves the device: the wall is component state.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Camera, Lock, RotateCcw, Sparkles } from 'lucide-react';
import CameraExperience from '../../components/landing/CameraExperience';
import ParticleBeam from '../../components/landing/ParticleBeam';
import { DEMO_KITS } from '../../lib/demoKits';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';
import { salesImage } from '../sales/salesImages';
import type { Rect } from '../../lib/beamGeometry';
import {
  AUDIENCES, DELIVER_STEPS, GREETING, POKE_LINES, STOP_LABELS, TOUR_STOPS,
  type Audience, type TourStop,
} from '../../lib/beamyTour';
import BeamyStage, { type BeamyApi, type BeamyClip, type Pt, type StageLayout } from './BeamyStage';

type Step = 'pick' | TourStop;

const WALL_SEED = ['event-wedding', 'event-birthday', 'event-gala', 'event-activation', 'event-conference', 'hero-wall', 'event-tradeshow'];

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const CSS = `
@keyframes by-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.by-in { animation: by-in 480ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes by-tap { 0% { transform: scale(1); } 40% { transform: scale(0.96); } 100% { transform: scale(1); } }
.by-tapped { animation: by-tap 420ms ease both; }
@keyframes by-land { 0% { filter: brightness(2.4) blur(6px); transform: scale(.7); } 100% { filter: none; transform: none; } }
.by-land { animation: by-land 700ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes by-wake { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
.by-wake { animation: by-wake 1.6s ease-in-out infinite; }
.by-bubble::after { content: ''; position: absolute; left: var(--tail-x, 50%); bottom: -9px; width: 18px; height: 18px; transform: translateX(-50%) rotate(45deg); background: inherit; border-right: 1px solid rgba(255,255,255,.14); border-bottom: 1px solid rgba(255,255,255,.14); border-bottom-right-radius: 4px; }
`;

/** Typewriter for Beamy's lines. Text is information, not decoration, so a
 *  reduced-motion visitor gets the whole line at once. */
function useTyped(text: string): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(text.length); return; }
    setN(0);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? (window.clearInterval(id), v) : v + 2)), 22);
    return () => window.clearInterval(id);
  }, [text]);
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

const rectOf = (el: Element | null): Rect | null => {
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

interface Flight { from: Rect; to: Rect; shot: string; ms: number; onDone: () => void; key: number; }

export default function BeamyPage() {
  usePageTitle('Meet Beamy · Beamwall');
  useNoIndex();

  const vp = useViewport();
  const desktop = vp.w >= 1024;

  const [audience, setAudience] = useState<Audience | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [line, setLine] = useState(GREETING);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tapped, setTapped] = useState<string | null>(null);
  const [deliverOn, setDeliverOn] = useState(-1);
  const [cameraOn, setCameraOn] = useState(false);
  const [shots, setShots] = useState<{ id: number; src: string }[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [propBusy, setPropBusy] = useState(false);

  const api = useRef<BeamyApi | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hitRef = useRef<HTMLButtonElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const firstTileRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const token = useRef(0);
  const nextShot = useRef(1);
  const flightKey = useRef(0);
  const layoutRef = useRef<StageLayout>({ home: { x: vp.w / 2, y: vp.h * 0.4 }, heightPx: 180 });

  /* Beamy's home and size follow the stage box. */
  useLayoutEffect(() => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    const heightPx = desktop ? Math.min(vp.h * 0.36, r.width * 0.55, 340) : Math.min(r.height * 0.6, 190);
    layoutRef.current = {
      home: { x: r.left + r.width / 2, y: r.bottom - (desktop ? r.height * 0.1 : 10) },
      heightPx,
    };
  }, [vp.w, vp.h, desktop]);

  const typed = useTyped(line);

  /** Start a new choreography; returns a checker that says "still current". */
  const begin = useCallback(() => {
    const mine = ++token.current;
    return () => token.current === mine;
  }, []);

  const say = (t: string) => setLine(t);

  /** Beamy walks to a card, taps it (wave), and comes back. */
  const walkAndTap = useCallback(async (el: HTMLElement | null, alive: () => boolean, id: string, stay = false) => {
    const b = api.current;
    if (b === null || el === null) return;
    const r = el.getBoundingClientRect();
    const small = desktop ? 0.42 : 0.55;
    const h = layoutRef.current.heightPx * small;
    const to: Pt = { x: Math.max(h * 0.4, r.left + h * 0.32), y: r.bottom - 6 };
    await b.walkTo(to, small);
    if (!alive()) return;
    setTapped(id);
    await b.play('Wave');
    if (!alive()) return;
    setTapped(null);
    if (!stay) await b.goHome();
  }, [desktop]);

  /* Greeting wave once Beamy is in. */
  useEffect(() => {
    if (!ready) return;
    const alive = begin();
    void (async () => {
      await wait(250);
      if (!alive()) return;
      await api.current?.play('Wave');
    })();
  }, [ready, begin]);

  const pickAudience = async (a: Audience, el: HTMLElement) => {
    const alive = begin();
    setAudience(a);
    say(`${a.emoji} ${a.title}? Great choice!`);
    if (api.current !== null) {
      await walkAndTap(el, alive, a.id, true);
      if (!alive()) return;
      void api.current.play('Hop');
      await api.current.goHome();
      if (!alive()) return;
    }
    goTo('intro', a);
  };

  const goTo = (s: Step, a: Audience | null = audience) => {
    const alive = begin();
    api.current?.clearProp();
    setTapped(null);
    setDeliverOn(-1);
    setStep(s);
    panelRef.current?.scrollTo({ top: 0 });
    if (s !== 'snap') setCameraOn(false);
    if (s === 'pick' || a === null) { say(GREETING); void api.current?.goHome(); return; }
    say(a.lines[s]);
    void (async () => {
      const b = api.current;
      if (b === null) return;
      await b.goHome();
      if (!alive()) return;
      if (s === 'intro') await b.play('Wave');
      if (s === 'prop') { await wait(300); if (alive()) await runReveal(a, alive); }
      if (s === 'deliver') { await wait(500); if (alive()) await runDeliver(alive); }
      if (s === 'go') { await b.play('Dance'); if (alive()) await b.play('ShadesOn'); }
    })();
  };

  const propSpot = (): { at: Pt; size: number } => {
    const L = layoutRef.current;
    const r = stageRef.current?.getBoundingClientRect();
    const dx = desktop ? L.heightPx * 0.95 : Math.min(L.heightPx * 0.85, (r?.width ?? vp.w) / 2 - L.heightPx * 0.35);
    return { at: { x: L.home.x + dx, y: L.home.y - L.heightPx * 0.62 }, size: L.heightPx * 0.62 };
  };

  const runReveal = async (a: Audience, alive: () => boolean) => {
    const b = api.current;
    if (b === null) return;
    setPropBusy(true);
    const { at, size } = propSpot();
    await b.reveal(a.prop.url, at, size);
    setPropBusy(false);
    if (!alive()) return;
    say(`Ta-da! A ${a.prop.name.toLowerCase()}. Guests see it on their own heads, tracked in 3D.`);
    await b.play('Dance');
  };

  const runDeliver = async (alive: () => boolean) => {
    for (let i = 0; i < DELIVER_STEPS.length; i++) {
      const el = panelRef.current?.querySelector<HTMLElement>(`[data-deliver="${i}"]`) ?? null;
      if (el === null) return;
      if (!desktop) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); await wait(450); }
      if (!alive()) return;
      setDeliverOn(i);
      say(DELIVER_STEPS[i].title + '. ' + DELIVER_STEPS[i].body);
      await walkAndTap(el, alive, `d${i}`, true);
      if (!alive()) return;
      await wait(900);
      if (!alive()) return;
    }
    if (!desktop) panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    await api.current?.goHome();
    if (alive()) say('That’s it! You share one link and we handle the rest.');
  };

  /* The booth hands over a shot: Beamy catches it, then beams it to the wall. */
  const onBeam = useCallback((src: string) => {
    const b = api.current;
    const vf = rectOf(viewfinderRef.current);
    const tile = rectOf(firstTileRef.current);
    const commit = () => {
      setShots((prev) => [{ id: nextShot.current++, src }, ...prev].slice(0, 6));
      say('It’s on the wall! Every guest’s shot lands there, live.');
      void api.current?.play('Dance');
    };
    if (b === null || vf === null || tile === null) { commit(); return; }
    const alive = begin();
    say('Ooh, nice one! Let me catch it…');
    const m = b.mouth();
    const mouthRect: Rect = { left: m.x - 22, top: m.y - 38, width: 44, height: 76 };
    b.face(vf.left + vf.width / 2);
    setFlight({
      key: ++flightKey.current, from: vf, to: mouthRect, shot: src, ms: 1100,
      onDone: () => {
        setFlight(null);
        if (!alive()) { commit(); return; }
        say('And… BEAM!');
        const target: Pt = { x: tile.left + tile.width / 2, y: tile.top + tile.height / 2 };
        void b.beam(target, () => {
          const m2 = b.mouth();
          setFlight({
            key: ++flightKey.current,
            from: { left: m2.x - 22, top: m2.y - 38, width: 44, height: 76 },
            to: tile, shot: src, ms: 1250,
            onDone: () => { setFlight(null); commit(); },
          });
        });
      },
    });
  }, [begin]);

  const poke = () => {
    if (api.current === null) return;
    const clips: BeamyClip[] = ['Hop', 'SideEye', 'Dance', 'ShadesOn', 'Wave'];
    const i = Math.floor(Math.random() * clips.length);
    say(POKE_LINES[i % POKE_LINES.length]);
    void api.current.play(clips[i]);
  };

  const stopIndex = step === 'pick' ? -1 : TOUR_STOPS.indexOf(step);
  const next = () => { const n = TOUR_STOPS[stopIndex + 1]; if (n) goTo(n); };
  const back = () => { const p = TOUR_STOPS[stopIndex - 1]; goTo(p ?? 'pick'); };
  const kit = audience?.kit ? DEMO_KITS[audience.kit] : undefined;

  /* ── Panel content per step ─────────────────────────────────────────── */

  let panel: ReactNode = null;
  if (step === 'pick') {
    panel = (
      <div className="by-in">
        <p className="font-label text-[11px] font-semibold uppercase tracking-[0.26em] text-[color:var(--color-accent)]">Meet Beamy</p>
        <h1 className="mt-2 font-serif text-[34px] font-semibold leading-[1.05] text-brand-fg sm:text-[44px]">What applies to you?</h1>
        <p className="mt-2 max-w-[46ch] text-[15px] leading-snug text-brand-muted">Pick the one that fits and Beamy will show you what Beamwall does for your kind of event.</p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={(e) => { void pickAudience(a, e.currentTarget); }}
              className={`liquid-glass group relative flex min-h-[88px] items-center gap-4 rounded-2xl p-4 pl-5 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${tapped === a.id ? 'by-tapped' : ''}`}
              style={tapped === a.id || audience?.id === a.id ? { boxShadow: `0 0 0 2px ${a.hue}, 0 0 36px -6px ${a.hue}` } : undefined}
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[26px]" style={{ background: `${a.hue}26` }} aria-hidden>{a.emoji}</span>
              <span className="min-w-0">
                <span className="block font-serif text-[20px] font-semibold leading-tight text-brand-fg">{a.title}</span>
                <span className="mt-0.5 block text-[13px] text-brand-muted">{a.hint}</span>
              </span>
              <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-fg" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    );
  } else if (audience !== null && step === 'intro') {
    panel = (
      <div className="by-in">
        <Eyebrow a={audience}>{audience.emoji} {audience.title}</Eyebrow>
        <h2 className="mt-2 font-serif text-[32px] font-semibold leading-[1.05] text-brand-fg sm:text-[40px]">A photo booth on every guest&rsquo;s phone. Built for you.</h2>
        <p className="mt-3 max-w-[50ch] text-[15px] leading-snug text-brand-muted">{audience.lines.intro}</p>
        <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {audience.gets.map((g) => (
            <li key={g} className="liquid-glass flex items-center gap-3 rounded-xl px-4 py-3 text-[14px] text-brand-fg">
              <Sparkles className="h-4 w-4 shrink-0" style={{ color: audience.hue }} aria-hidden /> {g}
            </li>
          ))}
        </ul>
        <NavRow onBack={back} onNext={next} nextLabel="Show me the booth" />
      </div>
    );
  } else if (audience !== null && step === 'snap') {
    panel = (
      <div className="by-in">
        <Eyebrow a={audience}>Snap &amp; beam</Eyebrow>
        <h2 className="mt-2 font-serif text-[28px] font-semibold leading-tight text-brand-fg sm:text-[34px]">Take a photo. Beamy beams it to the wall.</h2>
        <div className="mt-4 flex flex-col items-start gap-4 xl:flex-row">
          <div className="relative aspect-[9/16] w-full max-w-[min(340px,calc((100dvh-200px)*0.5625))] shrink-0 overflow-hidden rounded-[22px] border border-white/10 bg-[#05060b]">
            {cameraOn ? (
              <CameraExperience enabled videoId="beamy-booth-video" beamLabel="Beam it, Beamy!" onBeam={onBeam} kit={kit} screenRef={viewfinderRef} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <Camera className="h-10 w-10" style={{ color: audience.hue }} aria-hidden />
                <p className="text-[14px] leading-snug text-brand-muted">This is the real booth your guests open from a QR code.</p>
                <button
                  type="button"
                  data-start-camera
                  onClick={() => { setCameraOn(true); say('Smile! Pick a look, then tap the big button.'); }}
                  className={`inline-flex min-h-12 items-center gap-2 rounded-full bg-foil px-6 font-label text-[12px] font-bold uppercase tracking-[0.2em] text-white glow-accent active:scale-[0.98] ${tapped === 'cam' ? 'by-tapped' : ''}`}
                >
                  <Camera className="h-5 w-5" aria-hidden /> Start the camera
                </button>
                <p className="flex items-center gap-1.5 text-[12px] text-brand-muted/80"><Lock className="h-3.5 w-3.5" aria-hidden /> Nothing is uploaded.</p>
              </div>
            )}
          </div>
          <div className="max-w-[34ch] text-[14px] leading-snug text-brand-muted">
            <p>Guests pick a frame, an effect and a 3D piece, then take the shot. Beamy catches it and beams it onto the live wall {desktop ? 'on the left' : 'up top'}.</p>
            <p className="mt-2">On the night, that wall is any screen or projector you already have.</p>
          </div>
        </div>
        <NavRow onBack={back} onNext={next} nextLabel="Show me 3D" />
      </div>
    );
  } else if (audience !== null && step === 'prop') {
    panel = (
      <div className="by-in">
        <Eyebrow a={audience}>3D magic</Eyebrow>
        <h2 className="mt-2 font-serif text-[28px] font-semibold leading-tight text-brand-fg sm:text-[34px]">Real 3D pieces that follow each face.</h2>
        <p className="mt-3 max-w-[50ch] text-[15px] leading-snug text-brand-muted">Crowns, hats, shades, even custom pieces made for your event. Guests wear them live in the booth, and they land in every photo.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={propBusy}
            onClick={() => { const alive = begin(); void runReveal(audience, alive); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 font-label text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-fg disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Again!
          </button>
          <button
            type="button"
            onClick={() => goTo('snap')}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foil px-5 font-label text-[12px] font-bold uppercase tracking-[0.16em] text-white glow-accent"
          >
            <Camera className="h-4 w-4" aria-hidden /> Try it on
          </button>
        </div>
        <NavRow onBack={back} onNext={next} nextLabel="How it works" />
      </div>
    );
  } else if (audience !== null && step === 'deliver') {
    panel = (
      <div className="by-in">
        <Eyebrow a={audience}>How it works</Eyebrow>
        <h2 className="mt-2 font-serif text-[28px] font-semibold leading-tight text-brand-fg sm:text-[34px]">Done for you, from start to finish.</h2>
        <ol className="mt-5 flex flex-col gap-3">
          {DELIVER_STEPS.map((d, i) => (
            <li
              key={d.title}
              data-deliver={i}
              className={`liquid-glass flex items-start gap-4 rounded-2xl p-4 pl-16 transition duration-300 ${deliverOn === i ? '' : deliverOn > i ? 'opacity-90' : 'opacity-60'} ${tapped === `d${i}` ? 'by-tapped' : ''}`}
              style={deliverOn === i ? { boxShadow: `0 0 0 2px ${audience.hue}, 0 0 40px -6px ${audience.hue}` } : undefined}
            >
              <span className="text-[24px]" aria-hidden>{d.emoji}</span>
              <span>
                <span className="block font-label text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-muted">Step {i + 1}</span>
                <span className="block font-serif text-[20px] font-semibold leading-tight text-brand-fg">{d.title}</span>
                <span className="mt-1 block text-[14px] leading-snug text-brand-muted">{d.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => { const alive = begin(); void runDeliver(alive); }}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 font-label text-[12px] font-semibold uppercase tracking-[0.16em] text-brand-fg"
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> Show me again
        </button>
        <NavRow onBack={back} onNext={next} nextLabel={"Let\u2019s go"} />
      </div>
    );
  } else if (audience !== null && step === 'go') {
    panel = (
      <div className="by-in">
        <Eyebrow a={audience}>Ready when you are</Eyebrow>
        <h2 className="mt-2 font-serif text-[32px] font-semibold leading-[1.05] text-brand-fg sm:text-[40px]">{audience.lines.go}</h2>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link to="/signup" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-foil px-7 font-label text-[13px] font-bold uppercase tracking-[0.2em] text-white glow-accent">
            Create your free event <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link to="/#pricing" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] px-7 font-label text-[12px] font-semibold uppercase tracking-[0.18em] text-brand-fg">
            See plans
          </Link>
        </div>
        <button type="button" onClick={() => { setAudience(null); goTo('pick', null); }} className="mt-5 inline-flex min-h-11 items-center gap-2 text-[13px] text-brand-muted underline-offset-4 hover:text-brand-fg hover:underline">
          <RotateCcw className="h-4 w-4" aria-hidden /> Start over as someone else
        </button>
      </div>
    );
  }

  const wallTiles = [
    ...shots.map((s) => ({ key: `s${s.id}`, src: s.src, mine: true })),
    ...WALL_SEED.map((k, i) => ({ key: `${k}${i}`, src: salesImage(k)?.src ?? '', mine: false })),
  ].slice(0, desktop ? 6 : 4);

  return (
    <div className="app-bg fixed inset-0 overflow-hidden text-brand-fg">
      <style>{CSS}</style>
      <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: 'radial-gradient(60% 50% at 25% 35%, rgba(124,108,247,0.22), transparent 70%), radial-gradient(50% 40% at 80% 80%, rgba(34,211,238,0.10), transparent 70%)' }} />

      <div className="relative flex h-full flex-col">
        <header className="z-30 flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="rounded font-serif text-xl font-semibold tracking-wide text-foil-static sm:text-2xl">Beamwall</Link>
          {audience !== null && step !== 'pick' && (
            <nav aria-label="Tour progress" className="liquid-glass hidden items-center gap-1 rounded-full p-1 md:flex">
              {TOUR_STOPS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => goTo(s)}
                  aria-current={s === step ? 'step' : undefined}
                  className={`rounded-full px-3 py-1.5 font-label text-[10px] font-semibold uppercase tracking-[0.16em] transition ${s === step ? 'bg-white/15 text-brand-fg' : i < stopIndex ? 'text-brand-fg/80' : 'text-brand-muted/70'}`}
                >
                  {STOP_LABELS[s]}
                </button>
              ))}
            </nav>
          )}
          <Link to="/signup" className="whitespace-nowrap rounded-full bg-foil px-4 py-2 font-label text-[10px] font-bold uppercase tracking-[0.18em] text-white glow-accent">
            Get started
          </Link>
        </header>

        <div className={`flex min-h-0 flex-1 ${desktop ? 'flex-row' : 'flex-col'}`}>
          {/* Stage: Beamy's home + the live wall he beams onto. */}
          <section
            ref={stageRef}
            aria-label="Beamy's stage"
            className={`relative shrink-0 ${desktop ? 'w-[44%] max-w-[700px]' : 'h-[36dvh] min-h-[230px]'}`}
          >
            <div
              className={`absolute inset-x-4 top-2 grid gap-2 rounded-[20px] border border-white/10 bg-black/30 p-2 transition-opacity duration-500 sm:inset-x-8 ${desktop ? 'grid-cols-3 top-6' : 'grid-cols-4'} ${step === 'snap' ? 'opacity-100' : 'opacity-0'}`}
              aria-hidden={step !== 'snap'}
            >
              <p className="col-span-full flex items-center gap-2 px-1 font-label text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-fg">
                <span className="h-2 w-2 rounded-full bg-rose-400" /> Live wall
              </p>
              {wallTiles.map((t, i) => (
                <div
                  key={t.key}
                  ref={i === 0 ? firstTileRef : undefined}
                  className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-white/[0.05] ${t.mine && i === 0 ? 'by-land' : ''}`}
                  style={t.mine ? { boxShadow: '0 0 0 2px rgba(232,121,249,0.9), 0 0 24px -4px rgba(232,121,249,0.9)' } : undefined}
                >
                  {t.src !== '' && <img src={t.src} alt={t.mine ? 'Your photo on the wall' : ''} className="h-full w-full object-cover" draggable={false} />}
                </div>
              ))}
            </div>
            {!ready && !failed && (
              <p className="by-wake absolute inset-x-0 bottom-[22%] text-center font-label text-[11px] uppercase tracking-[0.24em] text-brand-muted">Beamy is waking up&hellip;</p>
            )}
          </section>

          {/* Panel */}
          <div ref={panelRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2 sm:px-8 lg:pr-12 lg:pt-6">
            <div className="mx-auto w-full max-w-[720px]">{panel}</div>
          </div>
        </div>
      </div>

      {/* Beamy */}
      {!failed && (
        <BeamyStage
          apiRef={api}
          layoutRef={layoutRef}
          bubbleRef={bubbleRef}
          hitRef={hitRef}
          onReady={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      )}
      <div
        ref={bubbleRef}
        role="status"
        aria-live="polite"
        className={`by-bubble pointer-events-none fixed backdrop-blur-xl left-0 top-0 z-50 max-w-[min(340px,calc(100vw-24px))] rounded-2xl px-4 py-3 text-[14px] leading-snug text-brand-fg shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] transition-opacity duration-300 ${ready || failed ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'rgba(22,20,40,0.82)', border: '1px solid rgba(255,255,255,0.14)', ...(failed ? { transform: 'translate3d(16px, 72px, 0)' } : null) }}
      >
        <span className="sr-only">{line}</span>
        <span aria-hidden>{typed}</span>
      </div>
      {ready && (
        <button
          ref={hitRef}
          type="button"
          onClick={poke}
          aria-label="Poke Beamy"
          className="fixed left-0 top-0 z-[45] rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        />
      )}

      {flight !== null && (
        <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden>
          <ParticleBeam key={flight.key} from={flight.from} to={flight.to} shot={flight.shot} durationMs={flight.ms} onDone={flight.onDone} />
        </div>
      )}
    </div>
  );
}

function Eyebrow({ a, children }: { a: Audience; children: ReactNode }) {
  return <p className="font-label text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: a.hue }}>{children}</p>;
}

function NavRow({ onBack, onNext, nextLabel }: { onBack: () => void; onNext: () => void; nextLabel: string }) {
  return (
    <div className="mt-8 flex items-center gap-3">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>
      <button type="button" onClick={onNext} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foil px-5 font-label text-[11px] font-bold uppercase tracking-[0.16em] text-white glow-accent">
        {nextLabel} <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
