/**
 * beamwall-mcp — remote MCP server (Streamable HTTP, stateless JSON responses)
 * that lets Claude make routine Beamwall platform changes without a deploy.
 *
 *   POST https://<ref>.supabase.co/functions/v1/beamwall-mcp/<token>
 *   POST https://<ref>.supabase.co/functions/v1/beamwall-mcp   + Authorization: Bearer <token>
 *
 * Deploy with verify_jwt OFF: an MCP client sends no Supabase JWT, so this
 * function authenticates every request itself, BEFORE any method runs:
 *   1. a `bwmcp_` key from the header, the last path segment or ?key=
 *   2. SHA-256 → mcp_tokens (not revoked, not expired)            → 401
 *   3. the key's owner is STILL a platform admin                  → 403
 *   4. ≤ RATE_PER_MIN tool calls per key per minute               → -32000
 * Then each tool checks its scope, validates its arguments against the same
 * schema tools/list advertises (core.ts), and every tools/call — reads too —
 * appends one mcp_audit row. Writes store the row before and after, which is
 * what undo_change restores. Destructive tools need the `destructive` scope
 * AND `confirm` equal to the target, so a model cannot delete by accident.
 *
 * admin_action forwards an allow-listed admin-api action, authenticated with
 * the service-role key + the key owner's user id (admin-api's internal-caller
 * path), so the admin suite's logic is reused, never re-implemented.
 *
 * DEPLOYS AS THREE FILES: index.ts, core.ts, deno.json.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import {
  ADMIN_ACTIONS, CHALLENGE_COLUMNS, DEFAULT_2D_CONFIG, EVENT_STATUSES, LOOK_KINDS, MAX_BASE64_BYTES,
  MAX_UPLOAD_BYTES, TOOL_MAP, TOOLS, UUID_RE,
  boundedJson, configPatchRefusal, confirmRefusal, diffPaths, eventLinks, extractToken, guideText,
  initializeResult, isPlainObject, isRpcRequest, isSafeSourceUrl, isoOrClear, mergePatch, planUndo,
  redactArgs, rpcError, rpcResult, safeFileName, scopeRefusal, slugFromName, slugRefusal, testSlug,
  toolListing, toolText, unchangedSince, uploadFolder, validateArgs,
  type RpcRequest, type Scope, type ToolDef,
} from './core.ts';

const RATE_PER_MIN = 120;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id, x-beamwall-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function httpJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

type Client = ReturnType<typeof serviceClient>;
type Args = Record<string, unknown>;

interface Caller {
  tokenId: string;
  userId: string;
  scopes: Scope[];
  label: string;
}

/** A tool's answer. `audit` describes the write (if any) for mcp_audit. */
interface Outcome {
  result: unknown;
  isError?: boolean;
  status?: 'ok' | 'error' | 'refused' | 'dry_run';
  slug?: string | null;
  table?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

class ToolError extends Error {
  constructor(message: string, readonly status: 'error' | 'refused' = 'error') {
    super(message);
  }
}

function refuse(msg: string): never {
  throw new ToolError(msg, 'refused');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Auth ────────────────────────────────────────────────────────────────────

async function authenticate(sb: Client, req: Request): Promise<Caller | Response> {
  const token = extractToken(req.url, req.headers);
  if (!token) return httpJson(401, { error: 'unauthorized', hint: 'Send a bwmcp_ key (Bearer header or URL path).' });
  const hash = await sha256Hex(token);
  const { data: row, error } = await sb
    .from('mcp_tokens')
    .select('id, label, owner_user_id, scopes, expires_at, revoked_at, use_count')
    .eq('token_hash', hash)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.revoked_at) return httpJson(401, { error: 'unauthorized' });
  if (row.expires_at && Date.parse(row.expires_at as string) <= Date.now()) {
    return httpJson(401, { error: 'token_expired' });
  }
  const { data: isAdmin, error: admErr } = await sb.rpc('is_platform_admin', { p_user: row.owner_user_id });
  if (admErr) throw admErr;
  if (isAdmin !== true) return httpJson(403, { error: 'forbidden' });

  // Best-effort usage stamp; never blocks the call.
  sb.from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString(), use_count: ((row.use_count as number) ?? 0) + 1 })
    .eq('id', row.id)
    .then(({ error: e }) => e && console.error('[beamwall-mcp] usage stamp failed', e));

  return {
    tokenId: row.id as string,
    userId: row.owner_user_id as string,
    scopes: (row.scopes as Scope[]) ?? ['read'],
    label: row.label as string,
  };
}

async function overRateLimit(sb: Client, tokenId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await sb
    .from('mcp_audit')
    .select('id', { count: 'exact', head: true })
    .eq('token_id', tokenId)
    .gte('created_at', since);
  if (error) {
    console.error('[beamwall-mcp] rate check failed (allowing)', error);
    return false;
  }
  return (count ?? 0) >= RATE_PER_MIN;
}

async function writeAudit(
  sb: Client, caller: Caller, tool: string, args: Args, o: Outcome, startedAt: number,
): Promise<number | null> {
  const { data, error } = await sb
    .from('mcp_audit')
    .insert({
      token_id: caller.tokenId,
      actor_user_id: caller.userId,
      tool,
      status: o.status ?? (o.isError ? 'error' : 'ok'),
      event_slug: o.slug ?? (typeof args.slug === 'string' ? args.slug : null),
      target_table: o.table ?? null,
      target_id: o.targetId ?? null,
      args: boundedJson(redactArgs(args), 16_000),
      before: o.before === undefined ? null : boundedJson(o.before),
      after: o.after === undefined ? null : boundedJson(o.after),
      error: o.isError ? String((o.result as { error?: string })?.error ?? o.result).slice(0, 2000) : null,
      duration_ms: Date.now() - startedAt,
    })
    .select('id')
    .single();
  if (error) {
    console.error('[beamwall-mcp] audit insert failed', error);
    return null;
  }
  return data.id as number;
}

// ── Shared reads ────────────────────────────────────────────────────────────

const EVENT_COLS = 'id, org_id, slug, name, event_type, status, plan_tier, starts_at, ends_at, config, created_at, archived_at, ended_at';
const LOOK_COLS = 'id, name, kind, asset_url, thumbnail_url, config, is_published, featured, sort_order, event_id, org_id, is_global, source, library_category_id, library_keywords, library_access, created_at, updated_at';

async function eventBySlug(sb: Client, slug: string) {
  const { data, error } = await sb.from('events').select(EVENT_COLS).eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) refuse(`no event with slug "${slug}"`);
  return data as Record<string, unknown>;
}

async function lookById(sb: Client, id: string) {
  if (!UUID_RE.test(id)) refuse('id must be a uuid');
  const { data, error } = await sb.from('experiences').select(LOOK_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) refuse(`no look with id ${id}`);
  return data as Record<string, unknown>;
}

async function challengeById(sb: Client, id: string) {
  if (!UUID_RE.test(id)) refuse('id must be a uuid');
  const { data, error } = await sb.from('challenges').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) refuse(`no challenge with id ${id}`);
  return data as Record<string, unknown>;
}

function likeTerm(s: string): string {
  return `%${s.replace(/[\\%_,()]/g, (c) => `\\${c}`)}%`;
}

/** Strip a heavy look config down for list views. */
function lookSummary(r: Record<string, unknown>) {
  const { config: _c, ...rest } = r;
  return rest;
}

// ── Tools ───────────────────────────────────────────────────────────────────

type Handler = (sb: Client, caller: Caller, a: Args) => Promise<Outcome>;

const handlers: Record<string, Handler> = {
  async beamwall_guide() {
    return { result: guideText() };
  },

  async list_events(sb, _c, a) {
    let q = sb.from('events')
      .select('id, slug, name, event_type, status, plan_tier, starts_at, created_at, org_id')
      .order('created_at', { ascending: false })
      .limit((a.limit as number) ?? 25);
    if (typeof a.status === 'string') q = q.eq('status', a.status);
    if (typeof a.search === 'string' && a.search.trim()) {
      const t = likeTerm(a.search.trim());
      q = q.or(`name.ilike.${t},slug.ilike.${t}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return { result: { events: data ?? [] } };
  },

  async get_event(sb, _c, a) {
    const ev = await eventBySlug(sb, a.slug as string);
    const slug = ev.slug as string;
    const [looks, links, challenges, org, features] = await Promise.all([
      sb.from('experiences').select(LOOK_COLS).eq('event_id', slug).order('sort_order'),
      sb.from('event_catalog_links').select('experience_id, added_at').eq('event_id', slug),
      sb.from('challenges').select('*').eq('event_id', slug).order('sort_order'),
      sb.from('orgs').select('id, name, plan_tier, plan_expires_at').eq('id', ev.org_id as string).maybeSingle(),
      sb.rpc('resolve_features_raw', { p_org: ev.org_id, p_event: ev.id }),
    ]);
    for (const r of [looks, links, challenges, org]) if (r.error) throw r.error;
    const linkIds = (links.data ?? []).map((l) => l.experience_id as string);
    let library: unknown[] = [];
    if (linkIds.length) {
      const { data, error } = await sb.from('experiences')
        .select('id, name, kind, thumbnail_url, is_published').in('id', linkIds);
      if (error) throw error;
      library = data ?? [];
    }
    return {
      result: {
        event: ev,
        org: org.data,
        looks: (looks.data ?? []).map((l) => ({ ...l, config_chars: JSON.stringify(l.config ?? {}).length, config: undefined })),
        libraryLooks: library,
        challenges: challenges.data ?? [],
        features: features.error ? { unavailable: true } : features.data,
        links: eventLinks(slug, ev.id as string),
        note: 'Look configs are omitted here; use get_look {id} for one look in full.',
      },
    };
  },

  async list_library(sb, _c, a) {
    let q = sb.from('experiences')
      .select('id, name, kind, thumbnail_url, asset_url, library_keywords, library_category_id, library_access, sort_order')
      .eq('is_global', true).eq('is_published', true)
      .order('sort_order').limit((a.limit as number) ?? 50);
    if (typeof a.kind === 'string') q = q.eq('kind', a.kind);
    if (typeof a.search === 'string' && a.search.trim()) {
      const s = a.search.trim();
      q = q.or(`name.ilike.${likeTerm(s)},library_keywords.cs.{${s.toLowerCase().replace(/[{},"\\]/g, '')}}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return { result: { items: data ?? [] } };
  },

  async get_look(sb, _c, a) {
    return { result: { look: await lookById(sb, a.id as string) } };
  },

  async list_changes(sb, _c, a) {
    let q = sb.from('mcp_audit')
      .select('id, created_at, tool, status, event_slug, target_table, target_id, args, error, reverted_by')
      .neq('tool', 'list_changes')
      .order('id', { ascending: false }).limit((a.limit as number) ?? 25);
    if (typeof a.slug === 'string') q = q.eq('event_slug', a.slug);
    const { data, error } = await q;
    if (error) throw error;
    return { result: { changes: data ?? [] } };
  },

  async create_event(sb, caller, a) {
    const name = (a.name as string).trim();
    if (!name) refuse('name is empty');
    let slug = typeof a.slug === 'string' && a.slug ? a.slug : slugFromName(name);
    if (a.test === true) slug = testSlug(slug);
    const bad = slugRefusal(slug);
    if (bad) refuse(bad);

    const { data: taken, error: tErr } = await sb.from('events').select('id').eq('slug', slug).maybeSingle();
    if (tErr) throw tErr;
    if (taken) refuse(`slug "${slug}" is taken — pass a different slug`);

    let orgId = typeof a.org_id === 'string' ? a.org_id : null;
    if (orgId) {
      if (!UUID_RE.test(orgId)) refuse('org_id must be a uuid');
      const { data: org, error } = await sb.from('orgs').select('id').eq('id', orgId).maybeSingle();
      if (error) throw error;
      if (!org) refuse(`no org ${orgId}`);
    } else {
      const { data: m, error } = await sb.from('org_members').select('org_id')
        .eq('user_id', caller.userId).limit(1).maybeSingle();
      if (error) throw error;
      if (!m) refuse('the token owner has no org — pass org_id');
      orgId = m.org_id as string;
    }

    let starts_at: string | null = null;
    if (typeof a.starts_at === 'string' && a.starts_at) {
      const v = isoOrClear(a.starts_at);
      if (v === 'invalid') refuse('starts_at is not a date');
      starts_at = v as string;
    }
    const row = {
      org_id: orgId,
      slug,
      name,
      event_type: (a.event_type as string) ?? 'wedding',
      status: 'draft',
      plan_tier: (a.plan_tier as string) ?? 'deluxe',
      starts_at,
      config: { copy: { fullName: name, eventName: name }, ...(a.test === true ? { test: true } : {}) },
    };
    if (a.dry_run === true) {
      return { status: 'dry_run', slug, result: { dryRun: true, wouldInsert: row, links: eventLinks(slug) } };
    }
    const { data: ev, error } = await sb.from('events').insert(row).select(EVENT_COLS).single();
    if (error) {
      if ((error as { code?: string }).code === '23505') refuse(`slug "${slug}" is taken`);
      throw error;
    }
    return {
      slug, table: 'events', targetId: ev.id as string, before: null, after: ev,
      result: {
        event: ev,
        links: eventLinks(slug, ev.id as string),
        next: 'It is a DRAFT: guests see it once set_event_status {status:"live"}. Add looks with add_look / attach_library_look.',
      },
    };
  },

  async update_event(sb, _c, a) {
    const ev = await eventBySlug(sb, a.slug as string);
    const patch: Record<string, unknown> = {};
    if (typeof a.name === 'string') {
      if (!a.name.trim()) refuse('name is empty');
      patch.name = a.name.trim();
    }
    if (typeof a.event_type === 'string') patch.event_type = a.event_type;
    for (const k of ['starts_at', 'ends_at'] as const) {
      if (typeof a[k] === 'string') {
        const v = isoOrClear(a[k] as string);
        if (v === 'invalid') refuse(`${k} is not a date`);
        patch[k] = v;
      }
    }
    if (isPlainObject(a.config_patch)) {
      const why = configPatchRefusal(a.config_patch);
      if (why) refuse(why);
      patch.config = mergePatch(ev.config ?? {}, a.config_patch);
    }
    if (Object.keys(patch).length === 0) refuse('nothing to change');
    const nextRow = { ...ev, ...patch };
    const changed = diffPaths(ev, nextRow);
    if (a.dry_run === true) {
      return { status: 'dry_run', result: { dryRun: true, changedPaths: changed, after: nextRow } };
    }
    if (changed.length === 0) return { result: { unchanged: true, links: eventLinks(ev.slug as string, ev.id as string) } };
    const { data, error } = await sb.from('events').update(patch).eq('id', ev.id as string).select(EVENT_COLS).single();
    if (error) throw error;
    return {
      table: 'events', targetId: ev.id as string, before: ev, after: data,
      result: { changedPaths: changed, event: data, links: eventLinks(ev.slug as string, ev.id as string) },
    };
  },

  async set_event_status(sb, _c, a) {
    const ev = await eventBySlug(sb, a.slug as string);
    const status = a.status as string;
    if (!EVENT_STATUSES.includes(status)) refuse('bad status');
    if (ev.status === status) return { result: { unchanged: true, status } };
    if (ev.status === 'live') {
      const why = confirmRefusal(ev.slug as string, a.confirm);
      if (why) refuse(`${why} (this closes a LIVE event for guests)`);
    }
    const patch: Record<string, unknown> = { status };
    if (status === 'archived') patch.archived_at = new Date().toISOString();
    if (status === 'ended' && !ev.ended_at) patch.ended_at = new Date().toISOString();
    if (status !== 'archived' && ev.archived_at) patch.archived_at = null;
    const { data, error } = await sb.from('events').update(patch).eq('id', ev.id as string).select(EVENT_COLS).single();
    if (error) throw error;
    return {
      table: 'events', targetId: ev.id as string, before: ev, after: data,
      result: { slug: ev.slug, from: ev.status, to: status, links: eventLinks(ev.slug as string, ev.id as string) },
    };
  },

  async upload_asset(sb, _c, a) {
    const file = safeFileName(a.file_name as string);
    if (!file) refuse('file_name needs one of these extensions: png, jpg, jpeg, webp, svg, glb, gltf');
    const folder = uploadFolder(a.folder as string);
    if (!folder) refuse('folder must be an event slug or "library"');
    if (folder !== '_platform/library/_mcp') await eventBySlug(sb, a.folder as string);

    const hasUrl = typeof a.source_url === 'string' && a.source_url;
    const hasB64 = typeof a.base64 === 'string' && a.base64;
    if (!hasUrl === !hasB64) refuse('give exactly one of source_url or base64');

    let bytes: Uint8Array;
    if (hasB64) {
      const b64 = (a.base64 as string).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
      if (b64.length * 0.75 > MAX_BASE64_BYTES) refuse('base64 is over 8 MB — use source_url');
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch {
        refuse('base64 does not decode');
      }
    } else {
      let url = a.source_url as string;
      let res: Response | null = null;
      for (let hop = 0; hop < 4; hop++) {
        if (!isSafeSourceUrl(url)) refuse('source_url must be a public https URL');
        res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          url = new URL(res.headers.get('location')!, url).toString();
          continue;
        }
        break;
      }
      if (!res || !res.ok) refuse(`could not download source_url (HTTP ${res?.status ?? '?'})`);
      const len = Number(res!.headers.get('content-length') ?? '0');
      if (len > MAX_UPLOAD_BYTES) refuse('file is over 50 MB');
      const ct = res!.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) refuse('source_url returned a web page, not a file');
      bytes = new Uint8Array(await res!.arrayBuffer());
    }
    if (bytes!.length === 0) refuse('file is empty');
    if (bytes!.length > MAX_UPLOAD_BYTES) refuse('file is over 50 MB');
    // Light sniffing so a mislabelled upload never reaches a guest's booth.
    const head = bytes!.slice(0, 12);
    const isPng = head[0] === 0x89 && head[1] === 0x50;
    const isJpg = head[0] === 0xff && head[1] === 0xd8;
    const isWebp = head[8] === 0x57 && head[9] === 0x45;
    const isGlb = head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
    const sniffOk = {
      png: isPng, jpg: isJpg, jpeg: isJpg, webp: isWebp, glb: isGlb, svg: true, gltf: true,
    }[file!.ext as 'png'];
    if (!sniffOk) refuse(`the bytes do not look like a .${file!.ext} file`);

    const path = `${folder}/${crypto.randomUUID().slice(0, 8)}-${file!.base}.${file!.ext}`;
    const { error } = await sb.storage.from('assets').upload(path, bytes!, {
      contentType: file!.contentType, upsert: false, cacheControl: '31536000',
    });
    if (error) throw error;
    const { data: pub } = sb.storage.from('assets').getPublicUrl(path);
    return {
      table: 'storage.assets', targetId: path, slug: folder.startsWith('_platform') ? null : (a.folder as string),
      result: { url: pub.publicUrl, path, bytes: bytes!.length, contentType: file!.contentType },
    };
  },

  async add_look(sb, _c, a) {
    const ev = await eventBySlug(sb, a.slug as string);
    const kind = a.kind as string;
    if (!LOOK_KINDS.includes(kind)) refuse('bad kind');
    if ((kind === 'border' || kind === '2d_filter' || kind === '3d_attachment') && !a.asset_url) {
      refuse(`a ${kind} look needs asset_url (upload it with upload_asset first)`);
    }
    let config: unknown = a.config;
    if (config === undefined) {
      if (kind === 'border' || kind === '2d_filter') config = DEFAULT_2D_CONFIG;
      else refuse(`a ${kind} look needs a config — copy one from get_look on a similar look`);
    }
    let sort = a.sort_order as number | undefined;
    if (sort === undefined) {
      const { data: last } = await sb.from('experiences').select('sort_order')
        .eq('event_id', ev.slug as string).order('sort_order', { ascending: false }).limit(1).maybeSingle();
      sort = ((last?.sort_order as number) ?? -1) + 1;
    }
    const row = {
      name: (a.name as string).trim(),
      kind,
      asset_url: (a.asset_url as string) ?? null,
      thumbnail_url: (a.thumbnail_url as string) ?? null,
      config,
      is_published: a.is_published !== false,
      sort_order: sort,
      event_id: ev.slug,
      org_id: ev.org_id,
      is_global: false,
      source: 'upload',
    };
    if (a.dry_run === true) return { status: 'dry_run', result: { dryRun: true, wouldInsert: row } };
    const { data, error } = await sb.from('experiences').insert(row).select(LOOK_COLS).single();
    if (error) throw error;
    return {
      table: 'experiences', targetId: data.id as string, before: null, after: data,
      result: { look: lookSummary(data), links: eventLinks(ev.slug as string, ev.id as string) },
    };
  },

  async update_look(sb, _c, a) {
    const look = await lookById(sb, a.id as string);
    if (look.is_global) refuse('that is a shared-library look — change it with admin_action (update_library_item_meta etc.)');
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'asset_url', 'thumbnail_url', 'is_published', 'featured', 'sort_order']) {
      if (a[k] !== undefined) patch[k] = typeof a[k] === 'string' ? (a[k] as string).trim() : a[k];
    }
    if (isPlainObject(a.config_patch)) patch.config = mergePatch(look.config ?? {}, a.config_patch);
    if (Object.keys(patch).length === 0) refuse('nothing to change');
    const changed = diffPaths(look, { ...look, ...patch });
    if (a.dry_run === true) return { status: 'dry_run', result: { dryRun: true, changedPaths: changed } };
    const { data, error } = await sb.from('experiences').update(patch).eq('id', look.id as string).select(LOOK_COLS).single();
    if (error) throw error;
    return {
      slug: look.event_id as string, table: 'experiences', targetId: look.id as string, before: look, after: data,
      result: { changedPaths: changed, look: lookSummary(data), links: eventLinks(look.event_id as string) },
    };
  },

  async remove_look(sb, _c, a) {
    const look = await lookById(sb, a.id as string);
    if (look.is_global) refuse('shared-library looks are retired through admin_action set_library_item_state, never deleted here');
    const why = confirmRefusal(look.id as string, a.confirm);
    if (why) refuse(`${why} Would delete "${look.name}" from event ${look.event_id}.`);
    const { error } = await sb.from('experiences').delete().eq('id', look.id as string);
    if (error) throw error;
    return {
      slug: look.event_id as string, table: 'experiences', targetId: look.id as string, before: look, after: null,
      result: { deleted: look.id, name: look.name, undo: 'undo_change with this change id restores it' },
    };
  },

  async attach_library_look(sb, _c, a) {
    const ev = await eventBySlug(sb, a.slug as string);
    const look = await lookById(sb, a.look_id as string);
    if (!look.is_global || !look.is_published) refuse('that look is not a published shared-library item');
    if (look.library_access === 'orgs') {
      const { data: acc, error } = await sb.from('library_item_access').select('org_id')
        .eq('experience_id', look.id as string).eq('org_id', ev.org_id as string).maybeSingle();
      if (error && (error as { code?: string }).code !== '42P01') throw error;
      if (!error && !acc) refuse('that library item is restricted to other customers (library_access = orgs)');
    }
    const row = { event_id: ev.slug, experience_id: look.id };
    const { data, error } = await sb.from('event_catalog_links').upsert(row, { onConflict: 'event_id,experience_id', ignoreDuplicates: true })
      .select().maybeSingle();
    if (error) throw error;
    return {
      table: 'event_catalog_links', targetId: `${ev.slug}:${look.id}`, before: null, after: data ?? row,
      result: { attached: look.name, links: eventLinks(ev.slug as string, ev.id as string) },
    };
  },

  async detach_library_look(sb, _c, a) {
    const ev = await eventBySlug(sb, a.slug as string);
    if (!UUID_RE.test(a.look_id as string)) refuse('look_id must be a uuid');
    const { data, error } = await sb.from('event_catalog_links').delete()
      .eq('event_id', ev.slug as string).eq('experience_id', a.look_id as string).select();
    if (error) throw error;
    if (!data || data.length === 0) refuse('that look was not attached to this event');
    return {
      table: 'event_catalog_links', targetId: `${ev.slug}:${a.look_id}`, before: data[0], after: null,
      result: { detached: a.look_id, links: eventLinks(ev.slug as string, ev.id as string) },
    };
  },

  async add_challenge(sb, _c, a) {
    const ev = await eventBySlug(sb, a.slug as string);
    const { data: last } = await sb.from('challenges').select('sort_order')
      .eq('event_id', ev.slug as string).order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const row = {
      event_id: ev.slug,
      title: (a.title as string).trim(),
      description: (a.description as string) ?? null,
      emoji: (a.emoji as string) ?? null,
      points: (a.points as number) ?? 10,
      active: a.active !== false,
      sort_order: ((last?.sort_order as number) ?? -1) + 1,
    };
    const { data, error } = await sb.from('challenges').insert(row).select('*').single();
    if (error) throw error;
    return {
      table: 'challenges', targetId: data.id as string, before: null, after: data,
      result: { challenge: data, links: eventLinks(ev.slug as string, ev.id as string) },
    };
  },

  async update_challenge(sb, _c, a) {
    const ch = await challengeById(sb, a.id as string);
    const patch: Record<string, unknown> = {};
    for (const k of CHALLENGE_COLUMNS) if (a[k] !== undefined) patch[k] = a[k];
    if (Object.keys(patch).length === 0) refuse('nothing to change');
    const { data, error } = await sb.from('challenges').update(patch).eq('id', ch.id as string).select('*').single();
    if (error) throw error;
    return {
      slug: ch.event_id as string, table: 'challenges', targetId: ch.id as string, before: ch, after: data,
      result: { challenge: data },
    };
  },

  async remove_challenge(sb, _c, a) {
    const ch = await challengeById(sb, a.id as string);
    const why = confirmRefusal(ch.id as string, a.confirm);
    if (why) refuse(`${why} Would delete challenge "${ch.title}" from ${ch.event_id}.`);
    const { error } = await sb.from('challenges').delete().eq('id', ch.id as string);
    if (error) throw error;
    return {
      slug: ch.event_id as string, table: 'challenges', targetId: ch.id as string, before: ch, after: null,
      result: { deleted: ch.id, title: ch.title },
    };
  },

  async undo_change(sb, _c, a) {
    const id = a.change_id as number;
    const why = confirmRefusal(String(id), a.confirm);
    const { data: entry, error } = await sb.from('mcp_audit')
      .select('id, tool, status, event_slug, target_table, target_id, before, after, reverted_by')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    if (!entry) refuse(`no change ${id}`);
    const plan = planUndo(entry as Parameters<typeof planUndo>[0]);
    if (plan.op === 'refuse') refuse(plan.reason);
    if (why) refuse(`${why} Would ${plan.op === 'delete' ? 'delete the row it created' : plan.op === 'insert' ? 're-create the row it deleted' : 'restore the row to how it was'} (${entry!.tool} on ${entry!.target_table}).`);

    const table = (plan as { table: string }).table;
    // deno-lint-ignore no-explicit-any
    const matchKey = (q: any, key: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(key)) q = q.eq(k, v);
      return q;
    };

    let current: Record<string, unknown> | null = null;
    if (plan.op !== 'insert') {
      const { data: cur, error: cErr } = await matchKey(sb.from(table).select('*'), plan.key).maybeSingle();
      if (cErr) throw cErr;
      current = cur;
      if (a.force !== true && !unchangedSince(entry!.after, current)) {
        refuse('the row changed again after this change — undo the later change first, or pass force: true');
      }
    }

    let restored: unknown = null;
    if (plan.op === 'delete') {
      const { error: e } = await matchKey(sb.from(table).delete(), plan.key);
      if (e) throw e;
    } else if (plan.op === 'insert') {
      const { data, error: e } = await sb.from(table).insert(plan.row).select('*').single();
      if (e) throw e;
      restored = data;
    } else {
      const row = { ...plan.row };
      delete row.updated_at;
      const { data, error: e } = await matchKey(sb.from(table).update(row), plan.key).select('*').single();
      if (e) throw e;
      restored = data;
    }
    return {
      slug: entry!.event_slug as string | null, table, targetId: entry!.target_id as string,
      before: current, after: restored,
      result: { undone: id, op: plan.op, table },
    };
  },

  async admin_action(_sb, caller, a) {
    const action = a.action as string;
    if (!(action in ADMIN_ACTIONS)) {
      refuse(`"${action}" is not reachable from here. Allowed: ${Object.keys(ADMIN_ACTIONS).join(', ')}`);
    }
    if (ADMIN_ACTIONS[action]) {
      const why = confirmRefusal(action, a.confirm);
      if (why) refuse(why);
    }
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/admin-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        'x-beamwall-actor': caller.userId,
        'x-beamwall-via': 'mcp',
      },
      body: JSON.stringify({ action, args: isPlainObject(a.args) ? a.args : {} }),
      signal: AbortSignal.timeout(55_000),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep text
    }
    if (!res.ok) {
      return { isError: true, status: 'error', table: 'admin-api', targetId: action, result: { error: `admin-api ${res.status}`, body } };
    }
    return { table: 'admin-api', targetId: action, result: body };
  },
};

// ── Dispatch ────────────────────────────────────────────────────────────────

async function callTool(sb: Client, caller: Caller, params: Record<string, unknown>) {
  const name = typeof params.name === 'string' ? params.name : '';
  const def: ToolDef | undefined = TOOL_MAP.get(name);
  const rawArgs = isPlainObject(params.arguments) ? params.arguments : {};
  const started = Date.now();
  if (!def) return toolText({ error: `unknown tool "${name}"` }, true);

  const scopeWhy = scopeRefusal(def, caller.scopes);
  if (scopeWhy) {
    await writeAudit(sb, caller, name, rawArgs, { result: { error: scopeWhy }, isError: true, status: 'refused' }, started);
    return toolText({ error: scopeWhy }, true);
  }
  const v = validateArgs(def, rawArgs);
  if (!v.ok) {
    await writeAudit(sb, caller, name, rawArgs, { result: { error: v.error }, isError: true, status: 'refused' }, started);
    return toolText({ error: v.error }, true);
  }

  let outcome: Outcome;
  try {
    outcome = await handlers[name](sb, caller, v.args);
  } catch (err) {
    if (err instanceof ToolError) {
      outcome = { result: { error: err.message }, isError: true, status: err.status };
    } else {
      console.error(`[beamwall-mcp] ${name} failed`, err);
      const msg = (err as { message?: string })?.message ?? String(err);
      outcome = { result: { error: `internal error: ${msg.slice(0, 300)}` }, isError: true, status: 'error' };
    }
  }
  const changeId = await writeAudit(sb, caller, name, v.args, outcome, started);
  // Link an undo to the change it reversed, so it cannot be undone twice and
  // the change log can show "undone by #n".
  if (name === 'undo_change' && !outcome.isError && changeId !== null) {
    const { error } = await sb.from('mcp_audit').update({ reverted_by: changeId }).eq('id', v.args.change_id as number);
    if (error) console.error('[beamwall-mcp] reverted_by stamp failed', error);
  }
  const wrote = outcome.table && outcome.status !== 'dry_run' && !outcome.isError && def.readOnly !== true;
  const result = wrote && isPlainObject(outcome.result) && changeId !== null
    ? { ...outcome.result, changeId }
    : outcome.result;
  return toolText(result, outcome.isError === true);
}

async function handleRpc(sb: Client, caller: Caller, msg: RpcRequest): Promise<unknown | null> {
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case 'initialize':
      return rpcResult(msg.id, initializeResult(msg.params?.protocolVersion));
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: toolListing(TOOLS, caller.scopes) });
    case 'resources/list':
      return rpcResult(msg.id, { resources: [] });
    case 'prompts/list':
      return rpcResult(msg.id, { prompts: [] });
    case 'tools/call': {
      if (await overRateLimit(sb, caller.tokenId)) {
        return rpcError(msg.id, -32000, `rate limit: at most ${RATE_PER_MIN} tool calls a minute per key`);
      }
      return rpcResult(msg.id, await callTool(sb, caller, msg.params ?? {}));
    }
    default:
      if (isNotification || msg.method.startsWith('notifications/')) return null;
      return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Stateless server: no SSE stream to open, no session to delete.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' },
    });
  }

  try {
    const sb = serviceClient();
    const caller = await authenticate(sb, req);
    if (caller instanceof Response) return caller;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return httpJson(400, rpcError(null, -32700, 'parse error'));
    }

    const batch = Array.isArray(body);
    const messages = batch ? (body as unknown[]) : [body];
    if (messages.length === 0 || messages.length > 20) return httpJson(400, rpcError(null, -32600, 'invalid request'));
    const replies: unknown[] = [];
    for (const m of messages) {
      if (!isRpcRequest(m)) {
        replies.push(rpcError(null, -32600, 'invalid request'));
        continue;
      }
      const r = await handleRpc(sb, caller, m);
      if (r !== null) replies.push(r);
    }
    if (replies.length === 0) return new Response(null, { status: 202, headers: corsHeaders });
    return httpJson(200, batch ? replies : replies[0]);
  } catch (err) {
    console.error('[beamwall-mcp] internal error', err);
    return httpJson(500, rpcError(null, -32603, 'internal error'));
  }
});
