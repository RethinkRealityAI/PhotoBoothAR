/**
 * agentEvals harness — the PURE half shared by scripts/agent-bench.ts (owner-
 * run, calls Gemini) and src/lib/agentEvals.test.ts (CI, replays recordings).
 *
 * One fixture = one conversation the agent must handle correctly. The harness
 * builds the SAME prompt/schema/contents the edge function sends (through the
 * real prompt.ts builders and the client's formatSnapshot/PLATFORM_GUIDE), and
 * scores a raw model output by running the SAME client normalizer the app
 * runs (normalizeActionsResult · normalizePlan · parseDirectorTurn) and
 * comparing the result to the fixture's `expect` block.
 *
 * No network, no supabase, no React here — vitest imports this module.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCopilotPrompt,
  buildCopilotSchema,
  buildCreatePrompt,
  buildResponseSchema,
  buildScenePrompt,
  buildSceneSchema,
  DEFAULT_TEMPLATES,
  type Surface,
  type SceneShaderEntry,
  type TemplateInfo,
} from '../../../supabase/functions/ai-event-designer/prompt.ts';
import type { AgentMode } from '../../../supabase/functions/ai-event-designer/profiles.ts';
import { normalizeActionsResult } from '../copilot';
import { normalizePlan } from '../eventDesigner';
import { formatSnapshot, type EventSnapshot } from '../eventSnapshot';
import { PLATFORM_GUIDE } from '../platformGuide';
import { parseDirectorTurn, type SceneShaderCatalogEntry } from '../studio/sceneDirector';
import { FILTER_SHADERS } from '../shaders';
import { HEAD_PIECES } from '../headPieces';
import { GENERIC_FRAMES } from '../borders';

export const MODES: readonly AgentMode[] = ['copilot', 'create', 'scene'];

/** `{ "$match": "<regex>" }` in `planFields` / `args` matches a string by regex. */
type Matcher = { $match: string };

export interface EvalExpect {
  /** copilot: the EXACT set of tool names a correct answer proposes ([] = propose nothing). */
  tools?: string[];
  /** copilot: every proposed tool must be one of these (zero proposals allowed). */
  toolsAnyOf?: string[];
  /** copilot: at most this many proposals survive normalization. */
  maxActions?: number;
  /** copilot: per-tool argument checks against the normalized proposal. */
  args?: Record<string, Record<string, unknown>>;
  /** create: plan fields that must equal (or $match) after normalizePlan. */
  planFields?: Record<string, unknown>;
  /** create/copilot/scene: the reply must contain a question mark. */
  asksQuestion?: boolean;
  /** scene: whether a plan must be present, and optionally which filter it picks. */
  scene?: { hasPlan: boolean; shaderId?: string };
}

export interface EvalFixture {
  mode: AgentMode;
  surface?: Surface;
  snapshot?: EventSnapshot;
  catalogs?: { filters?: { id: string; name: string }[]; headPieces?: { id: string; name: string }[]; frames?: { id: string; name: string }[] };
  templates?: TemplateInfo[];
  shaderCatalog?: SceneShaderCatalogEntry[];
  headPieceIds?: string[];
  sceneContext?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  expect: EvalExpect;
}

export interface LoadedFixture {
  mode: AgentMode;
  /** File basename without `.json`. */
  name: string;
  /** `<mode>/<name>` — the key recordings are filed under. */
  key: string;
  path: string;
  fixture: EvalFixture;
}

export interface GeminiRequest {
  systemPrompt: string;
  schema: Record<string, unknown>;
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
}

export interface Recording {
  recordedAt: string;
  model: string;
  thinkingBudget: number;
  promptSha256: string;
  raw: unknown;
  usage: Record<string, number | null> | null;
}

export interface Verdict {
  /** Empty when the output meets every expectation. */
  failures: string[];
  /** The model's raw output parsed as valid JSON of the mode's shape. */
  validJson: boolean;
  /** copilot: tools that survived normalization, in order. */
  proposedTools: string[];
  /** copilot: proposals the normalizer rejected. */
  dropped: number;
}

const here = fileURLToPath(new URL('.', import.meta.url));
export const FIXTURES_DIR = join(here, 'fixtures');
export const RECORDED_DIR = join(here, 'recorded');

/** Live app catalogs in the exact shape askCopilot / DirectorPanel send. */
export const APP_CATALOGS = {
  filters: FILTER_SHADERS.filter((s) => s.id !== 'none').map((s) => ({ id: s.id, name: s.name })),
  headPieces: HEAD_PIECES.map((p) => ({ id: p.id, name: p.name })),
  frames: GENERIC_FRAMES,
  shaderCatalog: FILTER_SHADERS.map((s) => ({
    id: s.id,
    params: s.params.map((p) => ({ key: p.key, min: p.min, max: p.max, default: p.default })),
  })) as SceneShaderCatalogEntry[],
  headPieceIds: HEAD_PIECES.map((p) => p.id),
};

/** Every `.json` under `<root>/<mode>/`, sorted. Missing dirs read as empty. */
function listJson(root: string, mode: string): string[] {
  const dir = join(root, mode);
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, f));
}

export function loadFixtures(root = FIXTURES_DIR): LoadedFixture[] {
  const out: LoadedFixture[] = [];
  for (const mode of MODES) {
    for (const path of listJson(root, mode)) {
      const name = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
      const fixture = JSON.parse(readFileSync(path, 'utf8')) as EvalFixture;
      out.push({ mode, name, key: `${mode}/${name}`, path, fixture });
    }
  }
  return out;
}

/** Every recording under `recorded/<run>/<mode>/<name>.json`, with its fixture key. */
export function loadRecordings(root = RECORDED_DIR): { run: string; key: string; path: string; recording: Recording }[] {
  let runs: string[] = [];
  try {
    runs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort();
  } catch {
    return [];
  }
  const out: { run: string; key: string; path: string; recording: Recording }[] = [];
  for (const run of runs) {
    for (const mode of MODES) {
      for (const path of listJson(join(root, run), mode)) {
        const name = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
        out.push({ run, key: `${mode}/${name}`, path, recording: JSON.parse(readFileSync(path, 'utf8')) as Recording });
      }
    }
  }
  return out;
}

/** The exact request the edge fn would send for this fixture (minus the live CREDITS block). */
export function buildRequest(f: EvalFixture): GeminiRequest {
  const contents = f.messages.map((m) => ({
    role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: [{ text: m.content }],
  }));
  if (f.mode === 'copilot') {
    const cat = f.catalogs ?? {};
    return {
      systemPrompt: buildCopilotPrompt({
        surface: f.surface ?? 'platform',
        docs: PLATFORM_GUIDE,
        context: f.snapshot ? formatSnapshot(f.snapshot) : '',
        filters: cat.filters ?? APP_CATALOGS.filters,
        headPieces: cat.headPieces ?? APP_CATALOGS.headPieces,
        frames: cat.frames ?? APP_CATALOGS.frames,
      }),
      schema: buildCopilotSchema(),
      contents,
    };
  }
  if (f.mode === 'scene') {
    const shaders = (f.shaderCatalog ?? APP_CATALOGS.shaderCatalog) as SceneShaderEntry[];
    return {
      systemPrompt: buildScenePrompt(shaders, f.headPieceIds ?? APP_CATALOGS.headPieceIds, f.sceneContext ?? ''),
      schema: buildSceneSchema(),
      contents,
    };
  }
  const templates = f.templates ?? DEFAULT_TEMPLATES;
  return { systemPrompt: buildCreatePrompt(templates, false), schema: buildResponseSchema(templates), contents };
}

export function promptSha256(systemPrompt: string): string {
  return createHash('sha256').update(systemPrompt, 'utf8').digest('hex');
}

function isMatcher(v: unknown): v is Matcher {
  return v !== null && typeof v === 'object' && typeof (v as Matcher).$match === 'string';
}

/** Literal deep-equality via JSON, or a `$match` regex against a string. */
function matches(expected: unknown, actual: unknown): boolean {
  if (isMatcher(expected)) return typeof actual === 'string' && new RegExp(expected.$match).test(actual);
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function checkFields(label: string, expected: Record<string, unknown>, actual: Record<string, unknown>, failures: string[]): void {
  for (const [k, v] of Object.entries(expected)) {
    if (!matches(v, actual[k])) failures.push(`${label}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(actual[k])}`);
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Score one raw model output (the parsed `{ reply, … }` object) against the fixture. */
export function evaluate(f: EvalFixture, raw: unknown): Verdict {
  const failures: string[] = [];
  const r = asRecord(raw);
  const reply = typeof r?.reply === 'string' ? r.reply : '';
  if (!r || !reply.trim()) {
    return { failures: ['no usable reply in the model output'], validJson: false, proposedTools: [], dropped: 0 };
  }
  if (f.expect.asksQuestion === true && !reply.includes('?')) failures.push('reply asks no question');

  let validJson = true;
  let proposedTools: string[] = [];
  let dropped = 0;

  if (f.mode === 'copilot') {
    let decoded: unknown = [];
    try {
      decoded = JSON.parse(typeof r.actionsJson === 'string' ? r.actionsJson : '[]');
      if (!Array.isArray(decoded)) throw new Error('not an array');
    } catch {
      validJson = false;
      failures.push('actionsJson is not a JSON array');
      decoded = [];
    }
    const norm = normalizeActionsResult(decoded, f.snapshot ?? null);
    proposedTools = norm.actions.map((a) => a.tool);
    dropped = norm.dropped;
    const e = f.expect;
    if (e.tools !== undefined) {
      const want = [...new Set(e.tools)].sort();
      const got = [...new Set(proposedTools)].sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) failures.push(`tools: expected [${want}], got [${got}]`);
    }
    if (e.toolsAnyOf !== undefined) {
      for (const t of proposedTools) if (!e.toolsAnyOf.includes(t)) failures.push(`tool ${t} not in [${e.toolsAnyOf}]`);
    }
    if (e.maxActions !== undefined && norm.actions.length > e.maxActions) {
      failures.push(`proposed ${norm.actions.length} actions, max ${e.maxActions}`);
    }
    for (const [tool, want] of Object.entries(e.args ?? {})) {
      const hit = norm.actions.find((a) => a.tool === tool);
      const proposal = hit && 'proposal' in hit ? asRecord(hit.proposal) : null;
      if (!proposal) failures.push(`args.${tool}: no such proposal`);
      else checkFields(`args.${tool}`, want, proposal, failures);
    }
  } else if (f.mode === 'create') {
    const planRaw = asRecord(r.plan);
    if (!planRaw) {
      validJson = false;
      failures.push('plan is not an object');
    }
    const plan = normalizePlan(planRaw ?? {}) as unknown as Record<string, unknown>;
    checkFields('plan', f.expect.planFields ?? {}, plan, failures);
  } else {
    const turn = parseDirectorTurn(r, f.shaderCatalog ?? APP_CATALOGS.shaderCatalog, f.headPieceIds ?? APP_CATALOGS.headPieceIds);
    const planJson = r.planJson;
    if (typeof planJson === 'string' && planJson.trim() !== '') {
      try {
        JSON.parse(planJson);
      } catch {
        validJson = false;
        failures.push('planJson is not valid JSON');
      }
    }
    const e = f.expect.scene;
    if (e) {
      const hasPlan = turn?.plan !== null && turn?.plan !== undefined;
      if (hasPlan !== e.hasPlan) failures.push(`scene.hasPlan: expected ${e.hasPlan}, got ${hasPlan}`);
      if (e.shaderId !== undefined && turn?.plan?.shader?.shaderId !== e.shaderId) {
        failures.push(`scene.shaderId: expected ${e.shaderId}, got ${turn?.plan?.shader?.shaderId ?? 'none'}`);
      }
    }
  }
  return { failures, validJson, proposedTools, dropped };
}
