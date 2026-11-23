import { describe, expect, it } from 'vitest';
import { authRedirectOrigin, authRedirectUrl, CANONICAL_ORIGIN, safeReturnPath } from './authRedirect';

const at = (url: string) => {
  const u = new URL(url);
  return { protocol: u.protocol, hostname: u.hostname, origin: u.origin };
};

describe('authRedirect', () => {
  it('production returns to beamwall.app', () => {
    expect(authRedirectUrl('/host', at('https://beamwall.app/login'))).toBe('https://beamwall.app/host');
  });

  it('never returns to a Netlify preview or the netlify.app host', () => {
    for (const u of [
      'https://deploy-preview-63--beamwall.netlify.app/login',
      'https://beamwall.netlify.app/login',
      'https://claude-project-thread-x--beamwall.netlify.app/',
      'https://www.beamwall.app/login',
    ]) {
      expect(authRedirectOrigin(at(u))).toBe(CANONICAL_ORIGIN);
    }
  });

  it('local dev keeps its own origin', () => {
    expect(authRedirectUrl('/host', at('http://localhost:5180/login'))).toBe('http://localhost:5180/host');
    expect(authRedirectOrigin(at('http://127.0.0.1:4173/'))).toBe('http://127.0.0.1:4173');
  });

  it('normalises a path without a leading slash', () => {
    expect(authRedirectUrl('reset-password', at('https://beamwall.app/'))).toBe('https://beamwall.app/reset-password');
  });
});

describe('safeReturnPath', () => {
  it('returns host-area deep links unchanged', () => {
    expect(safeReturnPath('/host/setup/abc/looks')).toBe('/host/setup/abc/looks');
    expect(safeReturnPath('/host/billing?tab=credits')).toBe('/host/billing?tab=credits');
    expect(safeReturnPath('/admin/support')).toBe('/admin/support');
    expect(safeReturnPath('/host')).toBe('/host');
  });

  it('falls back to the dashboard for anything else', () => {
    for (const bad of [undefined, null, 42, '', '/', '/e/party/booth', '//evil.com/host', '/\\evil.com', 'https://evil.com/host', '/hosting', '/host /x', '/login']) {
      expect(safeReturnPath(bad)).toBe('/host');
    }
  });
});
