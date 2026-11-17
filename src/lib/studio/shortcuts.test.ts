import { describe, it, expect } from 'vitest';
import { shortcutBlocked, type ShortcutTarget } from './shortcuts';

const el = (over: Partial<ShortcutTarget> = {}): ShortcutTarget => ({
  tagName: 'DIV',
  isContentEditable: false,
  role: null,
  inDialog: false,
  ...over,
});

describe('shortcutBlocked (#3 — modal- and control-aware studio shortcuts)', () => {
  it('fires on the page body / canvas', () => {
    expect(shortcutBlocked(el({ tagName: 'BODY' }), false)).toBe(false);
    expect(shortcutBlocked(null, false)).toBe(false);
  });
  it('never fires while a modal is open, wherever focus is', () => {
    expect(shortcutBlocked(el({ tagName: 'BODY' }), true)).toBe(true);
    expect(shortcutBlocked(null, true)).toBe(true);
  });
  it('never fires from inside a dialog (Backspace on a Power FX chip)', () => {
    expect(shortcutBlocked(el({ tagName: 'BUTTON', inDialog: true }), false)).toBe(true);
  });
  it('leaves native controls their own keys, SELECT included', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'select']) expect(shortcutBlocked(el({ tagName: tag }), false)).toBe(true);
    expect(shortcutBlocked(el({ isContentEditable: true }), false)).toBe(true);
  });
  it('leaves ARIA widgets their own keys', () => {
    for (const role of ['slider', 'tab', 'radio', 'option', 'listbox', 'menuitem', 'Slider']) {
      expect(shortcutBlocked(el({ role }), false)).toBe(true);
    }
    expect(shortcutBlocked(el({ tagName: 'BUTTON', role: 'button' }), false)).toBe(false);
  });
});
