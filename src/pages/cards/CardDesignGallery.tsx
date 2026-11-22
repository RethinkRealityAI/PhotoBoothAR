/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CardDesignGallery — /card-designs (noindex): every illustrated card design,
 * playable full screen with a sample card, no account needed.
 *
 * It renders the REAL CardExperience (the component /c/:publicId uses) fed
 * with sample data from bundled images, so what plays here is exactly what a
 * recipient gets. Used to review the library, and as a link a host or a
 * prospect can open on their phone.
 *
 * The app shell is h-screen overflow-hidden, so this page owns its own
 * scrolling (h-full overflow-y-auto), like Landing and Guides.
 */
import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import CardExperience from '../../components/cards/CardExperience';
import { CARD_DESIGNS, designAssets, type CardDesignId } from '../../lib/cardDesigns';
import { CARD_TEMPLATES } from '../../components/cards/templates/registry';
import type { CardViewContribution, CardViewData } from '../../lib/cards';
import wedding from '../../assets/landing/hero/hero-wedding.webp';
import gala from '../../assets/landing/hero/hero-gala.webp';
import birthday from '../../assets/landing/hero/hero-birthday.webp';
import conference from '../../assets/landing/hero/hero-conference.webp';

/** A believable card per design, so each one is judged on its own occasion. */
const SAMPLE: Record<CardDesignId, { title: string; recipient: string }> = {
  'garden-gate': { title: 'Happy anniversary, Tolu and Sam', recipient: 'Tolu and Sam' },
  'balloon-bash': { title: 'Happy 30th, Ada!', recipient: 'Ada' },
  'gala-night': { title: 'Congratulations on the award', recipient: 'Maya' },
  owambe: { title: 'Happy 50th, Mummy Funke', recipient: 'Mummy Funke' },
  'city-lights': { title: 'Here’s to 40, Jordan', recipient: 'Jordan' },
  'moon-gate': { title: 'Happy Lunar New Year', recipient: 'the Chen family' },
  'cloud-nine': { title: 'Welcome, baby Amara', recipient: 'Amara' },
  'grand-hall': { title: 'You did it, Dr. Okafor', recipient: 'Chidi' },
  'island-sunset': { title: 'Just married!', recipient: 'Lena and Marco' },
  'winter-glow': { title: 'Merry Christmas, Grandma', recipient: 'Grandma' },
};

function sampleContributions(): CardViewContribution[] {
  const photos = [wedding, birthday, gala, conference];
  const notes: Array<[string, string]> = [
    ['Kemi', 'Tonight was everything. So glad we got to celebrate you together.'],
    ['The Squad', 'Cheers to many more years of this kind of joy!'],
    ['Daniel', 'Still laughing about the dance floor. Love you lots.'],
    ['Auntie Bisi', 'God bless you abundantly. Enjoy every moment.'],
  ];
  const out: CardViewContribution[] = [];
  photos.forEach((url, i) => {
    out.push({
      id: `photo-${i}`,
      contributorName: notes[i][0],
      message: i % 2 === 0 ? notes[i][1] : null,
      mediaType: 'photo',
      durationSeconds: null,
      url,
      sortOrder: out.length,
    });
    if (i % 2 === 1) {
      out.push({
        id: `note-${i}`,
        contributorName: notes[i][0],
        message: notes[i][1],
        mediaType: 'text',
        durationSeconds: null,
        url: null,
        sortOrder: out.length,
      });
    }
  });
  return out;
}

export default function CardDesignGallery() {
  const reducedMotion = useReducedMotion() ?? false;
  const [open, setOpen] = useState<CardDesignId | null>(null);
  const [template, setTemplate] = useState('storybook');
  const contributions = useMemo(sampleContributions, []);

  useEffect(() => {
    document.title = 'Card designs · Beamwall';
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const card: CardViewData | null = open
    ? {
        title: SAMPLE[open].title,
        recipientName: SAMPLE[open].recipient,
        template,
        theme: {},
        presentation: { reveal: 'envelope', design: open },
        publishedAt: '2026-11-21T00:00:00Z',
        eventName: null,
        filmUrl: null,
      }
    : null;

  return (
    <div data-platform className="app-bg h-full overflow-y-auto overscroll-contain px-4 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
      <header className="mx-auto max-w-5xl">
        <p className="font-sans text-[13px] font-semibold text-brand-muted/80">Beamwall keepsake cards</p>
        <h1 className="mt-1 font-serif text-[clamp(1.9rem,6vw,3rem)] leading-tight text-brand-fg">Card designs</h1>
        <p className="mt-2 max-w-xl font-sans text-[15px] leading-relaxed text-brand-muted/85">
          Hand-cut paper scenes for every kind of celebration. Tap one to open it the way a guest would.
        </p>
      </header>

      <div className="mx-auto mt-5 max-w-5xl">
        <p id="gallery-style" className="mb-2 font-sans text-[13px] font-semibold text-brand-fg">Card style inside</p>
        <div role="radiogroup" aria-labelledby="gallery-style" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {CARD_TEMPLATES.filter((t) => !t.fullBleed).map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={template === t.id}
              onClick={() => setTemplate(t.id)}
              className={`pressable min-h-11 shrink-0 rounded-full px-4 font-sans text-[13px] font-medium ${
                template === t.id ? 'is-selected text-brand-fg' : 'liquid-glass text-brand-muted hover:text-brand-fg'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <ul className="mx-auto mt-6 grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CARD_DESIGNS.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => setOpen(d.id)}
              className="pressable liquid-glass group flex w-full flex-col gap-2 rounded-3xl p-2 text-left"
            >
              <span className="block aspect-[3/5] w-full overflow-hidden rounded-2xl" style={{ backgroundColor: d.palette.bg }}>
                <img
                  src={designAssets(d.id).thumb}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                />
              </span>
              <span className="px-1 font-sans text-[14px] font-semibold text-brand-fg">{d.label}</span>
              <span className="line-clamp-2 px-1 pb-1 font-sans text-[12px] leading-snug text-brand-muted/80">{d.goodFor}</span>
            </button>
          </li>
        ))}
      </ul>

      {open && card && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${SAMPLE[open].title}, sample card`}>
          <CardExperience key={`${open}:${template}`} card={card} contributions={contributions} reducedMotion={reducedMotion} />
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Back to all designs"
            className="pressable glass-strong absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex h-11 w-11 items-center justify-center rounded-full text-brand-fg"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
