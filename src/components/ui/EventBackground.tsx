/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Renders the active event's ambient background.
 */
import { activeEvent } from '../../events/active';

export default function EventBackground(props: { density?: number; className?: string }) {
  const C = activeEvent.Background;
  return <C {...props} />;
}
