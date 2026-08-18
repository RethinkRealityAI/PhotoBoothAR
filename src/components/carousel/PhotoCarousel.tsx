/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PhotoCarousel — a ring of photographs you orbit, shared by the live wall and
 * the keepsake viewer.
 *
 * Adapted from the pmndrs/examples "cards" demo (circular placement + a damped
 * camera that follows the pointer). What changed for this platform, and why:
 *
 *   • CARDS FACE OUTWARD. The demo offsets each card's Y rotation by π/2, which
 *     reads as a rolodex seen from above. A live wall is read head-on from
 *     across a room, so ours face straight out of the ring (see carouselRing).
 *   • PORTRAIT. Booth captures are 9:16; the demo's cards are 1.618 landscape.
 *   • NO SCROLL DEPENDENCY. The demo drives rotation from ScrollControls. Ours
 *     is driven by a target angle the parent owns — the wall points it at a
 *     newly arrived photo, the keepsake points it at the page you are on — and
 *     eases along the SHORT way round so it never unwinds a full turn.
 *   • REPORTS ITS FRONT. `onFrontRect` hands back the screen rectangle of the
 *     slot at the front of the ring, so the wall's particle beam can reassemble
 *     a guest's photo onto the card that turns into it (see CarouselView).
 *   • DEGRADES. No WebGL, or `prefers-reduced-motion`, is the caller's cue to
 *     render something else; this component reports readiness rather than
 *     assuming a projector can run it.
 *
 * Deliberately no new dependencies: drei's <Image> already does rounded
 * corners, and THREE.MathUtils.damp replaces maath's easing.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Image } from '@react-three/drei';
import {
  ringLayout,
  rotationForIndex,
  shortestAngleDelta,
  ndcBoundsToScreenRect,
  depthPresence,
  ringRadiusForCount,
  cameraDistanceForCard,
  cardHeightFraction,
  safeThreeColor,
  type ScreenRect,
} from '../../lib/carouselRing';

export interface CarouselItem {
  id: string;
  url: string;
}

export interface PhotoCarouselProps {
  items: CarouselItem[];
  /** Slot index to bring to the front; the ring eases there. */
  focusIndex?: number;
  /** Radians/second of idle drift. 0 = hold still (keepsake). */
  autoSpin?: number;
  /** Cards to render invisible — the wall hides a card until its beam lands. */
  hiddenIds?: readonly string[];
  /**
   * The on-screen rectangle of the FRONT slot, reported each frame.
   *
   * Not "where card X is right now": where the focused card ENDS UP. The wall's
   * arrival ceremony measures its destination once, at the instant it starts,
   * and deliberately never re-measures — so handing it a rectangle that the
   * ring is still rotating would land the particles beside a moving card. The
   * front slot is fixed in space, the ring turns the arriving photo into it,
   * and the beam and the card meet there.
   */
  onFrontRect?: (rect: ScreenRect | null) => void;
  onSelect?: (item: CarouselItem) => void;
  /**
   * Accent for the floor pool. Omitted (the normal case) it is read from the
   * live `--color-accent`, so the ring wears the event's colour on the wall and
   * the keepsake's colour on a card page without either caller plumbing it.
   */
  accent?: string;
  /** Camera follows the pointer (keepsake); a projector has no pointer. */
  pointerParallax?: boolean;
  /**
   * What a NARROW screen should do to the framing. The two surfaces want
   * opposite things, so neither can have it as a constant:
   *
   *   'hero' — the front card grows to fill the phone. Right for a keepsake:
   *            the page is the ring and a line of copy, and the neighbours
   *            were always going to crop at the edges.
   *   'ring' — the front card SHRINKS so its neighbours stay in frame and the
   *            thing still reads as a carousel. Right for the wall, whose
   *            header, QR panels and bottom bar overlay this same canvas — a
   *            phone-sized wall has less room to give the hero, not more.
   *
   * Both land on the same framing once the canvas is landscape.
   */
  framing?: 'hero' | 'ring';
  /** Override the derived ring radius. Normally left alone. */
  radius?: number;
  className?: string;
}

const CARD_H = 2.4;
const CARD_W = CARD_H * (9 / 16); // booth captures are 9:16
const CARD_HALF = { x: CARD_W / 2, y: CARD_H / 2 };

/**
 * The ring sits a little above the camera's aim, and the camera stands well
 * back at a narrow field of view.
 *
 * Both are framing decisions taken against the LIVE WALL, which is the harder
 * case: at the demo's short throw the nearest card is ~3.7 units away and the
 * far side ~14, so perspective blows the front card off the bottom of a
 * projector and crops it against the QR panels. Standing back and narrowing
 * the lens flattens that ratio to ~2:1 — the whole ring reads as one object,
 * and the lift keeps the card that a beam just landed on clear of the wall's
 * bottom furniture.
 *
 * The DISTANCE is not a constant: it is derived per ring from the photo count
 * (see carouselRing), because the ring widens as the evening fills it and a
 * fixed camera would quietly shrink the hero photo as guests arrived.
 */
const RING_LIFT = 0.45;
/** Used when no accent is given and the page has not themed one. */
const FALLBACK_ACCENT = '#5B8CFF';
const CAMERA_HEIGHT = 1.4;
const CAMERA_FOV = 32;

/** WebGL support, probed once — a projector without it must fall back. */
let webglOk: boolean | null = null;
export function hasWebGL(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement('canvas');
    webglOk = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

function Card({
  item, slotPosition, slotRotationY, slotAngle, ringRotation, hidden, hovered, anyHovered,
  onOver, onOut, onClick,
}: {
  item: CarouselItem;
  slotPosition: [number, number, number];
  slotRotationY: number;
  slotAngle: number;
  /** Live ring rotation, read per frame — state here would rerender 60×/s. */
  ringRotation: { current: number };
  hidden: boolean;
  hovered: boolean;
  anyHovered: boolean;
  onOver: () => void;
  onOut: () => void;
  onClick?: () => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    // Hovered card grows and lifts; its neighbours shrink back a little so the
    // hovered one reads as chosen rather than merely larger.
    const f = hidden ? 0.001 : hovered ? 1.22 : anyHovered ? 0.94 : 1;
    const d = Math.min(delta, 0.1); // a backgrounded tab returns one huge delta
    mesh.scale.x = THREE.MathUtils.damp(mesh.scale.x, CARD_W * f, 8, d);
    mesh.scale.y = THREE.MathUtils.damp(mesh.scale.y, CARD_H * f, 8, d);
    mesh.position.y = THREE.MathUtils.damp(mesh.position.y, hovered ? 0.18 : 0, 8, d);
    // Depth fade, so the far side of the ring recedes instead of competing
    // with the photo in front of it. Hovering pulls a card fully forward.
    const presence = hovered ? 1 : depthPresence(slotAngle, ringRotation.current);
    const mat = mesh.material as THREE.Material & { opacity: number };
    mat.opacity = THREE.MathUtils.damp(mat.opacity, hidden ? 0 : presence, 10, d);
  });

  return (
    <group position={slotPosition} rotation={[0, slotRotationY, 0]}>
      {/*
        In-canvas Suspense, PER CARD — the house pattern (see Studio3DView), and
        here it is load-bearing twice over. drei's <Image> suspends while its
        texture loads; a suspension that escapes the Canvas makes R3F's own
        CanvasImpl throw, React hides the subtree, its layout-effect cleanup
        calls forceContextLoss() — and because R3F keeps its root in a ref, the
        canvas comes back attached to a DEAD context and renders black forever.
        Per card rather than one boundary round the ring so photos appear as
        they arrive instead of the wall staying empty until the slowest lands.
      */}
      <Suspense fallback={null}>
        <Image
          ref={ref}
          url={item.url}
          transparent
          radius={0.06}
          scale={[CARD_W, CARD_H]}
          side={THREE.DoubleSide}
          onPointerOver={(e) => { e.stopPropagation(); onOver(); }}
          onPointerOut={onOut}
          onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
        />
      </Suspense>
    </group>
  );
}

function Ring({
  items, focusIndex, autoSpin, hiddenIds, onFrontRect, onSelect, radius, pointerParallax,
}: Required<Pick<PhotoCarouselProps, 'items' | 'radius'>> &
  Pick<PhotoCarouselProps, 'focusIndex' | 'autoSpin' | 'hiddenIds' | 'onFrontRect' | 'onSelect' | 'pointerParallax'>) {
  const group = useRef<THREE.Group>(null);
  const ringRotation = useRef(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const slots = useMemo(() => ringLayout(items.length, { radius }), [items.length, radius]);
  const hidden = useMemo(() => new Set(hiddenIds ?? []), [hiddenIds]);

  // Scratch objects reused every frame — allocating in useFrame is how a
  // smooth wall turns into a GC-stuttering one over a six-hour night.
  const scratch = useRef({
    v: new THREE.Vector3(),
    corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
  });

  const { camera, gl } = useThree();

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const d = Math.min(delta, 0.1);

    // Ease to the focused slot the SHORT way, then keep drifting.
    const target = focusIndex === undefined ? null : rotationForIndex(focusIndex, items.length);
    if (target !== null) {
      const to = g.rotation.y + shortestAngleDelta(g.rotation.y, target);
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, to, 3.2, d);
    }
    if (autoSpin) g.rotation.y += autoSpin * d;
    ringRotation.current = g.rotation.y;

    if (pointerParallax) {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, -state.pointer.x * 1.9, 3, d);
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y, state.pointer.y * 1.2 + CAMERA_HEIGHT, 3, d,
      );
      camera.lookAt(0, RING_LIFT, 0);
    }

    // Project the FRONT slot to a screen rect for the arrival ceremony. The
    // slot, not a card: it is the same four world-space corners every frame,
    // so the destination the beam was handed is still exactly right when the
    // particles get there a second and a half later.
    if (onFrontRect) {
      const { v, corners } = scratch.current;
      const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
      for (let c = 0; c < signs.length; c++) {
        v.set(signs[c][0] * CARD_HALF.x, RING_LIFT + signs[c][1] * CARD_HALF.y, radius);
        v.project(camera);
        corners[c].x = v.x;
        corners[c].y = v.y;
      }
      onFrontRect(ndcBoundsToScreenRect(corners, gl.domElement.getBoundingClientRect()));
    }
  });

  return (
    <group ref={group} position={[0, RING_LIFT, 0]}>
      {items.map((item, i) => (
        <Card
          key={`${item.id}-${i}`}
          item={item}
          slotPosition={slots[i]?.position ?? [0, 0, radius]}
          slotRotationY={slots[i]?.rotationY ?? 0}
          slotAngle={slots[i]?.angle ?? 0}
          ringRotation={ringRotation}
          hidden={hidden.has(item.id)}
          hovered={hovered === item.id}
          anyHovered={hovered !== null}
          onOver={() => setHovered(item.id)}
          onOut={() => setHovered((h) => (h === item.id ? null : h))}
          onClick={onSelect ? () => onSelect(item) : undefined}
        />
      ))}
    </group>
  );
}

/**
 * Keeps the camera at the distance the current ring wants.
 *
 * The <Canvas camera={...}> prop describes the camera at CREATION; a ring that
 * gains a photo — or a window that is resized, or a phone that is turned —
 * needs the camera to move afterwards, so the framing is applied here instead
 * of being frozen at mount. It also aims at the lifted
 * ring centre — without this a projector (which has no pointer, so nothing
 * else ever calls lookAt) would sight on the origin and tilt the ring.
 */
function Framing({ radius, aimY, framing }: { radius: number; aimY: number; framing: 'hero' | 'ring' }) {
  const { camera, size } = useThree();
  const aspect = size.width / size.height;
  const fraction = framing === 'hero'
    ? cardHeightFraction(aspect)
    : cardHeightFraction(aspect, 0.45, 0.3);
  const z = radius + cameraDistanceForCard(CARD_H, CAMERA_FOV, fraction);
  useEffect(() => {
    camera.position.z = z;
    camera.lookAt(0, aimY, 0);
    camera.updateProjectionMatrix();
  }, [camera, z, aimY]);
  return null;
}

/** Soft accent pool under the ring — grounds the cards instead of floating them. */
function Floor({ accent, radius }: { accent: string; radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, RING_LIFT - CARD_H / 2 - 0.05, 0]}>
      <circleGeometry args={[radius * 1.5, 64]} />
      <meshBasicMaterial color={accent} transparent opacity={0.06} />
    </mesh>
  );
}

export default function PhotoCarousel({
  items,
  focusIndex,
  autoSpin = 0,
  hiddenIds,
  onFrontRect,
  onSelect,
  accent,
  pointerParallax = true,
  framing = 'hero',
  radius,
  className,
}: PhotoCarouselProps) {
  const [failed, setFailed] = useState(false);
  const aliveRef = useRef(true);
  const restoreTimer = useRef<number | undefined>(undefined);

  /**
   * Context loss on a six-hour wall is survivable, and treating it as fatal is
   * worse than the loss: a browser reclaiming a context fires `lost` and then
   * `restored` a moment later, and React StrictMode's dev remount fires `lost`
   * during teardown. Marking the view dead on the first `lost` therefore killed
   * a carousel that was about to be perfectly fine.
   *
   * So: preventDefault (which is what permits restoration at all), wait, and
   * only fall back to the parent's DOM view if nothing comes back. Losses
   * arriving after unmount are ignored outright.
   */
  const onCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const el = gl.domElement;
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (!aliveRef.current) return;
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = window.setTimeout(() => {
        if (aliveRef.current) setFailed(true);
      }, 4000);
    });
    el.addEventListener('webglcontextrestored', () => {
      window.clearTimeout(restoreTimer.current);
      if (aliveRef.current) setFailed(false);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!hasWebGL()) setFailed(true);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(restoreTimer.current);
    };
  }, []);

  const ringAccent = useMemo(() => {
    if (accent) return safeThreeColor(accent, FALLBACK_ACCENT);
    if (typeof window === 'undefined') return FALLBACK_ACCENT;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
    return safeThreeColor(v, FALLBACK_ACCENT);
  }, [accent]);

  const ringRadius = radius ?? ringRadiusForCount(items.length, CARD_W);

  if (failed || items.length === 0) return null;

  return (
    <div className={className}>
      <Canvas
        dpr={[1, 1.5]}
        camera={{
          position: [0, CAMERA_HEIGHT, ringRadius + cameraDistanceForCard(CARD_H, CAMERA_FOV)],
          fov: CAMERA_FOV, near: 0.1, far: 100,
        }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={onCreated}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={1.4} />
        <Framing radius={ringRadius} aimY={RING_LIFT} framing={framing} />
        <Floor accent={ringAccent} radius={ringRadius} />
        <Ring
          items={items}
          focusIndex={focusIndex}
          autoSpin={autoSpin}
          hiddenIds={hiddenIds}
          onFrontRect={onFrontRect}
          onSelect={onSelect}
          radius={ringRadius}
          pointerParallax={pointerParallax}
        />
      </Canvas>
    </div>
  );
}
