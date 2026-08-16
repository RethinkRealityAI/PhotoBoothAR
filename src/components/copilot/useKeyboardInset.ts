/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useKeyboardInset — how many pixels the mobile soft keyboard is covering at the
 * bottom of the window, so a bottom-anchored chat input can lift above it.
 *
 * WHY IT IS NEEDED: when the keyboard opens, the VISUAL viewport shrinks but the
 * LAYOUT viewport (the ICB) does not — iOS Safari ignores
 * `interactive-widget=resizes-content`. Anything laid out against the layout
 * viewport therefore keeps its full height and its bottom edge slides under the
 * keyboard: the host taps the field, the keyboard opens, and the field they
 * tapped is the thing it hides.
 *
 * Extracted from CopilotPanel, which was the ONLY copilot surface that had this
 * fix — the same chat mounted inline on /host/concierge and on /host/new's build
 * phase (and that page's own concierge input row) had none, so on a phone the
 * two surfaces a host uses most typed into a box they could not see.
 *
 * Desktop returns 0 (there is no soft keyboard), so a `md:` anchor is untouched.
 * On browsers that DO honour `interactive-widget=resizes-content`, innerHeight
 * drops with the visual viewport, so this reads ~0 and composes without
 * double-adjusting.
 */
import { useEffect, useState } from 'react';

/** Sub-keyboard jitter (a collapsing URL bar) is a few px; a real keyboard is
 *  an order of magnitude more. Below this, treat it as no keyboard at all. */
const MIN_KEYBOARD_PX = 60;

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const isMobile = !window.matchMedia('(min-width: 768px)').matches;
      const occluded = isMobile ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      setInset(occluded > MIN_KEYBOARD_PX ? occluded : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
