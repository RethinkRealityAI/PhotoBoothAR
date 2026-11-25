/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/connector — the pure half: the connector URL a key becomes, the
 * access presets offered when minting one, and how a key's scopes read.
 * The server (supabase/functions/beamwall-mcp) is the authority on what a
 * scope allows; this only labels it. PURE: no React, no supabase.
 */

export type McpScope = 'read' | 'write' | 'admin' | 'destructive';

export interface AccessPreset {
  id: 'look' | 'edit' | 'full';
  label: string;
  detail: string;
  scopes: McpScope[];
}

export const ACCESS_PRESETS: AccessPreset[] = [
  {
    id: 'look',
    label: 'Look only',
    detail: 'Claude can read events, looks and the library. It cannot change anything.',
    scopes: ['read'],
  },
  {
    id: 'edit',
    label: 'Make changes',
    detail: 'Create events, upload assets, add looks and challenges, edit copy and themes. No deleting.',
    scopes: ['read', 'write'],
  },
  {
    id: 'full',
    label: 'Full admin',
    detail: 'Everything above, plus admin-suite actions (library publishing, feature flags) and deleting or undoing, each behind an explicit confirm.',
    scopes: ['read', 'write', 'admin', 'destructive'],
  },
];

export const DEFAULT_PRESET: AccessPreset['id'] = 'edit';

export const EXPIRY_OPTIONS: { days: number; label: string }[] = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

/** The URL pasted into claude.ai → Settings → Connectors → Add custom connector. */
export function connectorUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/beamwall-mcp/${token}`;
}

/** The URL without a key (for Claude Code / desktop configs that send a header). */
export function connectorBaseUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/beamwall-mcp`;
}

/** The preset a key's scopes match, else null (a custom set). */
export function presetFor(scopes: readonly string[]): AccessPreset | null {
  const key = [...scopes].sort().join(',');
  return ACCESS_PRESETS.find((p) => [...p.scopes].sort().join(',') === key) ?? null;
}

export function scopeSummary(scopes: readonly string[]): string {
  return presetFor(scopes)?.label ?? scopes.join(' · ');
}

export type KeyState = 'active' | 'revoked' | 'expired';

export function keyState(k: { revokedAt: string | null; expiresAt: string | null }, now = Date.now()): KeyState {
  if (k.revokedAt !== null) return 'revoked';
  if (k.expiresAt !== null && Date.parse(k.expiresAt) <= now) return 'expired';
  return 'active';
}

/** A change-log tool name in plain words ("add_look" → "Add look"). */
export function toolLabel(tool: string): string {
  const s = tool.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
