/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Renders the active event's wordmark / nav mark.
 */
import { activeEvent } from '../../events/active';

export function Wordmark(props: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const C = activeEvent.Wordmark;
  return <C {...props} />;
}

export function Mark() {
  const C = activeEvent.Mark;
  return <C />;
}

export function Emblem(props: { size?: number; className?: string }) {
  const C = activeEvent.Emblem;
  return <C {...props} />;
}
