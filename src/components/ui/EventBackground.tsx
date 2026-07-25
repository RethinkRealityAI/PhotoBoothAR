/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Renders the active event's ambient background.
 */
import { Suspense, type ComponentType } from 'react';
import { useEvent } from '../../events/EventContext';

export default function EventBackground(props: { density?: number; className?: string; [key: string]: unknown }) {
  const { config } = useEvent();
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
