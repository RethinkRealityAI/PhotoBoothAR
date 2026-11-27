import { describe, it, expect } from 'vitest';
import { PromiseLru } from './boardCache';

describe('PromiseLru', () => {
  it('runs make once per key and shares the promise', async () => {
    const c = new PromiseLru<number>(4);
    let runs = 0;
    const make = () => { runs++; return Promise.resolve(7); };
    const a = c.get('a', make);
    const b = c.get('a', make);
    expect(a).toBe(b);
    expect(await a).toBe(7);
    expect(runs).toBe(1);
  });

  it('drops a failed run so the next ask retries', async () => {
    const c = new PromiseLru<number>(4);
    await expect(c.get('a', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await Promise.resolve();
    expect(c.has('a')).toBe(false);
    expect(await c.get('a', () => Promise.resolve(1))).toBe(1);
  });

  it('evicts the least recently used past max', () => {
    const c = new PromiseLru<number>(2);
    c.get('a', () => Promise.resolve(1));
    c.get('b', () => Promise.resolve(2));
    c.get('a', () => Promise.resolve(9)); // touch a
    c.get('c', () => Promise.resolve(3));
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
    expect(c.size).toBe(2);
  });
});
