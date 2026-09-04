/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The event checklist — ONE source for "what is still missing" that the
 * copilot's beam-ready card (build mode), the dashboard's getting-started
 * list, the greeting and the quick chips all read. Two shapes of input
 * (a copilot snapshot; the studio's config + stats) feed one set of facts.
 *
 * PURE: no React, no supabase. Labels and hints are verbatim what the two
 * screens rendered before this module existed, so nothing moved for hosts.
 */
import type { EventSnapshot } from './eventSnapshot';

export type ChecklistMode = 'build' | 'dashboard';

export type ChecklistId =
  // dashboard
  | 'name' | 'look' | 'frames' | 'test_shot'
  // build (copilot)
  | 'frame' | 'filter' | 'prop' | 'challenges' | 'live';

export interface ChecklistItem {
  id: ChecklistId;
  label: string;
  /** Dashboard rows carry a hint; build rows do not. */
  hint?: string;
  done: boolean;
}

/** Everything both checklists decide from. */
export interface ChecklistFacts {
  /** The event's full name, '' when unnamed. */
  name: string;
  /** Template look active? null = not observed (a snapshot carries no theme),
   *  which the dashboard renders as not done — never as a check it didn't earn. */
  look: boolean | null;
  /** PUBLISHED experiences by kind — an unapproved generation must not tick a box. */
  frame: boolean;
  filter: boolean;
  prop: boolean;
  /** Dashboard's "frames & effects": template frames seeded OR any published experience. */
  hasFrames: boolean;
  challenges: number;
  posts: number;
  live: boolean;
}

export function checklistFromSnapshot(s: EventSnapshot): ChecklistFacts {
  const published = s.experiences.filter((e) => e.published);
  return {
    name: s.name,
    look: null,
    frame: published.some((e) => e.kind === 'border'),
    filter: published.some((e) => e.kind === 'shader'),
    prop: published.some((e) => e.kind === '3d_attachment'),
    hasFrames: published.length > 0,
    challenges: s.challenges.length,
    posts: s.postCount,
    live: s.status === 'live',
  };
}

/** The studio's view: events.config (copy.fullName / themeVars / arContent)
 *  plus the dashboard's counts. Per-kind flags are not observable here, so the
 *  build rows read false — the dashboard mode never renders them. */
export function checklistFromStudio(
  cfg: {
    copy?: { fullName?: string | null } | null;
    themeVars?: Record<string, string> | null;
    arContent?: { borderIds?: string[] | null } | null;
  },
  stats: { published?: number; posts?: number } | null | undefined,
  status: string,
): ChecklistFacts {
  const templateFrames = (cfg.arContent?.borderIds?.length ?? 0) > 0;
  return {
    name: cfg.copy?.fullName?.trim() ?? '',
    look: Boolean(cfg.themeVars && Object.keys(cfg.themeVars).length > 0),
    frame: false,
    filter: false,
    prop: false,
    hasFrames: templateFrames || (stats?.published ?? 0) > 0,
    challenges: 0,
    posts: stats?.posts ?? 0,
    live: status === 'live',
  };
}

export function computeChecklist(facts: ChecklistFacts, mode: ChecklistMode): ChecklistItem[] {
  if (mode === 'dashboard') {
    const hasLook = facts.look === true;
    return [
      { id: 'name', label: 'Name your event', hint: facts.name || 'Give it a name in Branding', done: facts.name.length > 0 },
      // Template-seeded events pass these two by design — but say so honestly:
      // "done" here means "your chosen template's defaults are active", not
      // "you customized it".
      { id: 'look', label: 'Pick your look & colours', hint: hasLook ? 'Template look active — make it yours in Branding' : 'Theme, background & fonts', done: hasLook },
      { id: 'frames', label: 'Add frames & effects', hint: facts.hasFrames ? 'Template frames active — add your own or AI-generate more' : 'Frames, filters & 3D props', done: facts.hasFrames },
      { id: 'test_shot', label: 'Take a test photo', hint: 'Open your booth and snap one — see what guests will see', done: facts.posts > 0 },
    ];
  }
  return [
    { id: 'frame', label: 'Add a frame', done: facts.frame },
    { id: 'filter', label: 'Add a filter', done: facts.filter },
    { id: 'prop', label: 'Add a 3D prop', done: facts.prop },
    { id: 'challenges', label: 'Add challenges', done: facts.challenges > 0 },
    { id: 'live', label: 'Go live', done: facts.live },
  ];
}

export function missingIds(items: ChecklistItem[]): ChecklistId[] {
  return items.filter((it) => !it.done).map((it) => it.id);
}
