/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth intro — the drawer Beamy uses to show a guest around the booth
 * the first time they open it — as pure data, so the booth and the host
 * wizard's live preview build the SAME steps from the SAME rules, and the
 * rules are tested without a camera.
 *
 * DYNAMIC: a step only appears when the event really has the thing it
 * teaches (Dapo, 2026-11-26: "if they don't, then the users won't see it").
 * No frames → no AR step; no challenges → no challenge step; no gestures →
 * no power-ups step. The controls step lists only the capture modes this
 * event's plan allows.
 *
 * Stored per event in `events.config.boothIntro` (jsonb that already exists,
 * no migration):
 *
 *   { v: 1, enabled: true, custom: true,
 *     steps: { world: { title: 'Pose with our arch', picture: { kind: 'look', lookId: '…' } } } }
 *
 * `custom: false` keeps Beamy's default wording and pictures, but the host's
 * edits stay stored so switching back to "Customise" brings them back.
 * Untrusted on read (any host can write config through the API), so
 * `normalizeBoothIntro` is total and every string is length-capped.
 */
import type { LookTab } from './lookTerms';
import { LOOK_TABS } from './lookTerms';
import { resolveSceneImageUrl } from './sceneThemes';
import type { Experience } from '../types';
import { buildDeck } from './boothDeck';
import { buildLookStrip } from './lookStrip';
import { frameArtUrl, isWorldLook } from './world/worldLooks';
import { POWER_UP_PRESETS, POWER_UP_TRIGGER_PREFIX } from './wizard/powerUps';

export type IntroStepId = 'welcome' | 'controls' | 'looks' | 'world' | 'gestures' | 'challenges' | 'wall';

/** Display order. Welcome first, the live wall last (it is where a shot ends up). */
export const INTRO_STEP_IDS: readonly IntroStepId[] = ['welcome', 'controls', 'looks', 'world', 'gestures', 'challenges', 'wall'];

/** The wizard's chip label for each step. */
export const INTRO_STEP_LABEL: Record<IntroStepId, string> = {
  welcome: 'Hello',
  controls: 'Controls',
  looks: 'Looks',
  world: 'AR',
  gestures: 'Power-ups',
  challenges: 'Challenges',
  wall: 'Live wall',
};

/** Steps whose picture a host can swap. The controls step is a live drawing of the real buttons. */
export const PICTURE_STEPS: readonly IntroStepId[] = ['welcome', 'looks', 'world', 'gestures', 'challenges', 'wall'];

export const INTRO_TITLE_MAX = 60;
export const INTRO_BODY_MAX = 180;

export type IntroPicture =
  | { kind: 'default' }
  /** One of the event's own Looks (its thumbnail, or the frame standing up on the AR step). */
  | { kind: 'look'; lookId: string }
  /** A picture the host uploaded (public storage URL, validated like scene images). */
  | { kind: 'upload'; url: string };

export interface IntroStepEdit {
  hidden?: boolean;
  title?: string;
  body?: string;
  picture?: IntroPicture;
}

export interface BoothIntroConfig {
  v: 1;
  /** false = guests go straight to the camera (they get the one-line tip instead). */
  enabled: boolean;
  /** true = the host's edits below are shown; false = Beamy's default intro. */
  custom: boolean;
  steps: Partial<Record<IntroStepId, IntroStepEdit>>;
}

export const DEFAULT_BOOTH_INTRO: BoothIntroConfig = { v: 1, enabled: true, custom: false, steps: {} };

function isStepId(v: unknown): v is IntroStepId {
  return typeof v === 'string' && (INTRO_STEP_IDS as readonly string[]).includes(v);
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return t === '' ? undefined : t;
}

function normalizePicture(raw: unknown): IntroPicture | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'default') return { kind: 'default' };
  if (r.kind === 'look' && typeof r.lookId === 'string' && r.lookId.length > 0 && r.lookId.length <= 200) {
    return { kind: 'look', lookId: r.lookId };
  }
  if (r.kind === 'upload') {
    const url = resolveSceneImageUrl(r.url);
    return url ? { kind: 'upload', url } : undefined;
  }
  return undefined;
}

function normalizeEdit(raw: unknown, id: IntroStepId): IntroStepEdit | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: IntroStepEdit = {};
  // The welcome step is the intro's front door: it can be reworded, never hidden.
  if (r.hidden === true && id !== 'welcome') out.hidden = true;
  const title = cleanText(r.title, INTRO_TITLE_MAX);
  if (title !== undefined) out.title = title;
  const body = cleanText(r.body, INTRO_BODY_MAX);
  if (body !== undefined) out.body = body;
  if (PICTURE_STEPS.includes(id)) {
    const pic = normalizePicture(r.picture);
    if (pic && pic.kind !== 'default') out.picture = pic;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Total coercion of `events.config.boothIntro`. Absent / malformed = Beamy's default intro, on. */
export function normalizeBoothIntro(raw: unknown): BoothIntroConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BOOTH_INTRO, steps: {} };
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return { ...DEFAULT_BOOTH_INTRO, steps: {} };
  const steps: Partial<Record<IntroStepId, IntroStepEdit>> = {};
  if (r.steps !== null && typeof r.steps === 'object' && !Array.isArray(r.steps)) {
    for (const [k, v] of Object.entries(r.steps as Record<string, unknown>)) {
      if (!isStepId(k)) continue;
      const e = normalizeEdit(v, k);
      if (e) steps[k] = e;
    }
  }
  return { v: 1, enabled: r.enabled !== false, custom: r.custom === true, steps };
}

/** Patch one step's edit; an empty edit is removed (the stored value stays minimal). */
export function editIntroStep(cfg: BoothIntroConfig, id: IntroStepId, patch: Partial<IntroStepEdit>): BoothIntroConfig {
  const merged: Record<string, unknown> = { ...(cfg.steps[id] ?? {}), ...patch };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  const clean = normalizeEdit(merged, id);
  const steps = { ...cfg.steps };
  if (clean) steps[id] = clean;
  else delete steps[id];
  return { ...cfg, steps };
}

/* ── What the event has ─────────────────────────────────────────────── */

/** One of the event's Looks, as the intro shows it. */
export interface IntroLook {
  id: string;
  name: string;
  tab: LookTab;
  /** Its picture (thumbnail, or a frame's art); null when it has none. */
  thumb: string | null;
}

/** Everything the intro needs to know about the booth it is introducing. */
export interface IntroContext {
  eventName: string;
  /** The booth's Looks, in tab order (Frames · Props · Paint · Effects). */
  looks: readonly IntroLook[];
  /** Frames a guest can stand up in the room (World mode). Empty = no AR step. */
  worldFrames: readonly IntroLook[];
  video: boolean;
  /** Photo strips (every platform booth today). */
  strip: boolean;
  /** Front/back camera. Unknown in the wizard preview → true (most phones). */
  canFlip: boolean;
  /** Event-wide power-ups, as "what you do" / "what happens" pairs. */
  gestures: readonly { gesture: string; effect: string }[];
  /** Active challenges the booth will show. */
  challenges: number;
}

/** A look's picture: its thumbnail, else a frame's own art. */
function lookThumb(exp: Experience): string | null {
  return exp.thumbnail_url ?? frameArtUrl(exp) ?? null;
}

/**
 * The booth's Looks and standing frames from its catalog — the SAME deck and
 * tab rules the booth's look switcher uses (boothDeck + lookStrip), so the
 * intro can never mention a tab the booth does not show. The "3D" World tiles
 * are left out of `looks`; their frames are `worldFrames`.
 */
export function introLooksFrom(catalog: readonly Experience[]): { looks: IntroLook[]; worldFrames: IntroLook[] } {
  const strip = buildLookStrip(buildDeck([...catalog]));
  const looks = strip
    .filter((i) => !isWorldLook(i.exp))
    .map((i) => ({ id: i.exp.id, name: i.title, tab: i.tab, thumb: lookThumb(i.exp) }));
  const seen = new Set<string>();
  const worldFrames: IntroLook[] = [];
  for (const exp of catalog) {
    const art = frameArtUrl(exp);
    if (art === null || seen.has(art)) continue;
    seen.add(art);
    worldFrames.push({ id: exp.id, name: exp.name, tab: 'frames', thumb: art });
  }
  return { looks, worldFrames };
}

/** Event power-ups (booth triggers or stored preset ids) → the words the intro says. */
export function introGestures(triggerIdsOrPresetIds: readonly string[]): { gesture: string; effect: string }[] {
  const ids = new Set(triggerIdsOrPresetIds.map((id) => id.startsWith(POWER_UP_TRIGGER_PREFIX) ? id.slice(POWER_UP_TRIGGER_PREFIX.length) : id));
  return POWER_UP_PRESETS.filter((p) => ids.has(p.id)).map((p) => ({ gesture: p.gesture, effect: p.effect }));
}

/* ── The steps a guest sees ─────────────────────────────────────────── */

export type IntroArt =
  | { kind: 'beamy'; pose: 'hello' | 'blast' | 'crown' }
  | { kind: 'controls'; flip: boolean; video: boolean; strip: boolean; tabs: LookTab[]; looks: IntroLook[] }
  | { kind: 'looks'; looks: IntroLook[] }
  | { kind: 'world'; frame: IntroLook | null }
  | { kind: 'challenges'; count: number }
  | { kind: 'wall' }
  | { kind: 'image'; url: string };

export interface IntroStep {
  id: IntroStepId;
  /** Beamy's little label above the title. */
  eyebrow: string;
  title: string;
  body: string;
  art: IntroArt;
}

/** "Frames, Props and Paint". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The look tabs this booth actually shows, in tab order. */
export function presentTabs(looks: readonly IntroLook[]): LookTab[] {
  return LOOK_TABS.map((t) => t.id).filter((id) => looks.some((l) => l.tab === id));
}

/** Up to `n` looks with pictures, one per tab first, so the fan shows the range. */
export function showcaseLooks(looks: readonly IntroLook[], n = 3): IntroLook[] {
  const withThumb = looks.filter((l) => l.thumb !== null);
  const out: IntroLook[] = [];
  for (const tab of LOOK_TABS.map((t) => t.id)) {
    const first = withThumb.find((l) => l.tab === tab);
    if (first && out.length < n) out.push(first);
  }
  for (const l of withThumb) if (out.length < n && !out.includes(l)) out.push(l);
  return out;
}

/** Which steps this booth can show at all (before the host hides any). */
export function availableIntroSteps(ctx: IntroContext): IntroStepId[] {
  return INTRO_STEP_IDS.filter((id) => {
    if (id === 'looks') return ctx.looks.length > 0;
    if (id === 'world') return ctx.worldFrames.length > 0;
    if (id === 'gestures') return ctx.gestures.length > 0;
    if (id === 'challenges') return ctx.challenges > 0;
    return true;
  });
}

const TAB_WORD: Record<LookTab, string> = { frames: 'Frames', props: 'Props', paint: 'Paint', effects: 'Effects' };

/** How the one capture button works: tap = photo, hold = video (no switch). */
function captureWords(ctx: IntroContext): string {
  const snap = ctx.video ? 'tap the big button to snap, or hold it to record a video' : 'tap the big button to snap';
  return `${snap}.${ctx.strip ? ' The film button makes a photo strip.' : ''}`;
}

/** Beamy's default step, built from what the booth has. */
export function defaultIntroStep(id: IntroStepId, ctx: IntroContext): IntroStep {
  const name = ctx.eventName.trim() || 'the party';
  const tabs = presentTabs(ctx.looks);
  switch (id) {
    case 'welcome':
      return {
        id, eyebrow: 'Hi, I’m Beamy',
        title: `Welcome to ${name}`,
        body: 'Let me show you around. It takes ten seconds, then the camera is all yours.',
        art: { kind: 'beamy', pose: 'hello' },
      };
    case 'controls': {
      const flip = ctx.canFlip ? 'Flip the camera, swap' : 'Swap';
      return {
        id, eyebrow: 'Your controls',
        title: 'Everything is one tap away',
        body: `${flip} your look, then ${captureWords(ctx)}`,
        art: { kind: 'controls', flip: ctx.canFlip, video: ctx.video, strip: ctx.strip, tabs, looks: showcaseLooks(ctx.looks, 4) },
      };
    }
    case 'looks': {
      const fan = showcaseLooks(ctx.looks);
      return {
        id, eyebrow: 'Looks',
        title: 'Try something on',
        body: `${listWords(tabs.map((t) => TAB_WORD[t]))} ${tabs.length === 1 ? 'is' : 'are'} made for ${name}. Wear one of each at once and mix it up.`,
        art: fan.length > 0 ? { kind: 'looks', looks: fan } : { kind: 'beamy', pose: 'crown' },
      };
    }
    case 'world':
      return {
        id, eyebrow: 'AR in your space',
        title: 'Stand a frame in the room',
        body: 'Tap a Prop marked AR and it stands life-size in the room, so you can pose beside it. It uses your back camera.',
        art: { kind: 'world', frame: ctx.worldFrames[0] ?? null },
      };
    case 'gestures': {
      const two = ctx.gestures.slice(0, 2).map((g) => `${g.gesture}: ${g.effect.charAt(0).toLowerCase()}${g.effect.slice(1)}.`);
      return {
        id, eyebrow: 'Power-ups',
        title: 'Your moves do magic',
        body: two.join(' '),
        art: { kind: 'beamy', pose: 'blast' },
      };
    }
    case 'challenges':
      return {
        id, eyebrow: 'Challenges',
        title: ctx.challenges === 1 ? 'One photo mission' : `${ctx.challenges} photo missions`,
        body: 'Open Challenges at the top, snap each one and climb the leaderboard.',
        art: { kind: 'challenges', count: ctx.challenges },
      };
    case 'wall':
      return {
        id, eyebrow: 'The live wall',
        title: 'Beam it to the big screen',
        body: 'Love your shot? Send it and it lands on the live wall for everyone to see.',
        art: { kind: 'wall' },
      };
  }
}

/** Find a look by id across the booth's looks and its standing frames. */
function findLook(ctx: IntroContext, id: string): IntroLook | undefined {
  return ctx.looks.find((l) => l.id === id) ?? ctx.worldFrames.find((l) => l.id === id);
}

/** The art for a host's picture choice; null = keep the default art. */
function artFor(id: IntroStepId, pic: IntroPicture | undefined, ctx: IntroContext): IntroArt | null {
  if (!pic || pic.kind === 'default') return null;
  if (pic.kind === 'upload') return { kind: 'image', url: pic.url };
  const look = findLook(ctx, pic.lookId);
  // A look the host since removed falls back to Beamy's picture, never a hole.
  if (!look) return null;
  if (id === 'world' && look.tab === 'frames') return { kind: 'world', frame: look };
  if (look.thumb === null) return null;
  if (id === 'looks') return { kind: 'looks', looks: [look] };
  return { kind: 'image', url: look.thumb };
}

/** The intro a guest sees: available steps, the host's edits when customised. */
export function buildIntroSteps(ctx: IntroContext, cfg: BoothIntroConfig): IntroStep[] {
  return availableIntroSteps(ctx).flatMap((id) => {
    const base = defaultIntroStep(id, ctx);
    if (!cfg.custom) return [base];
    const edit = cfg.steps[id];
    if (!edit) return [base];
    if (edit.hidden && id !== 'welcome') return [];
    return [{
      ...base,
      title: edit.title ?? base.title,
      body: edit.body ?? base.body,
      art: artFor(id, edit.picture, ctx) ?? base.art,
    }];
  });
}

/* ── Once per device ─────────────────────────────────────────────────── */

/** Versioned: guests who dismissed the old five-slide intro see Beamy's once. */
export function introSeenKey(eventSlug: string): string {
  return `beamwall.booth.intro.v2.${eventSlug}`;
}

/** Storage missing or throwing reads as NOT seen (one short drawer per visit beats never). */
export function introSeen(storage: Pick<Storage, 'getItem'> | null, eventSlug: string): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(introSeenKey(eventSlug)) !== null;
  } catch {
    return false;
  }
}

export function markIntroSeen(storage: Pick<Storage, 'setItem'> | null, eventSlug: string): void {
  if (storage === null) return;
  try {
    storage.setItem(introSeenKey(eventSlug), '1');
  } catch {
    /* non-fatal: the intro may show once more */
  }
}
