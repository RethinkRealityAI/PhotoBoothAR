/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * When may the studio's window-level shortcuts (undo/redo, Delete, arrow
 * nudge) act? Pure so vitest can pin it; StudioShell builds the descriptor
 * from the live DOM.
 *
 * The handler used to skip only INPUT/TEXTAREA/contentEditable, so Backspace
 * on a focused chip inside the Power FX dialog deleted the crown BEHIND it,
 * Backspace with "Save before you go?" open deleted the selected visor, and
 * the arrow keys stole every <select> and slider.
 */

/** What the shell knows about the keydown's target and the page. */
export interface ShortcutTarget {
  tagName: string | null;
  isContentEditable: boolean;
  /** The target's `role` attribute, if any. */
  role: string | null;
  /** The target sits inside a `[role=dialog]` / `[aria-modal=true]`. */
  inDialog: boolean;
}

/** Native form controls that own their own keys. */
const OWN_KEYS_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** ARIA widgets whose keyboard model uses arrows / Backspace themselves. */
const OWN_KEYS_ROLES = new Set([
  'slider', 'spinbutton', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'radio', 'radiogroup', 'tab', 'tablist', 'menu', 'menuitem', 'menuitemradio',
  'menuitemcheckbox', 'grid', 'gridcell', 'tree', 'treeitem',
]);

/**
 * True when the shortcut must NOT fire. `modalOpen` covers any modal the
 * shell itself owns or any `aria-modal` element in the document, even when
 * focus has fallen back to <body> behind it.
 */
export function shortcutBlocked(t: ShortcutTarget | null, modalOpen: boolean): boolean {
  if (modalOpen) return true;
  if (!t) return false;
  if (t.inDialog || t.isContentEditable) return true;
  if (t.tagName !== null && OWN_KEYS_TAGS.has(t.tagName.toUpperCase())) return true;
  return t.role !== null && OWN_KEYS_ROLES.has(t.role.toLowerCase());
}
