/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VirtualCelebrations — the homepage's "Celebrate from anywhere" stop: one
 * shared link goes out, friends' notes, photos and short videos fly in from
 * the edges of the screen and land on a glowing digital card, the card
 * closes into its cover, and it goes into an envelope and arrives for Tolu.
 *
 * Copy and the scene's order live in lib/beamyVirtual (pure, tested; it also
 * records what the platform really does: the HOST sends the card, nothing is
 * timed). The scene is real DOM, decorative (aria-hidden): the heading and
 * the line above it carry the meaning.
 *
 * Beamy takes part through the page's glide: the `data-slot="virtual"` box
 * is where he stands (between the link and the card), and when the link goes
 * out the page has him beam at the card (`onBeam`, only while he is here).
 * The timeline plays for everyone, in the same order; reduced motion only
 * softens it (flights become fades: brand.css, `[data-content-motion="soft"]`).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Cake, Check, Link2, Mail, MessageCircle, Play, Send } from 'lucide-react';
import ShineText from '../../components/beamy/ShineText';
import { WALL_POOL } from '../../components/beamy/LiveWall';
import { SIGNUP_PATH } from '../../lib/brandLanding';
import { nextChange, phaseAt, reached, type Sequence } from '../../lib/beamyMotion';
import { VC_COPY, VC_PIECES, VC_SCENE, VC_SEQ, type VcPiece } from '../../lib/beamyVirtual';

type Pt = { x: number; y: number };
const tf = (b: boolean) => (b ? 'true' : 'false');

/** Run the timeline while `live`: how many cues have started (0 when not live, so it replays). */
function usePhase(live: boolean, s: Sequence): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!live) { setPhase(0); return; }
    const t0 = performance.now();
    let id = 0;
    const tick = () => {
      const t = performance.now() - t0;
      setPhase(phaseAt(s, t));
      const n = nextChange(s, t);
      if (n !== null) id = window.setTimeout(tick, Math.max(16, n + 4));
    };
    tick();
    return () => window.clearTimeout(id);
  }, [live, s]);
  return phase;
}

/** Where each piece starts its flight, relative to its landing place (px). */
type Flight = { dx: number; dy: number };

/** The photos the pieces show: the hero wall's own (no guest photos). Explicit
 *  pool picks (birthday first, then party scenes), so no two pieces repeat. */
const PICKS = [0, 7, 4, 2, 8, 1];
const photoOf = (k: number) => WALL_POOL[PICKS[k % PICKS.length] % WALL_POOL.length];

export default function VirtualCelebrations({ phone, wide, beamyHere, onBeam }: {
  phone: boolean;
  /** Laptop widths: link · Beamy · card in one row (else stacked). */
  wide: boolean;
  /** Beamy has settled in this stop's slot. */
  beamyHere: boolean;
  /** Have Beamy beam at this viewport point. */
  onBeam: (to: Pt) => void;
}) {
  const S = VC_SCENE;
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const cardBoxRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);

  /* The scene plays once the card is well in view; it resets once the
     section has fully gone, so it replays on the next visit. */
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = cardBoxRef.current;
    if (el === null) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.intersectionRatio >= 0.55) setLive(true);
        else if (!e.isIntersecting) setLive(false);
      }
    }, { threshold: [0, 0.55] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const phase = usePhase(live, VC_SEQ);
  const at = (id: string) => reached(VC_SEQ, phase, id);

  /* Each piece's flight: from just past the edge it comes from to its
     place on the card (measured from layout, so it is right at every width). */
  const [flights, setFlights] = useState<Record<string, Flight>>({});
  useLayoutEffect(() => {
    const measure = () => {
      const sc = sceneRef.current?.getBoundingClientRect();
      if (sc === undefined || sc.width === 0) return;
      const vw = window.innerWidth;
      const out: Record<string, Flight> = {};
      VC_PIECES.forEach((p, n) => {
        const c = cellRefs.current[n]?.getBoundingClientRect();
        if (c === undefined || c.width === 0) return;
        const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
        // Left and right: from beyond the screen's edges; top and bottom: just past the scene.
        const from: Pt =
          p.edge === 'left' ? { x: -c.width, y: cy + (n % 2 ? 40 : -40) }
            : p.edge === 'right' ? { x: vw + c.width, y: cy + (n % 2 ? -30 : 30) }
              : p.edge === 'top' ? { x: cx - c.width * 1.6, y: sc.top - c.height }
                : { x: cx + c.width * 1.4, y: sc.bottom + c.height * 0.6 };
        out[p.id] = { dx: from.x - cx, dy: from.y - cy };
      });
      setFlights(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (sceneRef.current !== null) ro.observe(sceneRef.current);
    return () => ro.disconnect();
  }, [phone, wide]);

  /* The link goes out: Beamy beams at the card (when he is standing here). */
  const shared = at('share');
  const beamyHereRef = useRef(beamyHere);
  beamyHereRef.current = beamyHere;
  const onBeamRef = useRef(onBeam);
  onBeamRef.current = onBeam;
  useEffect(() => {
    if (!shared || !beamyHereRef.current) return;
    const r = cardRef.current?.getBoundingClientRect();
    if (r !== undefined) onBeamRef.current({ x: r.left + r.width / 2, y: r.top + r.height * 0.42 });
  }, [shared]);

  const landed = VC_PIECES.filter((p) => at(p.cue)).length;
  const closed = at('assemble');
  const sent = at('deliver');

  const piece = (p: VcPiece, n: number) => {
    const f = flights[p.id] ?? { dx: 0, dy: 0 };
    const style = { ['--dx' as string]: `${f.dx.toFixed(1)}px`, ['--dy' as string]: `${f.dy.toFixed(1)}px`, ['--r' as string]: `${(n % 2 ? 1 : -1) * (8 + n * 2)}deg`, ['--d' as string]: `${(n % 2) * 0.24}s` } as CSSProperties;
    return (
      <div key={p.id} ref={(el) => { cellRefs.current[n] = el; }} className="bw-vc-cell">
        <div className="bw-vc-piece" data-kind={p.kind} data-seq={at(p.cue) ? 'on' : 'off'} style={style}>
          {p.kind === 'note' ? (
            <div className="bw-vc-note">
              <MessageCircle size={13} strokeWidth={1.75} aria-hidden />
              <p>{p.text}</p>
            </div>
          ) : (
            <div className="bw-vc-media">
              <img src={photoOf(p.photo ?? 0)} alt="" loading="lazy" decoding="async" />
              {p.kind === 'video' && (
                <>
                  <span className="bw-vc-play"><Play size={12} strokeWidth={2} aria-hidden /></span>
                  <span className="bw-vc-dur">{p.text}</span>
                </>
              )}
            </div>
          )}
          <span className="bw-vc-who">{p.who} · {p.from}</span>
        </div>
      </div>
    );
  };

  const linkPanel = (
    <div className="bw-scene-card bw-vc-link" data-seq={at('link') ? 'on' : 'off'} data-shared={tf(shared)}>
      <div className="flex items-center gap-3">
        <span className="bw-scene-badge"><Cake size={20} strokeWidth={1.75} aria-hidden /></span>
        <span className="min-w-0 text-[15px] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{S.linkTitle}</span>
      </div>
      <div className="bw-vc-url mt-3">
        <Link2 size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{S.linkUrl}</span>
        <span className="bw-vc-copy" data-done={tf(shared)}>
          {shared ? <><Check size={12} strokeWidth={2.4} aria-hidden /> {S.shared}</> : S.copy}
        </span>
      </div>
      <div className="bw-vc-sent mt-3" data-seq={shared ? 'on' : 'off'}>
        <span className="bw-vc-faces" aria-hidden>
          {VC_PIECES.slice(0, 5).map((p) => <span key={p.id}>{p.who.charAt(0)}</span>)}
        </span>
        <span className="bw-scene-tiny flex items-center gap-1.5"><Send size={12} strokeWidth={1.75} aria-hidden /> {S.sentTo}</span>
      </div>
      {/* The link going out: three pings leave the panel for the edges. */}
      <span className="bw-vc-pings" data-on={tf(shared)} aria-hidden><i /><i /><i /></span>
    </div>
  );

  const card = (
    <div ref={cardBoxRef} className="bw-vc-cardbox" data-sent={tf(sent)}>
      <div ref={cardRef} className="bw-vc-card" data-closed={tf(closed)} data-sent={tf(sent)}>
        <div className="bw-vc-page">
          <div className="flex items-center justify-between gap-2 px-1 pb-2.5">
            <span className="bw-scene-label">{S.page}</span>
            <span className="bw-vc-count tabular-nums">{landed} / 12</span>
          </div>
          <div className="grid grid-cols-3 gap-2">{VC_PIECES.map(piece)}</div>
          <div className="mt-2.5 flex justify-center">
            <span className="bw-vc-more" data-seq={at('videos') ? 'on' : 'off'}>{S.more}</span>
          </div>
        </div>
        {/* The card closes: its cover, with three of the photos on it. */}
        <div className="bw-vc-cover">
          <div className="bw-vc-collage" aria-hidden>
            {[0, 4, 2].map((k) => <img key={k} src={photoOf(k)} alt="" loading="lazy" decoding="async" />)}
          </div>
          <p className="bw-vc-cover-title">{S.cover}</p>
          <p className="bw-scene-tiny mt-1 text-center">{S.coverSub}</p>
        </div>
        {/* A landing: the card's edge glows (restarted per wave). */}
        <span key={`g${Math.min(landed, 6)}`} className="bw-vc-glow" data-run={tf(landed > 0 && !closed)} />
      </div>
      {/* Sent: it slips into an envelope and arrives for Tolu. */}
      <svg className="bw-vc-env" viewBox="0 0 200 110" preserveAspectRatio="none" aria-hidden>
        <path d="M6 6 L100 62 L194 6" fill="none" />
        <rect x="6" y="6" width="188" height="98" rx="12" fill="none" />
      </svg>
      <div className="bw-vc-mail">
        <span className="bw-scene-badge bw-vc-mail-icon"><Mail size={20} strokeWidth={1.75} aria-hidden /></span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{S.mailTitle}</span>
          <span className="bw-scene-tiny mt-0.5 block">{S.mailBody}</span>
          <span className="bw-vc-from mt-1 block">{S.mailFrom}</span>
        </span>
      </div>
    </div>
  );

  const cta = (
    <Link to={SIGNUP_PATH} className={`bw-btn bw-btn-glow ${phone ? 'w-full' : 'bw-btn-lg'}`}>
      <span aria-hidden className="bw-btn-sheen" />
      <span className="relative z-[1]">{VC_COPY.cta}</span>
    </Link>
  );

  const secCls = `bw-sec bw-vc relative mx-auto w-full max-w-[1320px] ${phone ? 'px-5 py-14' : 'px-[clamp(40px,6vw,104px)] py-[clamp(72px,11vh,130px)]'}`;
  return (
    <section id="virtual" data-stop="virtual" aria-labelledby="h-virtual" className={secCls} data-live={tf(live)} data-phase={phase}>
      <div className={`bw-in ${wide ? 'max-w-[620px]' : ''}`}>
        <h2 id="h-virtual" className="bw-h2">{VC_COPY.heading} <ShineText text={VC_COPY.shine} /></h2>
        <p className="bw-body mt-2 max-w-[56ch]">{VC_COPY.line}</p>
      </div>
      {wide ? (
        <div ref={sceneRef} className="bw-vc-scene mt-8 grid grid-cols-[minmax(0,0.95fr)_minmax(0,0.5fr)_minmax(0,1.05fr)] items-end gap-[clamp(16px,2.4vw,40px)]">
          <div className="flex flex-col items-start gap-6">
            <div aria-hidden className="w-full max-w-[400px]">{linkPanel}</div>
            {cta}
          </div>
          <div className="flex h-[min(420px,52vh)] items-end justify-center">
            <div data-slot="virtual" data-yaw="0.4" aria-hidden className="h-full w-full max-w-[260px]" />
          </div>
          <div aria-hidden className="flex justify-center">{card}</div>
        </div>
      ) : (
        <div ref={sceneRef} className="bw-vc-scene mt-6 flex flex-col items-center">
          <div aria-hidden className="w-full max-w-[460px]">{linkPanel}</div>
          <div data-slot="virtual" data-yaw="0" data-bubble="none" aria-hidden className={`mt-1 w-[60%] max-w-[240px] ${phone ? 'h-[20svh]' : 'h-[28svh]'}`} />
          <div aria-hidden className="w-full max-w-[460px]">{card}</div>
          <div className={`mt-8 ${phone ? 'w-full' : ''}`}>{cta}</div>
        </div>
      )}
    </section>
  );
}
