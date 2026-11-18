/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /brand — the living style guide for brand v2 (noindex). Rendered with the
 * same scoped tokens and component classes as the candidate landing
 * (src/styles/brand.css), so what the owner approves here is exactly what
 * ships. The "Type options" strip loads two extra display candidates
 * (brand-compare.css) on this page only.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, Cake, CalendarPlus, Camera, Gift, Link2, Palette, Sparkles, Users } from 'lucide-react';
import '../../styles/brand-compare.css';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';
import { COLOR_TOKENS, contrastRatio, tokenHex } from '../../lib/brandTokens';
import { HERO, SECTIONS } from '../../lib/brandLanding';

const TYPE_OPTIONS = [
  { key: 'A', name: 'Bricolage Grotesque', note: 'Recommended, used everywhere', family: "'Bricolage Grotesque Variable', sans-serif" },
  { key: 'B', name: 'Outfit', note: 'Rounder, more geometric', family: "'Outfit Variable', sans-serif" },
  { key: 'C', name: 'Sora', note: 'Wider, more technical', family: "'Sora Variable', sans-serif" },
];

const SCALE = [
  { name: 'Display', cls: 'bw-display', spec: 'Bricolage 650 · 44 → 84px · -0.028em', sample: 'Every phone is the booth' },
  { name: 'Heading 2', cls: 'bw-h2', spec: 'Bricolage 650 · 30 → 48px · -0.02em', sample: 'What applies to you?' },
  { name: 'Heading 3', cls: 'bw-h3', spec: 'Bricolage 600 · 20 → 24px', sample: 'Share one link' },
  { name: 'Body', cls: 'bw-body', spec: 'Geist 400 · 16 → 18px · 1.5', sample: 'Guests scan a QR code and the booth opens on their phones.' },
  { name: 'Small', cls: 'bw-small', spec: 'Geist 400 · 14px', sample: 'Nothing leaves your device.' },
  { name: 'Label', cls: 'bw-label', spec: 'Geist 500 · 13px · sentence case', sample: 'Step 1' },
];

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-t py-12" style={{ borderColor: 'var(--bw-hairline)' }}>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="bw-h3">{title}</h2>
        {note !== undefined && <p className="bw-label">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function BrandPage() {
  usePageTitle('Beamwall brand');
  useNoIndex();
  const [pressed, setPressed] = useState('wedding');
  const [dot, setDot] = useState(1);
  const bg = tokenHex('--bw-bg');

  return (
    <div data-brand="2" className="bw-root min-h-dvh">
      <div className="bw-glow pointer-events-none fixed inset-0" style={{ ['--glow-x' as string]: '80%', ['--glow-y' as string]: '8%' }} aria-hidden />
      <div className="relative mx-auto max-w-[1180px] px-4 pb-24 sm:px-8">
        <header className="flex h-16 items-center justify-between">
          <span className="bw-wordmark">Beamwall</span>
          <Link to="/beamy" className="bw-link">See the candidate landing <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden /></Link>
        </header>

        <div className="pb-10 pt-10">
          <p className="bw-label">Brand v2 · Midnight + Beam</p>
          <h1 className="bw-display mt-3 max-w-[18ch]">The Beamwall style guide</h1>
          <p className="bw-body mt-4 max-w-[60ch]">Calm, flat midnight surfaces. One periwinkle accent, one warm amber highlight, and light that only gets expressive in the beam itself.</p>
        </div>

        <Block title="Type options" note="Same headline, three display candidates">
          <div className="grid gap-4 lg:grid-cols-3">
            {TYPE_OPTIONS.map((t) => (
              <div key={t.key} className="bw-card p-6" data-selected={t.key === 'A'}>
                <p className="bw-label">{t.key}. {t.name} · {t.note}</p>
                <p className="mt-4 text-[40px] font-[650] leading-[1.04]" style={{ fontFamily: t.family, letterSpacing: '-0.028em', color: 'var(--bw-ink)' }}>{HERO.headline}</p>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Wordmark">
          <div className="flex flex-wrap items-center gap-10">
            <span className="bw-wordmark" style={{ fontSize: 56 }}>Beamwall</span>
            <span className="bw-wordmark">Beamwall</span>
            <p className="bw-small max-w-[44ch]">Set in the display face, flat ink, tight tracking. No gradient, no foil, no icon lockup yet.</p>
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
                <p className={s.cls}>{s.sample}</p>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Colour" note="Contrast shown against Midnight; Beam fills against On beam">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {COLOR_TOKENS.map((c) => {
              const vs = c.cssVar.startsWith('--bw-accent') ? tokenHex('--bw-on-accent') : bg;
              const ratio = contrastRatio(c.hex, vs);
              return (
                <div key={c.cssVar} className="bw-card overflow-hidden">
                  <div className="h-20" style={{ background: c.hex, borderBottom: '1px solid var(--bw-hairline)' }} />
                  <div className="p-3">
                    <p className="text-[15px] font-semibold" style={{ color: 'var(--bw-ink)' }}>{c.name}</p>
                    <p className="bw-label">{c.hex} · {c.cssVar}</p>
                    <p className="bw-label mt-1">{c.role}</p>
                    <p className="bw-label mt-1" style={{ color: ratio >= 4.5 ? 'var(--bw-success)' : 'var(--bw-muted)' }}>
                      {ratio.toFixed(1)}:1 {ratio >= 4.5 ? 'AA text' : ratio >= 3 ? 'AA large / UI' : 'surface only'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Block>

        <Block title="Buttons" note="Pill, 48px (44 min), flat. Press scales to 0.98. Focus ring 2px Beam, 2px offset">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="bw-btn bw-btn-primary bw-btn-lg">Create your free event</button>
              <button type="button" className="bw-btn bw-btn-primary">Primary</button>
              <button type="button" className="bw-btn bw-btn-primary" style={{ background: 'var(--bw-accent-hover)' }}>Hover</button>
              <button type="button" className="bw-btn bw-btn-primary" style={{ background: 'var(--bw-accent-pressed)' }}>Pressed</button>
              <button type="button" className="bw-btn bw-btn-primary" style={{ outline: '2px solid var(--bw-accent)', outlineOffset: 2 }}>Focus</button>
              <button type="button" className="bw-btn bw-btn-primary" disabled>Disabled</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="bw-btn bw-btn-secondary">Secondary</button>
              <button type="button" className="bw-btn bw-btn-secondary" style={{ borderColor: 'var(--bw-hairline-strong)', background: '#1C2134' }}>Hover</button>
              <button type="button" className="bw-btn bw-btn-secondary bw-btn-sm">Small, 44px</button>
              <button type="button" className="bw-btn bw-btn-secondary" disabled>Disabled</button>
              <button type="button" className="bw-link">Tertiary link <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden /></button>
            </div>
          </div>
        </Block>

        <Block title="Cards and icon tiles" note="Surface + hairline, radius 20. Hover: hairline brightens, 2px lift. Selected: 1.5px Beam">
          <div className="grid gap-3 sm:grid-cols-3">
            {[{ t: 'Family celebration', h: 'Weddings, birthdays', I: Cake }, { t: 'Business or brand', h: 'Launches, conferences', I: Briefcase }, { t: 'Company team', h: 'Holiday parties', I: Gift }].map((c, n) => (
              <button key={c.t} type="button" aria-pressed={n === 0} className="bw-card bw-card-interactive flex min-h-[84px] items-center gap-4 p-4">
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
              <span key={n} className="bw-icon-tile" style={n % 2 ? { color: 'var(--bw-ink)' } : undefined} aria-hidden><I /></span>
            ))}
            <p className="bw-small self-center">lucide-react line icons, 1.5 stroke, 40px Surface 2 tile, radius 12. Icon in Beam or Ink. Never emoji.</p>
          </div>
        </Block>

        <Block title="Speech bubble, pills, field, progress">
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <div className="bw-bubble max-w-[320px] px-4 py-3">Hi, I’m Beamy! Who are you planning for?</div>
              <div role="group" aria-label="Look" className="flex flex-wrap gap-2">
                {['beam', 'wedding', 'christmas', 'birthday'].map((p) => (
                  <button key={p} type="button" className="bw-pill" aria-pressed={pressed === p} onClick={() => setPressed(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
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
            <li>One easing family: cubic-bezier(0.22, 1, 0.36, 1). Section changes 400–600ms.</li>
            <li>Outgoing content fades and slides 24px up; incoming rises; children stagger by 60ms.</li>
            <li>Nothing loops except Beamy’s idle. He reacts only at big moments, never the same way twice in a row.</li>
            <li>The beam of light is the one expressive effect: white into Beam, with an amber-white core.</li>
            <li>Reduced motion: crossfades, no beam flight, no particles or inertia. Every state change still happens.</li>
          </ul>
        </Block>
      </div>
    </div>
  );
}
