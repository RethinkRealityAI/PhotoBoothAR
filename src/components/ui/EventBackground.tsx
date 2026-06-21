/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Renders the active event's ambient background.
 */
import type { ComponentType } from 'react';
import { activeEvent } from '../../events/active';

export default function EventBackground(props: { density?: number; className?: string; [key: string]: unknown }) {
  const C = activeEvent.Background as ComponentType<Record<string, unknown>>;
  return <C {...props} />;
}
