/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Head tags + per-device storage for the sales pages.
 *
 * Both sales routes are noindex: the hub is internal and the decks are sent
 * one-to-one. netlify.toml also sends X-Robots-Tag, but a crawler that runs
 * the SPA reads the meta tag, so it is added while mounted and removed after.
 */
import { useEffect, useState } from 'react';

/** Add (or update) a <meta> while mounted; restore the previous value after. */
export function useMetaTag(attr: 'name' | 'property', key: string, content: string): void {
  useEffect(() => {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
    const created = el === null;
    const previous = el?.getAttribute('content') ?? null;
    if (el === null) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
    return () => {
      if (created) el?.remove();
      else if (previous !== null) el?.setAttribute('content', previous);
    };
  }, [attr, key, content]);
}

export function useNoIndex(): void {
  useMetaTag('name', 'robots', 'noindex,nofollow');
}

/** localStorage read; any failure (private mode, blocked storage) → null. */
export function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage write; failures are swallowed — this is convenience state. */
export function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the value lives for this visit only.
  }
}

/** A string remembered on this device. */
export function useStoredString(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => readStore(key) ?? initial);
  const set = (v: string) => {
    setValue(v);
    writeStore(key, v);
  };
  return [value, set];
}

/** A JSON value remembered on this device; malformed data falls back to `initial`. */
export function useStoredJson<T>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = readStore(key);
    if (raw === null) return initial;
    try {
      const parsed: unknown = JSON.parse(raw);
      return valid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    writeStore(key, JSON.stringify(v));
  };
  return [value, set];
}
