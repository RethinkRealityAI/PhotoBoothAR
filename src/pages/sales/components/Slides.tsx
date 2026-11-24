/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One designed layout per SlideKind, each in two modes:
 *  - 'stage': a fixed 1280×720 canvas the deck viewer scales to fit (desktop,
 *    presenting, print). Sizes are absolute px on purpose — the whole canvas
 *    scales as one, so type keeps its proportions at any window size.
 *  - 'card': a full-width responsive card for phones, where a shrunken 16:9
 *    canvas would make 12px text. Same content, re-flowed vertically.
 *
 * Every renderer tolerates missing optional fields — the content is authored
 * by hand and a slide without bullets must still look finished.
 * Speaker notes are NEVER rendered here; the viewer owns that panel.
 *
 * Brand v2 (src/styles/brand.css): every deck shares ONE look — the slide is
 * a flat liquid-glass pane over the periwinkle scene, white ink, Bricolage
 * for display and Geist for text, sentence case, white pill CTAs. There is no
 * per-deck accent colour any more; the warm core (--bw-core) is kept for the
 * deck's progress bar only. Nothing on a stage is set below 14px (it renders
 * at ~1:1 on a laptop) and nothing on a card below 12px.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, Camera, Check, Expand, MousePointerClick, Quote as QuoteIcon, X as XIcon } from 'lucide-react';
import type { Offer, Slide, SlideStat } from '../../../lib/salesTypes';
import FilmEmbed from '../../../components/ui/FilmEmbed';
import { demoKit, tryPath } from '../../../lib/demoKits';
import { salesImage } from '../salesImages';
import { isLiveWallKey, salesVideo } from '../salesVideos';
import { DeckWall, LooksBoard, StepArt } from './DeckVisuals';
import { iconFor } from './salesIcons';
import { hasShowcase, ShowcaseModal } from './Showcase';

export const STAGE_W = 1280;
export const STAGE_H = 720;

export interface DeckCta {
  href: string;
  label: string;
  /** true = a full URL / mailto (plain <a>); false = an in-app route (<Link>). */
  external: boolean;
}

export interface SlideEnv {
  mode: 'stage' | 'card';
  /** Offers for an offer slide, already filtered for the audience. */
  offersFor: (ids: readonly string[] | undefined) => Offer[];
  /** Price shown on a card — publicOfferPrice() on prospect pages. */
  priceFor: (o: Offer) => string;
  /** Hub only: badge unconfirmed prices. */
  placeholderBadges: boolean;
  primaryCta: DeckCta;
  secondaryCta?: DeckCta;
  /** "James Asumah · Director of Partnerships" or ''. */
  contactLine: string;
  /** Print renders offscreen: lazy images would never load. */
  eagerImages?: boolean;
  /** Print and thumbnails: posters instead of films, no iframe, no modals. */
  still?: boolean;
}

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

// ── Brand v2 ───────────────────────────────────────────────────────────────

/** The display face (Bricolage), lining figures for prices and stats. */
const DISPLAY = 'font-[family-name:var(--bw-font-display)] [font-variant-numeric:lining-nums_tabular-nums] tracking-[-0.022em]';
/** Ink on the pane: white, Ink 2 (86%) for body, 80% for captions. Measured
 *  on the composited pane (PANE below): white ≥7.2:1 and 80% ≥5.2:1 over the
 *  field the slide sits on; white still 4.9:1 over the scene's brightest glow. */
const MUTED = 'text-white/[0.86]';
const FAINT = 'text-white/80';
/** A card ON the pane: a clear frost and an inset light edge, never a border. */
const CARD = 'bg-white/[0.07] shadow-[inset_1px_1px_0_rgba(255,255,255,0.34),inset_-1px_-1px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_rgba(255,255,255,0.10)]';
/** An icon tile / marker: frosted, hairline rim, white glyph. */
const TILE = 'bg-white/[0.12] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]';
/** Soft drop under pictures and films (deep indigo, never a coloured bloom). */
const DROP = '0 30px 70px -34px rgba(22, 18, 78, 0.75)';
/** A lighter glow of the same hue behind a hero picture. */
const GLOW = 'radial-gradient(closest-side, rgba(134, 125, 240, 0.55), transparent)';
const PRIMARY = 'bg-foil';
const SECONDARY = 'border-[1.5px] border-white/70 bg-[rgba(26,23,64,0.12)] text-white hover:border-white hover:bg-[rgba(26,23,64,0.28)]';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

/**
 * The slide pane: brand v2 flat liquid glass (.bw-glass's recipe — indigo
 * veil, milky frost as an inset fill, a crisp rim brightest top-left), with
 * a deeper veil than the landing's panel because a slide is dense and sits
 * over the whole scene, glows included.
 */
export const PANE: CSSProperties = {
  backgroundColor: 'rgba(36, 32, 120, 0.40)',
  WebkitBackdropFilter: 'blur(36px) saturate(108%)',
  backdropFilter: 'blur(36px) saturate(108%)',
  boxShadow: [
    'inset 1px 1px 0 rgba(255, 255, 255, 0.62)',
    'inset -1px -1px 0 rgba(255, 255, 255, 0.10)',
    'inset 0 0 0 1px rgba(255, 255, 255, 0.14)',
    'inset 3px 3px 10px -6px rgba(255, 255, 255, 0.40)',
    'inset 0 0 0 100vmax rgba(255, 255, 255, 0.08)',
  ].join(', '),
};

// ── Shared atoms ───────────────────────────────────────────────────────────

/** A short line of context with a short rule under it (.bw-eyebrow). */
function Eyebrow({ env, children, center = false }: { env: SlideEnv; children: ReactNode; center?: boolean }) {
  const stage = env.mode === 'stage';
  return (
    <p className={cx('flex flex-col font-medium leading-[1.3] text-white', center ? 'items-center' : 'items-start', stage ? 'gap-3 text-[20px]' : 'gap-2.5 text-[14px]')}>
      {children}
      <span aria-hidden className={cx('block rounded-full bg-white/70', stage ? 'h-[2px] w-9' : 'h-[2px] w-7')} />
    </p>
  );
}

/** `display` = the cover/close headline (heavier, tighter, .bw-display);
 *  otherwise a section heading (.bw-h2). Always solid white ink. */
function Title({ env, children, size = 'lg', display = false, center = false }: {
  env: SlideEnv;
  children: ReactNode;
  size?: 'xl' | 'xlLong' | 'lg' | 'md';
  display?: boolean;
  center?: boolean;
}) {
  const stage = { xl: 'text-[84px] leading-[1.0]', xlLong: 'text-[70px] leading-[1.02]', lg: 'text-[58px] leading-[1.05]', md: 'text-[46px] leading-[1.08]' }[size];
  const card = { xl: 'text-[40px] leading-[1.04]', xlLong: 'text-[36px] leading-[1.06]', lg: 'text-[32px] leading-[1.1]', md: 'text-[28px] leading-[1.12]' }[size];
  return (
    <h2
      className={cx(
        DISPLAY,
        'text-balance text-white',
        display ? 'font-[760] tracking-[-0.034em]' : 'font-[700]',
        env.mode === 'stage' ? stage : card,
        center && 'text-center',
        env.mode === 'stage' ? 'mt-4' : 'mt-2',
      )}
    >
      {children}
    </h2>
  );
}

function Body({ env, children, center = false }: { env: SlideEnv; children: ReactNode; center?: boolean }) {
  return (
    <p
      className={cx(
        'text-pretty',
        MUTED,
        env.mode === 'stage' ? 'mt-5 text-[22px] leading-[1.5]' : 'mt-3 text-[15.5px] leading-relaxed',
        center && 'mx-auto text-center',
      )}
    >
      {children}
    </p>
  );
}

function SlideImg({ k, env, className = '', fit = 'contain' }: {
  k: string | undefined;
  env: SlideEnv;
  className?: string;
  fit?: 'contain' | 'cover';
}) {
  const img = salesImage(k);
  if (img === null) return null;
  const loading = env.eagerImages === true ? 'eager' : 'lazy';
  if (img.cutout) {
    return (
      <img
        src={img.src}
        width={img.width}
        height={img.height}
        alt={img.alt}
        loading={loading}
        decoding="async"
        draggable={false}
        className={cx('h-full w-full select-none object-contain', className)}
        style={{ filter: 'drop-shadow(0 24px 40px rgba(22, 18, 78, 0.45))' }}
      />
    );
  }
  // Scenes (and the dark-background Beamy renders): a soft radial mask lets
  // the picture's own black dissolve into the slide instead of a hard box,
  // and a `lighten` blend over a patch of the pane's own colour (#3B3C93 =
  // PANE over --bw-bg) drops that black out, so it never sits on the glass as
  // a dark halo. The patch is needed because the slide's entrance animation
  // isolates its content: there is no pane behind the picture to blend with.
  const beamy = (k ?? '').startsWith('beamy');
  return (
    <div
      className={cx('relative h-full w-full overflow-hidden', !beamy && 'rounded-[24px] ring-1 ring-white/20', className)}
      style={
        beamy
          ? { maskImage: 'radial-gradient(closest-side, #000 62%, transparent)', WebkitMaskImage: 'radial-gradient(closest-side, #000 62%, transparent)' }
          : { boxShadow: DROP }
      }
    >
      {beamy && <div aria-hidden className="absolute inset-0 bg-[#3B3C93]" />}
      <img
        style={beamy ? { position: 'relative', mixBlendMode: 'lighten' } : undefined}
        src={img.src}
        width={img.width}
        height={img.height}
        alt={img.alt}
        loading={loading}
        decoding="async"
        draggable={false}
        className={cx('h-full w-full select-none', fit === 'cover' ? 'object-cover' : 'object-contain')}
      />
      {!beamy && <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#1A1740]/35 via-transparent to-transparent" />}
    </div>
  );
}

/** A slide's film (managed autoplay), or its poster when the slide is still. */
function SlideFilm({ k, env, className = '' }: { k: string | undefined; env: SlideEnv; className?: string }) {
  if (isLiveWallKey(k)) return <DeckWall mode={env.mode} eager={env.eagerImages === true} className={className} />;
  const v = salesVideo(k);
  if (v === null) return null;
  return (
    <div className={cx('overflow-hidden rounded-[24px] ring-1 ring-white/20', className)} style={{ boxShadow: DROP }}>
      {env.still === true ? (
        <img src={v.poster} alt={v.label} loading={env.eagerImages === true ? 'eager' : 'lazy'} className="block h-auto w-full" draggable={false} />
      ) : (
        <FilmEmbed src={v.src} poster={v.poster} label={v.label} />
      )}
    </div>
  );
}

export function CtaLink({ cta, primary, env, className = '' }: { cta: DeckCta; primary: boolean; env: SlideEnv; className?: string }) {
  const cls = cx(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold leading-none tracking-[-0.005em] transition active:scale-[0.98]',
    FOCUS,
    env.mode === 'stage' ? 'min-h-[60px] px-8 text-[19px]' : 'min-h-12 px-6 text-[15px]',
    primary ? PRIMARY : SECONDARY,
    className,
  );
  const inner = (
    <>
      {cta.label}
      {primary && <ArrowRight className={env.mode === 'stage' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />}
    </>
  );
  if (cta.external) {
    const mail = cta.href.startsWith('mailto:');
    return (
      <a href={cta.href} className={cls} {...(mail ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={cta.href} className={cls}>
      {inner}
    </Link>
  );
}

function Bullets({ env, items, tone = 'check' }: { env: SlideEnv; items: string[]; tone?: 'check' | 'pain' }) {
  const stage = env.mode === 'stage';
  const Icon = tone === 'check' ? Check : XIcon;
  return (
    <ul className={cx('flex flex-col', stage ? 'mt-7 gap-4' : 'mt-5 gap-3')}>
      {items.map((b, i) => (
        <li key={i} className={cx('flex items-start text-white', stage ? 'gap-4 text-[21px] leading-snug' : 'gap-3 text-[15px] leading-snug')}>
          <span
            className={cx('mt-0.5 flex shrink-0 items-center justify-center rounded-full', stage ? 'h-8 w-8' : 'h-6 w-6', tone === 'check' && TILE)}
            style={
              tone === 'check'
                ? undefined
                : { background: 'rgba(255, 196, 202, 0.12)', color: 'var(--bw-danger)', boxShadow: 'inset 0 0 0 1px rgba(255, 196, 202, 0.34)' }
            }
            aria-hidden
          >
            <Icon className={stage ? 'h-4 w-4' : 'h-3.5 w-3.5'} strokeWidth={2.5} />
          </span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

/** Footnotes for any stat that carries a source — never an unsourced figure. */
function Footnotes({ env, stats }: { env: SlideEnv; stats: SlideStat[] | undefined }) {
  const sourced = (stats ?? []).map((s, i) => ({ s, i })).filter(({ s }) => s.source !== undefined && s.source !== '');
  if (sourced.length === 0) return null;
  return (
    <ol className={cx(FAINT, env.mode === 'stage' ? 'mt-auto flex flex-wrap gap-x-6 gap-y-1 pt-6 text-[14px]' : 'mt-5 flex flex-col gap-1 text-[12px]')}>
      {sourced.map(({ s, i }) => (
        <li key={i}>
          <sup className={cx('mr-1', env.mode === 'stage' ? 'text-[14px]' : 'text-[12px]')}>{i + 1}</sup>
          {s.source}
        </li>
      ))}
    </ol>
  );
}

function hasSource(s: SlideStat) {
  return s.source !== undefined && s.source !== '';
}

// ── Layouts ────────────────────────────────────────────────────────────────

function Cover({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const img = slide.image ?? 'beamy';
  if (!stage) {
    return (
      <div className="flex flex-col">
        <div className="mx-auto aspect-square w-56 max-w-full"><SlideImg k={img} env={env} /></div>
        {slide.eyebrow !== undefined && <div className="mt-4"><Eyebrow env={env}>{slide.eyebrow}</Eyebrow></div>}
        <Title env={env} size={slide.title.length > 26 ? 'xlLong' : 'xl'} display>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-[1.15fr_0.85fr] items-center gap-10">
      <div className="flex flex-col">
        {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
        <Title env={env} size={slide.title.length > 26 ? 'xlLong' : 'xl'} display>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
      </div>
      <div className="relative flex h-[540px] items-center justify-center">
        <div aria-hidden className="absolute inset-10 rounded-full blur-3xl" style={{ background: GLOW }} />
        <SlideImg k={img} env={env} fit="cover" className="relative" />
      </div>
    </div>
  );
}

function Problem({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const points = slide.bullets ?? slide.items?.map((it) => (it.body !== undefined ? `${it.title} — ${it.body}` : it.title)) ?? [];
  const list = (
    <ol className={cx('flex flex-col', stage ? 'gap-4' : 'mt-5 gap-3')}>
      {points.map((p, i) => (
        <li
          key={i}
          className={cx('flex items-start rounded-[20px]', CARD, stage ? 'gap-5 px-6 py-5' : 'gap-3 px-4 py-3.5')}
        >
          <span className={cx(DISPLAY, 'font-[300] text-white/80', stage ? 'text-[30px] leading-none' : 'text-[20px] leading-none')}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className={cx('text-white', stage ? 'text-[20px] leading-snug' : 'text-[15px] leading-snug')}>{p}</span>
        </li>
      ))}
    </ol>
  );
  if (!stage) {
    return (
      <div className="flex flex-col">
        {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
        <Title env={env}>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {points.length > 0 ? list : slide.image !== undefined && <div className="mt-5 aspect-[4/3]"><SlideImg k={slide.image} env={env} fit="cover" /></div>}
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-[0.9fr_1.1fr] items-center gap-14">
      <div className="flex flex-col">
        {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
        <Title env={env}>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
      </div>
      {points.length > 0 ? list : <div className="h-[520px]"><SlideImg k={slide.image} env={env} fit="cover" /></div>}
    </div>
  );
}

function ItemsList({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  if (slide.items === undefined || slide.items.length === 0) return null;
  return (
    <div className={cx('grid', stage ? 'mt-7 grid-cols-2 gap-4' : 'mt-5 gap-3')}>
      {slide.items.map((it, i) => {
        const Icon = iconFor(it.icon);
        return (
          <div key={i} className={cx('flex items-start gap-3 rounded-[20px]', CARD, stage ? 'p-4' : 'p-3.5')}>
            <Icon className={cx('shrink-0 text-white', stage ? 'h-6 w-6' : 'h-5 w-5')} strokeWidth={1.5} aria-hidden />
            <div>
              <p className={cx('font-semibold text-white', stage ? 'text-[18px]' : 'text-[14.5px]')}>{it.title}</p>
              {it.body !== undefined && <p className={cx('mt-1', MUTED, stage ? 'text-[15px] leading-snug' : 'text-[13.5px] leading-snug')}>{it.body}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Solution({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const img = slide.image;
  const text = (
    <div className="flex flex-col">
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env}>{slide.title}</Title>
      {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
      {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
      <ItemsList slide={slide} env={env} />
    </div>
  );
  const film = salesVideo(slide.video) !== null || isLiveWallKey(slide.video);
  if (!stage) {
    return (
      <div className="flex flex-col">
        {film && <SlideFilm k={slide.video} env={env} className={isLiveWallKey(slide.video) ? 'mb-9' : 'mb-5'} />}
        {!film && img !== undefined && salesImage(img) !== null && (
          <div className={cx('mb-5', salesImage(img)?.cutout === true ? 'mx-auto aspect-square w-60 max-w-full' : 'aspect-[4/3] w-full')}>
            <SlideImg k={img} env={env} fit="cover" />
          </div>
        )}
        {text}
      </div>
    );
  }
  if (film) {
    return (
      <div className="grid h-full grid-cols-[0.8fr_1.2fr] items-center gap-12">
        {text}
        <SlideFilm k={slide.video} env={env} />
      </div>
    );
  }
  if (img === undefined || salesImage(img) === null) return <div className="flex h-full max-w-[920px] flex-col justify-center">{text}</div>;
  return (
    <div className="grid h-full grid-cols-[0.82fr_1.18fr] items-center gap-14">
      <div className="h-[560px]"><SlideImg k={img} env={env} fit="cover" /></div>
      {text}
    </div>
  );
}

function How({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const steps: { title: string; body?: string }[] = slide.items ?? (slide.bullets ?? []).map((b) => ({ title: b }));
  return (
    <div className={cx('flex flex-col', stage && 'h-full')}>
      <div className={cx(stage && 'text-center')}>
        {slide.eyebrow !== undefined && <Eyebrow env={env} center={stage}>{slide.eyebrow}</Eyebrow>}
        <Title env={env} center={stage}>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env} center={stage}>{slide.body}</Body>}
      </div>
      <ol className={cx(stage ? 'mt-auto grid grid-cols-3 gap-8' : 'mt-6 flex flex-col gap-4')}>
        {steps.map((s, i) => {
          return (
            <li key={i} className={cx('relative flex', stage ? 'flex-col items-center text-center' : cx('items-center gap-4 rounded-[20px] p-3', CARD))}>
              <div className={cx('relative shrink-0', stage ? 'h-[230px] w-[230px]' : 'h-20 w-20')}>
                <StepArt index={i} mode={env.mode} eager={env.eagerImages === true} />
                <span
                  className={cx('absolute flex items-center justify-center rounded-full bg-[color:var(--bw-core)] font-semibold tabular-nums text-[color:var(--bw-on-accent)] shadow-[0_8px_20px_-10px_rgba(26,23,64,0.6)]', stage ? '-left-1 top-2 h-11 w-11 text-[18px]' : '-left-1 -top-1 h-7 w-7 text-[13px]')}
                  aria-hidden
                >
                  {i + 1}
                </span>
              </div>
              <div className={stage ? 'mt-3' : ''}>
                <p className={cx(DISPLAY, 'font-[680] text-white', stage ? 'text-[30px]' : 'text-[20px]')}>
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </p>
                {s.body !== undefined && (
                  <p className={cx(MUTED, stage ? 'mt-2 text-[17px] leading-snug' : 'mt-1 text-[14px] leading-snug')}>{s.body}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Features({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const items = slide.items ?? (slide.bullets ?? []).map((b) => ({ title: b, icon: undefined, body: undefined, showcase: undefined }));
  const cols = items.length === 4 ? 'grid-cols-2' : 'grid-cols-3';
  const [open, setOpen] = useState<number | null>(null);
  const interactive = env.still !== true && items.some((it) => hasShowcase(it.showcase));
  return (
    <div className={cx('flex flex-col', stage && 'h-full')}>
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env} size="md">{slide.title}</Title>
      {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
      {interactive && (
        <p className={cx('flex items-center gap-2', FAINT, stage ? 'mt-3 text-[15px]' : 'mt-2 text-[13px]')}>
          <MousePointerClick className={cx('text-white', stage ? 'h-4 w-4' : 'h-3.5 w-3.5')} strokeWidth={1.75} aria-hidden />
          Tap any feature to see it
        </p>
      )}
      <div className={cx('grid', stage ? `mt-auto ${cols} gap-5` : 'mt-6 grid-cols-1 gap-3 min-[420px]:grid-cols-2')}>
        {items.map((it, i) => {
          const Icon = iconFor(it.icon);
          const opens = interactive && hasShowcase(it.showcase);
          const Tag = opens ? 'button' : 'div';
          return (
            <Tag
              key={i}
              {...(opens ? { type: 'button' as const, onClick: () => setOpen(i), 'aria-haspopup': 'dialog' as const } : {})}
              className={cx(
                'relative rounded-[20px] text-left',
                CARD,
                stage ? 'p-6' : 'p-4',
                opens && cx('group cursor-pointer transition hover:-translate-y-0.5 hover:bg-white/[0.11] active:scale-[0.99]', FOCUS),
              )}
            >
              {opens && (
                <span
                  className={cx('absolute flex items-center gap-1 rounded-full bg-white/[0.14] font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)] transition group-hover:bg-white/[0.22]', stage ? 'right-4 top-4 px-3 py-1 text-[14px]' : 'right-3 top-3 px-2.5 py-0.5 text-[12px]')}
                  aria-hidden
                >
                  See it <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
              )}
              <span
                className={cx('flex items-center justify-center rounded-[12px]', TILE, stage ? 'h-12 w-12' : 'h-10 w-10')}
                aria-hidden
              >
                <Icon className={stage ? 'h-6 w-6' : 'h-5 w-5'} strokeWidth={1.5} />
              </span>
              <p className={cx('font-semibold text-white', stage ? 'mt-4 text-[21px]' : 'mt-3 text-[15.5px]')}>{it.title}</p>
              {it.body !== undefined && (
                <p className={cx(MUTED, stage ? 'mt-2 text-[16px] leading-snug' : 'mt-1 text-[13.5px] leading-snug')}>{it.body}</p>
              )}
            </Tag>
          );
        })}
      </div>
      {open !== null && <ShowcaseModal items={items} start={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Long stat values ("₦396.5bn") step down so the display face, which is
 *  wider than a serif, never runs past its card. */
function statClass(value: string, stage: boolean): string {
  const long = value.length > 6;
  const vlong = value.length > 9;
  if (!stage) return vlong ? 'text-[30px]' : long ? 'text-[34px]' : 'text-[40px]';
  return vlong ? 'text-[44px]' : long ? 'text-[52px]' : 'text-[64px]';
}

function Proof({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const stats = slide.stats ?? [];
  const content = (
    <div className={cx('flex flex-col', stage && 'h-full')}>
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env} size="md">{slide.title}</Title>
      {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
      {stats.length > 0 && (
        <dl className={cx('grid', stage ? `mt-12 gap-6 ${stats.length >= 4 ? 'grid-cols-4' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}` : 'mt-6 grid-cols-1 gap-3 min-[420px]:grid-cols-2')}>
          {stats.map((s, i) => (
            <div key={i} className={cx('flex flex-col-reverse rounded-[20px]', CARD, stage ? 'p-7' : 'p-4')}>
              <dt className={cx(MUTED, stage ? 'mt-3 text-[17px] leading-snug' : 'mt-1.5 text-[13.5px] leading-snug')}>
                {s.label}
                {hasSource(s) && <sup className={cx('ml-0.5 text-white/80', stage ? 'text-[14px]' : 'text-[12px]')}>{i + 1}</sup>}
              </dt>
              <dd className={cx(DISPLAY, 'font-[720] leading-none text-white', statClass(s.value, stage))}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
      {stats.length === 0 && <ItemsList slide={slide} env={env} />}
      <Footnotes env={env} stats={stats} />
    </div>
  );
  // On stage the picture fills the right half; without it the slide read as
  // half-empty (the image was declared but never drawn).
  if (!stage || salesImage(slide.image) === null) return content;
  return (
    <div className="grid h-full grid-cols-[1.2fr_0.8fr] items-center gap-10">
      {content}
      <div className="relative h-[540px]">
        <div aria-hidden className="absolute inset-8 rounded-full blur-3xl" style={{ background: GLOW }} />
        <SlideImg k={slide.image} env={env} fit="cover" className="relative" />
      </div>
    </div>
  );
}

/** Long prices ("From ₦600,000", "Tailored quote") step down so they never
 *  overflow a narrow card — at 390px or in a four-up stage row. */
function priceClass(price: string, stage: boolean, many: boolean): string {
  const long = price.length > 9;
  const vlong = price.length > 13;
  if (!stage) return vlong ? 'mt-2 text-[26px]' : long ? 'mt-2 text-[30px]' : 'mt-2 text-[34px]';
  if (many) return vlong ? 'mt-3 text-[28px]' : long ? 'mt-3 text-[32px]' : 'mt-3 text-[40px]';
  return vlong ? 'mt-3 text-[34px]' : long ? 'mt-3 text-[40px]' : 'mt-3 text-[48px]';
}

function OfferSlide({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const offers = env.offersFor(slide.offerIds);
  const many = offers.length >= 4;
  return (
    <div className={cx('flex flex-col', stage && 'h-full')}>
      <div className={cx(stage && 'text-center')}>
        {slide.eyebrow !== undefined && <Eyebrow env={env} center={stage}>{slide.eyebrow}</Eyebrow>}
        <Title env={env} size="md" center={stage}>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env} center={stage}>{slide.body}</Body>}
      </div>
      <div
        className={cx('grid', stage ? 'mt-auto gap-4 pt-6' : 'mt-6 gap-3')}
        style={stage ? { gridTemplateColumns: `repeat(${Math.max(1, Math.min(offers.length, 4))}, minmax(0, 1fr))` } : undefined}
      >
        {offers.map((o, i) => {
          const featured = offers.length > 1 && i === Math.min(1, offers.length - 1);
          return (
            <div
              key={o.id}
              className={cx(
                'relative flex min-w-0 flex-col rounded-[20px]',
                // Featured: a brighter frost and a full white rim (still flat glass).
                featured
                  ? 'bg-white/[0.12] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.72),0_24px_50px_-28px_rgba(22,18,78,0.7)]'
                  : CARD,
                stage ? (many ? 'p-5' : 'p-7') : 'p-5',
              )}
            >
              {env.placeholderBadges && o.placeholder && (
                <span className="absolute right-4 top-4 rounded-full bg-[rgba(255,197,107,0.14)] px-2.5 py-1 text-[12px] font-semibold text-[color:var(--bw-core)] shadow-[inset_0_0_0_1px_rgba(255,197,107,0.45)]">
                  Placeholder
                </span>
              )}
              <p className={cx('font-semibold leading-snug text-white', stage ? 'text-[16px]' : 'text-[14px]', env.placeholderBadges && o.placeholder && 'pr-24')}>{o.name}</p>
              <p className={cx('break-words font-[720] leading-[1.05] text-white', DISPLAY, priceClass(env.priceFor(o), stage, many))}>
                {env.priceFor(o)}
              </p>
              <p className={cx(FAINT, stage ? 'mt-1 text-[14px]' : 'mt-1 text-[13px]')}>{o.unit}</p>
              <p className={cx('text-white', stage ? (many ? 'mt-3 text-[15px] leading-snug' : 'mt-4 text-[16px] leading-snug') : 'mt-3 text-[14px] leading-snug')}>{o.blurb}</p>
              <ul className={cx('flex flex-col', stage ? 'mt-4 gap-2' : 'mt-3 gap-1.5')}>
                {o.features.slice(0, many ? 3 : 5).map((f, j) => (
                  <li key={j} className={cx('flex items-start gap-2', MUTED, stage ? 'text-[14.5px] leading-snug' : 'text-[13px] leading-snug')}>
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" strokeWidth={2.25} aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {slide.bullets !== undefined && slide.bullets.length > 0 && (
        <p className={cx(FAINT, stage ? 'mt-5 text-center text-[14px]' : 'mt-4 text-[13px]')}>{slide.bullets.join(' · ')}</p>
      )}
    </div>
  );
}

function Roi({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const rows: { label: string; value: string; idx: number; sourced: boolean }[] =
    slide.stats !== undefined && slide.stats.length > 0
      ? slide.stats.map((s, i) => ({ label: s.label, value: s.value, idx: i, sourced: hasSource(s) }))
      : (slide.items ?? []).map((it, i) => ({ label: it.title, value: it.body ?? '', idx: i, sourced: false }));
  const text = (
    <div className="flex flex-col">
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env} size="md">{slide.title}</Title>
      {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
    </div>
  );
  const table = (
    <div className={cx('overflow-hidden rounded-[20px]', CARD)}>
      <table className="w-full border-collapse">
        <caption className="sr-only">{slide.title}</caption>
        <tbody>
          {rows.map((r, i) => {
            const total = rows.length > 1 && i === rows.length - 1;
            return (
              <tr key={i} className={cx(i > 0 && 'border-t border-white/[0.14]', total && 'bg-white/[0.10]')}>
                <th scope="row" className={cx('text-left font-normal', total ? 'font-semibold text-white' : MUTED, stage ? 'px-7 py-4 text-[18px]' : 'px-4 py-3 text-[13.5px]')}>
                  {r.label}
                  {r.sourced && <sup className={cx('ml-0.5 text-white/80', stage ? 'text-[14px]' : 'text-[12px]')}>{r.idx + 1}</sup>}
                </th>
                <td className={cx('text-right text-white', DISPLAY, total ? 'font-[760]' : 'font-[680]', stage ? (total ? 'px-7 py-4 text-[34px]' : 'px-7 py-4 text-[26px]') : (total ? 'px-4 py-3 text-[24px]' : 'px-4 py-3 text-[18px]'))}>
                  {r.value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const assumptions = slide.bullets !== undefined && slide.bullets.length > 0 && (
    <ul className={cx(FAINT, stage ? 'mt-4 flex flex-col gap-1 text-[14px]' : 'mt-3 flex flex-col gap-1 text-[12px]')}>
      {slide.bullets.map((b, i) => <li key={i}>· {b}</li>)}
    </ul>
  );
  if (!stage) {
    return (
      <div className="flex flex-col">
        {text}
        <div className="mt-5">{table}</div>
        {assumptions}
        <Footnotes env={env} stats={slide.stats} />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-[0.85fr_1.15fr] items-center gap-12">
        {text}
        <div>
          {table}
          {assumptions}
        </div>
      </div>
      <Footnotes env={env} stats={slide.stats} />
    </div>
  );
}

function QuoteSlide({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  // The films carry their own captions, so a quote never sits ON one: the
  // line leads, the film plays framed beneath it.
  if (salesVideo(slide.video) !== null || isLiveWallKey(slide.video)) {
    return (
      <figure className={cx('flex flex-col items-center text-center', stage && 'h-full justify-center')}>
        {slide.eyebrow !== undefined && <Eyebrow env={env} center>{slide.eyebrow}</Eyebrow>}
        <blockquote className={cx(DISPLAY, 'font-[700] text-balance text-white', stage ? 'text-[56px] leading-[1.08]' : 'text-[30px] leading-[1.15]')}>
          {slide.title}
        </blockquote>
        {slide.body !== undefined && (
          <figcaption className={cx(MUTED, stage ? 'mt-3 text-[19px]' : 'mt-3 text-[14px]')}>{slide.body}</figcaption>
        )}
        <SlideFilm k={slide.video} env={env} className={stage ? 'mt-7 w-[660px]' : 'mt-5 w-full'} />
      </figure>
    );
  }
  return (
    <figure className={cx('flex flex-col items-center text-center', stage && 'h-full justify-center px-16')}>
      {slide.image !== undefined && salesImage(slide.image) !== null ? (
        <div className={stage ? 'mb-2 h-[300px] w-[320px]' : 'mb-3 h-40 w-44'}><SlideImg k={slide.image} env={env} /></div>
      ) : (
        <QuoteIcon className={cx('text-white/80', stage ? 'h-14 w-14' : 'h-9 w-9')} strokeWidth={1.25} aria-hidden />
      )}
      {slide.eyebrow !== undefined && <div className="mt-3"><Eyebrow env={env} center>{slide.eyebrow}</Eyebrow></div>}
      <blockquote className={cx(DISPLAY, 'font-[700] text-balance text-white', stage ? 'mt-5 text-[60px] leading-[1.1]' : 'mt-3 text-[30px] leading-[1.15]')}>
        {slide.title}
      </blockquote>
      {slide.body !== undefined && (
        <figcaption className={cx(MUTED, stage ? 'mt-7 text-[20px]' : 'mt-4 text-[14px]')}>{slide.body}</figcaption>
      )}
    </figure>
  );
}

/** Frame thumbs over photos — the demo slide's picture when it cannot run. */
function DemoCollage({ kitId, env, small = false }: { kitId: string | undefined; env: SlideEnv; small?: boolean }) {
  const kit = demoKit(kitId);
  const photos = ['event-wedding', 'event-gala', 'event-birthday'];
  return (
    <div className="flex items-end justify-center">
      {kit.frames.slice(0, 3).map((f, i) => (
        <div
          key={f.id}
          className={cx('relative aspect-[9/16] overflow-hidden rounded-2xl bg-[color:var(--bw-deep-2)] ring-1 ring-white/25', small ? 'w-[30%] max-w-[120px]' : 'w-[180px]', i === 1 ? 'z-10 -mx-3 mb-4' : '')}
          style={{ transform: `rotate(${(i - 1) * 6}deg)`, boxShadow: DROP }}
        >
          <img src={salesImage(photos[i])?.src} alt="" loading={env.eagerImages === true ? 'eager' : 'lazy'} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          <img src={f.thumb} alt={`${f.name} frame`} loading={env.eagerImages === true ? 'eager' : 'lazy'} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        </div>
      ))}
    </div>
  );
}

function Demo({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const kit = demoKit(slide.demoKit);
  const path = tryPath(kit.id);
  const text = (
    <div className="flex flex-col">
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env} size="md">{slide.title}</Title>
      {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
      {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
    </div>
  );
  if (!stage) {
    return (
      <div className="flex flex-col">
        <DemoCollage kitId={kit.id} env={env} small />
        <div className="mt-5">{text}</div>
        {env.still !== true && (
          <Link
            to={path}
            className={cx('mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold leading-none transition active:scale-[0.98]', PRIMARY, FOCUS)}
          >
            <Camera className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Try the {kit.label.toLowerCase()} booth
          </Link>
        )}
      </div>
    );
  }
  const absolute = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
  return (
    <div className="grid h-full grid-cols-[0.72fr_1.28fr] items-center gap-10">
      <div className="flex flex-col">
        {text}
        <div className="mt-7 flex items-center gap-5">
          <div className="rounded-2xl bg-white p-2.5"><QRCodeSVG value={absolute} size={112} level="M" /></div>
          <div className="flex flex-col gap-3">
            <p className={cx('text-[16px] leading-snug', MUTED)}>Scan to try it on<br />your own phone</p>
            {env.still !== true && (
              <a href={path} target="_blank" rel="noopener" className={cx('inline-flex min-h-11 items-center gap-2 self-start rounded-full px-5 text-[15px] font-semibold leading-none transition active:scale-[0.98]', SECONDARY, FOCUS)}>
                <Expand className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Full screen
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="relative h-[590px] overflow-hidden rounded-[24px] bg-[color:var(--bw-deep-2)] ring-1 ring-white/20" style={{ boxShadow: DROP }}>
        {env.still === true ? (
          <div className="flex h-full items-center justify-center"><DemoCollage kitId={kit.id} env={env} /></div>
        ) : (
          <iframe
            src={`${path}?embed=1`}
            title={`Try the ${kit.label.toLowerCase()} booth`}
            allow="camera; microphone; fullscreen"
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}

/** What a guest can try on, in the platform's own words (lib/lookTerms). */
function Looks({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const header = (
    <div>
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env} size="md">{slide.title}</Title>
      {slide.body !== undefined && <p className={cx('text-pretty', MUTED, stage ? 'mt-4 text-[19px] leading-[1.45]' : 'mt-3 text-[15.5px] leading-relaxed')}>{slide.body}</p>}
    </div>
  );
  return <div className={cx(stage && 'h-full')}><LooksBoard mode={env.mode} hero={slide.image} eager={env.eagerImages === true} header={header} /></div>;
}

function Cta({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const img = slide.image ?? 'beamy';
  const buttons = (
    <div className={cx('flex flex-wrap gap-3', stage ? 'mt-10' : 'mt-6')}>
      <CtaLink cta={env.primaryCta} primary env={env} />
      {env.secondaryCta !== undefined && <CtaLink cta={env.secondaryCta} primary={false} env={env} />}
    </div>
  );
  const steps = slide.bullets !== undefined && slide.bullets.length > 0 && (
    <ol className={cx('flex flex-col', stage ? 'mt-8 gap-3' : 'mt-5 gap-2.5')}>
      {slide.bullets.map((b, i) => (
        <li key={i} className={cx('flex items-center text-white', stage ? 'gap-4 text-[20px]' : 'gap-3 text-[15px]')}>
          <span
            className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums', TILE, stage ? 'h-9 w-9 text-[16px]' : 'h-7 w-7 text-[13px]')}
            aria-hidden
          >
            {i + 1}
          </span>
          {b}
        </li>
      ))}
    </ol>
  );
  const contact = env.contactLine !== '' && (
    <p className={cx(FAINT, stage ? 'mt-6 text-[16px]' : 'mt-4 text-[13px]')}>{env.contactLine}</p>
  );
  if (!stage) {
    return (
      <div className="flex flex-col">
        <div className="mx-auto aspect-square w-44 max-w-full"><SlideImg k={img} env={env} fit="cover" /></div>
        {slide.eyebrow !== undefined && <div className="mt-3"><Eyebrow env={env}>{slide.eyebrow}</Eyebrow></div>}
        <Title env={env} size="lg" display>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {steps}
        {buttons}
        {contact}
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-[1.25fr_0.75fr] items-center gap-10">
      <div className="flex flex-col">
        {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
        <Title env={env} size={slide.title.length > 26 ? 'xlLong' : 'xl'} display>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {steps}
        {buttons}
        {contact}
      </div>
      <div className="relative h-[500px]">
        <div aria-hidden className="absolute inset-8 rounded-full blur-3xl" style={{ background: GLOW }} />
        <SlideImg k={img} env={env} fit="cover" className="relative" />
      </div>
    </div>
  );
}

const LAYOUTS: Record<Slide['kind'], (p: { slide: Slide; env: SlideEnv }) => ReactNode> = {
  cover: Cover,
  problem: Problem,
  solution: Solution,
  how: How,
  features: Features,
  proof: Proof,
  offer: OfferSlide,
  roi: Roi,
  quote: QuoteSlide,
  demo: Demo,
  looks: Looks,
  cta: Cta,
};

/** The Beamwall wordmark in the slide chrome (.bw-wordmark: display face, flat white). */
function Wordmark({ size }: { size: number }) {
  return (
    <span className="font-[family-name:var(--bw-font-display)] font-[750] leading-none tracking-[-0.035em] text-white" style={{ fontSize: size }}>
      Beamwall
    </span>
  );
}

/**
 * One slide. In 'stage' mode it is exactly STAGE_W×STAGE_H and the caller
 * scales it; in 'card' mode it fills its width.
 */
export function SlideView({
  slide,
  env,
  index,
  total,
  deckName,
}: {
  slide: Slide;
  env: SlideEnv;
  index: number;
  total: number;
  deckName: string;
}) {
  const Layout = Object.prototype.hasOwnProperty.call(LAYOUTS, slide.kind) ? LAYOUTS[slide.kind] : Solution;
  if (env.mode === 'card') {
    return (
      <article
        aria-label={`Slide ${index + 1} of ${total}: ${slide.title}`}
        className="relative overflow-hidden rounded-[24px] px-5 pb-7 pt-6 text-white shadow-[0_30px_60px_-36px_rgba(22,18,78,0.7)] [font-family:var(--bw-font-text)]"
        style={PANE}
      >
        <div className="mb-4 flex items-center justify-between">
          <Wordmark size={17} />
          <span className={cx('text-[13px] tabular-nums', FAINT)}>{index + 1} / {total}</span>
        </div>
        <Layout slide={slide} env={env} />
      </article>
    );
  }
  return (
    <article
      aria-label={`Slide ${index + 1} of ${total}: ${slide.title}`}
      className="sales-stage relative overflow-hidden rounded-[32px] text-left text-white [font-family:var(--bw-font-text)]"
      style={{ width: STAGE_W, height: STAGE_H, ...PANE }}
    >
      <div className="absolute inset-0 flex flex-col px-[72px] pb-[64px] pt-[60px]">
        <div className="sd-in min-h-0 flex-1">
          <Layout slide={slide} env={env} />
        </div>
      </div>
      <div className={cx('absolute inset-x-[72px] bottom-[22px] flex items-center justify-between text-[15px]', FAINT)}>
        <span className="flex items-center gap-3"><Wordmark size={18} /> <span aria-hidden className="opacity-60">·</span> {deckName}</span>
        <span className="tabular-nums">{index + 1} / {total}</span>
      </div>
    </article>
  );
}
