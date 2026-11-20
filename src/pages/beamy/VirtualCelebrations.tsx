/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VirtualCelebrations — the pieces of "How it works" step 6: one shared link
 * goes out, friends' notes, photos and short videos fly in from the edges of
 * the screen and land on a glowing digital card, the card closes into its
 * cover (with the day it goes out), and it goes into an envelope and arrives
 * for Tolu.
 *
 * StoryScenes places the two pieces round Beamy and runs their timeline
 * (lib/beamyStory STORY_SEQ.virtual = lib/beamyVirtual VC_SEQ); each piece
 * only reads `phase` (how many cues have started, 0 = reset, so it replays).
 * The page hears the cues: on 'share' Beamy beams at the card
 * (`data-fx-anchor="virtual"`), on 'deliver' he sparkles.
 *
 * Copy lives in lib/beamyVirtual (pure, tested; it also records what the
 * platform really does). Decorative (the story caption carries the words).
 * The timeline plays for everyone, in the same order; reduced motion only
 * softens it (flights become fades: brand.css, `[data-content-motion="soft"]`).
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarClock, Cake, Check, Link2, Mail, MessageCircle, Play, Send } from 'lucide-react';
import { WALL_POOL } from '../../components/beamy/LiveWall';
import { reached } from '../../lib/beamyMotion';
import { VC_PIECES, VC_SCENE, VC_SEQ, type VcPiece } from '../../lib/beamyVirtual';

const tf = (b: boolean) => (b ? 'true' : 'false');
const at = (phase: number, id: string) => reached(VC_SEQ, phase, id);

/** Where each piece starts its flight, relative to its landing place (px). */
type Flight = { dx: number; dy: number };

/** The photos the pieces show: the hero wall's own (no guest photos). Explicit
 *  pool picks (birthday first, then party scenes), so no two pieces repeat. */
const PICKS = [0, 7, 4, 2, 8, 1];
const photoOf = (k: number) => WALL_POOL[PICKS[k % PICKS.length] % WALL_POOL.length];

/** The share link: title, URL with its copy chip, who it went to. `compact` = one row (phones). */
export function VcLinkPanel({ phase, compact }: { phase: number; compact: boolean }) {
  const S = VC_SCENE;
  const shared = at(phase, 'share');
  const url = (
    <div className={`bw-vc-url ${compact ? 'min-w-0 flex-1' : 'mt-3'}`}>
      <Link2 size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{S.linkUrl}</span>
      <span className="bw-vc-copy" data-done={tf(shared)}>
        {shared ? <><Check size={12} strokeWidth={2.4} aria-hidden /> {S.shared}</> : S.copy}
      </span>
    </div>
  );
  return (
    <div className="bw-vc h-full w-full">
      <div className="bw-scene-card bw-vc-link" data-compact={tf(compact)} data-shared={tf(shared)}>
        {compact ? (
          <div className="flex items-center gap-2.5">
            <span className="bw-scene-badge bw-vc-badge-sm"><Cake size={16} strokeWidth={1.75} aria-hidden /></span>
            {url}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="bw-scene-badge"><Cake size={20} strokeWidth={1.75} aria-hidden /></span>
              <span className="min-w-0 text-[15px] font-semibold leading-tight" style={{ color: 'var(--bw-ink)' }}>{S.linkTitle}</span>
            </div>
            {url}
            <div className="bw-vc-sent mt-3" data-seq={shared ? 'on' : 'off'}>
              <span className="bw-vc-faces" aria-hidden>
                {VC_PIECES.slice(0, 5).map((p) => <span key={p.id}>{p.who.charAt(0)}</span>)}
              </span>
              <span className="bw-scene-tiny flex items-center gap-1.5"><Send size={12} strokeWidth={1.75} aria-hidden /> {S.sentTo}</span>
            </div>
          </>
        )}
        {/* The link going out: three pings leave the panel for the edges. */}
        <span className="bw-vc-pings" data-on={tf(shared)} aria-hidden><i /><i /><i /></span>
      </div>
    </div>
  );
}

/** The card the pieces land on, its cover, the envelope and the arrival. */
export function VcCard({ phase, on, compact }: { phase: number; on: boolean; compact: boolean }) {
  const S = VC_SCENE;
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /* Each piece's flight: from just past the edge it comes from to its place
     on the card (measured from layout when the step comes up, so it is right
     at every width). Left and right: from beyond the screen's edges; top and
     bottom: just past the card. */
  const [flights, setFlights] = useState<Record<string, Flight>>({});
  useLayoutEffect(() => {
    if (!on) return;
    const measure = () => {
      const box = boxRef.current?.getBoundingClientRect();
      if (box === undefined || box.width === 0) return;
      const vw = window.innerWidth;
      const out: Record<string, Flight> = {};
      VC_PIECES.forEach((p, n) => {
        const c = cellRefs.current[n]?.getBoundingClientRect();
        if (c === undefined || c.width === 0) return;
        const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
        const from =
          p.edge === 'left' ? { x: -c.width, y: cy + (n % 2 ? 40 : -40) }
            : p.edge === 'right' ? { x: vw + c.width, y: cy + (n % 2 ? -30 : 30) }
              : p.edge === 'top' ? { x: cx - c.width * 1.6, y: box.top - c.height * 1.4 }
                : { x: cx + c.width * 1.4, y: box.bottom + c.height };
        out[p.id] = { dx: from.x - cx, dy: from.y - cy };
      });
      setFlights(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current !== null) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [on, compact]);

  const landed = VC_PIECES.filter((p) => at(phase, p.cue)).length;
  const closed = at(phase, 'assemble');
  const sent = at(phase, 'deliver');

  const piece = (p: VcPiece, n: number) => {
    const f = flights[p.id] ?? { dx: 0, dy: 0 };
    const style = { ['--dx' as string]: `${f.dx.toFixed(1)}px`, ['--dy' as string]: `${f.dy.toFixed(1)}px`, ['--r' as string]: `${(n % 2 ? 1 : -1) * (8 + n * 2)}deg`, ['--d' as string]: `${(n % 2) * 0.24}s` } as CSSProperties;
    return (
      <div key={p.id} ref={(el) => { cellRefs.current[n] = el; }} className="bw-vc-cell">
        <div className="bw-vc-piece" data-kind={p.kind} data-seq={at(phase, p.cue) ? 'on' : 'off'} style={style}>
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

  return (
    <div className="bw-vc h-full w-full">
      <div ref={boxRef} className="bw-vc-cardbox" data-compact={tf(compact)} data-sent={tf(sent)}>
        <div className="bw-vc-card" data-closed={tf(closed)} data-sent={tf(sent)}>
          <div className="bw-vc-page">
            <div className="flex items-center justify-between gap-2 px-1 pb-2.5">
              <span className="bw-scene-label">{S.page}</span>
              <span className="bw-vc-count tabular-nums">{landed} / 12</span>
            </div>
            <div className="grid grid-cols-3 gap-2">{VC_PIECES.map(piece)}</div>
            {!compact && (
              <div className="mt-2.5 flex justify-center">
                <span className="bw-vc-more" data-seq={at(phase, 'videos') ? 'on' : 'off'}>{S.more}</span>
              </div>
            )}
          </div>
          {/* The card closes: its cover, with three of the photos on it, and the day it goes out. */}
          <div className="bw-vc-cover">
            <div className="bw-vc-collage" aria-hidden>
              {[0, 4, 2].map((k) => <img key={k} src={photoOf(k)} alt="" loading="lazy" decoding="async" />)}
            </div>
            <p className="bw-vc-cover-title">{S.cover}</p>
            <p className="bw-scene-tiny mt-1 text-center">{S.coverSub}</p>
            <span className="bw-vc-when"><CalendarClock size={12} strokeWidth={2} aria-hidden /> {S.when}</span>
          </div>
          {/* A landing: the card's edge glows (restarted per wave). */}
          <span key={`g${Math.min(landed, 6)}`} className="bw-vc-glow" data-run={tf(landed > 0 && !closed)} />
        </div>
        {/* Sent: it slips into an envelope and arrives for Tolu. */}
        <svg className="bw-vc-env" viewBox="0 0 200 110" preserveAspectRatio="none" aria-hidden>
          {/* Body first, then the folds on top (drawn the other way round, the
              opaque body hid the flap and it read as a blank box). */}
          <rect x="6" y="6" width="188" height="98" rx="12" fill="none" />
          <path className="bw-vc-env-fold" d="M8 102 L84 52 M192 102 L116 52" fill="none" />
          <path className="bw-vc-env-flap" d="M6 8 L100 66 L194 8" fill="none" />
          <circle className="bw-vc-env-seal" cx="100" cy="64" r="9" />
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
    </div>
  );
}
