import { describe, expect, it, vi } from 'vitest';

// supabase.ts throws on construction without env in node tests.
vi.mock('./supabase', () => ({ supabase: {} }));

import { aiAccessFromRpc } from './aiAccess';

describe('aiAccessFromRpc — fails closed', () => {
  it('only a literal true shows AI', () => {
    expect(aiAccessFromRpc(true, null)).toBe(true);
  });
  it('false, null, strings and objects hide it', () => {
    expect(aiAccessFromRpc(false, null)).toBe(false);
    expect(aiAccessFromRpc(null, null)).toBe(false);
    expect(aiAccessFromRpc(undefined, null)).toBe(false);
    expect(aiAccessFromRpc('true', null)).toBe(false);
    expect(aiAccessFromRpc({ allowed: true }, null)).toBe(false);
  });
  it('an RPC error hides it even if data looks true', () => {
    expect(aiAccessFromRpc(true, { message: 'boom' })).toBe(false);
  });
});
