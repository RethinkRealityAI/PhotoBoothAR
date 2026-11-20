/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 'curtain' reveal — PLACEHOLDER until the real one lands. Contract: ./types.ts.
 */
import RevealPlaceholder from './RevealPlaceholder';
import type { CardRevealProps } from './types';

export default function CurtainReveal(props: CardRevealProps) {
  return <RevealPlaceholder {...props} label="curtain" />;
}
