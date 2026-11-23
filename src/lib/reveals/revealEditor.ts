/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revealEditor — the pure half of the reveal editor (/admin/reveals/:id):
 * what changed since the last save, what the public link is showing, where
 * an uploaded image goes, and the field checks. No React, no supabase, so it
 * is unit-tested in node (revealEditor.test.ts).
 */
import {
  CAPS, isValidSlug, normalizeRevealDoc, presetDoc, safeImage, safeLink, slugify,
  type RevealDoc,
} from './revealModel';

/** What the editor holds locally (the admin's in-progress edits). */
export interface EditorLocal {
  doc: RevealDoc;
  name: string;
  slug: string;
}

/** The last version the database confirmed. */
export interface EditorSaved {
  doc: RevealDoc;
  name: string;
  slug: string;
}

/** Canonical JSON of a doc as readers will see it (trims, caps, fallbacks applied). */
export function canonDoc(doc: unknown): string {
  return JSON.stringify(normalizeRevealDoc(doc));
}

export const NAME_MAX = 120;

/** The name as it will be stored: trimmed, capped. '' means "not savable yet". */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export interface DraftPatch {
  draft?: RevealDoc;
  name?: string;
  slug?: string;
}

/**
 * The patch that brings the database up to the local edits, or null when
 * nothing savable changed. An invalid slug, an empty name, or a slug the
 * database already refused (`blockedSlug`) is left out, so the rest of the
 * edits still save.
 */
export function buildDraftPatch(local: EditorLocal, saved: EditorSaved, blockedSlug: string | null = null): DraftPatch | null {
  const patch: DraftPatch = {};
  if (canonDoc(local.doc) !== canonDoc(saved.doc)) patch.draft = normalizeRevealDoc(local.doc);
  const name = cleanName(local.name);
  if (name !== '' && name !== saved.name) patch.name = name;
  const slug = local.slug.trim();
  if (slug !== saved.slug && isValidSlug(slug) && slug !== blockedSlug) patch.slug = slug;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** True when local edits differ from the saved version in anything (savable or not). */
export function isDirty(local: EditorLocal, saved: EditorSaved): boolean {
  return canonDoc(local.doc) !== canonDoc(saved.doc)
    || cleanName(local.name) !== saved.name
    || local.slug.trim() !== saved.slug;
}

export type RevealStatus = 'draft' | 'live' | 'changes';

/** Live = the public link shows exactly this doc; changes = live but behind; draft = nothing live. */
export function revealStatus(doc: RevealDoc, published: RevealDoc | null): RevealStatus {
  if (published === null) return 'draft';
  return canonDoc(doc) === canonDoc(published) ? 'live' : 'changes';
}

export const STATUS_META: Record<RevealStatus, { label: string; blurb: string }> = {
  draft: { label: 'Draft', blurb: 'Not live yet. The public link shows nothing until you publish.' },
  live: { label: 'Live', blurb: 'The public link shows exactly what you see here.' },
  changes: { label: 'Changes not live', blurb: 'The public link still shows the last version you published.' },
};

/** The doc is still exactly its occasion's starting template (safe to swap without asking). */
export function isUntouched(doc: RevealDoc): boolean {
  return canonDoc(doc) === canonDoc(presetDoc(doc.occasion));
}

/* ── Image upload ──────────────────────────────────────────────────── */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(',');

/** Why a picked file cannot be used, or null when it can. */
export function imageUploadError(file: { type: string; size: number }): string | null {
  if (!(file.type in IMAGE_TYPES)) return 'That file is not an image we can use. Pick a JPG, PNG, WebP or GIF.';
  if (file.size > IMAGE_MAX_BYTES) return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`;
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** `_platform/reveals/<reveal id>/<timestamp>.<ext>` in the public assets bucket. */
export function revealUploadPath(revealId: string, mimeType: string, nowMs: number): string {
  const id = revealId.replace(/[^a-zA-Z0-9-]/g, '') || 'unknown';
  const ext = IMAGE_TYPES[mimeType] ?? 'png';
  return `_platform/reveals/${id}/${Math.floor(nowMs)}.${ext}`;
}

/* ── Field checks ──────────────────────────────────────────────────── */

/** A problem with the reveal button's link, or null ('' is fine: no button). */
export function linkError(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  if (s.length > CAPS.url) return `Links can be up to ${CAPS.url} characters.`;
  if (safeLink(s) === '') return 'Use a full https:// link, or a page on this site starting with /.';
  return null;
}

/** A problem with the image URL, or null ('' is fine: no image). */
export function imageUrlError(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  if (safeImage(s) === '') return 'Images need a full https:// link.';
  return null;
}

/** A problem with the slug, or null. */
export function slugError(raw: string, takenSlug: string | null): string | null {
  const s = raw.trim();
  if (s === '') return 'The link needs a name.';
  if (s.length < 3) return 'At least 3 characters.';
  if (s.length > 60) return 'Up to 60 characters.';
  if (!isValidSlug(s)) return 'Lowercase letters, numbers and dashes only, not starting or ending with a dash.';
  if (takenSlug !== null && s === takenSlug) return 'Another reveal already uses this link.';
  return null;
}

/** What typing in the slug field turns into: lowercase, dashes, no junk (keeps a trailing dash while typing). */
export function typedSlug(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 60);
}

/** A slug suggestion from the reveal's name. */
export function slugFromName(name: string): string {
  return slugify(name);
}

/** "12/90", and whether it is near or at the cap. */
export function counter(value: string, cap: number): { text: string; tone: 'ok' | 'near' | 'full' } {
  const n = value.length;
  return { text: `${n}/${cap}`, tone: n >= cap ? 'full' : n >= cap * 0.9 ? 'near' : 'ok' };
}

/** The file name for "Download .html". */
export function emailFileName(slug: string): string {
  return `${slug.trim() || 'reveal'}-email.html`;
}

/**
 * The email preview's srcDoc: links open in a new tab (the preview iframe is
 * sandboxed without scripts, so a click must never load a page inside it).
 */
export function previewSrcDoc(html: string): string {
  const base = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  return `${base}${html}`;
}

/** "2 min ago" style, for the list. `now` injected for tests. */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(t).toISOString().slice(0, 10);
}
