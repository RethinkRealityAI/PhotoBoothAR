/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which photo the welcome page's booth preview shows. It must read as ONE
 * booth screen, but a guest's newest post may be a photo strip (2-3 shots
 * stacked on one 9:16 card) and posts carry no marker for that. So the
 * newest few photos are sampled at 90×160 and classified
 * (scenePage.stripShots): the newest single shot wins; when every candidate
 * is a strip, the newest strip is shown cropped to its first panel.
 *
 * Failure paths: an image that cannot be read (CORS refused, decode error,
 * timeout, no 2D context) counts as a single shot, so the preview never
 * goes blank because the check failed. Results are cached per URL.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Post } from '../../types';
import { transformedUrl } from '../../lib/mediaUrl';
import { boothShowcase, heroFrameUrl, type ShowcaseCard, STRIP_SAMPLE_H, STRIP_SAMPLE_W, stripPanelCrop, stripShots } from '../../lib/scenePage';
import { buildCatalog } from '../../lib/catalog';
import { effectiveOpeningLookId } from '../../lib/openingLook';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';

/** Newest photos checked before giving up and cropping a strip. */
const MAX_CANDIDATES = 6;
const CHECK_TIMEOUT_MS = 4000;

const verdicts = new Map<string, 0 | 2 | 3>();

function classify(url: string): Promise<0 | 2 | 3> {
  const known = verdicts.get(url);
  if (known !== undefined) return Promise.resolve(known);
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const done = (v: 0 | 2 | 3) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      verdicts.set(url, v);
      resolve(v);
    };
    const timer = setTimeout(() => done(0), CHECK_TIMEOUT_MS);
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = STRIP_SAMPLE_W;
        canvas.height = STRIP_SAMPLE_H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(0);
        ctx.drawImage(img, 0, 0, STRIP_SAMPLE_W, STRIP_SAMPLE_H);
        const { data } = ctx.getImageData(0, 0, STRIP_SAMPLE_W, STRIP_SAMPLE_H);
        const lum = new Float32Array(STRIP_SAMPLE_W * STRIP_SAMPLE_H);
        for (let i = 0; i < lum.length; i += 1) {
          lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
        }
        done(stripShots(lum, STRIP_SAMPLE_W, STRIP_SAMPLE_H));
      } catch {
        // A tainted canvas (no CORS) throws on getImageData: unknown = single.
        done(0);
      }
    };
    img.onerror = () => done(0);
    img.src = transformedUrl(url, { width: 180 }) ?? url;
  });
}

export interface BoothShot {
  post?: Post;
  /** Set when `post` is a strip: show only its first panel. */
  crop?: { cx: number; cy: number; scale: number };
}

/** `photos` oldest first (scenePage.wallFieldPhotos). */
export function useBoothShot(photos: readonly Post[]): BoothShot {
  const [shot, setShot] = useState<BoothShot>({});
  // The effect re-runs only when the candidate ids change, not on every new
  // array the store hands back.
  const latest = useRef(photos);
  latest.current = photos;
  const key = photos.slice(-MAX_CANDIDATES).map((p) => p.id).join('|');
  useEffect(() => {
    const candidates = latest.current.slice(-MAX_CANDIDATES).reverse();
    if (candidates.length === 0) {
      setShot({});
      return;
    }
    let cancelled = false;
    void (async () => {
      let firstStrip: { post: Post; shots: 2 | 3 } | null = null;
      for (const p of candidates) {
        const shots = await classify(p.image_url);
        if (cancelled) return;
        if (shots === 0) {
          setShot({ post: p });
          return;
        }
        firstStrip ??= { post: p, shots };
      }
      if (!cancelled && firstStrip) setShot({ post: firstStrip.post, crop: stripPanelCrop(firstStrip.shots) });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return shot;
}

/** The booth's own catalogue, from the store only: the caller's page fetches
 *  the experiences, preset overrides and wall settings. */
function useBoothCatalog() {
  const { config } = useEvent();
  const experiences = useStore((s) => s.experiences);
  const linkedGlobals = useStore((s) => s.linkedGlobals);
  const experiencesLoaded = useStore((s) => s.experiencesLoaded);
  const presetOverrides = useStore((s) => s.presetOverrides);
  return useMemo(
    () => buildCatalog(
      config.arContent,
      experiencesLoaded ? experiences : [],
      presetOverrides,
      experiencesLoaded ? linkedGlobals : [],
      true,
    ),
    [config.arContent, experiences, experiencesLoaded, linkedGlobals, presetOverrides],
  );
}

/** The frame drawn over the booth preview (scenePage.heroFrameUrl). */
export function useHeroFrameUrl(): string | undefined {
  const { config } = useEvent();
  const wallDefault = useStore((s) => s.wallSettings.defaultExperienceId);
  const catalog = useBoothCatalog();
  return useMemo(
    () => heroFrameUrl(catalog, effectiveOpeningLookId(wallDefault, config.defaultExperienceId)),
    [catalog, config.defaultExperienceId, wallDefault],
  );
}

/** The looks floating round the booth preview (scenePage.boothShowcase). */
export function useBoothShowcase(max = 6): ShowcaseCard[] {
  const catalog = useBoothCatalog();
  return useMemo(() => boothShowcase(catalog, max), [catalog, max]);
}
