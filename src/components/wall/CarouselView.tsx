/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CarouselView — the live wall as a slowly turning ring of photographs.
 *
 * A third gallery mode beside Mosaic and Marquee, built on the shared
 * PhotoCarousel (adapted from pmndrs/examples "cards"). It is the "showpiece"
 * mode: fewer photos on screen than the mosaic, each one big, moving on its
 * own so a projector has presence in a room without anyone touching it.
 *
 * THE ARRIVAL BEAM STILL LANDS. The wall's ceremony (ArrivalBeam) reassembles
 * a guest's photo, particle by particle, into the DOMRect of its destination
 * tile. A 3D card has no DOMRect — so this view:
 *   1. rotates the ring so the arriving photo's card is driven to the FRONT,
 *   2. reports the FRONT SLOT's projected rectangle through the same
 *      `onTileRect` contract MosaicGrid uses, and
 *   3. holds that card invisible until the beam lands, exactly as a tile is
 *      held, so the photo appears to BECOME the card rather than pop in.
 * The ceremony itself is untouched: it cannot tell a 3D card from a div.
 *
 * TWO THINGS MAKE THAT WORK, and both are about WHEN. ArrivalBeam measures its
 * destination exactly once, in the effect that starts the ceremony, and never
 * again — so (a) the rectangle has to be in the map BEFORE that effect runs,
 * which is why it is published from an effect here (this view sits above the
 * ceremony in the tree, so its effects run first) rather than from a frame
 * that has not happened yet; and (b) the rectangle has to still be true when
 * the particles arrive, which is why it describes the stationary front slot
 * instead of a card the ring is still turning.
 *
 * WHY A WINDOW. Every card is a GPU texture and a wall runs for hours, so the
 * ring shows a recent window rather than the whole night — and how wide that
 * window is comes from the SCREEN (`ringSlotsFor`), not from however many
 * photos happen to exist. Sizing it by the photo count left a small ring
 * marooned in the middle of a wide wall; sizing it by the viewport fills the
 * frame and simply asks for more photos to do it. The mosaic remains the mode
 * for seeing everything.
 *
 * VIDEOS ARE ON THE RING. A clip's `image_url` is the clip, so it cannot be a
 * texture as-is — which is why the ring used to drop videos, and a dropped
 * video is a card that does not exist, so a guest's arriving clip beamed to
 * nowhere. `cardTexture` seeks a frame out of it (the same trick ArrivalBeam
 * already uses to compose a ceremony) and bakes a play glyph into it. The
 * card is a still on purpose: thirty simultaneous decoders is not something a
 * venue laptop survives, and the mosaic is still the mode that plays clips.
 *
 * FALLBACK. No WebGL → render nothing and let the parent keep the mosaic; the
 * wall must never become a black rectangle at an event.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PhotoCarousel, { hasWebGL, ringSlotsFor, type CarouselItem } from '../carousel/PhotoCarousel';
import { ringWindow } from '../../lib/carouselRing';
import type { BeamRect } from '../../lib/wallArrivals';
import type { Post } from '../../types';

interface Props {
  posts: Post[];
  /** Ids currently mid-ceremony — their cards stay invisible until landing. */
  beamingIds?: ReadonlySet<string>;
  /** Same contract as MosaicGrid, so ArrivalBeam needs no changes. */
  onTileRect?: (id: string, rect: BeamRect | null) => void;
  onSelect?: (post: Post) => void;
  /** Event accent for the floor pool. Left out, the ring reads the live
   *  `--color-accent` itself, which is what an event-themed wall wants. */
  accent?: string;
  /** A projector has no pointer; parallax would just sit still anyway. */
  projectionMode?: boolean;
}

/** Idle drift, radians/sec. One full turn ≈ 75s — present, never distracting. */
const IDLE_SPIN = (Math.PI * 2) / 75;

export default function CarouselView({
  posts, beamingIds, onTileRect, onSelect, accent, projectionMode = false,
}: Props) {
  const [usable] = useState(() => hasWebGL());

  // Measure the box the ring actually gets, not the window: the wall insets
  // this for its header and for the QR rail, and a ring sized to the window
  // would ask for cards that turn behind them.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 1440, height: 900 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const slots = useMemo(
    () => ringSlotsFor(box.width, box.height, 'ring'),
    [box.width, box.height],
  );

  const ringPosts = useMemo(() => ringWindow(posts, slots), [posts, slots]);

  const items = useMemo<CarouselItem[]>(
    () => ringPosts.map((p, i) => ({
      id: `${p.id}::${i}`,
      url: p.image_url,
      media: p.media_type === 'video' ? 'video' : 'photo',
    })),
    [ringPosts],
  );

  /** The arriving photo, if it is on the ring — the ring turns to face it. */
  const beamingIndex = useMemo(() => {
    if (!beamingIds?.size) return undefined;
    const i = ringPosts.findIndex((p) => beamingIds.has(p.id));
    return i >= 0 ? i : undefined;
  }, [ringPosts, beamingIds]);

  const trackItemId = beamingIndex === undefined ? null : items[beamingIndex]?.id ?? null;
  const trackPostId = beamingIndex === undefined ? null : ringPosts[beamingIndex]?.id ?? null;

  /** Latest front-slot rectangle, kept in a ref: it changes every frame and
   *  nothing here should re-render at 60 Hz. */
  const frontRect = useRef<BeamRect | null>(null);
  const handleFrontRect = useCallback((rect: BeamRect | null) => {
    frontRect.current = rect;
  }, []);

  // Cards are keyed with a ring-slot suffix (a short event repeats photos), so
  // hiding by post id means hiding every copy of it.
  const hiddenIds = useMemo(
    () => (trackItemId ? [trackItemId] : []),
    [trackItemId],
  );

  // Publish the destination under the POST's id — the ceremony knows posts,
  // not ring slots — the moment a photo starts arriving, and withdraw it when
  // that ceremony ends. Releasing matters as much as publishing: a stale rect
  // would aim the NEXT beam at a card that has since turned away.
  const lastTracked = useRef<string | null>(null);
  useEffect(() => {
    if (!onTileRect) return;
    if (lastTracked.current && lastTracked.current !== trackPostId) {
      onTileRect(lastTracked.current, null);
    }
    lastTracked.current = trackPostId;
    if (trackPostId && frontRect.current) onTileRect(trackPostId, frontRect.current);
    return () => {
      if (lastTracked.current) onTileRect(lastTracked.current, null);
    };
  }, [trackPostId, onTileRect]);

  const onSelectItem = useCallback(
    (item: CarouselItem) => {
      const idx = items.findIndex((i) => i.id === item.id);
      const post = idx >= 0 ? ringPosts[idx] : undefined;
      if (post && onSelect) onSelect(post);
    },
    [items, ringPosts, onSelect],
  );

  if (!usable) return null;

  return (
    // Normal flow, NOT `absolute inset-0`: an absolutely positioned child
    // resolves its insets against the ancestor's PADDING box, so it would
    // ignore the room the wall reserves for its header and QR rail and spin
    // the ring straight back underneath them.
    <div ref={boxRef} className="relative h-full w-full">
      {items.length > 0 && (
        <PhotoCarousel
          items={items}
          focusIndex={beamingIndex}
          autoSpin={beamingIndex === undefined ? IDLE_SPIN : 0}
          hiddenIds={hiddenIds}
          onFrontRect={handleFrontRect}
          onSelect={onSelect ? onSelectItem : undefined}
          accent={accent}
          pointerParallax={!projectionMode}
          // A narrow wall pulls BACK rather than closing in: its header, QR panels
          // and bottom bar overlay this same canvas, and a lone giant photo stops
          // reading as a carousel at all.
          framing="ring"
          className="absolute inset-0"
        />
      )}
    </div>
  );
}
