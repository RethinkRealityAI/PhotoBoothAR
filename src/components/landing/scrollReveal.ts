/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The generic marketing scroll reveals, lifted out of Landing.tsx unchanged so
 * every public page animates identically: [data-reveal] slides in on entry,
 * [data-reveal-stagger] cascades its children, [data-screen-tilt] leans a film
 * upright on a scrub. Tween values, easings and ScrollTrigger params are the
 * shipped ones — this module is a move, not a redesign.
 *
 * Page-specific choreography (Landing's parallax, ghost frames, cluster sweep,
 * how-it-works steps and decor pops) deliberately stays with the page that owns
 * that DOM. Both halves are called from inside a gsap.matchMedia() branch, and
 * `scroller` is the caller's own scroll container — the platform shell is
 * overflow-hidden, so the page, not the window, does the scrolling.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/** Full-motion reveals — call from the '(prefers-reduced-motion: no-preference)' branch. */
export function applyReveals(content: HTMLElement, scroller: HTMLElement) {
  const OFFSETS: Record<string, { x: number; y: number }> = {
    up: { x: 0, y: 64 },
    left: { x: -80, y: 0 },
    right: { x: 80, y: 0 },
  };
  gsap.utils.toArray<HTMLElement>('[data-reveal]', content).forEach((el) => {
    const o = OFFSETS[el.dataset.reveal || 'up'] ?? OFFSETS.up;
    gsap.fromTo(
      el,
      { x: o.x, y: o.y, opacity: 0 },
      {
        x: 0,
        y: 0,
        opacity: 1,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, scroller, start: 'top 85%' },
      },
    );
  });
  gsap.utils.toArray<HTMLElement>('[data-reveal-stagger]', content).forEach((group) => {
    gsap.fromTo(
      group.children,
      { y: 30, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.7,
        stagger: 0.09,
        ease: 'power2.out',
        scrollTrigger: { trigger: group, scroller, start: 'top 88%' },
      },
    );
  });
  // Feature films lean back like a screen settling upright: a scrubbed
  // rotateX from a deep recline to a slight resting tilt as the film
  // scrolls up into view (perspective lives on the film's wrapper).
  gsap.utils.toArray<HTMLElement>('[data-screen-tilt]', content).forEach((el) => {
    gsap.fromTo(
      el,
      // Deeper entry + a longer scrub window (98%→35%) + snappier scrub:
      // on phones a fast flick used to blow through the old 95→40 range
      // before a frame rendered, so the tilt was never seen on mobile.
      { rotateX: 24, scale: 0.93, transformOrigin: 'center 85%' },
      {
        rotateX: 5,
        scale: 1,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, scroller, scrub: 0.35, start: 'top 98%', end: 'top 35%' },
      },
    );
  });
}

/** The reduced-motion fallback for those same three selectors: a plain opacity
 *  fade (no movement) rather than nothing at all, and screens resting at their
 *  settled tilt. Call from the '(prefers-reduced-motion: reduce)' branch. */
export function applyReducedReveals(content: HTMLElement, scroller: HTMLElement) {
  gsap.utils.toArray<HTMLElement>('[data-reveal], [data-reveal-stagger]', content).forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0 },
      { opacity: 1, duration: 0.5, scrollTrigger: { trigger: el, scroller, start: 'top 90%' } },
    );
  });
  // Screens rest at their settled tilt — no scrubbed motion.
  gsap.utils.toArray<HTMLElement>('[data-screen-tilt]', content).forEach((el) => {
    gsap.set(el, { rotateX: 5, transformOrigin: 'center 85%' });
  });
}
