import { describe, it, expect } from 'vitest';
import {
  routeContext, sanitizeProps, BreadcrumbTrail, deviceFacts, MAX_BREADCRUMBS,
  setTelemetryContext, getTelemetryContext,
} from './telemetryCore';

describe('routeContext', () => {
  it.each([
    ['/e/lynxxx-birthday/booth', 'booth', 'lynxxx-birthday'],
    ['/e/lynxxx-birthday/wall', 'wall', 'lynxxx-birthday'],
    ['/e/lynxxx-birthday/welcome', 'guest', 'lynxxx-birthday'],
    ['/e/lynxxx-birthday', 'guest', 'lynxxx-birthday'],
    ['/e/lynxxx-birthday/admin/moderation', 'host', 'lynxxx-birthday'],
    ['/r/some-event', 'recap', 'some-event'],
    ['/c/abc123', 'card', null],
    ['/host/events/123', 'host', null],
    ['/admin/support', 'admin', null],
    ['/reset-password', 'auth', null],
    ['/', 'marketing', null],
    ['/guides/frames', 'marketing', null],
    ['/hub/p7m2k9qx', 'other', null],
  ])('%s → %s', (path, surface, slug) => {
    expect(routeContext(path)).toEqual({ surface, eventSlug: slug });
  });
});

describe('sanitizeProps', () => {
  it('keeps primitives, clips strings, drops objects and undefined', () => {
    const out = sanitizeProps({ a: 1.23456, b: 'x'.repeat(500), c: { nested: true }, d: undefined, e: null, f: false });
    expect(out).toEqual({ a: 1.23, b: 'x'.repeat(120), e: null, f: false });
  });
  it('zero and empty string are data, not absence', () => {
    expect(sanitizeProps({ n: 0, s: '' })).toEqual({ n: 0, s: '' });
  });
  it('non-finite numbers become null', () => {
    expect(sanitizeProps({ n: Infinity })).toEqual({ n: null });
  });
});

describe('BreadcrumbTrail', () => {
  it('keeps the newest MAX_BREADCRUMBS', () => {
    const t = new BreadcrumbTrail();
    for (let i = 0; i < MAX_BREADCRUMBS + 5; i++) t.add(`e${i}`, undefined, i);
    const snap = t.snapshot(1e9);
    expect(snap).toHaveLength(MAX_BREADCRUMBS);
    expect(snap[0].name).toBe('e5');
    expect(snap[snap.length - 1].name).toBe(`e${MAX_BREADCRUMBS + 4}`);
  });
  it('trims the oldest crumbs to fit the char budget', () => {
    const t = new BreadcrumbTrail();
    for (let i = 0; i < 30; i++) t.add('look_switched', { id: 'x'.repeat(100), i }, i);
    const snap = t.snapshot(1000);
    expect(JSON.stringify(snap).length).toBeLessThanOrEqual(1000);
    expect(snap[snap.length - 1].props?.i).toBe(29);
  });
});

describe('telemetry context', () => {
  it('undefined removes a key', () => {
    setTelemetryContext({ user_id: 'u1', event_slug: 'x' });
    setTelemetryContext({ user_id: undefined });
    expect(getTelemetryContext()).toEqual({ event_slug: 'x' });
  });
});

describe('deviceFacts', () => {
  it('iPhone Instagram webview', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 350.0';
    expect(deviceFacts(ua)).toEqual({ os: 'iOS', browser: 'other', mobile: true, inApp: 'instagram' });
  });
  it('Android Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
    expect(deviceFacts(ua)).toEqual({ os: 'Android', browser: 'Chrome', mobile: true, inApp: null });
  });
  it('desktop Safari', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
    expect(deviceFacts(ua)).toEqual({ os: 'macOS', browser: 'Safari', mobile: false, inApp: null });
  });
});
