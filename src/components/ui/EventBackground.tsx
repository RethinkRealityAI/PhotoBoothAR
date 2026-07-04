/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Renders the active event's ambient background.
 */
import type { ComponentType } from 'react';
import { useEvent } from '../../events/EventContext';

export default function EventBackground(props: { density?: number; className?: string; [key: string]: unknown }) {
  const { config } = useEvent();
  const C = config.Background as ComponentType<Record<string, unknown>>;
  return <C {...props} />;
}
