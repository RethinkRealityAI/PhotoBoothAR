/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hub's Features tab: a visual cheat sheet of everything Beamwall does.
 * One card per feature: a real product picture, an icon, the line to say,
 * and where it helps a live demo link and a copy button. The words live in
 * lib/salesFeatures.ts (pure, tested); this file only draws them.
 *
 * Pictures are real product screens: the /guides screens (shot on the public
 * demo events with the AI stand-in guest, never a real customer) plus a few
 * shot for this tab (src/assets/sales/features). Phone screens sit in a
 * tilted phone on a soft glow; wide screens fill their well. Tap any picture
 * to see it full size (a native <dialog>, so the hub's scroll box can't clip it).
 */
import { useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight, BookOpen, Bot, Box, Camera, Crown, Eye, Film, Frame, Gift, Handshake, Layers, Library, Mail, Maximize2,
  Megaphone, Monitor, Music2, Palette, QrCode, Search, ShieldCheck, Smartphone, Sparkles, Trophy, Users, Wand2, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  FAST_FIVE, FEATURE_GROUPS, searchFeatures, type Feature, type FeatureIcon, type FeatureImageKey, type FeatureTag,
} from '../../../lib/salesFeatures';
import { GUIDE_SCREENS } from '../../../lib/guidesContent';
import { guideScreen } from '../../../lib/guidesMedia';
import { BEAMY_WAVE, salesImage } from '../salesImages';
import CopyButton from './CopyButton';
import worldPlace from '../../../assets/sales/features/world-place.webp';
import photoStrips from '../../../assets/sales/features/photo-strips.webp';
import cardDesigns from '../../../assets/sales/features/card-designs.webp';
import keepsakeFilm from '../../../assets/sales/features/keepsake-film.webp';
import beamyReveals from '../../../assets/sales/features/beamy-reveals.webp';
import libraryTryOn from '../../../assets/sales/features/library-try-on.webp';
import aiFrameMaker from '../../../assets/sales/features/ai-frame-maker.webp';

const ICONS: Record<FeatureIcon, LucideIcon> = {
  qr: QrCode, frame: Frame, crown: Crown, paint: Palette, sparkles: Sparkles, box: Box, camera: Camera,
  trophy: Trophy, eye: Eye, zap: Zap, monitor: Monitor, shield: ShieldCheck, mail: Mail, film: Film, gift: Gift,
  wand: Wand2, library: Library, wizard: Layers, bot: Bot, studio: Box, handshake: Handshake, megaphone: Megaphone,
  users: Users, smartphone: Smartphone, album: BookOpen, music: Music2,
};

interface Pic {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** phone = a phone screen; wide = desktop/landscape; cutout = transparent art. */
  kind: 'phone' | 'wide' | 'cutout';
}

const guide = (id: keyof typeof GUIDE_SCREENS): Pic => {
  const s = GUIDE_SCREENS[id];
  return { src: guideScreen(id), width: s.width, height: s.height, alt: s.alt, kind: s.device === 'phone' ? 'phone' : 'wide' };
};

/** Every image key the data can name. Typed as a full Record: a key added to
 *  salesFeatures without a picture here is a compile error, not a broken img. */
const PICS: Record<FeatureImageKey, Pic> = {
  'guest-welcome': guide('guest-welcome'),
  'guest-frame': guide('guest-frame'),
  'guest-crown': guide('guest-crown'),
  'guest-paint': guide('guest-paint'),
  'guest-effects': guide('guest-effects'),
  'guest-more-looks': guide('guest-more-looks'),
  'guest-challenges': guide('guest-challenges'),
  'guest-send': guide('guest-send'),
  'wall-grid': guide('wall-grid'),
  'wall-gallery': guide('wall-gallery'),
  'setup-looks': guide('setup-looks'),
  'setup-launch': guide('setup-launch'),
  'setup-welcome': guide('setup-welcome'),
  'setup-powerups': guide('setup-powerups'),
  'studio-editor': guide('studio-editor'),
  'world-place': { src: worldPlace, width: 600, height: 1298, kind: 'phone', alt: 'World mode in the booth: “Place it in your space”, a life-size frame guests can step into, over the back camera' },
  'photo-strips': { src: photoStrips, width: 600, height: 1298, kind: 'phone', alt: 'The photo strip picker: 2 shots, 3 shots, 4 shots or a 2 × 2 grid' },
  'library-try-on': { src: libraryTryOn, width: 390, height: 844, kind: 'phone', alt: 'Trying a vintage trilby from the shared library on a face before adding it' },
  'ai-frame-maker': { src: aiFrameMaker, width: 600, height: 1582, kind: 'phone', alt: 'The AI frame maker: pick a style and colours, add a note, generate' },
  'card-designs': { src: cardDesigns, width: 1200, height: 1019, kind: 'wide', alt: 'Ten animated celebration card designs: gardens, roses, lanterns, fireworks and more' },
  'keepsake-film': { src: keepsakeFilm, width: 960, height: 540, kind: 'wide', alt: 'A frame from a keepsake film: a couple’s selfie with a caption, “Best night ever!”' },
  'beamy-reveals': { src: beamyReveals, width: 1200, height: 538, kind: 'wide', alt: 'Five Beamy reveal emails, each with a glowing button to unlock the news' },
  'beamy-wave': { src: BEAMY_WAVE.src, width: BEAMY_WAVE.width, height: BEAMY_WAVE.height, kind: 'cutout', alt: BEAMY_WAVE.alt },
};

const TAG_STYLE: Record<FeatureTag, string> = {
  New: 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100',
  'Paid plans': 'border-amber-300/40 bg-amber-300/10 text-amber-100',
  'Enterprise add-on': 'border-fuchsia-300/40 bg-fuchsia-300/10 text-fuchsia-100',
  'Done for you': 'border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)]/15 text-brand-fg',
  'Free plan': 'border-white/20 bg-white/10 text-brand-fg',
  'Coming soon': 'border-sky-300/40 bg-sky-300/10 text-sky-100',
};

/** The picture well at the top of a card, plus its enlarge dialog. */
function FeaturePicture({ pic, title }: { pic: Pic; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const well = 'relative block aspect-[4/3] w-full overflow-hidden rounded-t-[24px]';
  const glow = (
    <span aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_100%,rgba(212,214,255,0.28),transparent_60%),linear-gradient(160deg,rgba(91,140,255,0.22),rgba(150,96,190,0.18))]" />
  );
  let inner;
  if (pic.kind === 'phone') {
    inner = (
      <>
        {glow}
        <span className="absolute left-1/2 top-[9%] w-[46%] -translate-x-1/2 rotate-[-3deg] rounded-[1.4rem] border border-white/20 bg-[#0b0a1f]/80 p-1 shadow-[0_30px_60px_-20px_rgba(8,6,30,0.9)] transition duration-500 group-hover:rotate-0 group-hover:-translate-y-1 motion-reduce:transition-none">
          <img src={pic.src} alt={pic.alt} width={pic.width} height={pic.height} loading="lazy" decoding="async" draggable={false} className="block h-auto w-full rounded-[1.15rem]" />
        </span>
      </>
    );
  } else if (pic.kind === 'cutout') {
    inner = (
      <>
        {glow}
        <img src={pic.src} alt={pic.alt} width={pic.width} height={pic.height} loading="lazy" decoding="async" draggable={false} className="absolute inset-x-0 bottom-0 mx-auto h-[92%] w-auto object-contain drop-shadow-[0_18px_30px_rgba(8,6,30,0.6)] motion-safe:animate-float" />
      </>
    );
  } else if (pic.width / pic.height > 2) {
    // A long strip (a panel crop, a row of emails): show all of it, centred on the glow.
    inner = (
      <>
        {glow}
        <img src={pic.src} alt={pic.alt} width={pic.width} height={pic.height} loading="lazy" decoding="async" draggable={false} className="absolute inset-x-4 top-1/2 w-[calc(100%-2rem)] -translate-y-1/2 rounded-xl shadow-[0_24px_50px_-20px_rgba(8,6,30,0.9)] ring-1 ring-white/15" />
      </>
    );
  } else {
    inner = (
      <img src={pic.src} alt={pic.alt} width={pic.width} height={pic.height} loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
    );
  }
  if (pic.kind === 'cutout') return <span className={well}>{inner}</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={`Enlarge the picture: ${title}`}
        className={`${well} cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-accent)]`}
      >
        {inner}
        <span aria-hidden className="pointer-events-none absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white opacity-80 backdrop-blur-md transition [@media(hover:hover)]:opacity-0 group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>
      <dialog
        ref={dialog}
        aria-label={pic.alt}
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
        className="m-auto max-h-none max-w-none overflow-visible bg-transparent p-0 backdrop:bg-[#07061a]/85 backdrop:backdrop-blur-sm"
      >
        <img src={pic.src} alt={pic.alt} width={pic.width} height={pic.height} className={`block h-auto max-h-[88vh] w-auto max-w-[92vw] object-contain shadow-2xl ${pic.kind === 'phone' ? 'rounded-[1.6rem]' : 'rounded-xl'}`} />
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="Close"
          autoFocus
          className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </dialog>
    </>
  );
}

function FeatureCard({ f, origin }: { f: Feature; origin: string }) {
  const Icon = ICONS[f.icon];
  const pic = f.image !== undefined ? PICS[f.image] : null;
  return (
    <article id={`feature-${f.id}`} className="group flex flex-col rounded-[24px] liquid-glass transition hover:-translate-y-0.5 motion-reduce:transition-none">
      {pic !== null ? (
        <FeaturePicture pic={pic} title={f.title} />
      ) : (
        <span aria-hidden className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-t-[24px] bg-[radial-gradient(90%_80%_at_50%_40%,rgba(212,214,255,0.30),transparent_65%),linear-gradient(160deg,rgba(91,140,255,0.20),rgba(150,96,190,0.18))]">
          <span className="flex h-24 w-24 items-center justify-center rounded-[28px] liquid-glass">
            <Icon className="h-11 w-11 text-brand-fg" strokeWidth={1.5} />
          </span>
        </span>
      )}
      <div className="relative flex flex-1 flex-col p-5 pt-6">
        <span aria-hidden className="absolute -top-6 left-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-[color:var(--bw-deep-2,#1d1a4a)] shadow-[0_10px_24px_-10px_rgba(8,6,30,0.9)]">
          <Icon className="h-5 w-5 text-accent" />
        </span>
        <div className="flex flex-wrap items-center gap-2 pl-14">
          <h3 className="text-[18px] font-semibold leading-tight text-brand-fg">{f.title}</h3>
          {f.tag !== undefined && (
            <span className={`rounded-full border px-2 py-0.5 font-label text-[10px] font-bold uppercase tracking-[0.12em] ${TAG_STYLE[f.tag]}`}>{f.tag}</span>
          )}
        </div>
        <p className="mt-4 text-[15.5px] leading-snug text-brand-fg/95">
          <span aria-hidden className="mr-1 font-serif text-[22px] leading-none text-accent">“</span>
          {f.line}
        </p>
        {f.detail !== undefined && <p className="mt-2 text-[13px] leading-snug text-brand-muted">{f.detail}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          <CopyButton text={f.line} label="Copy line" variant="ghost" ariaLabel={`Copy the line for ${f.title}`} />
          {f.demo !== undefined && (
            <a
              href={`${origin}${f.demo.path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            >
              {f.demo.label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function HubFeatures() {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => searchFeatures(FEATURE_GROUPS, query), [query]);
  const count = FEATURE_GROUPS.reduce((n, g) => n + g.features.length, 0);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const hero = salesImage('beamy-crown');

  const jumpTo = (id: string) => {
    document.getElementById(`group-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      {/* Hero: what this is + the 30-second version */}
      <div className="relative overflow-hidden rounded-[32px] liquid-glass p-6 sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[color:var(--color-accent)]/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-10 h-80 w-80 rounded-full bg-fuchsia-400/15 blur-3xl" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.28em] text-accent">Features · {count} talking points</p>
            <h2 className="mt-2 font-serif text-[38px] font-semibold leading-[1.02] sm:text-[52px]">
              Everything it does,<br /><span className="text-foil-static">one line each.</span>
            </h2>
            <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-brand-muted">
              Scan this before a call. Every card is a real screen from the product and a line you can say as it is. Copy a line straight into a message, or open the live demo in front of them.
            </p>
            {hero !== null && (
              <img src={hero.src} width={hero.width} height={hero.height} alt={hero.alt} className="mt-6 hidden h-40 w-auto motion-safe:animate-float lg:block" />
            )}
          </div>
          <div className="rounded-[24px] border border-white/15 bg-white/[0.05] p-5 sm:p-6">
            <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.22em] text-brand-muted">Only got 30 seconds? Say these five</p>
            <ol className="mt-4 flex flex-col gap-3">
              {FAST_FIVE.map((line, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-snug text-brand-fg">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foil font-label text-[12px] font-bold text-white">{i + 1}</span>
                  <span className="pt-0.5">{line}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5">
              <CopyButton text={FAST_FIVE.join('\n')} label="Copy all five" variant="ghost" />
            </div>
          </div>
        </div>
      </div>

      {/* Find + jump */}
      <div className="z-20 -mx-4 mt-6 md:sticky md:top-0 bg-brand-bg/70 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:-mx-12 xl:px-12">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative block md:w-72">
            <span className="sr-only">Find a feature</span>
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a feature, e.g. video"
              className="min-h-11 w-full rounded-full liquid-glass-inset pl-10 pr-4 text-[16px] text-brand-fg placeholder:text-brand-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] md:text-[14.5px]"
            />
          </label>
          <nav aria-label="Feature groups" className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
            {FEATURE_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => { setQuery(''); requestAnimationFrame(() => jumpTo(g.id)); }}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-[13px] font-medium text-brand-muted transition hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
              >
                {g.eyebrow}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {groups.length === 0 && (
        <p className="mt-10 text-center text-[15px] text-brand-muted">Nothing matches “{query}”. Try “video”, “wall” or “3D”.</p>
      )}

      {groups.map((g) => (
        <section key={g.id} id={`group-${g.id}`} aria-labelledby={`group-${g.id}-title`} className="scroll-mt-28 pt-10">
          <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.28em] text-accent">{g.eyebrow}</p>
          <h2 id={`group-${g.id}-title`} className="mt-1.5 font-serif text-[30px] font-semibold leading-tight sm:text-[36px]">{g.title}</h2>
          <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-brand-muted">{g.intro}</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {g.features.map((f) => <FeatureCard key={f.id} f={f} origin={origin} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
