/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Watch it in action": the five product films on the guides hub.
 *
 * The films moved here from the homepage. Built to keep the hub light:
 *
 *  - ONE player. A tile picks which film it shows, rather than five
 *    <video>s autoplaying side by side. FilmEmbed plays whatever is in view,
 *    and iOS caps concurrent video pipelines, so five at once would freeze
 *    some of them. It is keyed on the film, the same way the homepage tab row
 *    does it, so a switch starts the new film cleanly.
 *  - Mounted only when the section nears the viewport. Until then the stage
 *    is a lazy poster <img>, so a visitor who reads the guide cards and
 *    leaves fetches no video at all (FilmEmbed preloads metadata as soon as
 *    it mounts).
 *  - The stage box is a fixed 16:9, so switching films never moves the page.
 *
 * Copy lives in guidesContent (FEATURE_FILMS), media in guidesMedia.
 */
import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import FilmEmbed from '../ui/FilmEmbed';
import { FEATURE_FILMS, FEATURE_FILMS_COPY, type FeatureFilmId } from '../../lib/guidesContent';
import { FEATURE_FILM_MEDIA } from '../../lib/guidesMedia';

export default function FeatureFilms() {
  const [active, setActive] = useState<FeatureFilmId>(FEATURE_FILMS[0].id);
  const [near, setNear] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Mount the player once the stage is within ~one screen of the viewport.
  useEffect(() => {
    const el = stageRef.current;
    if (el === null || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const film = FEATURE_FILMS.find((f) => f.id === active) ?? FEATURE_FILMS[0];
  const media = FEATURE_FILM_MEDIA[film.id];

  const pick = (id: FeatureFilmId) => {
    setActive(id);
    setNear(true);
    // On a phone the tiles sit under the player. If it has scrolled off the
    // top, bring it back so the tap visibly does something.
    const el = stageRef.current;
    if (el !== null && el.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
  };

  return (
    <section
      id="films"
      data-guide-block="films"
      aria-labelledby="films-title"
      className="mt-20 w-full scroll-mt-20 text-left sm:mt-28"
    >
      <div data-reveal="up" className="mx-auto mb-8 flex max-w-2xl flex-col items-center text-center sm:mb-10">
        <p className="mb-3 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70">
          {FEATURE_FILMS_COPY.eyebrow}
        </p>
        <h2 id="films-title" className="font-serif text-3xl leading-[1.1] text-shadow-lux sm:text-4xl">
          {FEATURE_FILMS_COPY.title}
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-brand-muted">{FEATURE_FILMS_COPY.blurb}</p>
      </div>

      <div ref={stageRef} className="scroll-mt-20" style={{ perspective: '1200px' }}>
        <div data-screen-tilt className="liquid-glass overflow-hidden rounded-2xl sm:rounded-3xl">
          <div className="relative aspect-video w-full bg-black/30">
            {near ? (
              <FilmEmbed
                key={film.id}
                src={media.src}
                poster={media.poster}
                label={`${film.title}: feature film`}
              />
            ) : (
              <img
                src={media.poster}
                alt=""
                width={1280}
                height={720}
                loading="lazy"
                decoding="async"
                className="block h-full w-full object-cover"
              />
            )}
          </div>
        </div>
      </div>

      {/* The caption for whichever film is on, announced politely on a switch. */}
      <div aria-live="polite" className="mt-5 flex flex-col gap-1.5 sm:mt-6">
        <span
          className="font-label uppercase tracking-luxe text-[10px] font-semibold"
          style={{ color: film.hue }}
        >
          {film.eyebrow}
        </span>
        <h3 className="font-serif text-xl leading-tight text-brand-fg sm:text-2xl">{film.title}</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-brand-muted">{film.hook}</p>
      </div>

      <ul
        data-reveal-stagger
        aria-label="Choose a film"
        className="mt-6 grid grid-cols-1 gap-2.5 sm:mt-8 sm:grid-cols-5 sm:gap-3"
      >
        {FEATURE_FILMS.map((f) => {
          const on = f.id === active;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => pick(f.id)}
                aria-pressed={on}
                aria-label={`Play ${f.eyebrow}: ${f.title}`}
                className={`pressable group flex min-h-11 w-full items-center gap-3 rounded-2xl border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:flex-col sm:items-stretch sm:gap-2.5 sm:p-2.5 ${
                  on ? 'bg-white/[0.08]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                }`}
                style={on ? { borderColor: `${f.hue}99` } : undefined}
              >
                <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-black/30 sm:w-full">
                  <img
                    src={FEATURE_FILM_MEDIA[f.id].poster}
                    alt=""
                    width={1280}
                    height={720}
                    loading="lazy"
                    decoding="async"
                    className={`block h-full w-full object-cover transition-opacity ${on ? 'opacity-100' : 'opacity-75 group-hover:opacity-100'}`}
                  />
                  <span
                    aria-hidden
                    className={`absolute inset-0 flex items-center justify-center transition-opacity ${on ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full liquid-glass text-brand-fg">
                      <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                    </span>
                  </span>
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 sm:px-0.5 sm:pb-0.5">
                  <span
                    className="font-label uppercase tracking-luxe text-[10px] font-semibold"
                    style={{ color: f.hue }}
                  >
                    {f.eyebrow}
                  </span>
                  <span className="text-[13px] leading-snug text-brand-fg/90">{f.title}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
