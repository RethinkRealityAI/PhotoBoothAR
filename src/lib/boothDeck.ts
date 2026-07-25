/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth control deck's data model — pure, so the JSX stays dumb.
 *
 * The old rail (FilterOrbs) crammed four labelled groups — Quick · Effects ·
 * Frames · 3D — with dividers into a single horizontally-scrolling row above
 * the shutter. Everything was on screen at once and nothing was findable,
 * which is the "overwhelming" the redesign is answering.
 *
 * This models what the landing demo does instead (CameraExperience.tsx): three
 * categories as tabs, one row of orbs for the active tab. Deciding what those
 * tabs and orbs contain is logic, and logic belongs here where it can be
 * tested, rather than inside a component that needs a camera to render.
 */
import type { Experience } from '../types';

export type DeckCategory = 'effect' | 'frame' | 'prop';

export interface DeckOption {
  /** The Experience row this orb applies. */
  exp: Experience;
  /** Short label under the orb — first word only; orbs are 48px wide. */
  label: string;
  /** For shader experiences, the shader this option activates. */
  shaderId: string | null;
}

export interface DeckSection {
  key: DeckCategory;
  label: string;
  options: DeckOption[];
}

/** Selection state the booth already tracks, in one shape. */
export interface DeckSelection {
  /** Active shader id, or 'none'. */
  effectId: string;
  frameId: string | null;
  attachmentId: string | null;
}

const CATEGORY_LABEL: Record<DeckCategory, string> = {
  effect: 'Effect',
  frame: 'Frame',
  prop: '3D',
};

/** Orbs are narrow; a full multi-word name truncates to nothing useful. */
export function shortLabel(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.length > 9 ? `${first.slice(0, 8)}…` : first;
}

function optionOf(exp: Experience): DeckOption {
  return {
    exp,
    label: shortLabel(exp.name),
    shaderId: exp.config?.shader?.shaderId ?? null,
  };
}

/**
 * Split the catalog into the three deck sections.
 *
 * 'composite' (a mixed 2D + 3D + filter scene) belongs to Frame, matching the
 * existing booth behaviour: it is a whole scene led by its frame, and
 * Booth's handleSelectFrame applies all three of its slots together.
 *
 * Empty sections are dropped — an event with no 3D pieces should not show a
 * "3D" tab that leads to an empty row.
 */
export function buildDeck(catalog: Experience[]): DeckSection[] {
  const sections: DeckSection[] = [
    {
      key: 'effect',
      label: CATEGORY_LABEL.effect,
      options: catalog.filter((e) => e.kind === 'shader').map(optionOf),
    },
    {
      key: 'frame',
      label: CATEGORY_LABEL.frame,
      options: catalog
        .filter((e) => e.kind === 'border' || e.kind === '2d_filter' || e.kind === 'composite')
        .map(optionOf),
    },
    {
      key: 'prop',
      label: CATEGORY_LABEL.prop,
      options: catalog.filter((e) => e.kind === '3d_attachment').map(optionOf),
    },
  ];
  return sections.filter((s) => s.options.length > 0);
}

/**
 * Which option in this section is currently applied, by Experience id.
 *
 * Effects are matched on the SHADER id rather than the experience id, because
 * the booth stores the active shader, and two catalog rows can carry the same
 * shader.
 */
export function activeOptionId(section: DeckSection, sel: DeckSelection): string | null {
  if (section.key === 'effect') {
    if (sel.effectId === 'none') return null;
    return section.options.find((o) => o.shaderId === sel.effectId)?.exp.id ?? null;
  }
  if (section.key === 'frame') return sel.frameId;
  return sel.attachmentId;
}

/** Does this category hold a selection? Drives the dot on its tab. */
export function sectionHasSelection(section: DeckSection, sel: DeckSelection): boolean {
  return activeOptionId(section, sel) !== null;
}

/**
 * The tab to open on first paint: the one already holding a selection (so a
 * guest arriving via /experience/:id or an event default lands looking at what
 * is applied), else the first available.
 */
export function initialCategory(sections: DeckSection[], sel: DeckSelection): DeckCategory | null {
  if (sections.length === 0) return null;
  return (sections.find((s) => sectionHasSelection(s, sel)) ?? sections[0]).key;
}

/** True when nothing at all is applied — drives the "Clear" orb's active state. */
export function isPristine(sel: DeckSelection, sparkles: boolean): boolean {
  return sel.effectId === 'none' && !sparkles && sel.frameId === null && sel.attachmentId === null;
}
