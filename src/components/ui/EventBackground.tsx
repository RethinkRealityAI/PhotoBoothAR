/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Renders the active event's ambient background.
 */
import { Suspense, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { useEvent } from '../../events/EventContext';
import { resolveScene, type EventScene } from '../../lib/sceneThemes';
import SceneBackdrop from '../theme/SceneBackdrop';

export default function EventBackground(props: { density?: number; className?: string; [key: string]: unknown }) {
  const { config, source } = useEvent();
  // A platform event whose host picked a page look (events.config.scene,
  // normalized at load). Coded legacy events never carry one, so they take
  // the original path below unchanged.
  if (source === 'db' && config.scene) {
    return <EventSceneBackground scene={config.scene} fallback={config.Background as ComponentType<Record<string, unknown>>} props={props} />;
  }
  const C = config.Background as ComponentType<Record<string, unknown>>;
  // Coded events supply Background as React.lazy (their modules can pull
  // three/R3F — see events/types.ts); fallback null = the page's solid
  // bg-brand-bg shows for the frame or two the chunk takes to arrive.
  return (
    <Suspense fallback={null}>
      <C {...props} />
    </Suspense>
  );
}

/** Guest routes whose chrome sits over a camera or the projected wall: the
 *  page must not take a light scene's dark ink there (the booth and wall
 *  screens dress themselves). */
const NO_FLIP_ROUTE = /\/(booth|wall)(\/|$)/;

function EventSceneBackground({
  scene, fallback: Fallback, props,
}: {
  scene: EventScene;
  fallback: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}) {
  const { pathname } = useLocation();
  const probe = useRef<HTMLSpanElement>(null);
  // The host's event studio (`data-platform` chrome) reuses this component
  // behind its admin screens. The scene is a GUEST page look, so the studio
  // keeps the animated background it always had; checked before first paint.
  const [inStudioChrome, setInStudioChrome] = useState(false);
  useLayoutEffect(() => {
    setInStudioChrome(probe.current?.closest('[data-platform]') != null);
  }, []);

  if (inStudioChrome) {
    return (
      <Suspense fallback={null}>
        <Fallback {...props} />
      </Suspense>
    );
  }
  return (
    <>
      <span ref={probe} hidden />
      <SceneBackdrop
        scene={resolveScene(scene)}
        className={typeof props.className === 'string' ? props.className : ''}
        flipTone={!NO_FLIP_ROUTE.test(pathname)}
      />
    </>
  );
}
