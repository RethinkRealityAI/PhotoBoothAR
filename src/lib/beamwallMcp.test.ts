/**
 * The beamwall-mcp server's pure half (supabase/functions/beamwall-mcp/core.ts):
 * the auth-token parsing, the scope + confirm latches, argument validation,
 * JSON merge patch, the SSRF guard and the undo planner. The transport
 * (index.ts) is verified live against the deployed function.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACTIONS, EVENT_CONFIG_KEYS, TOOLS, TOOL_MAP,
  configPatchRefusal, confirmRefusal, diffPaths, extractToken, guideText, initializeResult,
  isSafeSourceUrl, mergePatch, planUndo, redactArgs, safeFileName, scopeRefusal, slugFromName,
  slugRefusal, testSlug, toolListing, unchangedSince, uploadFolder, validateArgs,
} from '../../supabase/functions/beamwall-mcp/core';

const TOKEN = `bwmcp_${'a1'.repeat(24)}`;
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('extractToken', () => {
  it('reads a Bearer header', () => {
    expect(extractToken('https://x.co/functions/v1/beamwall-mcp', headers({ authorization: `Bearer ${TOKEN}` }))).toBe(TOKEN);
  });
  it('reads the last path segment (the claude.ai connector form)', () => {
    expect(extractToken(`https://x.co/functions/v1/beamwall-mcp/${TOKEN}`, headers({}))).toBe(TOKEN);
  });
  it('reads ?key= and x-beamwall-token', () => {
    expect(extractToken(`https://x.co/beamwall-mcp?key=${TOKEN}`, headers({}))).toBe(TOKEN);
    expect(extractToken('https://x.co/beamwall-mcp', headers({ 'x-beamwall-token': TOKEN }))).toBe(TOKEN);
  });
  it('ignores a Supabase JWT or junk, so nothing but a bwmcp_ key authenticates', () => {
    expect(extractToken('https://x.co/beamwall-mcp', headers({ authorization: 'Bearer eyJhbGciOi.x.y' }))).toBeNull();
    expect(extractToken('https://x.co/beamwall-mcp/beamwall-mcp', headers({}))).toBeNull();
    expect(extractToken('https://x.co/beamwall-mcp/bwmcp_short', headers({}))).toBeNull();
  });
});

describe('scopes and the confirm latch', () => {
  it('lists only the tools a key may run', () => {
    const readOnly = toolListing(TOOLS, ['read']).map((t) => t.name);
    expect(readOnly).toContain('get_event');
    expect(readOnly).not.toContain('create_event');
    const writer = toolListing(TOOLS, ['read', 'write']).map((t) => t.name);
    expect(writer).toContain('create_event');
    expect(writer).not.toContain('remove_look'); // destructive needs its own scope
    expect(writer).not.toContain('admin_action');
    expect(toolListing(TOOLS, ['read', 'write', 'destructive']).map((t) => t.name)).toContain('remove_look');
  });
  it('refuses a destructive tool without the destructive scope even when listed scope matches', () => {
    expect(scopeRefusal(TOOL_MAP.get('remove_look')!, ['read', 'write'])).toMatch(/destructive/);
    expect(scopeRefusal(TOOL_MAP.get('remove_look')!, ['read', 'write', 'destructive'])).toBeNull();
    expect(scopeRefusal(TOOL_MAP.get('admin_action')!, ['read', 'write'])).toMatch(/admin/);
  });
  it('confirm must equal the target exactly', () => {
    expect(confirmRefusal('abc', undefined)).toMatch(/confirm = "abc"/);
    expect(confirmRefusal('abc', 'yes')).not.toBeNull();
    expect(confirmRefusal('abc', true)).not.toBeNull();
    expect(confirmRefusal('abc', 'abc')).toBeNull();
  });
  it('every destructive tool takes a confirm argument', () => {
    for (const t of TOOLS.filter((d) => d.destructive)) expect(t.properties.confirm, t.name).toBeDefined();
  });
  it('marks read-only tools and destructive tools in the MCP annotations', () => {
    const all = toolListing(TOOLS, ['read', 'write', 'admin', 'destructive']);
    const byName = new Map(all.map((t) => [t.name, t.annotations as Record<string, boolean>]));
    expect(byName.get('get_event')!.readOnlyHint).toBe(true);
    expect(byName.get('remove_challenge')!.destructiveHint).toBe(true);
    expect(all).toHaveLength(TOOLS.length);
  });
});

describe('admin_action allow-list', () => {
  it('never reaches account, money or admin-membership actions', () => {
    for (const a of ['reset_password', 'set_user_banned', 'adjust_credits', 'add_admin', 'remove_admin',
      'set_org_plan', 'sync_catalog_to_stripe', 'upsert_catalog_item', 'set_signup_credits', 'create_promo']) {
      expect(a in ADMIN_ACTIONS, a).toBe(false);
    }
  });
  it('every allowed action exists in admin-api', () => {
    const src = readFileSync('supabase/functions/admin-api/index.ts', 'utf8');
    for (const a of Object.keys(ADMIN_ACTIONS)) expect(src, a).toContain(`case '${a}':`);
  });
  it('kill switches and deletions need confirm', () => {
    expect(ADMIN_ACTIONS.set_flag_kill).toBe(true);
    expect(ADMIN_ACTIONS.delete_library_category).toBe(true);
    expect(ADMIN_ACTIONS.discard_library_drafts).toBe(true);
  });
});

describe('validateArgs', () => {
  const def = TOOL_MAP.get('create_event')!;
  it('accepts a well-formed call', () => {
    expect(validateArgs(def, { name: 'Ada & Tunde', event_type: 'wedding', test: true }).ok).toBe(true);
  });
  it('refuses unknown arguments, wrong types, bad enums and missing required', () => {
    expect(validateArgs(def, { name: 'x', colour: 'red' })).toMatchObject({ ok: false, error: expect.stringMatching(/unknown argument/) });
    expect(validateArgs(def, { name: 42 })).toMatchObject({ ok: false });
    expect(validateArgs(def, { name: 'x', event_type: 'rave' })).toMatchObject({ ok: false, error: expect.stringMatching(/one of/) });
    expect(validateArgs(def, {})).toMatchObject({ ok: false, error: expect.stringMatching(/missing/) });
    expect(validateArgs(TOOL_MAP.get('list_events')!, { limit: 1.5 })).toMatchObject({ ok: false });
    expect(validateArgs(TOOL_MAP.get('list_events')!, { limit: 500 })).toMatchObject({ ok: false });
  });
  it('treats a missing arguments object as empty', () => {
    expect(validateArgs(TOOL_MAP.get('beamwall_guide')!, undefined).ok).toBe(true);
  });
});

describe('config patching', () => {
  it('merge patch merges objects, null deletes, arrays replace', () => {
    const before = { copy: { tagline: 'a', thankYou: 'b' }, accentHexes: ['#111'], look: 'beamwall' };
    const after = mergePatch(before, { copy: { tagline: 'z' }, accentHexes: ['#222', '#333'], look: null });
    expect(after).toEqual({ copy: { tagline: 'z', thankYou: 'b' }, accentHexes: ['#222', '#333'] });
    expect(before.copy.tagline).toBe('a'); // input untouched
  });
  it('diffPaths names exactly what changed', () => {
    expect(diffPaths({ a: { b: 1, c: 2 }, d: 1 }, { a: { b: 1, c: 3 }, d: 1, e: 0 })).toEqual(['a.c', 'e']);
  });
  it('refuses unknown top-level config keys and bad moderation', () => {
    expect(configPatchRefusal({ copy: {} })).toBeNull();
    expect(configPatchRefusal({ coppy: {} })).toMatch(/unknown config key/);
    expect(configPatchRefusal({ moderation: 'later' })).toMatch(/moderation/);
    expect(EVENT_CONFIG_KEYS.has('copy')).toBe(true);
  });
});

describe('slugs', () => {
  it('derives a valid slug from a name', () => {
    expect(slugFromName("Ada & Tunde's Wedding")).toBe('ada-tundes-wedding');
    expect(slugFromName('Café Noël 2026!')).toBe('cafe-noel-2026');
    expect(slugRefusal(slugFromName('!'))).toBeNull();
  });
  it('refuses reserved and malformed slugs', () => {
    expect(slugRefusal('admin')).toMatch(/reserved/);
    expect(slugRefusal('hope-gala')).toMatch(/reserved/);
    expect(slugRefusal('Bad Slug')).not.toBeNull();
    expect(slugRefusal('ok-slug')).toBeNull();
  });
  it('prefixes test events once', () => {
    expect(testSlug('demo-night')).toBe('zz-test-demo-night');
    expect(testSlug('zz-test-demo-night')).toBe('zz-test-demo-night');
    expect(testSlug('a'.repeat(63)).length).toBeLessThanOrEqual(63);
  });
});

describe('uploads', () => {
  it('keeps only the assets bucket types, with a safe name', () => {
    expect(safeFileName('Gold Frame (v2).PNG')).toEqual({ base: 'gold-frame-v2', ext: 'png', contentType: 'image/png' });
    expect(safeFileName('crown.glb')?.contentType).toBe('model/gltf-binary');
    expect(safeFileName('evil.html')).toBeNull();
    expect(safeFileName('noext')).toBeNull();
  });
  it('folders are an event slug or the library staging area', () => {
    expect(uploadFolder('library')).toBe('_platform/library/_mcp');
    expect(uploadFolder('my-wedding')).toBe('my-wedding/mcp');
    expect(uploadFolder('../etc')).toBeNull();
    expect(uploadFolder('admin')).toBeNull();
  });
  it('SSRF guard: public https only', () => {
    expect(isSafeSourceUrl('https://cdn.example.com/a.png')).toBe(true);
    for (const bad of ['http://cdn.example.com/a.png', 'https://localhost/a', 'https://127.0.0.1/a',
      'https://10.0.0.5/a', 'https://169.254.169.254/latest', 'https://192.168.1.1/a', 'https://[::1]/a',
      'https://user:pw@example.com/a', 'https://example.com:8443/a', 'https://metadata.internal/a', 'notaurl']) {
      expect(isSafeSourceUrl(bad), bad).toBe(false);
    }
  });
  it('never writes base64 payloads into the audit log', () => {
    expect(redactArgs({ base64: 'x'.repeat(500), file_name: 'a.png' })).toEqual({ base64: '<500 base64 chars>', file_name: 'a.png' });
  });
});

describe('undo planning', () => {
  const ok = { status: 'ok', reverted_by: null };
  it('undoes an insert by deleting, a delete by re-inserting, an update by restoring', () => {
    expect(planUndo({ ...ok, target_table: 'experiences', before: null, after: { id: 'L1', name: 'x' } }))
      .toEqual({ op: 'delete', table: 'experiences', key: { id: 'L1' } });
    expect(planUndo({ ...ok, target_table: 'challenges', before: { id: 'C1', title: 't' }, after: null }))
      .toEqual({ op: 'insert', table: 'challenges', row: { id: 'C1', title: 't' } });
    expect(planUndo({ ...ok, target_table: 'events', before: { id: 'E1', name: 'a' }, after: { id: 'E1', name: 'b' } }))
      .toEqual({ op: 'update', table: 'events', key: { id: 'E1' }, row: { id: 'E1', name: 'a' } });
  });
  it('uses the composite key for catalog links', () => {
    expect(planUndo({ ...ok, target_table: 'event_catalog_links', before: null, after: { event_id: 's', experience_id: 'x', added_at: 't' } }))
      .toEqual({ op: 'delete', table: 'event_catalog_links', key: { event_id: 's', experience_id: 'x' } });
  });
  it('refuses failed, already-undone, untracked or truncated changes', () => {
    expect(planUndo({ status: 'error', reverted_by: null, target_table: 'events', before: {}, after: {} }).op).toBe('refuse');
    expect(planUndo({ ...ok, reverted_by: 7, target_table: 'events', before: { id: 1 }, after: { id: 1 } }).op).toBe('refuse');
    expect(planUndo({ ...ok, target_table: 'storage.assets', before: null, after: null }).op).toBe('refuse');
    expect(planUndo({ ...ok, target_table: 'experiences', before: { _truncated: true }, after: { id: 'L' } }).op).toBe('refuse');
  });
  it('detects a row that changed again since', () => {
    expect(unchangedSince({ id: 'E', name: 'b', updated_at: 1 }, { id: 'E', name: 'b', updated_at: 2 })).toBe(true);
    expect(unchangedSince({ id: 'E', name: 'b' }, { id: 'E', name: 'c' })).toBe(false);
    expect(unchangedSince({ id: 'E' }, null)).toBe(false);
  });
});

describe('protocol', () => {
  it('echoes a supported protocol version and falls back to the newest', () => {
    expect(initializeResult('2025-06-18').protocolVersion).toBe('2025-06-18');
    expect(initializeResult('1999-01-01').protocolVersion).toBe('2025-11-25');
  });
  it('the guide documents every admin action and config key it allows', () => {
    const g = guideText();
    for (const a of Object.keys(ADMIN_ACTIONS)) expect(g).toContain(a);
    for (const k of EVENT_CONFIG_KEYS) expect(g).toContain(k);
  });
  it('tool names are unique snake_case and described', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(t.description.length).toBeGreaterThan(20);
      for (const r of t.required ?? []) expect(t.properties[r], `${t.name}.${r}`).toBeDefined();
    }
  });
});
