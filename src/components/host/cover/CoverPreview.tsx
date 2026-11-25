/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live previews for the magazine cover editor:
 *  - CoverSelfiePreview: the selfie Frame over a sample photo, exactly as the
 *    booth draws it (render2d.ts).
 *  - CoverRoomPreview: the AR cover standing in a softly lit room, turning
 *    slowly so the hanging masthead, floating lines and garnishes read as 3D
 *    (the same build3d.ts the booth's world mode stands up).
 * Both load their renderer on demand.
 */
import { useEffect, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import type { ResolvedCover } from '../../../lib/cover/spec';

const SAMPLE_PHOTO = '/starters/soft-portrait.webp';

/** Redraw at most this often while the host types. */
const DEBOUNCE_MS = 180;

export function CoverSelfiePreview({ cover, className = '' }: { cover: ResolvedCover; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      import('../../../lib/cover/render2d')
        .then(async ({ renderCover2D }) => {
          const off = await renderCover2D(cover);
          const cv = canvas.current;
          if (!alive || !cv) return;
          cv.width = off.width;
          cv.height = off.height;
          cv.getContext('2d')?.drawImage(off, 0, 0);
          setDrawn(true);
        })
        .catch((e) => console.warn('[cover preview]', e));
    }, DEBOUNCE_MS);
    return () => { alive = false; window.clearTimeout(t); };
  }, [cover]);
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-[22px] bg-black/40 ${className}`}>
      <img src={SAMPLE_PHOTO} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Selfie cover preview: ${cover.masthead}`}
        className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${drawn ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

export function CoverRoomPreview({ cover, className = '' }: { cover: ResolvedCover; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    let raf = 0;
    let cleanup: (() => void) | null = null;
    setState('loading');
    const t = window.setTimeout(() => {
      Promise.all([import('three'), import('three/examples/jsm/environments/RoomEnvironment.js'), import('../../../lib/cover/build3d')])
        .then(async ([THREE, { RoomEnvironment }, { buildCover3D }]) => {
          if (!alive) return;
          const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          const scene = new THREE.Scene();
          const pm = new THREE.PMREMGenerator(renderer);
          const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
          scene.environment = env;
          const key = new THREE.DirectionalLight('#ffffff', 1.2);
          key.position.set(1.2, 3, 2.4);
          scene.add(key);
          const floor = new THREE.Mesh(
            new THREE.CircleGeometry(3, 48),
            new THREE.MeshStandardMaterial({ color: '#2a2735', roughness: 0.9, transparent: true, opacity: 0.55 }),
          );
          floor.rotation.x = -Math.PI / 2;
          scene.add(floor);
          const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 40);
          const obj = await buildCover3D(cover, renderer.capabilities.getMaxAnisotropy());
          if (!alive) { obj.dispose(); renderer.dispose(); env.dispose(); return; }
          scene.add(obj.group);
          el.appendChild(renderer.domElement);
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = '100%';
          const fit = () => {
            const w = Math.max(1, el.clientWidth);
            const h = Math.max(1, el.clientHeight);
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            // Far enough back that the whole cover, garnishes too, is in view.
            const dist = Math.max(4.4, 3.2 / Math.min(1, camera.aspect * 1.4));
            camera.userData.dist = dist;
            camera.updateProjectionMatrix();
          };
          fit();
          const ro = new ResizeObserver(fit);
          ro.observe(el);
          const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
          const loop = (now: number) => {
            const yaw = reduced ? 0.32 : Math.sin(now / 4200) * 0.42;
            const d = (camera.userData.dist as number) ?? 4.4;
            camera.position.set(Math.sin(yaw) * d, 1.45, Math.cos(yaw) * d);
            camera.lookAt(0, 1.2, 0);
            obj.tick(now);
            renderer.render(scene, camera);
            raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
          setState('ready');
          cleanup = () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            obj.dispose();
            (floor.geometry as THREE_NS.BufferGeometry).dispose();
            (floor.material as THREE_NS.Material).dispose();
            env.dispose();
            pm.dispose();
            renderer.dispose();
            renderer.domElement.remove();
          };
        })
        .catch((e) => { console.warn('[cover 3d preview]', e); if (alive) setState('failed'); });
    }, DEBOUNCE_MS * 2);
    return () => { alive = false; window.clearTimeout(t); cleanup?.(); };
  }, [cover]);
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-[22px] bg-[radial-gradient(90%_70%_at_50%_30%,#4a4660,#16141f)] ${className}`}>
      <div ref={host} className="absolute inset-0" role="img" aria-label={`AR cover preview: ${cover.masthead}, standing in a room`} />
      {state !== 'ready' && (
        <p className="absolute inset-x-0 bottom-4 text-center text-[13px] text-white/70">
          {state === 'failed' ? 'The 3D preview couldn’t load here. Guests still get it in AR.' : 'Building the 3D cover…'}
        </p>
      )}
    </div>
  );
}
