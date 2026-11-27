import { afterEach, describe, expect, it } from 'vitest';
import {
  BOOT_ATTR, BOOT_LOOK_PREFIX, EVENT_ROW_SELECT, bootScript, bootStyle, discardBootRow, isOpaqueColor,
  isSafeColor, parseBootLook, parseEventPath, peekBootRowSync, takeBootRow,
} from './eventBoot';

describe('parseEventPath', () => {
  it('reads the slug and which route chunk applies', () => {
    expect(parseEventPath('/e/foreverwedo/welcome')).toEqual({ slug: 'foreverwedo', route: 'welcome' });
    expect(parseEventPath('/e/foreverwedo/booth')).toEqual({ slug: 'foreverwedo', route: 'booth' });
    expect(parseEventPath('/e/x/experience/abc')).toEqual({ slug: 'x', route: 'booth' });
    expect(parseEventPath('/e/lynxxx-birthday')).toEqual({ slug: 'lynxxx-birthday', route: null });
    expect(parseEventPath('/e/x/wall')).toEqual({ slug: 'x', route: null });
  });
  it('ignores every non-event page', () => {
    for (const p of ['/', '/host', '/login', '/r/foreverwedo', '/events/x']) expect(parseEventPath(p)).toBeNull();
  });
});

describe('colours from storage', () => {
  it('accepts plain colours only', () => {
    expect(isSafeColor('#E2B04A')).toBe(true);
    expect(isSafeColor('rgb(26, 15, 11)')).toBe(true);
    expect(isSafeColor('red;background:url(x)')).toBe(false);
    expect(isSafeColor('var(--x)')).toBe(false);
  });
  it('never boots on a see-through background (it would show white)', () => {
    expect(isOpaqueColor('rgba(0, 0, 0, 0)')).toBe(false);
    expect(isOpaqueColor('rgba(10, 10, 10, 0.5)')).toBe(false);
    expect(isOpaqueColor('#00000080')).toBe(false);
    expect(isOpaqueColor('rgb(26, 15, 11)')).toBe(true);
    expect(isOpaqueColor('rgba(26, 15, 11, 1)')).toBe(true);
  });
  it('parses a stored look, dropping anything odd', () => {
    expect(parseBootLook('{"bg":"rgb(26, 15, 11)","accent":"#E2B04A"}')).toEqual({ bg: 'rgb(26, 15, 11)', accent: '#E2B04A' });
    expect(parseBootLook('{"bg":"rgb(26, 15, 11)","accent":"url(x)"}')).toEqual({ bg: 'rgb(26, 15, 11)', accent: null });
    expect(parseBootLook('{"bg":"rgba(0, 0, 0, 0)"}')).toBeNull();
    expect(parseBootLook('not json')).toBeNull();
    expect(parseBootLook(null)).toBeNull();
  });
});

describe('boot style', () => {
  it('only acts while the boot attribute is on', () => {
    expect(bootStyle()).toContain(`html[${BOOT_ATTR}]`);
    expect(bootStyle()).not.toMatch(/(^|})html\{/);
  });
});

/** Runs the inline script against a fake page; returns what it did. */
function runScript(pathname: string, stored: Record<string, string> = {}, fetchImpl?: (url: string, init: unknown) => Promise<unknown>) {
  const attrs = new Map<string, string>();
  const styleProps = new Map<string, string>();
  const links: Array<Record<string, string>> = [];
  const meta = { content: '#262566', setAttribute(_k: string, v: string) { this.content = v; } };
  const fetches: string[] = [];
  const win: Record<string, unknown> = {
    Promise,
    fetch: (url: string, init: unknown) => { fetches.push(url); return fetchImpl ? fetchImpl(url, init) : new Promise(() => {}); },
  };
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), style: { setProperty: (k: string, v: string) => styleProps.set(k, v) } },
    querySelector: () => meta,
    createElement: () => ({}) as Record<string, string>,
    head: { appendChild: (n: Record<string, string>) => links.push(n) },
  };
  const localStorage = { getItem: (k: string) => stored[k] ?? null };
  const src = bootScript({ supabaseUrl: 'https://p.supabase.co/', anonKey: 'anon', chunks: { welcome: ['/assets/W.js', '/assets/x.js'], booth: ['/assets/B.js'] } });
  new Function('window', 'document', 'location', 'localStorage', 'fetch', src)(win, document, { pathname }, localStorage, win.fetch);
  return { attrs, styleProps, links, meta, fetches, win };
}

describe('inline boot script', () => {
  it('does nothing at all off an event route', () => {
    const r = runScript('/host');
    expect(r.attrs.size).toBe(0);
    expect(r.links).toHaveLength(0);
    expect(r.fetches).toHaveLength(0);
    expect(r.meta.content).toBe('#262566');
  });

  it('boots a first visit neutral, preloads the route and asks for the event row', () => {
    const r = runScript('/e/foreverwedo/welcome');
    expect(r.attrs.has(BOOT_ATTR)).toBe(true);
    expect(r.styleProps.size).toBe(0);
    expect(r.meta.content).toBe('#0b0a10');
    expect(r.links.map((l) => [l.rel, l.href])).toEqual([['modulepreload', '/assets/W.js'], ['modulepreload', '/assets/x.js']]);
    expect(r.fetches).toEqual([
      `https://p.supabase.co/rest/v1/events?select=${encodeURIComponent(EVENT_ROW_SELECT)}&slug=eq.foreverwedo`,
    ]);
    expect((r.win.__bwEventBoot as { slug: string }).slug).toBe('foreverwedo');
  });

  it('boots a repeat visit in the remembered colours', () => {
    const r = runScript('/e/foreverwedo/booth', { [BOOT_LOOK_PREFIX + 'foreverwedo']: '{"bg":"rgb(26, 15, 11)","accent":"#E2B04A"}' });
    expect(r.styleProps.get('--bw-boot-bg')).toBe('rgb(26, 15, 11)');
    expect(r.styleProps.get('--bw-boot-accent')).toBe('#E2B04A');
    expect(r.meta.content).toBe('rgb(26, 15, 11)');
    expect(r.links.map((l) => l.href)).toEqual(['/assets/B.js']);
  });

  it('refuses a tampered stored look', () => {
    const r = runScript('/e/x/welcome', { [BOOT_LOOK_PREFIX + 'x']: '{"bg":"red;x:url(y)","accent":"expression(1)"}' });
    expect(r.styleProps.size).toBe(0);
  });

  it('never throws, even when storage and fetch do', () => {
    expect(() => runScript('/e/x/welcome', {}, () => { throw new Error('blocked'); })).not.toThrow();
  });
});

describe('taking the boot answer', () => {
  const g = globalThis as { __bwEventBoot?: unknown };
  afterEach(() => { delete g.__bwEventBoot; });
  const row = { id: 'u1', slug: 'fw', status: 'live' };

  it('peeks without consuming, so a re-render after suspending sees it again', () => {
    g.__bwEventBoot = { slug: 'fw', rows: [row] };
    expect(peekBootRowSync('fw')).toEqual(row);
    expect(peekBootRowSync('fw')).toEqual(row);
    discardBootRow();
    expect(peekBootRowSync('fw')).toBeNull();
  });

  it('ignores another slug, an empty answer and an unfinished request', () => {
    g.__bwEventBoot = { slug: 'other', rows: [row] };
    expect(peekBootRowSync('fw')).toBeNull();
    g.__bwEventBoot = { slug: 'fw', rows: [] };
    expect(peekBootRowSync('fw')).toBeNull();
    g.__bwEventBoot = { slug: 'fw', p: new Promise(() => {}) };
    expect(peekBootRowSync('fw')).toBeNull();
  });

  it('waits for an in-flight answer once, then hands over to the network', async () => {
    g.__bwEventBoot = { slug: 'fw', p: Promise.resolve([row]) };
    await expect(takeBootRow('fw')).resolves.toEqual(row);
    await expect(takeBootRow('fw')).resolves.toBeNull();
  });

  it('a failed or missing answer falls back (a host may see their own draft)', async () => {
    g.__bwEventBoot = { slug: 'fw', p: Promise.resolve(null) };
    await expect(takeBootRow('fw')).resolves.toBeNull();
    g.__bwEventBoot = { slug: 'fw', p: Promise.reject(new Error('x')) };
    await expect(takeBootRow('fw')).resolves.toBeNull();
  });
});
