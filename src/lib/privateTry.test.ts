import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPrivatePost,
  isPrivateTry,
  listPrivatePosts,
  privateGallery,
  removePrivatePost,
  resetPrivateTry,
  setPrivateGallery,
  slugFromQrLanding,
  subscribePrivatePosts,
} from './privateTry';
import { isDeleteToken } from './postDelete';
import { demoQrUrl, HOME_ASSET_DEFAULTS } from './beamyAssets';

afterEach(() => {
  resetPrivateTry();
  vi.unstubAllGlobals();
});

describe('isPrivateTry', () => {
  it('always covers the demo event the homepage QR opens', () => {
    expect(isPrivateTry(HOME_ASSET_DEFAULTS.demoEventSlug ?? '')).toBe(true);
    expect(isPrivateTry('demo')).toBe(true);
  });

  it('leaves every real event alone', () => {
    for (const slug of ['hope-gala', 'jenna-jake', 'detola-wuyi', 'lynxxx-birthday', 'the-winter-gala', '']) {
      expect(isPrivateTry(slug)).toBe(false);
    }
  });

  it('marks the slug the QR landed on private for the rest of the tab', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal('window', { location: { pathname: '/e/beamy-demo/welcome', search: '?from=beamy-qr' } });
    expect(isPrivateTry('beamy-demo')).toBe(true);
    expect(isPrivateTry('another-event')).toBe(false);
    // Later pages in the same tab no longer carry the marker.
    vi.stubGlobal('window', { location: { pathname: '/e/beamy-demo/booth', search: '' } });
    resetPrivateTry();
    expect(isPrivateTry('beamy-demo')).toBe(true);
  });
});

describe('slugFromQrLanding', () => {
  it('reads the slug off the QR the homepage draws', () => {
    const url = new URL(demoQrUrl('https://beamwall.app', 'beamy-demo'));
    expect(slugFromQrLanding(url.pathname, url.search)).toBe('beamy-demo');
  });

  it('ignores any other link', () => {
    expect(slugFromQrLanding('/e/gala/welcome', '')).toBeNull();
    expect(slugFromQrLanding('/e/gala/welcome', '?from=signage')).toBeNull();
    expect(slugFromQrLanding('/host', '?from=beamy-qr')).toBeNull();
  });
});

describe('the on-device store', () => {
  it('keeps a shot, shows it back and tells the wall', () => {
    const seen: string[] = [];
    const off = subscribePrivatePosts('demo', (e) => seen.push(e.kind === 'insert' ? `+${e.post.id}` : `-${e.id}`));
    const { post, deleteToken } = addPrivatePost('demo', { url: 'blob:x', sessionId: 's1', guestName: ' Ada ', now: 0 });
    expect(post).toMatchObject({ image_url: 'blob:x', guest_name: 'Ada', approved: true, hidden: false, media_type: 'image' });
    expect(isDeleteToken(deleteToken)).toBe(true);
    expect(listPrivatePosts('demo').map((p) => p.id)).toEqual([post.id]);
    expect(removePrivatePost('demo', post.id)).toBe(true);
    expect(removePrivatePost('demo', post.id)).toBe(false);
    off();
    addPrivatePost('demo', { url: 'blob:y', sessionId: 's1' });
    expect(seen).toEqual([`+${post.id}`, `-${post.id}`]);
  });

  it('keeps events apart and lists newest first', () => {
    const a = addPrivatePost('demo', { url: 'blob:a', sessionId: 's' }).post;
    const b = addPrivatePost('demo', { url: 'blob:b', sessionId: 's' }).post;
    addPrivatePost('other', { url: 'blob:c', sessionId: 's' });
    expect(listPrivatePosts('demo').map((p) => p.id)).toEqual([b.id, a.id]);
  });

  it('holds the gallery in memory only', () => {
    setPrivateGallery('demo', [{ id: '1', image_url: 'blob:a', createdAt: 0 }]);
    expect(privateGallery('demo')).toHaveLength(1);
    resetPrivateTry();
    expect(privateGallery('demo')).toEqual([]);
  });
});
