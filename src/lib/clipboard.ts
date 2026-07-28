/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One way to copy text, because there were eighteen.
 *
 * Every "copy link" button on the platform called
 * `navigator.clipboard.writeText(x).then(...)` directly. That has two failure
 * modes, and neither was handled:
 *
 *  1. `navigator.clipboard` is UNDEFINED outside a secure context. Reading
 *     `.writeText` off it throws a TypeError. This is not hypothetical for this
 *     product — "Test on phone" exists to make a host open the studio on a LAN
 *     IP so their phone can reach it, and that is plain HTTP.
 *  2. `writeText` REJECTS when the document isn't focused or permission is
 *     denied. With only a `.then()` that became an unhandled rejection.
 *
 * So this resolves a boolean and never rejects, and falls back to the legacy
 * execCommand path — which is deprecated, but is the only thing that works at
 * all in a non-secure context, and is exactly where the modern API is missing.
 */

/** True when the async Clipboard API is actually usable here. */
export function hasAsyncClipboard(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

/** Copy `text`. Resolves true on success, false on any failure. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (hasAsyncClipboard()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through — a denied/unfocused write can still succeed below.
    }
  }
  return legacyCopy(text);
}

/**
 * execCommand('copy') over an off-screen textarea. Deprecated, and the only
 * option in a non-secure context. `readonly` + a zero-opacity fixed position
 * keeps iOS from scrolling to it or popping the keyboard.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
