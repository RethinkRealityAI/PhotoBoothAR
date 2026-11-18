/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /brand — the living style guide for brand v2, "Liquid glass + Beam"
 * (noindex). Rendered with the same scoped tokens and component classes as
 * the candidate landing (src/styles/brand.css), so what the owner approves
 * here is exactly what ships. Every contrast figure is MEASURED by
 * lib/brandTokens against the composited glass (frost over veil over the
 * field), the pixel the reader actually sees. The "Type options" strip loads
 * two extra display candidates (brand-compare.css) on this page only.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, Cake, CalendarPlus, Camera, Gift, Link2, Palette, Sparkles, Users } from 'lucide-react';
import '../../styles/brand-compare.css';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';
import { ALL_FIELDS, COLOR_TOKENS, cardOver, contrastRatio, panelOver, tokenHex, type ColorToken } from '../../lib/brandTokens';
import { HERO, SECTIONS } from '../../lib/brandLanding';

const TYPE_OPTIONS = [
  { key: 'A', name: 'Bricolage Grotesque', note: 'Recommended, used everywhere', family: "'Bricolage Grotesque Variable', sans-serif" },
  { key: 'B', name: 'Outfit', note: 'Rounder, more geometric', family: "'Outfit Variable', sans-serif" },
  { key: 'C', name: 'Sora', note: 'Wider, more technical', family: "'Sora Variable', sans-serif" },
];

const SCALE = [
  { name: 'Display', cls: 'bw-display', spec: 'Bricolage 300 + 760 mixed · 36 → 78px · -0.034em', mixed: true, sample: '' },
  { name: 'Heading 2', cls: 'bw-h2', spec: 'Bricolage 720 · 28 → 46px · -0.022em', mixed: false, sample: 'What applies to you?' },
  { name: 'Heading 3', cls: 'bw-h3', spec: 'Bricolage 620 · 19 → 23px', mixed: false, sample: 'Share one link' },
  { name: 'Eyebrow', cls: 'bw-eyebrow', spec: 'Geist 500 · 15px · short rule under', mixed: false, sample: HERO.eyebrow },
  { name: 'Body', cls: 'bw-body', spec: 'Geist 400 · 15 → 17px · 1.5 · Ink 2', mixed: false, sample: 'Guests scan a QR code and the booth opens on their phones.' },
  { name: 'Small', cls: 'bw-small', spec: 'Geist 400 · 14px', mixed: false, sample: 'Nothing leaves your device.' },
  { name: 'Label', cls: 'bw-label', spec: 'Geist 500 · 13px · sentence case', mixed: false, sample: 'Step 1' },
];

/** The base glass pixel, and the brightest one a card can sit on. */
const PANEL = panelOver(tokenHex('--bw-bg'));
const CARD = cardOver(tokenHex('--bw-bg-2'));

/** What each swatch is measured against, and what it is measured for. */
function measure(c: ColorToken): { ratio: number; against: string } | null {
  if ((ALL_FIELDS as readonly string[]).includes(c.cssVar)) return { ratio: contrastRatio('#FFFFFF', panelOver(c.value)), against: 'white ink on glass here' };
  if (c.cssVar.includes('veil') || c.cssVar.includes('frost')) return null;
  if (c.cssVar.startsWith('--bw-accent')) return { ratio: contrastRatio(tokenHex('--bw-on-accent'), c.value), against: 'On primary' };
  if (c.cssVar === '--bw-on-accent' || c.cssVar === '--bw-on-light') return { ratio: contrastRatio(c.value, '#FFFFFF'), against: 'white' };
  if (c.cssVar === '--bw-deep' || c.cssVar === '--bw-deep-2') return { ratio: contrastRatio('#FFFFFF', c.value), against: 'white ink on it' };
  return { ratio: contrastRatio(c.value, PANEL), against: 'the glass' };
}

function Glass({ children, className = '', radius = 28 }: { children: ReactNode; className?: string; radius?: number }) {
  return (
    <div className={`relative ${className}`} style={{ ['--bw-radius-panel' as string]: `${radius}px` }}>
      <div className="bw-glass" aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Glass className="mt-6">
      <section className="p-6 sm:p-8">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="bw-h3">{title}</h2>
          {note !== undefined && <p className="bw-label">{note}</p>}
        </div>
        {children}
      </section>
    </Glass>
  );
}

export default function BrandPage() {
  usePageTitle('Beamwall brand');
  useNoIndex();
  const [pressed, setPressed] = useState('wedding');
  const [dot, setDot] = useState(1);
  const [picked, setPicked] = useState(0);

  return (
    <div data-brand="2" className="bw-root relative min-h-dvh overflow-x-clip">
      <div aria-hidden className="bw-orb" style={{ position: 'fixed', width: '34vmax', height: '34vmax', right: '-12vmax', top: '-12vmax', opacity: 0.55 }} />
      <div aria-hidden className="bw-orb" style={{ position: 'fixed', width: '24vmax', height: '24vmax', left: '-8vmax', bottom: '-10vmax', opacity: 0.45 }} />
      <div className="relative mx-auto max-w-[1180px] px-3 pb-24 sm:px-8">
        <header className="flex h-16 items-center justify-between gap-3 px-1">
          <span className="bw-wordmark">Beamwall</span>
          <Link to="/beamy" className="bw-link">See the candidate landing <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden /></Link>
        </header>

        {/* The hero specimen: the system in one panel. */}
        <Glass radius={36}>
          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <div>
              <p className="bw-eyebrow">Brand v2 · Liquid glass + Beam</p>
              <h1 className="bw-display mt-6">
                <span className="bw-light block">The Beamwall</span>
                <span className="block">style guide</span>
              </h1>
              <p className="bw-body mt-5 max-w-[52ch]">A soft periwinkle scene in one hue family, every stop inside one frosted glass panel, white ink measured against the glass, and light that only gets expressive in the beam itself.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:justify-end">
              <button type="button" className="bw-btn bw-btn-primary bw-btn-lg">{HERO.primary}</button>
              <button type="button" className="bw-btn bw-btn-secondary bw-btn-lg">{HERO.secondary}</button>
            </div>
          </div>
        </Glass>

        <Block title="Type options" note="Same mixed-weight headline, three display candidates">
          <div className="grid gap-4 lg:grid-cols-3">
            {TYPE_OPTIONS.map((t) => (
              <div key={t.key} className="bw-glass-card p-6" data-selected={t.key === 'A'}>
                <p className="bw-label">{t.key}. {t.name} · {t.note}</p>
                <p className="mt-4 text-[38px] leading-[1.04]" style={{ fontFamily: t.family, letterSpacing: '-0.03em', color: 'var(--bw-ink)' }}>
                  <span className="block font-[300]">{HERO.lead}</span>
                  <span className="block font-[760]">{HERO.strong}</span>
                </p>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Wordmark">
          <div className="flex flex-wrap items-center gap-10">
            <span className="bw-wordmark" style={{ fontSize: 56 }}>Beamwall</span>
            <span className="bw-wordmark">Beamwall</span>
            <p className="bw-small max-w-[44ch]">Set in the display face, flat white, tight tracking. No gradient, no foil, no icon lockup yet.</p>
          </div>
        </Block>

        <Block title="Typefaces and scale" note="Bricolage Grotesque for display · Geist for text and UI · never below 12px">
          <div className="flex flex-col gap-6">
            {SCALE.map((s) => (
              <div key={s.name} className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-baseline">
                <div>
                  <p className="text-[15px] font-semibold" style={{ color: 'var(--bw-ink)' }}>{s.name}</p>
                  <p className="bw-label">{s.spec}</p>
                </div>
                {s.mixed ? (
                  <p className={s.cls}><span className="bw-light">{HERO.lead} </span>{HERO.strong}</p>
                ) : (
                  <p className={s.cls}>{s.sample}</p>
                )}
              </div>
            ))}
          </div>
        </Block>

        <Block title="Colour" note="Every ratio measured on the composited glass, not the raw token">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {COLOR_TOKENS.map((c) => {
              const m = measure(c);
              return (
                <div key={c.cssVar} className="bw-glass-card overflow-hidden">
                  <div className="relative h-20" style={{ background: PANEL }}>
                    <div className="absolute inset-0" style={{ background: c.value }} />
                  </div>
                  <div className="p-3">
                    <p className="text-[15px] font-semibold" style={{ color: 'var(--bw-ink)' }}>{c.name}</p>
                    <p className="bw-label break-all">{c.value} · {c.cssVar}</p>
                    <p className="bw-label mt-1">{c.role}</p>
                    {m !== null && (
                      <p className="bw-label mt-1" style={{ color: 'var(--bw-ink)' }}>
                        {m.ratio.toFixed(1)}:1 vs {m.against} · {m.ratio >= 4.5 ? 'AA text' : m.ratio >= 3 ? 'AA large / UI' : 'decor only'}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="bw-small mt-5 max-w-[80ch]">
            On the glass over the base field: white {contrastRatio('#FFFFFF', PANEL).toFixed(1)}:1 · Ink 2 {contrastRatio('rgba(255, 255, 255, 0.92)', PANEL).toFixed(1)}:1.
            On a glass card over the brightest glow a card may sit on: white {contrastRatio('#FFFFFF', CARD).toFixed(1)}:1 · Ink 2 {contrastRatio('rgba(255, 255, 255, 0.92)', CARD).toFixed(1)}:1.
            A white frost alone would LOWER white text’s contrast, so the panel’s tint is an indigo veil with the frost on top.
          </p>
        </Block>

        <Block title="Liquid glass" note="Panel · card · chip. Edge light is an inset shadow, never a gradient border">
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="relative h-[180px]" style={{ ['--bw-radius-panel' as string]: '28px' }}>
              <div className="bw-glass" />
              <div className="relative p-5">
                <p className="text-[15px] font-semibold" style={{ color: 'var(--bw-ink)' }}>.bw-glass</p>
                <p className="bw-label mt-1">Veil 0.18 + frost 0.16 · blur 36 · saturate 108% · rim brightest top-left · radius 36 (24 on phones) · soft wide drop</p>
              </div>
            </div>
            <div className="bw-glass-card h-[180px] p-5">
              <p className="text-[15px] font-semibold" style={{ color: 'var(--bw-ink)' }}>.bw-glass-card</p>
              <p className="bw-label mt-1">Veil 0.22 + frost 0.08 · blur 18 · radius 20. Selected: solid white, deep-indigo ink.</p>
            </div>
            <div className="flex h-[180px] flex-col justify-center gap-3 p-1">
              <div className="flex flex-wrap gap-2">
                <span className="bw-glass-chip">.bw-glass-chip</span>
                <span className="bw-glass-chip" aria-current="true">Selected</span>
              </div>
              <p className="bw-label">44px tall pill · indigo veil 0.14 · selected = white with indigo text</p>
            </div>
          </div>
          <p className="bw-small mt-5 max-w-[70ch]">Without backdrop-filter support every glass falls back to a solid indigo tint that keeps the same contrast.</p>
        </Block>

        <Block title="Buttons" note="Pill, 48px (44 min). Press scales to 0.98. Focus ring 2px white, 2px offset">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="bw-btn bw-btn-primary bw-btn-lg">Create your free event</button>
              <button type="button" className="bw-btn bw-btn-primary">Primary</button>
              <button type="button" className="bw-btn bw-btn-primary" style={{ background: 'var(--bw-accent-hover)' }}>Hover</button>
              <button type="button" className="bw-btn bw-btn-primary" style={{ background: 'var(--bw-accent-pressed)' }}>Pressed</button>
              <button type="button" className="bw-btn bw-btn-primary" style={{ outline: '2px solid #FFFFFF', outlineOffset: 2 }}>Focus</button>
              <button type="button" className="bw-btn bw-btn-primary" disabled>Disabled</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="bw-btn bw-btn-secondary">Secondary</button>
              <button type="button" className="bw-btn bw-btn-secondary" style={{ background: 'rgba(255,255,255,0.16)', borderColor: '#FFFFFF' }}>Hover</button>
              <button type="button" className="bw-btn bw-btn-secondary bw-btn-sm">Small, 44px</button>
              <button type="button" className="bw-btn bw-btn-secondary" disabled>Disabled</button>
              <button type="button" className="bw-link">Tertiary link <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden /></button>
            </div>
          </div>
        </Block>

        <Block title="Cards and icon tiles" note="Glass card, radius 20. Hover: brighter edge, 2px lift. Selected: solid white">
          <div className="grid gap-3 sm:grid-cols-3">
            {[{ t: 'Family celebration', h: 'Weddings, birthdays', I: Cake }, { t: 'Business or brand', h: 'Launches, conferences', I: Briefcase }, { t: 'Company team', h: 'Holiday parties', I: Gift }].map((c, n) => (
              <button key={c.t} type="button" aria-pressed={n === picked} onClick={() => setPicked(n)} className="bw-glass-card bw-interactive flex min-h-[84px] items-center gap-4 p-4">
                <span className="bw-icon-tile" aria-hidden><c.I /></span>
                <span>
                  <span className="block text-[16px] font-semibold" style={{ color: 'var(--bw-ink)' }}>{c.t}</span>
                  <span className="bw-label block">{c.h}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {[CalendarPlus, Palette, Link2, Camera, Users, Sparkles].map((I, n) => (
              <span key={n} className="bw-icon-tile" aria-hidden><I /></span>
            ))}
            <p className="bw-small self-center">lucide-react line icons, 1.5 stroke, 40px frosted tile, radius 12, white. Never emoji.</p>
          </div>
        </Block>

        <Block title="Speech bubble, chips, field, progress">
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <div className="bw-bubble max-w-[320px] px-4 py-3">Hi, I’m Beamy! Who are you planning for?</div>
              <div role="group" aria-label="Look" className="flex flex-wrap gap-2">
                {['beam', 'wedding', 'christmas', 'birthday'].map((p) => (
                  <button key={p} type="button" className="bw-glass-chip" aria-pressed={pressed === p} onClick={() => setPressed(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <label className="flex flex-col gap-2">
                <span className="bw-label">Event name</span>
                <input className="bw-field" placeholder="Maya’s 30th" />
              </label>
              <div className="flex items-center gap-4">
                <div className="flex items-center" role="group" aria-label="Sections">
                  {SECTIONS.map((s, n) => (
                    <button key={s.id} type="button" className="bw-dot" title={s.label} aria-label={s.label} aria-current={n === dot ? 'step' : undefined} onClick={() => setDot(n)} />
                  ))}
                </div>
                <span className="bw-label">{SECTIONS[dot].label}</span>
              </div>
            </div>
          </div>
        </Block>

        <Block title="Motion">
          <ul className="bw-small flex max-w-[70ch] list-disc flex-col gap-2 pl-5">
            <li>One easing family: cubic-bezier(0.22, 1, 0.36, 1). Stop changes 400–600ms.</li>
            <li>Outgoing content fades and slides 24px up; incoming rises; children stagger by 60ms.</li>
            <li>Crystals bob slowly and drift with the pointer (nearer ones more); the glass sheen follows it a little.</li>
            <li>The intro, once per session: a beam drops, Beamy lands, takes a selfie and beams it to the live wall. Any click skips it.</li>
            <li>The beam of light is the one expressive effect: white into periwinkle, with an amber-white core.</li>
            <li>Reduced motion: crossfades, no beam flight, no flash strobe, static crystals. Every state change still happens.</li>
          </ul>
        </Block>
      </div>
    </div>
  );
}
