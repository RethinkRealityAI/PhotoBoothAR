import { describe, expect, it } from 'vitest';
import { ALL_SCOPES } from '../../supabase/functions/beamwall-mcp/core';
import {
  ACCESS_PRESETS, DEFAULT_PRESET, connectorBaseUrl, connectorUrl, keyState, presetFor, scopeSummary, toolLabel,
} from './mcpConnector';

describe('mcpConnector', () => {
  it('builds the connector URL with the key as the last path segment', () => {
    expect(connectorUrl('https://ref.supabase.co/', 'bwmcp_abc')).toBe('https://ref.supabase.co/functions/v1/beamwall-mcp/bwmcp_abc');
    expect(connectorBaseUrl('https://ref.supabase.co')).toBe('https://ref.supabase.co/functions/v1/beamwall-mcp');
  });

  it('presets only use scopes the server knows, and the default exists', () => {
    for (const p of ACCESS_PRESETS) for (const s of p.scopes) expect(ALL_SCOPES).toContain(s);
    expect(ACCESS_PRESETS.some((p) => p.id === DEFAULT_PRESET)).toBe(true);
    // The default never includes deleting.
    expect(ACCESS_PRESETS.find((p) => p.id === DEFAULT_PRESET)!.scopes).not.toContain('destructive');
  });

  it('names a key by its preset regardless of scope order', () => {
    expect(presetFor(['write', 'read'])?.id).toBe('edit');
    expect(scopeSummary(['read'])).toBe('Look only');
    expect(scopeSummary(['read', 'admin'])).toBe('read · admin');
  });

  it('tells active, revoked and expired keys apart', () => {
    const now = Date.parse('2026-11-25T00:00:00Z');
    expect(keyState({ revokedAt: null, expiresAt: null }, now)).toBe('active');
    expect(keyState({ revokedAt: '2026-11-01T00:00:00Z', expiresAt: null }, now)).toBe('revoked');
    expect(keyState({ revokedAt: null, expiresAt: '2026-11-24T00:00:00Z' }, now)).toBe('expired');
    expect(keyState({ revokedAt: null, expiresAt: '2026-12-24T00:00:00Z' }, now)).toBe('active');
  });

  it('labels tools in plain words', () => {
    expect(toolLabel('attach_library_look')).toBe('Attach library look');
  });
});
