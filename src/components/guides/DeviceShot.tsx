/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A real product screen in a device: a phone bezel for guest screens, a
 * browser window for host screens. Tap it to see it full size.
 *
 * The enlarge view is a native <dialog> opened with showModal(): it lands in
 * the top layer, so the guides page's own scroll container cannot clip it, and
 * Escape, focus trapping and the inert page behind come from the browser rather
 * than from code here. A click on the backdrop (the dialog element itself, not
 * the picture) closes it too.
 *
 * Every <img> carries its real width and height from GUIDE_SCREENS, so the
 * page never jumps as the pictures arrive, and all but the first on a page load
 * lazily.
 */
import { useRef } from 'react';
import { Maximize2, X } from 'lucide-react';
import { GUIDE_SCREENS, type GuideScreenId } from '../../lib/guidesContent';
import { guideScreen } from '../../lib/guidesMedia';

export default function DeviceShot({
  screen,
  /** Sizing and placement. Defaults to the full width of its column. */
  className = 'w-full',
  eager = false,
  zoom = true,
}: {
  screen: GuideScreenId;
  className?: string;
  /** Load straight away instead of lazily (a picture near the top of a page). */
  eager?: boolean;
  /** Tap to enlarge. Off where the picture sits inside a link (a hub card). */
  zoom?: boolean;
}) {
  const shot = GUIDE_SCREENS[screen];
  const dialog = useRef<HTMLDialogElement>(null);
  const src = guideScreen(screen);
  const phone = shot.device === 'phone';

  const picture = (
    <img
      src={src}
      alt={shot.alt}
      width={shot.width}
      height={shot.height}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className={`block h-auto w-full ${phone ? 'rounded-[1.35rem]' : 'rounded-b-[0.6rem]'}`}
    />
  );

  const device = phone ? (
    <span className="block rounded-[1.75rem] border border-white/15 bg-[#0b0a1f]/70 p-1.5 shadow-[0_24px_60px_-24px_rgba(8,6,30,0.85)]">
      {picture}
    </span>
  ) : (
    <span className="block overflow-hidden rounded-xl border border-white/15 bg-[#0b0a1f]/70 shadow-[0_24px_60px_-24px_rgba(8,6,30,0.85)]">
      <span aria-hidden className="flex h-6 items-center gap-1.5 border-b border-white/10 bg-white/[0.06] px-3">
        <span className="h-2 w-2 rounded-full bg-white/25" />
        <span className="h-2 w-2 rounded-full bg-white/25" />
        <span className="h-2 w-2 rounded-full bg-white/25" />
      </span>
      {picture}
    </span>
  );

  if (!zoom) return <span className={`block ${className}`}>{device}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={`Enlarge: ${shot.alt}`}
        className={`group relative block cursor-zoom-in rounded-[1.75rem] text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${className}`}
      >
        {device}
        <span
          aria-hidden
          // Always showing on touch screens (no hover there to reveal it), where
          // a desktop screen squeezed to phone width most needs enlarging.
          className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white opacity-80 backdrop-blur-md transition [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>
      <dialog
        ref={dialog}
        aria-label={shot.alt}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="m-auto max-h-none max-w-none overflow-visible bg-transparent p-0 backdrop:bg-[#07061a]/85 backdrop:backdrop-blur-sm"
      >
        <img
          src={src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          className={`block h-auto max-h-[88vh] w-auto max-w-[92vw] object-contain shadow-2xl ${phone ? 'rounded-[1.6rem]' : 'rounded-xl'}`}
        />
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="Close"
          // autoFocus inside a dialog: showModal() moves focus here, so the
          // first key a keyboard user presses can close it.
          autoFocus
          className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </dialog>
    </>
  );
}
