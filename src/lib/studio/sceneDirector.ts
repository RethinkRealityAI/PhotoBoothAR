/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Scene Director — pure plan handling. One prompt produces a coordinated
 * scene: a frame (AI image, 1 credit), a shader look (free), and a 3D head
 * piece (built-in free, or AI-generated for 10 credits). The LLM call happens
 * in the ai-event-designer edge function (mode:'scene'); this module
 * normalizes/clamps its output against the real shader catalog and head-piece
 * registry so a hallucinated id or out-of-range param can never reach the
 * booth. Credits are charged only when the host ACCEPTS a piece — accepting
 * the frame calls ai-generate-image, accepting a generated head piece calls
 * ai-generate-3d; both enforce credits server-side.
 *
 * Kept free of supabase/react imports: the network call lives in the panel.
 */

export interface SceneShaderCatalogEntry {
  id: string;
  params: { key: string; min: number; max: number; default: number }[];
}

export interface ScenePlanShader {
  shaderId: string;
  params: Record<string, number>;
}

export interface ScenePlanHeadPiece {
  kind: 'procedural' | 'generate';
  /** procedural: a HEAD_PIECES id */
  id?: string;
  /** generate: prompt for ai-generate-3d */
  prompt?: string;
}

export interface ScenePlan {
  sceneName: string;
  /** prompt for ai-generate-image (kind 'border') — null when the model skipped it */
  frame: { prompt: string } | null;
  shader: ScenePlanShader | null;
  headPiece: ScenePlanHeadPiece | null;
}

/** One turn of the docked Director chat: the director's warm reply (always
 *  present) plus an OPTIONAL scene plan. Pure-ideation turns ("what colours
 *  suit a gala?") carry a reply and no plan; scene-descriptions carry both. */
export interface DirectorTurn {
  reply: string;
  plan: ScenePlan | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function cleanPrompt(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, 600) : null;
}

/** The director's chat line. Generous cap so concrete suggestion lists survive;
 *  a non-string / blank reply degrades to '' (the caller decides fallback copy). */
function cleanReply(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, 1500) : '';
}

/**
 * Validate + clamp a raw plan (already-parsed JSON from the edge function).
 * Unknown shader ids and head-piece ids are dropped (piece → null) rather than
 * guessed; params are clamped to the catalog's ranges with defaults filled in.
 * Returns null when nothing usable remains.
 */
export function normalizeScenePlan(
  raw: unknown,
  catalog: readonly SceneShaderCatalogEntry[],
  headPieceIds: readonly string[],
): ScenePlan | null {
  const r = asRecord(raw);
  if (!r) return null;

  const framePrompt = cleanPrompt(asRecord(r.frame)?.prompt);
  const frame = framePrompt ? { prompt: framePrompt } : null;

  let shader: ScenePlanShader | null = null;
  const rawShader = asRecord(r.shader);
  if (rawShader && typeof rawShader.shaderId === 'string') {
    const entry = catalog.find((c) => c.id === rawShader.shaderId);
    if (entry) {
      const rawParams = asRecord(rawShader.params) ?? {};
      const params: Record<string, number> = {};
      for (const p of entry.params) {
        const v = rawParams[p.key];
        params[p.key] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, p.min, p.max) : p.default;
      }
      shader = { shaderId: entry.id, params };
    }
  }

  let headPiece: ScenePlanHeadPiece | null = null;
  const rawPiece = asRecord(r.headPiece);
  if (rawPiece) {
    if (rawPiece.kind === 'procedural' && typeof rawPiece.id === 'string' && headPieceIds.includes(rawPiece.id)) {
      headPiece = { kind: 'procedural', id: rawPiece.id };
    } else {
      const prompt = cleanPrompt(rawPiece.prompt);
      if (prompt && (rawPiece.kind === 'generate' || rawPiece.kind === 'procedural')) {
        // 'procedural' with an unknown id but a usable prompt degrades to generate
        headPiece = { kind: 'generate', prompt };
      }
    }
  }

  if (!frame && !shader && !headPiece) return null;

  return {
    sceneName: cleanPrompt(r.sceneName) ?? 'Custom Scene',
    frame,
    shader,
    headPiece,
  };
}

/** Parse the edge function's planJson STRING field (Gemini array-hang trap:
 *  structured output encodes nested objects as a JSON string). */
export function planFromJson(
  text: unknown,
  catalog: readonly SceneShaderCatalogEntry[],
  headPieceIds: readonly string[],
): ScenePlan | null {
  if (typeof text !== 'string') return null;
  try {
    return normalizeScenePlan(JSON.parse(text), catalog, headPieceIds);
  } catch {
    return null;
  }
}

/**
 * Normalize the edge function's scene-mode response `{ reply, planJson }` into a
 * Director turn. `reply` is parsed loosely; `planJson` is OPTIONAL — a missing,
 * blank, or malformed planJson yields `plan: null` (a clean, non-throwing
 * "ideation only" turn) rather than an error, so the reply always surfaces.
 * Returns null only when there is neither a usable reply nor a usable plan.
 */
export function parseDirectorTurn(
  data: unknown,
  catalog: readonly SceneShaderCatalogEntry[],
  headPieceIds: readonly string[],
): DirectorTurn | null {
  const r = asRecord(data);
  if (!r) return null;
  const reply = cleanReply(r.reply);
  const plan = planFromJson(r.planJson, catalog, headPieceIds);
  if (!reply && !plan) return null;
  return { reply, plan };
}

/* ---- credits ------------------------------------------------------ */

export const FRAME_CREDIT_COST = 1;
export const GENERATE_3D_CREDIT_COST = 10;

export function pieceCreditCost(plan: ScenePlan, piece: ScenePieceKey): number {
  if (piece === 'frame') return plan.frame ? FRAME_CREDIT_COST : 0;
  if (piece === 'headPiece') return plan.headPiece?.kind === 'generate' ? GENERATE_3D_CREDIT_COST : 0;
  return 0;
}

export function totalCreditCost(plan: ScenePlan): number {
  return pieceCreditCost(plan, 'frame') + pieceCreditCost(plan, 'shader') + pieceCreditCost(plan, 'headPiece');
}

/* ---- acceptance progress ------------------------------------------ */

export type ScenePieceKey = 'frame' | 'shader' | 'headPiece';
export type ScenePieceStatus = 'proposed' | 'working' | 'accepted' | 'skipped' | 'failed';
export type SceneProgress = Record<ScenePieceKey, ScenePieceStatus>;

export function initialProgress(plan: ScenePlan): SceneProgress {
  return {
    frame: plan.frame ? 'proposed' : 'skipped',
    shader: plan.shader ? 'proposed' : 'skipped',
    headPiece: plan.headPiece ? 'proposed' : 'skipped',
  };
}

export function setPieceStatus(p: SceneProgress, piece: ScenePieceKey, status: ScenePieceStatus): SceneProgress {
  return p[piece] === status ? p : { ...p, [piece]: status };
}

/** True when no piece is still proposed/working — the scene run is finished. */
export function isSceneSettled(p: SceneProgress): boolean {
  return Object.values(p).every((s) => s === 'accepted' || s === 'skipped' || s === 'failed');
}
