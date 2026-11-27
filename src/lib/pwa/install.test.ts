import { describe, expect, it } from 'vitest';
import { PLATFORM_COLOR, browserInstallAllowed, eventManifest, eventManifestFromQuery, eventManifestHref, installOffer, installRequested, isAndroid, isIos, manifestColor, parseInstallPath } from './install';

describe('the install offer', () => {
  it('offers the browser prompt only when the browser gave one', () => {
    expect(installOffer({ canPrompt: true, standalone: false, ios: false })).toBe('prompt');
    expect(installOffer({ canPrompt: false, standalone: false, ios: false })).toBeNull();
  });
  it('shows the manual steps on iPhone and iPad', () => {
    expect(installOffer({ canPrompt: false, standalone: false, ios: true })).toBe('ios-steps');
  });
  it('shows the menu steps on Android when the browser gave no prompt', () => {
    expect(installOffer({ canPrompt: false, standalone: false, ios: false, android: true })).toBe('android-steps');
    expect(installOffer({ canPrompt: true, standalone: false, ios: false, android: true })).toBe('prompt');
    expect(installOffer({ canPrompt: false, standalone: true, ios: false, android: true })).toBeNull();
    expect(isAndroid('Mozilla/5.0 (Linux; Android 15; SM-F966B) AppleWebKit/537.36 SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36')).toBe(true);
    expect(isAndroid('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
  });
  it('the install chip shows only on a link that asks for it', () => {
    expect(installRequested('?install')).toBe(true);
    expect(installRequested('?cachedebug&install=1')).toBe(true);
    expect(installRequested('')).toBe(false);
    expect(installRequested('?reinstall=1')).toBe(false);
  });
  it('offers nothing once installed', () => {
    expect(installOffer({ canPrompt: true, standalone: true, ios: false })).toBeNull();
    expect(installOffer({ canPrompt: false, standalone: true, ios: true })).toBeNull();
  });
  it('recognises iPadOS, which calls itself a Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 14)', 5)).toBe(false);
  });
});

describe('event pages', () => {
  it('reads the slug and spots the wall', () => {
    expect(parseInstallPath('/e/foreverwedo/wall')).toEqual({ slug: 'foreverwedo', wall: true });
    expect(parseInstallPath('/e/foreverwedo/booth')).toEqual({ slug: 'foreverwedo', wall: false });
    expect(parseInstallPath('/e/foreverwedo')).toEqual({ slug: 'foreverwedo', wall: false });
    for (const p of ['/', '/host', '/host/events/x/wall', '/r/x']) expect(parseInstallPath(p)).toBeNull();
    expect(parseInstallPath('/e/%E0%A4%A')).toBeNull();
  });

  it('accepts only colours an OS can paint a splash with', () => {
    expect(manifestColor('#1A0F0B', '#000')).toBe('#1A0F0B');
    expect(manifestColor('rgb(26, 15, 11)', '#000')).toBe('#1a0f0b');
    expect(manifestColor('rgba(26, 15, 11, 1)', '#000')).toBe('#1a0f0b');
    expect(manifestColor('rgba(0, 0, 0, 0)', '#123456')).toBe('#123456');
    expect(manifestColor('var(--x)', '#123456')).toBe('#123456');
    expect(manifestColor(null, '#123456')).toBe('#123456');
  });

  it('an installed wall reopens that wall, in the event name and colours', () => {
    const m = eventManifest({ origin: 'https://beamwall.app', slug: 'foreverwedo', wall: true, name: 'Mariba & Philip', background: 'rgb(26, 15, 11)' });
    expect(m.start_url).toBe('https://beamwall.app/e/foreverwedo/wall');
    expect(m.scope).toBe('https://beamwall.app/e/foreverwedo');
    expect(m.name).toBe('Mariba & Philip · Live wall');
    expect(m.display).toBe('standalone');
    expect(m.background_color).toBe('#1a0f0b');
    expect(m.theme_color).toBe('#1a0f0b');
  });

  it('the manifest has a real https address, and serving it gives the same manifest back', () => {
    const input = { origin: 'https://beamwall.app', slug: 'foreverwedo', wall: true, name: 'Mariba & Philip', background: 'rgb(26, 15, 11)' };
    const href = eventManifestHref(input);
    expect(href.startsWith('https://beamwall.app/event.webmanifest?')).toBe(true);
    const u = new URL(href);
    expect(eventManifestFromQuery(u.origin, u.searchParams)).toEqual(eventManifest(input));
    const booth = new URL(eventManifestHref({ ...input, wall: false, background: null }));
    expect(eventManifestFromQuery(booth.origin, booth.searchParams)).toEqual(eventManifest({ ...input, wall: false, background: null }));
  });

  it('refuses a slug no event can have, and paints a bad colour as the platform', () => {
    expect(eventManifestFromQuery('https://beamwall.app', new URLSearchParams('slug=../host'))).toBeNull();
    expect(eventManifestFromQuery('https://beamwall.app', new URLSearchParams(''))).toBeNull();
    const m = eventManifestFromQuery('https://beamwall.app', new URLSearchParams('slug=x&bg=javascript:1'));
    expect(m?.background_color).toBe(PLATFORM_COLOR);
    expect(m?.start_url).toBe('https://beamwall.app/e/x');
  });

  it("the browser's own install button is off only on a guest's plain event link", () => {
    expect(browserInstallAllowed('/e/foreverwedo/booth', false)).toBe(false);
    expect(browserInstallAllowed('/e/foreverwedo/wall', false)).toBe(false);
    expect(browserInstallAllowed('/e/foreverwedo/booth', true)).toBe(true);
    for (const p of ['/', '/host', '/host/events/x', '/admin', '/login']) expect(browserInstallAllowed(p, false)).toBe(true);
  });

  it('any other event page reopens the event, and every URL is absolute', () => {
    const m = eventManifest({ origin: 'https://beamwall.app', slug: 'a b', wall: false, name: '  ', background: null });
    expect(m.start_url).toBe('https://beamwall.app/e/a%20b');
    expect((m.start_url as string).startsWith(m.scope as string)).toBe(true);
    expect(m.name).toBe('Photo Booth');
    expect(m.background_color).toBe(PLATFORM_COLOR);
    for (const icon of m.icons as Array<{ src: string }>) expect(icon.src.startsWith('https://beamwall.app/')).toBe(true);
    expect((m.short_name as string).length).toBeLessThanOrEqual(12);
  });
});
