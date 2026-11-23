/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beamy's note at the top of the album — the host's thank-you, in Beamy's
 * speech bubble, signed by the host.
 *
 * The art is a 17KB transparent webp cut from the mascot turnaround
 * (public/mascot/beamy-greet.webp), not the 3.5MB beamy.glb: an album opened on
 * the bus home must not spin up WebGL to say thank you. The idle bob and the
 * core's glow are CSS keyframes on transform/opacity only, and both stop under
 * prefers-reduced-motion.
 */
import type { RecapGreeting } from '../../lib/recapKeepsake';
import { K_GLASS } from './recapStyles';

export default function RecapBeamyCard({ greeting }: { greeting: RecapGreeting }) {
  return (
    <section
      data-reveal
      aria-label="A note from your host"
      className="relative flex flex-col items-center gap-3 sm:flex-row sm:items-end sm:gap-6"
    >
      <style>{BEAMY_CSS}</style>
      <div className="relative w-28 shrink-0 sm:w-36" aria-hidden>
        <div className="beamy-core absolute left-1/2 top-[46%] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(var(--k-glow-rgb),0.55)] blur-2xl sm:h-20 sm:w-20" />
        <img
          src="/mascot/beamy-greet.webp"
          alt=""
          width={360}
          height={321}
          decoding="async"
          className="beamy-bob relative block h-auto w-full drop-shadow-[0_18px_24px_rgba(0,0,0,0.35)]"
        />
      </div>

      <figure className={`beamy-bubble relative w-full rounded-[1.75rem] px-6 py-5 sm:px-8 sm:py-7 ${K_GLASS}`}>
        <blockquote className="flex flex-col gap-2.5">
          <p className="font-serif italic text-[1.6rem] leading-[1.15] text-[color:var(--k-ink)] sm:text-[2rem]">
            {greeting.headline}
          </p>
          <p className="font-sans text-[15px] leading-relaxed text-[color:var(--k-muted)]">{greeting.message}</p>
        </blockquote>
        <figcaption className="mt-5 flex flex-col gap-0.5">
          <span className="font-sans text-sm text-[color:var(--k-muted)]">{greeting.signOff}</span>
          <span className="font-serif italic text-xl text-[color:var(--k-accent-text)]">{greeting.signer}</span>
        </figcaption>
      </figure>
    </section>
  );
}

/* The bubble's tail points UP at Beamy on a phone (stacked) and LEFT on wider
 * screens (side by side). Drawn as a rotated square in the card's own colours. */
const BEAMY_CSS = `
.beamy-bubble::before {
  content: '';
  position: absolute;
  width: 18px; height: 18px;
  background: rgb(var(--k-surface-rgb));
  border-left: 1px solid var(--k-line);
  border-top: 1px solid var(--k-line);
  left: 50%; top: -9px; transform: translateX(-50%) rotate(45deg);
}
@media (min-width: 640px) {
  .beamy-bubble::before { left: -9px; top: auto; bottom: 34px; transform: rotate(-45deg); }
}
@keyframes beamy-bob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-7px) rotate(2deg); } }
@keyframes beamy-core { 0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.92); } 50% { opacity: 0.95; transform: translate(-50%, -50%) scale(1.08); } }
.beamy-bob { animation: beamy-bob 4.2s ease-in-out infinite; transform-origin: 50% 90%; }
.beamy-core { animation: beamy-core 3.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .beamy-bob, .beamy-core { animation: none; } }
`;
