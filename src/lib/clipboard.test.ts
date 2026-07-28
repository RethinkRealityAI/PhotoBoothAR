import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasAsyncClipboard, copyText } from './clipboard';

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function setClipboard(clipboard: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard },
    configurable: true,
    writable: true,
  });
}
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original);
});

describe('hasAsyncClipboard', () => {
  it('is false when the API is missing — a NON-SECURE CONTEXT, not an exotic case', () => {
    // navigator.clipboard is undefined over plain HTTP, which is exactly what
    // "Test on phone" invites a host into. Reading .writeText off it threw.
    setClipboard(undefined);
    expect(hasAsyncClipboard()).toBe(false);
  });

  it('is false when clipboard exists but writeText does not', () => {
    setClipboard({});
    expect(hasAsyncClipboard()).toBe(false);
  });

  it('is true when writeText is callable', () => {
    setClipboard({ writeText: () => Promise.resolve() });
    expect(hasAsyncClipboard()).toBe(true);
  });
});

describe('copyText', () => {
  it('resolves true when the async API succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('https://example.test/x')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.test/x');
  });

  it('does not throw when the clipboard API is absent', async () => {
    setClipboard(undefined);
    // No DOM in this env either, so the legacy path bails — the contract is
    // simply that it resolves false rather than throwing a TypeError.
    await expect(copyText('x')).resolves.toBe(false);
  });

  it('does not reject when writeText rejects (unfocused document / denied)', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
    await expect(copyText('x')).resolves.toBe(false);
  });

  it('refuses empty text without touching the clipboard', async () => {
    const writeText = vi.fn();
    setClipboard({ writeText });
    await expect(copyText('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
