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
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Quote as QuoteIcon, X as XIcon } from 'lucide-react';
import type { Offer, Slide, SlideStat } from '../../../lib/salesTypes';
import { salesImage } from '../salesImages';
import { iconFor } from './salesIcons';

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
  /** Deck accent "r, g, b". */
  rgb: string;
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
}

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

// ── Shared atoms ───────────────────────────────────────────────────────────

function Eyebrow({ env, children }: { env: SlideEnv; children: ReactNode }) {
  return (
    <p
      className={cx(
        'font-label font-semibold uppercase',
        env.mode === 'stage' ? 'text-[15px] tracking-[0.3em]' : 'text-[11px] tracking-[0.26em]',
      )}
      style={{ color: `rgb(${env.rgb})` }}
    >
      {children}
    </p>
  );
}

function Title({ env, children, size = 'lg', foil = false, center = false }: {
  env: SlideEnv;
  children: ReactNode;
  size?: 'xl' | 'xlLong' | 'lg' | 'md';
  foil?: boolean;
  center?: boolean;
}) {
  const stage = { xl: 'text-[84px] leading-[1.0]', xlLong: 'text-[70px] leading-[1.02]', lg: 'text-[58px] leading-[1.05]', md: 'text-[46px] leading-[1.08]' }[size];
  const card = { xl: 'text-[40px] leading-[1.04]', xlLong: 'text-[36px] leading-[1.06]', lg: 'text-[32px] leading-[1.1]', md: 'text-[28px] leading-[1.12]' }[size];
  return (
    <h2
      className={cx(
        'font-serif [font-variant-numeric:lining-nums_tabular-nums] font-semibold text-balance text-brand-fg',
        env.mode === 'stage' ? stage : card,
        foil && 'text-foil-static',
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
        'text-pretty text-brand-muted',
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
        style={{ filter: `drop-shadow(0 24px 60px rgba(${env.rgb}, 0.35))` }}
      />
    );
  }
  // Scenes (and the dark-background Beamy renders): a soft radial mask lets
  // the picture's own black dissolve into the slide instead of a hard box.
  const beamy = (k ?? '').startsWith('beamy');
  return (
    <div
      className={cx('relative h-full w-full overflow-hidden', !beamy && 'rounded-[28px] ring-1 ring-white/10', className)}
      style={
        beamy
          ? { maskImage: 'radial-gradient(closest-side, #000 62%, transparent)', WebkitMaskImage: 'radial-gradient(closest-side, #000 62%, transparent)' }
          : { boxShadow: `0 30px 80px -30px rgba(${env.rgb}, 0.55)` }
      }
    >
      <img
        src={img.src}
        width={img.width}
        height={img.height}
        alt={img.alt}
        loading={loading}
        decoding="async"
        draggable={false}
        className={cx('h-full w-full select-none', fit === 'cover' ? 'object-cover' : 'object-contain')}
      />
      {!beamy && <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />}
    </div>
  );
}

export function CtaLink({ cta, primary, env, className = '' }: { cta: DeckCta; primary: boolean; env: SlideEnv; className?: string }) {
  const cls = cx(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full font-label font-bold uppercase transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]',
    env.mode === 'stage' ? 'px-9 py-4 text-[15px] tracking-[0.2em]' : 'px-6 py-3 text-[12px] tracking-[0.18em]',
    primary ? 'bg-foil text-white glow-accent' : 'border border-white/20 bg-white/[0.05] text-brand-fg hover:bg-white/[0.1]',
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
        <li key={i} className={cx('flex items-start text-brand-fg/90', stage ? 'gap-4 text-[21px] leading-snug' : 'gap-3 text-[15px] leading-snug')}>
          <span
            className={cx('mt-0.5 flex shrink-0 items-center justify-center rounded-full', stage ? 'h-8 w-8' : 'h-6 w-6')}
            style={
              tone === 'check'
                ? { background: `rgba(${env.rgb}, 0.16)`, color: `rgb(${env.rgb})`, boxShadow: `inset 0 0 0 1px rgba(${env.rgb}, 0.35)` }
                : { background: 'rgba(255,120,120,0.10)', color: '#ff9a9a', boxShadow: 'inset 0 0 0 1px rgba(255,120,120,0.28)' }
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
    <ol className={cx('text-brand-muted/60', env.mode === 'stage' ? 'mt-auto flex flex-wrap gap-x-6 gap-y-1 pt-6 text-[12.5px]' : 'mt-5 flex flex-col gap-1 text-[11px]')}>
      {sourced.map(({ s, i }) => (
        <li key={i}>
          <sup className="mr-1">{i + 1}</sup>
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
        <Title env={env} size={slide.title.length > 26 ? 'xlLong' : 'xl'} foil>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-[1.15fr_0.85fr] items-center gap-10">
      <div className="flex flex-col">
        {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
        <Title env={env} size={slide.title.length > 26 ? 'xlLong' : 'xl'} foil>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
      </div>
      <div className="relative flex h-[540px] items-center justify-center">
        <div aria-hidden className="absolute inset-10 rounded-full blur-3xl" style={{ background: `radial-gradient(closest-side, rgba(${env.rgb},0.35), transparent)` }} />
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
          className={cx('flex items-start rounded-2xl border border-white/10 bg-white/[0.035]', stage ? 'gap-5 px-6 py-5' : 'gap-3 px-4 py-3.5')}
        >
          <span className={cx('font-serif [font-variant-numeric:lining-nums_tabular-nums] font-semibold text-[#ff9a9a]/90', stage ? 'text-[30px] leading-none' : 'text-[20px] leading-none')}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className={cx('text-brand-fg/90', stage ? 'text-[20px] leading-snug' : 'text-[15px] leading-snug')}>{p}</span>
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
          <div key={i} className={cx('flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035]', stage ? 'p-4' : 'p-3.5')}>
            <Icon className={cx('shrink-0', stage ? 'h-6 w-6' : 'h-5 w-5')} style={{ color: `rgb(${env.rgb})` }} aria-hidden />
            <div>
              <p className={cx('font-semibold text-brand-fg', stage ? 'text-[18px]' : 'text-[14.5px]')}>{it.title}</p>
              {it.body !== undefined && <p className={cx('mt-1 text-brand-muted', stage ? 'text-[15px] leading-snug' : 'text-[13.5px] leading-snug')}>{it.body}</p>}
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
  if (!stage) {
    return (
      <div className="flex flex-col">
        {img !== undefined && salesImage(img) !== null && (
          <div className={cx('mb-5', salesImage(img)?.cutout === true ? 'mx-auto aspect-square w-60 max-w-full' : 'aspect-[4/3] w-full')}>
            <SlideImg k={img} env={env} fit="cover" />
          </div>
        )}
        {text}
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

const STEP_ART = ['step-create', 'step-qr', 'step-wall'];

function How({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const steps: { title: string; body?: string }[] = slide.items ?? (slide.bullets ?? []).map((b) => ({ title: b }));
  return (
    <div className={cx('flex flex-col', stage && 'h-full')}>
      <div className={cx(stage && 'text-center')}>
        {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
        <Title env={env} center={stage}>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env} center={stage}>{slide.body}</Body>}
      </div>
      <ol className={cx(stage ? 'mt-auto grid grid-cols-3 gap-8' : 'mt-6 flex flex-col gap-4')}>
        {steps.map((s, i) => {
          const art = STEP_ART[i];
          return (
            <li key={i} className={cx('relative flex', stage ? 'flex-col items-center text-center' : 'items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3')}>
              <div className={cx('relative shrink-0', stage ? 'h-[230px] w-[230px]' : 'h-20 w-20')}>
                {art !== undefined ? <SlideImg k={art} env={env} /> : null}
                <span
                  className={cx('absolute flex items-center justify-center rounded-full bg-foil font-label font-bold text-white', stage ? '-left-1 top-2 h-11 w-11 text-[18px]' : '-left-1 -top-1 h-7 w-7 text-[12px]')}
                  aria-hidden
                >
                  {i + 1}
                </span>
              </div>
              <div className={stage ? 'mt-3' : ''}>
                <p className={cx('font-serif [font-variant-numeric:lining-nums_tabular-nums] font-semibold text-brand-fg', stage ? 'text-[30px]' : 'text-[20px]')}>
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </p>
                {s.body !== undefined && (
                  <p className={cx('text-brand-muted', stage ? 'mt-2 text-[17px] leading-snug' : 'mt-1 text-[14px] leading-snug')}>{s.body}</p>
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
  const items = slide.items ?? (slide.bullets ?? []).map((b) => ({ title: b, icon: undefined, body: undefined }));
  const cols = items.length === 4 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <div className={cx('flex flex-col', stage && 'h-full')}>
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env} size="md">{slide.title}</Title>
      {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
      <div className={cx('grid', stage ? `mt-auto ${cols} gap-5` : 'mt-6 grid-cols-1 gap-3 min-[420px]:grid-cols-2')}>
        {items.map((it, i) => {
          const Icon = iconFor(it.icon);
          return (
            <div
              key={i}
              className={cx('rounded-[22px] border border-white/10', stage ? 'p-6' : 'p-4')}
              style={{ background: `linear-gradient(160deg, rgba(${env.rgb},0.09), rgba(255,255,255,0.02) 55%)` }}
            >
              <span
                className={cx('flex items-center justify-center rounded-xl', stage ? 'h-12 w-12' : 'h-10 w-10')}
                style={{ background: `rgba(${env.rgb},0.16)`, boxShadow: `inset 0 0 0 1px rgba(${env.rgb},0.35)` }}
                aria-hidden
              >
                <Icon className={stage ? 'h-6 w-6' : 'h-5 w-5'} style={{ color: `rgb(${env.rgb})` }} />
              </span>
              <p className={cx('font-semibold text-brand-fg', stage ? 'mt-4 text-[21px]' : 'mt-3 text-[15.5px]')}>{it.title}</p>
              {it.body !== undefined && (
                <p className={cx('text-brand-muted', stage ? 'mt-2 text-[16px] leading-snug' : 'mt-1 text-[13.5px] leading-snug')}>{it.body}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Proof({ slide, env }: { slide: Slide; env: SlideEnv }) {
  const stage = env.mode === 'stage';
  const stats = slide.stats ?? [];
  return (
    <div className={cx('flex flex-col', stage && 'h-full')}>
      {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
      <Title env={env} size="md">{slide.title}</Title>
      {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
      {stats.length > 0 && (
        <dl className={cx('grid', stage ? `mt-12 gap-6 ${stats.length >= 4 ? 'grid-cols-4' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}` : 'mt-6 grid-cols-1 gap-3 min-[420px]:grid-cols-2')}>
          {stats.map((s, i) => (
            <div key={i} className={cx('flex flex-col-reverse rounded-[22px] border border-white/10 bg-white/[0.03]', stage ? 'p-7' : 'p-4')}>
              <dt className={cx('text-brand-muted', stage ? 'mt-3 text-[17px] leading-snug' : 'mt-1.5 text-[13.5px] leading-snug')}>
                {s.label}
                {hasSource(s) && <sup className="ml-0.5 text-brand-muted/60">{i + 1}</sup>}
              </dt>
              <dd className={cx('font-serif [font-variant-numeric:lining-nums_tabular-nums] font-semibold text-foil-static', stage ? 'text-[64px] leading-none' : 'text-[40px] leading-none')}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {slide.bullets !== undefined && slide.bullets.length > 0 && <Bullets env={env} items={slide.bullets} />}
      {stats.length === 0 && <ItemsList slide={slide} env={env} />}
      <Footnotes env={env} stats={stats} />
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
        {slide.eyebrow !== undefined && <Eyebrow env={env}>{slide.eyebrow}</Eyebrow>}
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
              className={cx('relative flex min-w-0 flex-col rounded-[24px] border', stage ? (many ? 'p-5' : 'p-7') : 'p-5')}
              style={{
                borderColor: featured ? `rgba(${env.rgb},0.55)` : 'rgba(255,255,255,0.10)',
                background: featured
                  ? `linear-gradient(170deg, rgba(${env.rgb},0.16), rgba(255,255,255,0.02) 60%)`
                  : 'rgba(255,255,255,0.03)',
                boxShadow: featured ? `0 24px 70px -30px rgba(${env.rgb},0.7)` : undefined,
              }}
            >
              {env.placeholderBadges && o.placeholder && (
                <span className="absolute right-4 top-4 rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 font-label text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">
                  Placeholder
                </span>
              )}
              <p className={cx('font-semibold leading-snug text-brand-fg/90', stage ? 'text-[16px]' : 'text-[14px]', env.placeholderBadges && o.placeholder && 'pr-24')}>{o.name}</p>
              <p className={cx('break-words font-serif [font-variant-numeric:lining-nums_tabular-nums] font-semibold leading-[1.05] text-brand-fg', priceClass(env.priceFor(o), stage, many))}>
                {env.priceFor(o)}
              </p>
              <p className={cx('text-brand-muted/80', stage ? 'mt-1 text-[14px]' : 'mt-1 text-[12.5px]')}>{o.unit}</p>
              <p className={cx('text-brand-fg/85', stage ? (many ? 'mt-3 text-[15px] leading-snug' : 'mt-4 text-[16px] leading-snug') : 'mt-3 text-[14px] leading-snug')}>{o.blurb}</p>
              <ul className={cx('flex flex-col', stage ? 'mt-4 gap-2' : 'mt-3 gap-1.5')}>
                {o.features.slice(0, many ? 3 : 5).map((f, j) => (
                  <li key={j} className={cx('flex items-start gap-2 text-brand-muted', stage ? 'text-[14.5px] leading-snug' : 'text-[13px] leading-snug')}>
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: `rgb(${env.rgb})` }} aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {slide.bullets !== undefined && slide.bullets.length > 0 && (
        <p className={cx('text-brand-muted/70', stage ? 'mt-5 text-center text-[14px]' : 'mt-4 text-[12.5px]')}>{slide.bullets.join(' · ')}</p>
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
    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03]">
      <table className="w-full border-collapse">
        <caption className="sr-only">{slide.title}</caption>
        <tbody>
          {rows.map((r, i) => {
            const total = rows.length > 1 && i === rows.length - 1;
            return (
              <tr
                key={i}
                className={cx(i > 0 && 'border-t border-white/[0.07]')}
                style={total ? { background: `linear-gradient(90deg, rgba(${env.rgb},0.16), rgba(${env.rgb},0.04))` } : undefined}
              >
                <th scope="row" className={cx('text-left font-normal', total ? 'font-semibold text-brand-fg' : 'text-brand-muted', stage ? 'px-7 py-4 text-[18px]' : 'px-4 py-3 text-[13.5px]')}>
                  {r.label}
                  {r.sourced && <sup className="ml-0.5 text-brand-muted/60">{r.idx + 1}</sup>}
                </th>
                <td className={cx('text-right font-serif [font-variant-numeric:lining-nums_tabular-nums] font-semibold', total ? 'text-foil-static' : 'text-brand-fg', stage ? (total ? 'px-7 py-4 text-[34px]' : 'px-7 py-4 text-[26px]') : (total ? 'px-4 py-3 text-[24px]' : 'px-4 py-3 text-[18px]'))}>
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
    <ul className={cx('text-brand-muted/65', stage ? 'mt-4 flex flex-col gap-1 text-[13.5px]' : 'mt-3 flex flex-col gap-1 text-[12px]')}>
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
  return (
    <figure className={cx('flex flex-col items-center text-center', stage && 'h-full justify-center px-16')}>
      {slide.image !== undefined && salesImage(slide.image) !== null ? (
        <div className={stage ? 'mb-4 h-[150px] w-[150px]' : 'mb-3 h-24 w-24'}><SlideImg k={slide.image} env={env} /></div>
      ) : (
        <QuoteIcon className={stage ? 'h-14 w-14' : 'h-9 w-9'} style={{ color: `rgb(${env.rgb})` }} aria-hidden />
      )}
      {slide.eyebrow !== undefined && <div className="mt-3"><Eyebrow env={env}>{slide.eyebrow}</Eyebrow></div>}
      <blockquote className={cx('font-serif [font-variant-numeric:lining-nums_tabular-nums] font-semibold text-balance text-foil-static', stage ? 'mt-5 text-[60px] leading-[1.1]' : 'mt-3 text-[30px] leading-[1.15]')}>
        {slide.title}
      </blockquote>
      {slide.body !== undefined && (
        <figcaption className={cx('text-brand-muted', stage ? 'mt-7 text-[20px]' : 'mt-4 text-[14px]')}>{slide.body}</figcaption>
      )}
    </figure>
  );
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
        <li key={i} className={cx('flex items-center text-brand-fg/90', stage ? 'gap-4 text-[20px]' : 'gap-3 text-[15px]')}>
          <span
            className={cx('flex shrink-0 items-center justify-center rounded-full font-label font-bold', stage ? 'h-9 w-9 text-[15px]' : 'h-7 w-7 text-[12px]')}
            style={{ background: `rgba(${env.rgb},0.16)`, color: `rgb(${env.rgb})`, boxShadow: `inset 0 0 0 1px rgba(${env.rgb},0.35)` }}
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
    <p className={cx('text-brand-muted/75', stage ? 'mt-6 text-[16px]' : 'mt-4 text-[13px]')}>{env.contactLine}</p>
  );
  if (!stage) {
    return (
      <div className="flex flex-col">
        <div className="mx-auto aspect-square w-44 max-w-full"><SlideImg k={img} env={env} fit="cover" /></div>
        {slide.eyebrow !== undefined && <div className="mt-3"><Eyebrow env={env}>{slide.eyebrow}</Eyebrow></div>}
        <Title env={env} size="lg" foil>{slide.title}</Title>
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
        <Title env={env} size={slide.title.length > 26 ? 'xlLong' : 'xl'} foil>{slide.title}</Title>
        {slide.body !== undefined && <Body env={env}>{slide.body}</Body>}
        {steps}
        {buttons}
        {contact}
      </div>
      <div className="relative h-[500px]">
        <div aria-hidden className="absolute inset-8 rounded-full blur-3xl" style={{ background: `radial-gradient(closest-side, rgba(${env.rgb},0.32), transparent)` }} />
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
  cta: Cta,
};

/** The slide's backdrop: void black, the deck's accent pooled in two corners. */
function backdrop(rgb: string): string {
  return [
    `radial-gradient(90% 70% at 100% 0%, rgba(${rgb},0.20), transparent 60%)`,
    `radial-gradient(70% 60% at 0% 100%, rgba(124,108,247,0.14), transparent 60%)`,
    'linear-gradient(180deg, #070912, #05060B)',
  ].join(',');
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
        className="relative overflow-hidden rounded-[28px] border border-white/10 px-5 pb-7 pt-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]"
        style={{ background: backdrop(env.rgb) }}
      >
        <div className="mb-4 flex items-center justify-between font-label text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-muted/60">
          <span className="text-foil-static">Beamwall</span>
          <span className="tabular-nums">{index + 1} / {total}</span>
        </div>
        <Layout slide={slide} env={env} />
      </article>
    );
  }
  return (
    <article
      aria-label={`Slide ${index + 1} of ${total}: ${slide.title}`}
      className="sales-stage relative overflow-hidden text-left"
      style={{ width: STAGE_W, height: STAGE_H, background: backdrop(env.rgb) }}
    >
      {/* A faint beam across the top edge — the brand's light streak. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, rgba(${env.rgb},0.7), transparent)` }} />
      <div className="absolute inset-0 flex flex-col px-[72px] pb-[64px] pt-[60px]">
        <div className="sd-in min-h-0 flex-1">
          <Layout slide={slide} env={env} />
        </div>
      </div>
      <div className="absolute inset-x-[72px] bottom-[24px] flex items-center justify-between font-label text-[12px] font-semibold uppercase tracking-[0.26em] text-brand-muted/50">
        <span><span className="text-foil-static">Beamwall</span> <span className="mx-2 opacity-50">·</span> {deckName}</span>
        <span className="tabular-nums">{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
      </div>
    </article>
  );
}
