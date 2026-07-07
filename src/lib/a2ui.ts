/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A2UI v0.9.1 protocol core (https://a2ui.org · github.com/google/A2UI).
 *
 * A2UI is Google's open protocol for agent-driven interfaces: the agent sends
 * a stream of declarative JSON messages (createSurface / updateComponents /
 * updateDataModel / deleteSurface) describing UI *intent* as a FLAT list of
 * components with id references plus a JSON data model; the client renders
 * them with its own trusted component catalog and reports user interactions
 * back as `action` events. "Safe like data, expressive like code."
 *
 * This module is the pure half — types, JSON-Pointer data model (RFC 6901),
 * the surface reducer, and binding resolution — with zero React/DOM imports so
 * it runs under the vitest node env. The themed renderer lives in
 * src/components/a2ui/A2uiSurface.tsx.
 */

/* ── Message + surface types ─────────────────────────────────────────── */

/** One component in the flat adjacency list. Parent→child links are id
 *  references held in component-specific props (`child`, `children`, …). */
export interface A2uiComponent {
  id: string;
  component: string;
  [prop: string]: unknown;
}

export interface A2uiMessage {
  version?: string;
  createSurface?: {
    surfaceId: string;
    catalogId?: string;
    theme?: Record<string, unknown>;
    sendDataModel?: boolean;
  };
  updateComponents?: {
    surfaceId: string;
    components: A2uiComponent[];
  };
  updateDataModel?: {
    surfaceId: string;
    /** JSON Pointer; '/' or omitted replaces the whole model. */
    path?: string;
    /** Omitted value = remove the key at `path`. */
    value?: unknown;
  };
  deleteSurface?: {
    surfaceId: string;
  };
}

export interface SurfaceState {
  surfaceId: string;
  catalogId: string | null;
  components: Record<string, A2uiComponent>;
  dataModel: Record<string, unknown>;
}

/** The client→agent event emitted when the user triggers a component action. */
export interface A2uiActionEvent {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context: Record<string, unknown>;
  timestamp: string;
}

export const A2UI_VERSION = 'v0.9.1';
export const BASIC_CATALOG_ID =
  'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';

/* ── JSON Pointer (RFC 6901) ─────────────────────────────────────────── */

/** Tokens that would let agent-authored paths reach the prototype chain.
 *  A2UI payloads are model-generated input — treat them as untrusted. */
const FORBIDDEN_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);

/** '' → []; '/a/~1b/0' → ['a', '/b', '0'] (with ~0 → '~', ~1 → '/'). */
export function parsePointer(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return [];
  const body = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  return body.split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getPath(root: unknown, pointer: string): unknown {
  let node: unknown = root;
  for (const token of parsePointer(pointer)) {
    if (FORBIDDEN_TOKENS.has(token)) return undefined;
    if (Array.isArray(node)) {
      node = node[Number(token)];
    } else if (node !== null && typeof node === 'object') {
      node = (node as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * Immutable set/delete at a JSON Pointer: returns a new root with fresh
 * objects along the path (untouched branches are shared). `value` of
 * undefined removes the key. Missing intermediate nodes are created as
 * objects (or arrays when the next token is a whole number).
 */
export function setPath(root: unknown, pointer: string, value: unknown): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value === undefined ? {} : value;
  if (tokens.some((t) => FORBIDDEN_TOKENS.has(t))) return root;

  const set = (node: unknown, i: number): unknown => {
    const token = tokens[i];
    const last = i === tokens.length - 1;
    if (Array.isArray(node)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0) return node;
      const copy = node.slice();
      if (last) {
        if (value === undefined) copy.splice(idx, 1);
        else copy[idx] = value;
      } else {
        copy[idx] = set(copy[idx], i + 1);
      }
      return copy;
    }
    const obj =
      node !== null && typeof node === 'object' ? { ...(node as Record<string, unknown>) } : {};
    if (last) {
      if (value === undefined) delete obj[token];
      else obj[token] = value;
    } else {
      const nextIsIndex = /^\d+$/.test(tokens[i + 1]);
      obj[token] = set(obj[token] ?? (nextIsIndex ? [] : {}), i + 1);
    }
    return obj;
  };
  return set(root, 0);
}

/* ── Surface reducer ─────────────────────────────────────────────────── */

function emptySurface(surfaceId: string, catalogId: string | null = null): SurfaceState {
  return { surfaceId, catalogId, components: {}, dataModel: {} };
}

/**
 * Apply a batch of agent messages to the surfaces map, immutably (safe as a
 * React state update). Lenient where the spec allows recovery: components or
 * data arriving before createSurface implicitly create the surface, and a
 * repeated createSurface resets it.
 */
export function applySurfaceMessages(
  surfaces: Record<string, SurfaceState>,
  messages: A2uiMessage[],
): Record<string, SurfaceState> {
  let next = surfaces;
  const mutate = (id: string, fn: (s: SurfaceState) => SurfaceState) => {
    const current = next[id] ?? emptySurface(id);
    next = { ...next, [id]: fn(current) };
  };

  for (const msg of messages) {
    if (msg.createSurface?.surfaceId) {
      const { surfaceId, catalogId } = msg.createSurface;
      next = { ...next, [surfaceId]: emptySurface(surfaceId, catalogId ?? null) };
    } else if (msg.updateComponents?.surfaceId) {
      const { surfaceId, components } = msg.updateComponents;
      if (!Array.isArray(components)) continue;
      mutate(surfaceId, (s) => {
        const merged = { ...s.components };
        for (const c of components) {
          if (c && typeof c.id === 'string' && c.id && typeof c.component === 'string' && c.component) {
            merged[c.id] = c;
          }
        }
        return { ...s, components: merged };
      });
    } else if (msg.updateDataModel?.surfaceId) {
      const { surfaceId, path, value } = msg.updateDataModel;
      mutate(surfaceId, (s) => {
        const model = setPath(s.dataModel, path ?? '/', value);
        return {
          ...s,
          dataModel:
            model !== null && typeof model === 'object' && !Array.isArray(model)
              ? (model as Record<string, unknown>)
              : {},
        };
      });
    } else if (msg.deleteSurface?.surfaceId) {
      const { [msg.deleteSurface.surfaceId]: _gone, ...rest } = next;
      next = rest;
    }
  }
  return next;
}

/* ── Dynamic value + action-context resolution ───────────────────────── */

/** Absolute pointers stand alone; relative ones resolve inside `scope`
 *  (the current templated-list item, per the spec's collection scoping). */
export function resolveBindingPath(path: string, scope: string): string {
  return path.startsWith('/') ? path : `${scope}/${path}`;
}

/**
 * Resolve a component property that may be a literal, a `{ path }` binding,
 * or a `{ literalString }` wrapper. Unsupported `{ call }` functions resolve
 * to null rather than throwing — an agent typo must never crash the booth.
 */
export function resolveDynamic(value: unknown, dataModel: unknown, scope = ''): unknown {
  if (value === null || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (typeof v.path === 'string') return getPath(dataModel, resolveBindingPath(v.path, scope));
  if (typeof v.literalString === 'string') return v.literalString;
  if (typeof v.call === 'string') return null; // function catalog not implemented
  return value;
}

/** Resolve an action's `context` map: every `{ path }` leaf (at any depth)
 *  is replaced with its current data-model value at trigger time. */
export function resolveContext(
  context: Record<string, unknown> | undefined,
  dataModel: unknown,
  scope = '',
): Record<string, unknown> {
  const resolve = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    const obj = v as Record<string, unknown>;
    if (typeof obj.path === 'string' || typeof obj.literalString === 'string' || typeof obj.call === 'string') {
      return resolveDynamic(v, dataModel, scope);
    }
    if (Array.isArray(v)) return v.map(resolve);
    return Object.fromEntries(Object.entries(obj).map(([k, val]) => [k, resolve(val)]));
  };
  return (resolve(context ?? {}) ?? {}) as Record<string, unknown>;
}
