/**
 * beamwall-mcp — the PURE half (no Deno, no supabase, no fetch).
 *
 * Everything here is deterministic so it can be unit-tested from vitest
 * (src/lib/beamwallMcp.test.ts imports this file directly, the same idiom as
 * ai-event-designer/prompt.ts ↔ src/lib/agentPrompt.test.ts). index.ts is the
 * transport: auth, database, storage, audit.
 *
 * WHY THIS EXISTS: routine platform changes (create a test event, upload a
 * frame, attach a library prop, tweak an event's copy or theme) used to need a
 * code change + deploy, or a one-off SQL session. This server exposes those
 * content operations as MCP tools so Claude can make them directly — every
 * call authenticated by a hashed token, scoped, audited with a before/after
 * snapshot, and destructive calls refused without an explicit `confirm`.
 */

export const SERVER_NAME = 'beamwall';
export const SERVER_VERSION = '1.0.0';
/** Newest first. We answer with the client's version when we know it. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export type Scope = 'read' | 'write' | 'admin' | 'destructive';
export const ALL_SCOPES: Scope[] = ['read', 'write', 'admin', 'destructive'];

// ── Shared validation rules (mirror create-event / DB constraints) ──────────

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same set as create-event's RESERVED_SLUGS — keep in sync with src/lib/slug.ts. */
export const RESERVED_SLUGS = new Set([
  'admin', 'host', 'login', 'signup', 'api', 'e', 'c', 'm', 'app', 'www',
  'assets', 'posts', 'wall', 'booth', 'upload', 'me', 'gallery', 'join',
  'experience', 'beamwall', 'legal', 'pricing', 'help', 'about',
  'hope-gala', 'jenna-jake', 'detola-wuyi', 'demo',
]);

export const EVENT_TYPES = ['wedding', 'gala', 'birthday', 'corporate', 'party', 'remote'];
export const EVENT_STATUSES = ['draft', 'live', 'ended', 'archived'];
export const PLAN_TIERS = ['free', 'essentials', 'premium', 'deluxe'];
/** experiences_kind_check. User-facing names in parentheses. */
export const LOOK_KINDS = ['border', '2d_filter', 'shader', '3d_attachment', 'composite'];

/** Top-level events.config keys a tool may write. Anything else is refused,
 *  so a typo cannot silently create a key the app never reads. */
export const EVENT_CONFIG_KEYS = new Set([
  'copy', 'landingRoute', 'arContent', 'accentHexes', 'defaultExperienceId',
  'background_template', 'look', 'scene', 'powerUps', 'themeVars', 'moderation',
  'brief', 'theme', 'default_card_template', 'fontHref', 'chrome', 'boothScreen',
  'wizard',
]);

/** Columns of each table a tool may set directly. */
export const EVENT_COLUMNS = new Set(['name', 'event_type', 'starts_at', 'ends_at']);
export const LOOK_COLUMNS = new Set(['name', 'asset_url', 'thumbnail_url', 'is_published', 'featured', 'sort_order']);
export const CHALLENGE_COLUMNS = new Set(['title', 'description', 'emoji', 'points', 'sort_order', 'active', 'validation']);

/** Tables undo_change may touch, with their primary key columns. */
export const UNDO_TABLES: Record<string, string[]> = {
  events: ['id'],
  experiences: ['id'],
  challenges: ['id'],
  event_catalog_links: ['event_id', 'experience_id'],
};

export const PLATFORM_ORIGIN = 'https://beamwall.app';

export function eventLinks(slug: string, eventId?: string): Record<string, string> {
  const base = `${PLATFORM_ORIGIN}/e/${slug}`;
  const links: Record<string, string> = {
    booth: `${base}/booth`,
    welcome: `${base}/welcome`,
    wall: `${base}/wall`,
    recap: `${PLATFORM_ORIGIN}/r/${slug}`,
  };
  if (eventId) links.hostDashboard = `${PLATFORM_ORIGIN}/host/events/${eventId}`;
  return links;
}

// ── Uploads ─────────────────────────────────────────────────────────────────

/** The `assets` bucket's own allow-list (storage.buckets), by extension. */
export const UPLOAD_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // the bucket's file_size_limit
export const MAX_BASE64_BYTES = 8 * 1024 * 1024;  // a tool argument, not a file transfer

/** Lowercase, safe storage file name keeping the extension. null = refused. */
export function safeFileName(name: string): { base: string; ext: string; contentType: string } | null {
  const trimmed = name.trim().toLowerCase();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = trimmed.slice(dot + 1);
  const contentType = UPLOAD_TYPES[ext];
  if (!contentType) return null;
  const base = trimmed.slice(0, dot).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset';
  return { base, ext, contentType };
}

/** Storage folder for an upload: an event's own folder, or the platform
 *  library staging area (`_platform` can never be an event slug). */
export function uploadFolder(target: string): string | null {
  if (target === 'library') return '_platform/library/_mcp';
  if (SLUG_RE.test(target) && !RESERVED_SLUGS.has(target)) return `${target}/mcp`;
  return null;
}

/**
 * SSRF guard for `source_url`: https only, a public-looking hostname, no
 * credentials, no explicit port. Literal private/loopback/link-local IPs and
 * internal names are refused. (The edge runtime has no route to a private
 * network anyway; this keeps the function from being pointed at its own
 * metadata endpoints or the project's internal hosts.)
 */
export function isSafeSourceUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.')) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (h.includes(':')) return false; // literal IPv6 — refuse rather than classify
  return true;
}

// ── JSON helpers ────────────────────────────────────────────────────────────

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** RFC 7386 JSON Merge Patch: objects merge, `null` deletes, anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/** Dotted paths whose value differs between a and b (for dry-run previews). */
export function diffPaths(a: unknown, b: unknown, prefix = '', out: string[] = [], max = 200): string[] {
  if (out.length >= max) return out;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k, out, max);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(prefix || '(root)');
  return out;
}

/** Truncate a JSON value for the audit log (keeps the row bounded). */
export function boundedJson(v: unknown, maxChars = 32_000): unknown {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  if (s === undefined) return null;
  if (s.length <= maxChars) return v;
  return { _truncated: true, chars: s.length, head: s.slice(0, 2000) };
}

/** Args as stored in the audit log: base64 payloads are replaced by their size. */
export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'base64' && typeof v === 'string') out[k] = `<${v.length} base64 chars>`;
    else out[k] = v;
  }
  return out;
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export const TOKEN_PREFIX = 'bwmcp_';
const TOKEN_RE = /^bwmcp_[A-Za-z0-9_-]{32,128}$/;

/**
 * Where the caller put its token, in order: `Authorization: Bearer`, the
 * `x-beamwall-token` header, the last path segment (`/beamwall-mcp/<token>`,
 * the only form a claude.ai custom connector can carry), or `?key=`.
 */
export function extractToken(url: string, headers: { get(name: string): string | null }): string | null {
  const auth = headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m && TOKEN_RE.test(m[1])) return m[1];
  }
  const h = headers.get('x-beamwall-token');
  if (h && TOKEN_RE.test(h.trim())) return h.trim();
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    if (TOKEN_RE.test(last)) return last;
    const q = u.searchParams.get('key');
    if (q && TOKEN_RE.test(q)) return q;
  } catch {
    // fall through
  }
  return null;
}

// ── Argument validation (a small JSON-Schema subset) ────────────────────────

export interface PropSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: { type: 'string' | 'object' };
  maxItems?: number;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  /** Needs the `destructive` scope AND `confirm` equal to the target. */
  destructive?: boolean;
  /** Changes nothing — MCP annotations readOnlyHint. */
  readOnly?: boolean;
  properties: Record<string, PropSchema>;
  required?: string[];
}

export function validateArgs(def: ToolDef, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (args === undefined || args === null) args = {};
  if (!isPlainObject(args)) return { ok: false, error: 'arguments must be an object' };
  for (const k of Object.keys(args)) {
    if (!(k in def.properties)) return { ok: false, error: `unknown argument "${k}"` };
  }
  for (const r of def.required ?? []) {
    if (args[r] === undefined || args[r] === null || args[r] === '') return { ok: false, error: `missing required argument "${r}"` };
  }
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    const s = def.properties[k];
    const bad = (why: string) => ({ ok: false as const, error: `"${k}" ${why}` });
    switch (s.type) {
      case 'string':
        if (typeof v !== 'string') return bad('must be a string');
        if (s.maxLength !== undefined && v.length > s.maxLength) return bad(`is longer than ${s.maxLength} characters`);
        if (s.enum && !s.enum.includes(v)) return bad(`must be one of: ${s.enum.join(', ')}`);
        break;
      case 'number':
      case 'integer':
        if (typeof v !== 'number' || !Number.isFinite(v)) return bad('must be a number');
        if (s.type === 'integer' && !Number.isInteger(v)) return bad('must be a whole number');
        if (s.minimum !== undefined && v < s.minimum) return bad(`must be at least ${s.minimum}`);
        if (s.maximum !== undefined && v > s.maximum) return bad(`must be at most ${s.maximum}`);
        break;
      case 'boolean':
        if (typeof v !== 'boolean') return bad('must be true or false');
        break;
      case 'object':
        if (!isPlainObject(v)) return bad('must be an object');
        break;
      case 'array':
        if (!Array.isArray(v)) return bad('must be an array');
        if (s.maxItems !== undefined && v.length > s.maxItems) return bad(`has more than ${s.maxItems} items`);
        if (s.items?.type === 'string' && v.some((x) => typeof x !== 'string')) return bad('must contain only strings');
        break;
    }
  }
  return { ok: true, args };
}

/** JSON Schema for tools/list. */
export function inputSchema(def: ToolDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(def.properties)) {
    const p: Record<string, unknown> = { type: s.type, description: s.description };
    if (s.enum) p.enum = s.enum;
    if (s.maxLength !== undefined) p.maxLength = s.maxLength;
    if (s.minimum !== undefined) p.minimum = s.minimum;
    if (s.maximum !== undefined) p.maximum = s.maximum;
    if (s.items) p.items = s.items;
    if (s.maxItems !== undefined) p.maxItems = s.maxItems;
    properties[k] = p;
  }
  return { type: 'object', properties, required: def.required ?? [], additionalProperties: false };
}

export function toolListing(defs: ToolDef[], scopes: Scope[]): Record<string, unknown>[] {
  return defs
    .filter((d) => scopes.includes(d.scope) && (!d.destructive || scopes.includes('destructive')))
    .map((d) => ({
      name: d.name,
      title: d.title,
      description: d.description,
      inputSchema: inputSchema(d),
      annotations: {
        title: d.title,
        readOnlyHint: d.readOnly === true,
        destructiveHint: d.destructive === true,
        idempotentHint: d.readOnly === true,
        openWorldHint: false,
      },
    }));
}

/** May this token run this tool? Returns the refusal reason, or null. */
export function scopeRefusal(def: ToolDef, scopes: Scope[]): string | null {
  if (!scopes.includes(def.scope)) return `this token lacks the "${def.scope}" scope`;
  if (def.destructive && !scopes.includes('destructive')) return 'this token lacks the "destructive" scope';
  return null;
}

// ── Common argument fragments ───────────────────────────────────────────────

const slugArg: PropSchema = { type: 'string', maxLength: 63, description: 'Event slug (the part after /e/ in the guest link).' };
const dryRunArg: PropSchema = { type: 'boolean', description: 'true = validate and show what would change, write nothing.' };
const confirmArg = (what: string): PropSchema => ({
  type: 'string', maxLength: 128,
  description: `Safety latch: must equal ${what}. Without it the tool explains what it would do and changes nothing.`,
});

// ── The tool registry ───────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  // READ
  {
    name: 'beamwall_guide', title: 'How Beamwall content works', scope: 'read', readOnly: true,
    description: 'Read this first. Explains Beamwall\'s data model (events, looks, library, challenges, config keys), the safe workflow (dry_run → write → preview link → undo_change), and worked examples. No arguments.',
    properties: {},
  },
  {
    name: 'list_events', title: 'List events', scope: 'read', readOnly: true,
    description: 'Find events by name/slug search and status. Newest first.',
    properties: {
      search: { type: 'string', maxLength: 80, description: 'Matches name or slug (case-insensitive).' },
      status: { type: 'string', enum: EVENT_STATUSES, description: 'Only this status.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
    },
  },
  {
    name: 'get_event', title: 'Get an event', scope: 'read', readOnly: true,
    description: 'Everything about one event: row + config, its own looks, linked library looks, challenges, resolved feature flags and the guest/wall/host links.',
    properties: { slug: slugArg },
    required: ['slug'],
  },
  {
    name: 'list_library', title: 'Search the shared library', scope: 'read', readOnly: true,
    description: 'Published shared-library looks any event can attach (3D props, composites/filters). Returns id, name, kind, thumbnail, keywords.',
    properties: {
      search: { type: 'string', maxLength: 80, description: 'Matches name or keyword.' },
      kind: { type: 'string', enum: LOOK_KINDS, description: 'Only this kind.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 50.' },
    },
  },
  {
    name: 'get_look', title: 'Get a look', scope: 'read', readOnly: true,
    description: 'One look (experiences row) in full, including its config — use it as a template before add_look.',
    properties: { id: { type: 'string', maxLength: 36, description: 'Look id (uuid).' } },
    required: ['id'],
  },
  {
    name: 'list_changes', title: 'Change history', scope: 'read', readOnly: true,
    description: 'The audit log of changes made through this server (who/what/when, with change ids for undo_change).',
    properties: {
      slug: { type: 'string', maxLength: 63, description: 'Only changes to this event.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
    },
  },

  // WRITE
  {
    name: 'create_event', title: 'Create an event', scope: 'write',
    description: 'Create a DRAFT event. Defaults to the token owner\'s org and the deluxe tier (no paywalls while setting up). Set test=true for throwaway test events — they get a "zz-test-" slug prefix so they are easy to find and clean up.',
    properties: {
      name: { type: 'string', maxLength: 80, description: 'Event name shown to guests.' },
      slug: { type: 'string', maxLength: 63, description: 'Optional. Lowercase letters, digits, dashes. Derived from the name when omitted.' },
      event_type: { type: 'string', enum: EVENT_TYPES, description: 'Default wedding.' },
      starts_at: { type: 'string', maxLength: 40, description: 'ISO date/time.' },
      org_id: { type: 'string', maxLength: 36, description: 'Owning org (uuid). Default: the token owner\'s org.' },
      plan_tier: { type: 'string', enum: PLAN_TIERS, description: 'Default deluxe.' },
      test: { type: 'boolean', description: 'Mark as a test event (zz-test- slug prefix, config.test = true).' },
      dry_run: dryRunArg,
    },
    required: ['name'],
  },
  {
    name: 'update_event', title: 'Update an event', scope: 'write',
    description: 'Change an event\'s name/type/dates and/or apply a JSON Merge Patch to its config (objects merge, null deletes a key). Only known top-level config keys are accepted (see beamwall_guide). Returns the changed paths.',
    properties: {
      slug: slugArg,
      name: { type: 'string', maxLength: 80, description: 'New name.' },
      event_type: { type: 'string', enum: EVENT_TYPES, description: 'New type.' },
      starts_at: { type: 'string', maxLength: 40, description: 'ISO date/time, or "" to clear.' },
      ends_at: { type: 'string', maxLength: 40, description: 'ISO date/time, or "" to clear.' },
      config_patch: { type: 'object', description: 'JSON Merge Patch applied to events.config, e.g. {"copy":{"tagline":"…"}}.' },
      dry_run: dryRunArg,
    },
    required: ['slug'],
  },
  {
    name: 'set_event_status', title: 'Set event status', scope: 'write',
    description: 'draft → live opens the booth to guests. Moving a LIVE event to ended/archived closes it for guests, so that direction needs confirm = the slug.',
    properties: {
      slug: slugArg,
      status: { type: 'string', enum: EVENT_STATUSES, description: 'New status.' },
      confirm: confirmArg('the slug (only when leaving live)'),
    },
    required: ['slug', 'status'],
  },
  {
    name: 'upload_asset', title: 'Upload an asset', scope: 'write',
    description: 'Store a PNG/JPG/WebP/SVG image or a GLB/GLTF model in the public assets bucket and get its URL. Give either source_url (https, ≤50 MB) or base64 (≤8 MB). folder = an event slug, or "library" for shared-library staging.',
    properties: {
      file_name: { type: 'string', maxLength: 100, description: 'Name with extension, e.g. gold-frame.png. The extension decides the type.' },
      folder: { type: 'string', maxLength: 63, description: 'An event slug, or "library".' },
      source_url: { type: 'string', maxLength: 2000, description: 'Public https URL to copy from.' },
      base64: { type: 'string', description: 'File bytes, base64 (no data: prefix).' },
    },
    required: ['file_name', 'folder'],
  },
  {
    name: 'add_look', title: 'Add a look to an event', scope: 'write',
    description: 'Create a look that belongs to one event. kind: border (2D frame PNG over the photo), 2d_filter (2D overlay), shader (whole-screen effect), 3d_attachment (worn 3D prop GLB), composite (a full studio scene). Copy config from get_look on a similar look; a border needs only {"opacity":1,"transform":{"x":0,"y":0,"scale":1,"rotation":0}} (the default when config is omitted for border/2d_filter).',
    properties: {
      slug: slugArg,
      name: { type: 'string', maxLength: 80, description: 'Name guests see in the picker.' },
      kind: { type: 'string', enum: LOOK_KINDS, description: 'Look kind.' },
      asset_url: { type: 'string', maxLength: 2000, description: 'Image/model URL (from upload_asset).' },
      thumbnail_url: { type: 'string', maxLength: 2000, description: 'Optional thumbnail URL.' },
      config: { type: 'object', description: 'Look config (see description).' },
      is_published: { type: 'boolean', description: 'Visible to guests. Default true.' },
      sort_order: { type: 'integer', minimum: 0, maximum: 100000, description: 'Lower first. Default after existing looks.' },
      dry_run: dryRunArg,
    },
    required: ['slug', 'name', 'kind'],
  },
  {
    name: 'update_look', title: 'Update a look', scope: 'write',
    description: 'Rename, re-point, publish/unpublish, reorder or merge-patch the config of an EVENT look. Shared-library looks are changed through admin_action instead.',
    properties: {
      id: { type: 'string', maxLength: 36, description: 'Look id.' },
      name: { type: 'string', maxLength: 80, description: 'New name.' },
      asset_url: { type: 'string', maxLength: 2000, description: 'New asset URL.' },
      thumbnail_url: { type: 'string', maxLength: 2000, description: 'New thumbnail URL.' },
      is_published: { type: 'boolean', description: 'Visible to guests.' },
      featured: { type: 'boolean', description: 'Featured in the picker.' },
      sort_order: { type: 'integer', minimum: 0, maximum: 100000, description: 'Lower first.' },
      config_patch: { type: 'object', description: 'JSON Merge Patch applied to the look config.' },
      dry_run: dryRunArg,
    },
    required: ['id'],
  },
  {
    name: 'remove_look', title: 'Delete an event look', scope: 'write', destructive: true,
    description: 'Permanently delete an EVENT look (never a shared-library item). Recoverable with undo_change. confirm = the look id.',
    properties: { id: { type: 'string', maxLength: 36, description: 'Look id.' }, confirm: confirmArg('the look id') },
    required: ['id'],
  },
  {
    name: 'attach_library_look', title: 'Attach a library look', scope: 'write',
    description: 'Make a shared-library look available in an event\'s booth (same as the host picking it in the wizard).',
    properties: { slug: slugArg, look_id: { type: 'string', maxLength: 36, description: 'Library look id (from list_library).' } },
    required: ['slug', 'look_id'],
  },
  {
    name: 'detach_library_look', title: 'Detach a library look', scope: 'write',
    description: 'Remove a shared-library look from one event (the library item itself is untouched).',
    properties: { slug: slugArg, look_id: { type: 'string', maxLength: 36, description: 'Library look id.' } },
    required: ['slug', 'look_id'],
  },
  {
    name: 'add_challenge', title: 'Add a challenge', scope: 'write',
    description: 'Add a photo challenge/mission to an event.',
    properties: {
      slug: slugArg,
      title: { type: 'string', maxLength: 80, description: 'Challenge title.' },
      description: { type: 'string', maxLength: 300, description: 'What guests should do.' },
      emoji: { type: 'string', maxLength: 8, description: 'One emoji.' },
      points: { type: 'integer', minimum: 0, maximum: 1000, description: 'Default 10.' },
      active: { type: 'boolean', description: 'Default true.' },
    },
    required: ['slug', 'title'],
  },
  {
    name: 'update_challenge', title: 'Update a challenge', scope: 'write',
    description: 'Edit a challenge\'s text, points, order or active flag.',
    properties: {
      id: { type: 'string', maxLength: 36, description: 'Challenge id.' },
      title: { type: 'string', maxLength: 80, description: 'Title.' },
      description: { type: 'string', maxLength: 300, description: 'Description.' },
      emoji: { type: 'string', maxLength: 8, description: 'Emoji.' },
      points: { type: 'integer', minimum: 0, maximum: 1000, description: 'Points.' },
      sort_order: { type: 'integer', minimum: 0, maximum: 100000, description: 'Order.' },
      active: { type: 'boolean', description: 'Active.' },
    },
    required: ['id'],
  },
  {
    name: 'remove_challenge', title: 'Delete a challenge', scope: 'write', destructive: true,
    description: 'Delete a challenge. Recoverable with undo_change. confirm = the challenge id.',
    properties: { id: { type: 'string', maxLength: 36, description: 'Challenge id.' }, confirm: confirmArg('the challenge id') },
    required: ['id'],
  },
  {
    name: 'undo_change', title: 'Undo a change', scope: 'write', destructive: true,
    description: 'Put a row back the way it was before an earlier change (from list_changes). Refuses if the row changed again since, unless force=true. confirm = the change id as text.',
    properties: {
      change_id: { type: 'integer', minimum: 1, description: 'Change id from list_changes.' },
      force: { type: 'boolean', description: 'Overwrite later edits too.' },
      confirm: confirmArg('the change id, e.g. "42"'),
    },
    required: ['change_id'],
  },

  // ADMIN
  {
    name: 'admin_action', title: 'Run an admin-suite action', scope: 'admin',
    description: 'Run one of the /admin suite\'s actions as the token owner (shared library publishing and metadata, categories, library drafts, feature flags and plan defaults, event tiers, customers, catalog, landing CMS, audit). The allowed actions and which need confirm are listed in beamwall_guide. args are passed through unchanged.',
    properties: {
      action: { type: 'string', maxLength: 60, description: 'admin-api action name, e.g. list_library_items.' },
      args: { type: 'object', description: 'That action\'s arguments.' },
      confirm: confirmArg('the action name (only for actions marked confirm)'),
    },
    required: ['action'],
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * admin-api actions reachable through admin_action. Anything NOT listed is
 * refused — notably password resets, bans, credit grants, admin membership,
 * Stripe sync and plan changes that touch money, which stay human-only in
 * /admin. `true` = needs confirm = the action name.
 */
export const ADMIN_ACTIONS: Record<string, boolean> = {
  overview_metrics: false,
  list_orgs: false,
  get_org: false,
  list_events: false,
  set_event_status: true,
  set_event_tier: false,
  list_audit: false,
  list_feature_flags: false,
  resolve_features: false,
  set_plan_default: true,
  set_org_override: false,
  clear_org_override: false,
  set_event_override: false,
  clear_event_override: false,
  set_flag_kill: true,
  list_catalog: false,
  get_landing_content_admin: false,
  save_landing_draft: false,
  publish_landing_content: true,
  list_library_items: false,
  publish_library_item: false,
  update_library_item_meta: false,
  set_library_item_state: true,
  set_library_item_fit: false,
  copy_library_settings: false,
  list_library_categories: false,
  save_library_category: false,
  delete_library_category: true,
  bulk_update_library_items: true,
  set_library_access: false,
  list_event_models: false,
  list_library_drafts: false,
  create_library_drafts: false,
  update_library_draft: false,
  classify_library_drafts: false,
  publish_library_drafts: false,
  discard_library_drafts: true,
  replace_library_item_model: true,
};

/** Refusal reason for a destructive call without the right latch, or null. */
export function confirmRefusal(expected: string, given: unknown): string | null {
  if (given === expected) return null;
  return `not done: this change needs confirm = "${expected}". Re-run with that argument once the user has agreed.`;
}

// ── Event helpers ───────────────────────────────────────────────────────────

/** A slug from a name: "Ada & Tunde's Wedding" → "ada-tundes-wedding". */
export function slugFromName(name: string): string {
  const s = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50).replace(/-+$/g, '');
  return s.length >= 2 ? s : `event-${s || 'new'}`;
}

export function slugRefusal(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return 'slug must be 2-63 lowercase letters, digits or dashes, starting with a letter or digit';
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved`;
  return null;
}

export function testSlug(slug: string): string {
  return slug.startsWith('zz-test-') ? slug : `zz-test-${slug}`.slice(0, 63).replace(/-+$/g, '');
}

/** Refusal for a config patch with unknown top-level keys, or null. */
export function configPatchRefusal(patch: Record<string, unknown>): string | null {
  const bad = Object.keys(patch).filter((k) => !EVENT_CONFIG_KEYS.has(k));
  if (bad.length) return `unknown config key(s): ${bad.join(', ')}. Allowed: ${[...EVENT_CONFIG_KEYS].join(', ')}`;
  if (patch.moderation !== undefined && patch.moderation !== null && patch.moderation !== 'post' && patch.moderation !== 'pre') {
    return 'config.moderation must be "post" or "pre"';
  }
  return null;
}

/** ISO date or '' (clear). null = invalid. */
export function isoOrClear(v: string): string | null | 'invalid' {
  if (v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 'invalid' : new Date(t).toISOString();
}

export const DEFAULT_2D_CONFIG = { opacity: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } };

// ── Undo planning ───────────────────────────────────────────────────────────

export type UndoPlan =
  | { op: 'delete'; table: string; key: Record<string, unknown> }
  | { op: 'insert'; table: string; row: Record<string, unknown> }
  | { op: 'update'; table: string; key: Record<string, unknown>; row: Record<string, unknown> }
  | { op: 'refuse'; reason: string };

/** What undo_change should do for one audited change. Pure. */
export function planUndo(entry: {
  target_table: string | null;
  before: unknown;
  after: unknown;
  status: string;
  reverted_by: number | null;
}): UndoPlan {
  if (entry.status !== 'ok') return { op: 'refuse', reason: 'only successful changes can be undone' };
  if (entry.reverted_by !== null) return { op: 'refuse', reason: `already undone by change ${entry.reverted_by}` };
  const table = entry.target_table ?? '';
  const pk = UNDO_TABLES[table];
  if (!pk) return { op: 'refuse', reason: 'this change has no row snapshot to restore' };
  const before = isPlainObject(entry.before) ? entry.before : null;
  const after = isPlainObject(entry.after) ? entry.after : null;
  if ((before && before._truncated) || (after && after._truncated)) {
    return { op: 'refuse', reason: 'the snapshot was too large to keep, so this change cannot be undone automatically' };
  }
  const keyOf = (row: Record<string, unknown>) => Object.fromEntries(pk.map((c) => [c, row[c]]));
  if (!before && after) return { op: 'delete', table, key: keyOf(after) };
  if (before && !after) return { op: 'insert', table, row: before };
  if (before && after) return { op: 'update', table, key: keyOf(before), row: before };
  return { op: 'refuse', reason: 'nothing recorded to restore' };
}

/** True when `current` still matches the change's `after` snapshot on every column it recorded. */
export function unchangedSince(after: unknown, current: unknown): boolean {
  if (!isPlainObject(after)) return current === null || current === undefined;
  if (!isPlainObject(current)) return false;
  for (const [k, v] of Object.entries(after)) {
    if (k === 'updated_at') continue;
    if (JSON.stringify(v) !== JSON.stringify(current[k])) return false;
  }
  return true;
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function isRpcRequest(v: unknown): v is RpcRequest {
  return isPlainObject(v) && v.jsonrpc === '2.0' && typeof v.method === 'string';
}

export function rpcResult(id: RpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function rpcError(id: RpcRequest['id'] | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function negotiateProtocol(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];
}

export function initializeResult(requested: unknown) {
  return {
    protocolVersion: negotiateProtocol(requested),
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, title: 'Beamwall platform', version: SERVER_VERSION },
    instructions:
      'Beamwall platform tools. Call beamwall_guide first. Prefer dry_run before writes, give the user the preview link from the result, ' +
      'and never pass confirm unless the user agreed to that exact change. Every write is logged and most can be reversed with undo_change.',
  };
}

export function toolText(result: unknown, isError = false) {
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  const out: Record<string, unknown> = { content: [{ type: 'text', text }], isError };
  if (!isError && isPlainObject(result)) out.structuredContent = result;
  return out;
}

// ── The guide ───────────────────────────────────────────────────────────────

export function guideText(): string {
  const confirmActions = Object.entries(ADMIN_ACTIONS).filter(([, c]) => c).map(([a]) => a);
  const plainActions = Object.entries(ADMIN_ACTIONS).filter(([, c]) => !c).map(([a]) => a);
  return `# Beamwall platform — how content works

Beamwall is a multi-tenant AR photo booth: hosts create EVENTS; guests open
${PLATFORM_ORIGIN}/e/<slug>/booth on their phone, try LOOKS on (Frames, Props,
Paint, Effects — never call them "filters" to users), snap, and the photo beams
onto the event's live wall (/e/<slug>/wall).

## Data model (what these tools write)
- events — slug (URL id), name, event_type (${EVENT_TYPES.join('/')}), status
  (${EVENT_STATUSES.join(' → ')}; only "live" is open to guests), plan_tier
  (${PLAN_TIERS.join('/')}), starts_at/ends_at, config (jsonb).
- events.config top-level keys accepted by update_event: ${[...EVENT_CONFIG_KEYS].join(', ')}.
  Most useful: copy {eventName, fullName, tagline, eyebrow, thankYou, welcomeIntro,
  keepsakeIntro, shareTitle, shareText}; accentHexes ["#hex", …]; themeVars
  {"--accent": "#hex", …}; scene / theme (event look); arContent {borderIds,
  shaderIds, headPieceIds} — allow-lists of BUILT-IN looks ([] = all,
  ["__none__"] = none); moderation "post" | "pre"; brief (the AI brief).
  Read get_event first and patch only what you mean to change.
- experiences (= "looks"). kind: border (2D frame PNG, transparent window),
  2d_filter (2D overlay), shader (whole-screen effect, config.shader.shaderId),
  3d_attachment (worn 3D GLB prop, config.anchor + config.layers), composite (a
  saved studio scene). An event's OWN looks have event_id = slug. Shared-library
  looks have is_global = true and are attached to events through
  event_catalog_links (attach_library_look).
- challenges — photo missions per event (event_id = slug).
- Storage: the public "assets" bucket. upload_asset puts event files under
  <slug>/mcp/ and library staging under _platform/library/_mcp/.

## Safe workflow
1. Read: get_event / list_library / get_look.
2. Write with dry_run: true first when the change is non-trivial; show the user.
3. Write for real. Every result carries a change id and, for events, links —
   give the user the booth link so they can see it immediately.
4. Mistake? list_changes → undo_change (needs confirm = the change id).
Destructive tools (remove_look, remove_challenge, undo_change, set_event_status
away from live, some admin actions) need the token's "destructive" scope AND a
confirm argument. Only pass confirm after the user agreed to that exact change.
Test events: create_event with test: true (slug gets a zz-test- prefix).

## Recipes
- New 2D frame for an event: upload_asset {file_name:"gold.png", folder:<slug>,
  source_url:…} → add_look {slug, name:"Gold frame", kind:"border",
  asset_url:<url>} → share links.booth.
- Add a library prop: list_library {search:"crown"} → attach_library_look.
- Re-brand: update_event {slug, config_patch:{accentHexes:["#d4af37"],
  copy:{tagline:"…"}}}.
- Clone a look from another event: get_look {id} → add_look with its kind and
  config, new asset_url.
- Publish a new 3D model to the shared library: admin_action
  create_library_drafts / classify_library_drafts / publish_library_drafts
  (see the admin suite), or admin_action publish_library_item.

## admin_action
Allowed: ${plainActions.join(', ')}.
Need confirm = the action name: ${confirmActions.join(', ')}.
Everything else (passwords, bans, credits, admins, Stripe, paid plans) is
deliberately not reachable from here — those stay in ${PLATFORM_ORIGIN}/admin.
`;
}
