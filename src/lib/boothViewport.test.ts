import { afterEach, describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  LOCK_ATTR,
  _lockDepth,
  isDoubleTapZoom,
  isPlatformBooth,
  lockViewport,
  shouldBlockTouchMove,
  type LockDocument,
  type LockElement,
  type LockWindow,
} from './boothViewport';

function fakeEl(initial: Record<string, string> = {}): LockElement & { props: Map<string, string>; attrs: Set<string> } {
  const props = new Map(Object.entries(initial));
  const attrs = new Set<string>();
  return {
    props,
    attrs,
    style: {
      getPropertyValue: (n) => props.get(n) ?? '',
      getPropertyPriority: () => '',
      setProperty: (n, v) => { props.set(n, v); },
      removeProperty: (n) => { const v = props.get(n) ?? ''; props.delete(n); return v; },
    },
    setAttribute: (n) => { attrs.add(n); },
    removeAttribute: (n) => { attrs.delete(n); },
  };
}

type Handler = (e: unknown) => void;
function fakeDoc() {
  const html = fakeEl({ overflow: 'auto' });
  const body = fakeEl();
  const listeners = new Map<string, Set<Handler>>();
  const doc: LockDocument = {
    documentElement: html,
    body,
    addEventListener: (t, fn) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn as Handler);
    },
    removeEventListener: (t, fn) => { listeners.get(t)?.delete(fn as Handler); },
  };
  const fire = (t: string, e: unknown) => { for (const fn of listeners.get(t) ?? []) fn(e); };
  const count = (t: string) => listeners.get(t)?.size ?? 0;
  return { doc, html, body, fire, count };
}

function fakeWin() {
  const scrolls: [number, number][] = [];
  const timers = new Map<number, () => void>();
  let id = 0;
  const win: LockWindow = {
    scrollTo: (x, y) => { scrolls.push([x, y]); },
    setTimeout: (fn) => { id += 1; timers.set(id, fn); return id; },
    clearTimeout: (i) => { timers.delete(i); },
  };
  const flush = () => { for (const [k, fn] of [...timers]) { timers.delete(k); fn(); } };
  return { win, scrolls, flush };
}

function touchEvent(over: Partial<{ touches: number; x: number; y: number; t: number; target: unknown }>) {
  const e = {
    touches: { length: over.touches ?? 0 },
    changedTouches: { length: 1, 0: { clientX: over.x ?? 100, clientY: over.y ?? 100 } },
    timeStamp: over.t ?? 0,
    target: over.target ?? null,
    cancelable: true,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  return e;
}

afterEach(() => {
  // Every test releases what it took; a leak here would poison the next.
  expect(_lockDepth()).toEqual({ depth: 0, zoomDepth: 0 });
});

describe('pure gesture rules', () => {
  it('blocks only multi-finger moves (a pinch), never a one-finger scroll', () => {
    expect(shouldBlockTouchMove(0)).toBe(false);
    expect(shouldBlockTouchMove(1)).toBe(false);
    expect(shouldBlockTouchMove(2)).toBe(true);
  });

  it('a quick second tap in the same spot on plain surface is a zoom double-tap', () => {
    expect(isDoubleTapZoom({ t: 0, x: 10, y: 10 }, { t: 200, x: 14, y: 12 }, false)).toBe(true);
  });

  it('never cancels a tap on a control, a slow tap, a far tap, or the first tap', () => {
    expect(isDoubleTapZoom({ t: 0, x: 10, y: 10 }, { t: 200, x: 10, y: 10 }, true)).toBe(false);
    expect(isDoubleTapZoom({ t: 0, x: 10, y: 10 }, { t: DOUBLE_TAP_MS + 1, x: 10, y: 10 }, false)).toBe(false);
    expect(isDoubleTapZoom({ t: 0, x: 10, y: 10 }, { t: 100, x: 80, y: 10 }, false)).toBe(false);
    expect(isDoubleTapZoom(null, { t: 100, x: 10, y: 10 }, false)).toBe(false);
    expect(isDoubleTapZoom({ t: 500, x: 10, y: 10 }, { t: 100, x: 10, y: 10 }, false)).toBe(false);
  });
});

describe('isPlatformBooth', () => {
  it('is a DB event in a platform build only', () => {
    expect(isPlatformBooth('db', '')).toBe(true);
    expect(isPlatformBooth('db', '  ')).toBe(true);
    expect(isPlatformBooth('code', '')).toBe(false);
    expect(isPlatformBooth(undefined, '')).toBe(false);
    // A VITE_EVENT legacy build is frozen whatever the event's source.
    expect(isPlatformBooth('db', 'hope-gala')).toBe(false);
  });
});

describe('lockViewport', () => {
  it('pins html/body, marks html and scrolls to the top, then restores exactly', () => {
    const { doc, html, body } = fakeDoc();
    const { win, scrolls } = fakeWin();
    const release = lockViewport(doc, win, { zoom: false });
    expect(html.props.get('overflow')).toBe('hidden');
    expect(html.props.get('overscroll-behavior')).toBe('none');
    expect(body.props.get('position')).toBe('fixed');
    expect(body.props.get('overflow')).toBe('hidden');
    expect(html.attrs.has(LOCK_ATTR)).toBe(true);
    expect(scrolls).toEqual([[0, 0]]);
    release();
    // The pre-existing inline value comes back; the ones we added are gone.
    expect(html.props.get('overflow')).toBe('auto');
    expect(html.props.has('overscroll-behavior')).toBe(false);
    expect(body.props.size).toBe(0);
    expect(html.attrs.has(LOCK_ATTR)).toBe(false);
  });

  it('nests: styles stay until the LAST release, and a double release is a no-op', () => {
    const { doc, body } = fakeDoc();
    const { win } = fakeWin();
    const a = lockViewport(doc, win, { zoom: true });
    const b = lockViewport(doc, win, { zoom: false });
    a();
    a();
    expect(body.props.get('position')).toBe('fixed');
    expect(_lockDepth()).toEqual({ depth: 1, zoomDepth: 0 });
    b();
    expect(body.props.size).toBe(0);
  });

  it('zoom lock cancels pinch + iOS gesture events and the zoom double-tap only', () => {
    const { doc, fire, count } = fakeDoc();
    const { win } = fakeWin();
    const release = lockViewport(doc, win, { zoom: true });

    const pinch = touchEvent({ touches: 2 });
    fire('touchmove', pinch);
    expect(pinch.prevented).toBe(true);
    const scroll = touchEvent({ touches: 1 });
    fire('touchmove', scroll);
    expect(scroll.prevented).toBe(false);

    const g = touchEvent({});
    fire('gesturestart', g);
    expect(g.prevented).toBe(true);

    const plain = { closest: () => null };
    const first = touchEvent({ t: 0, target: plain });
    const second = touchEvent({ t: 150, target: plain });
    fire('touchend', first);
    fire('touchend', second);
    expect(first.prevented).toBe(false);
    expect(second.prevented).toBe(true);

    const button = { closest: () => ({}) };
    const b1 = touchEvent({ t: 1000, target: button });
    const b2 = touchEvent({ t: 1100, target: button });
    fire('touchend', b1);
    fire('touchend', b2);
    expect(b2.prevented).toBe(false);

    release();
    expect(count('touchmove') + count('touchend') + count('gesturestart')).toBe(0);
  });

  it('scroll-only lock leaves pinch alone (the zoomable welcome page)', () => {
    const { doc, fire, count } = fakeDoc();
    const { win } = fakeWin();
    const release = lockViewport(doc, win, { zoom: false });
    expect(count('touchmove')).toBe(0);
    const pinch = touchEvent({ touches: 2 });
    fire('touchmove', pinch);
    expect(pinch.prevented).toBe(false);
    release();
  });

  it('puts the page back at the top after a field loses focus (iOS keyboard drift)', () => {
    const { doc, fire, count } = fakeDoc();
    const { win, scrolls, flush } = fakeWin();
    const release = lockViewport(doc, win, { zoom: false });
    fire('focusout', {});
    flush();
    expect(scrolls).toEqual([[0, 0], [0, 0]]);
    release();
    expect(count('focusout')).toBe(0);
  });
});
