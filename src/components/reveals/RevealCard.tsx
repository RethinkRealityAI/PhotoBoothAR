/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RevealCard — the news itself: eyebrow, title, body (line breaks kept), an
 * optional image and the card's own button (hasRevealCta). In the poster the
 * card shows only shapes (the still carries no text). GlowButton is the brand
 * "glowing border" pill: a light face, a bright rim, a soft glow and a spark
 * running round the rim (an SVG dash; still under reduced motion).
 */
import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { hasRevealCta, type RevealDoc } from '../../lib/reveals/revealModel';

interface Props {
  doc: RevealDoc;
  /** The news is out: the card may scroll and its button works. */
  open: boolean;
  /** Play the rise-in. */
  rise: boolean;
  /** Text-free skeleton (the poster). */
  skeleton?: boolean;
  /** Editor preview: links do not navigate the iframe away. */
  inert?: boolean;
}

export default function RevealCard({ doc, open, rise, skeleton = false, inert = false }: Props) {
  const r = doc.reveal;
  if (skeleton) {
    return (
      <div className="rv-card" aria-hidden>
        <div className="rv-card-scroll">
          <span className="rv-skel" style={{ width: '30%', height: 12 }} />
          <span className="rv-skel" style={{ width: '78%', height: 30 }} />
          <span className="rv-skel" style={{ width: '90%', height: 12, opacity: 0.6 }} />
          <span className="rv-skel" style={{ width: '70%', height: 12, opacity: 0.6 }} />
          <span className="rv-skel" style={{ width: '42%', height: 44, marginTop: 10 }} />
        </div>
      </div>
    );
  }
  return (
    <article className="rv-card" data-open={open ? 'true' : 'false'} data-rise={rise ? 'true' : undefined} aria-hidden={open ? undefined : true}>
      <div className="rv-card-scroll">
        {r.eyebrow !== '' && (
          <div className="rv-eyebrow">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 0 L8.4 5.6 L14 7 L8.4 8.4 L7 14 L5.6 8.4 L0 7 L5.6 5.6 Z" fill="var(--rv-core)" /></svg>
            {r.eyebrow}
          </div>
        )}
        <h1 className="rv-display rv-title">{r.title}</h1>
        {r.imageUrl !== '' && <img className="rv-image" src={r.imageUrl} alt="" loading="eager" decoding="async" />}
        {r.body !== '' && <p className="rv-body">{r.body}</p>}
        {hasRevealCta(doc) && <GlowButton label={r.ctaLabel} url={r.ctaUrl} disabled={!open} inert={inert} />}
      </div>
    </article>
  );
}

function GlowButton({ label, url, disabled, inert }: { label: string; url: string; disabled: boolean; inert: boolean }) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const [box, setBox] = useState({ w: 200, h: 52 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setBox({ w: el.offsetWidth, h: el.offsetHeight });
    read();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [label]);
  // The rim path sits 6px outside the face (the svg is 12px larger).
  const w = box.w + 12;
  const h = box.h + 12;
  const rim = (
    <svg className="rv-glowbtn-rim" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <rect x="1" y="1" width={w - 2} height={h - 2} rx={(h - 2) / 2} fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.5" />
      <rect className="rv-glowbtn-spark" x="1" y="1" width={w - 2} height={h - 2} rx={(h - 2) / 2} fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray="5 95" style={{ filter: 'drop-shadow(0 0 4px var(--rv-core)) drop-shadow(0 0 8px #FFFFFF)' }} />
    </svg>
  );
  const common = {
    ref,
    className: 'rv-glowbtn rv-focus',
    tabIndex: disabled ? -1 : undefined,
    onClick: inert ? (e: MouseEvent) => e.preventDefault() : undefined,
  };
  const inner = <>{rim}<span style={{ position: 'relative' }}>{label}</span></>;
  if (url.startsWith('/')) return <Link to={url} {...common}>{inner}</Link>;
  return <a href={url} target="_blank" rel="noopener noreferrer" {...common}>{inner}</a>;
}
