import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn — Tailwind-aware class merge', () => {
  it('lets a later conflicting utility win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });
  it('accepts clsx object and array forms', () => {
    expect(cn({ on: true, off: false }, ['x', 'y'])).toBe('on x y');
  });
});
