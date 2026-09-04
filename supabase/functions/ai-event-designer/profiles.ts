/**
 * profiles.ts — per-mode Gemini "agent profiles" for ai-event-designer.
 *
 * One edge function, four specialists (create · copilot · scene · copy); each gets
 * an explicit model + generation profile instead of ad-hoc per-call options,
 * so the owner can re-point ONE mode at another model / thinking budget with
 * an env secret and no deploy.
 *
 * WHY scene THINKS and create/copilot DON'T:
 *   - create + copilot are structured EXTRACTION (pull facts from a chat into
 *     a plan; pick a tool and its args). Thinking adds cost and, worse, a
 *     failure mode: the model can spend its whole output budget "thinking",
 *     hit MAX_TOKENS, and return an EMPTY candidate — the turn then falls
 *     back to the offline reply. thinkingBudget 0 removes both.
 *   - scene is creative DIRECTION (a coordinated frame + filter + 3D piece +
 *     triggers that read as one look, with two/three DISTINCT ideation lines).
 *     A small budget (512) is the bet for that creative step (the bench in
 *     the plan's step 15/17 measures it); its output cap is raised to 4096 so
 *     the plan never competes with the thoughts.
 *   With thinking ON, maxOutputTokens must exceed the budget with room for the
 *   actual answer — resolveProfile enforces `maxOutputTokens > thinkingBudget
 *   + THINKING_HEADROOM` by RAISING maxOutputTokens (never by throwing: a bad
 *   secret must degrade to a working profile, not a 500).
 *   - copy writes four short guest lines ONCE per event (tagline · welcome ·
 *     thank-you · keepsake intro): a tiny creative job, so flash-lite at a
 *     warmer temperature, no thinking, a 15s budget, and the smallest output
 *     cap the headroom invariant allows (1024 = 0 + 2 × THINKING_HEADROOM —
 *     a lower value would be raised to exactly that anyway).
 *
 * Env overrides (all optional, MODE upper-cased: CREATE | COPILOT | SCENE | COPY):
 *   GEMINI_MODEL_<MODE>        model id, /^[a-z0-9.-]+$/i (quotes/whitespace
 *                              stripped — dashboard secrets often carry them)
 *   GEMINI_THINKING_<MODE>     integer 0..8192
 *   GEMINI_TEMPERATURE_<MODE>  number 0..2
 *   GEMINI_MAX_TOKENS_<MODE>   integer 256..8192
 * An invalid value is IGNORED (the default stands) and never throws.
 *
 * This module is deliberately free of edge-runtime globals (no runtime `env`
 * object, no `jsr:` imports): env arrives through a `getEnv` callback so
 * src/lib/agentProfiles.test.ts can import it under vitest AND pull it into
 * `npm run lint` (tsc) — the gate that catches an undeclared identifier,
 * which tsconfig's `supabase` exclude otherwise lets through (the PR #28
 * class). The test asserts the runtime global's name never appears here.
 */

export type AgentMode = 'create' | 'copilot' | 'scene' | 'copy';

export interface AgentProfile {
  /** Gemini model id as it appears in the generateContent URL. */
  model: string;
  /** Lower = more deterministic. Extraction/proposals ~0.2; creative ~0.5-0.6. */
  temperature: number;
  /** 0 disables thinking (thoughts are billed as output tokens). */
  thinkingBudget: number;
  /** Hard cap on output — reply + JSON payload; guards runaway cost. */
  maxOutputTokens: number;
  /** Per-attempt fetch budget; the transport retries once on transient failure. */
  timeoutMs: number;
}

export const AGENT_PROFILES: Record<AgentMode, AgentProfile> = {
  create: { model: 'gemini-2.5-flash', temperature: 0.6, thinkingBudget: 0, maxOutputTokens: 2048, timeoutMs: 25_000 },
  copilot: { model: 'gemini-2.5-flash', temperature: 0.2, thinkingBudget: 0, maxOutputTokens: 3072, timeoutMs: 25_000 },
  scene: { model: 'gemini-2.5-flash', temperature: 0.5, thinkingBudget: 512, maxOutputTokens: 4096, timeoutMs: 40_000 },
  copy: { model: 'gemini-2.5-flash-lite', temperature: 0.7, thinkingBudget: 0, maxOutputTokens: 1024, timeoutMs: 15_000 },
};

/** Output room that must remain above the thinking budget (see header). */
export const THINKING_HEADROOM = 512;

const MODEL_RE = /^[a-z0-9.-]+$/i;
const INT_RE = /^-?\d+$/;

/** Trim + strip one pair of wrapping quotes; undefined when empty/absent. */
function cleanEnv(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().replace(/^["']|["']$/g, '').trim();
  return v === '' ? undefined : v;
}

function envInt(raw: string | undefined, min: number, max: number): number | undefined {
  const v = cleanEnv(raw);
  if (v === undefined || !INT_RE.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
}

function envNumber(raw: string | undefined, min: number, max: number): number | undefined {
  const v = cleanEnv(raw);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

function envModel(raw: string | undefined): string | undefined {
  const v = cleanEnv(raw);
  return v !== undefined && MODEL_RE.test(v) ? v : undefined;
}

/**
 * The profile for a mode after env overrides. Returns a fresh object (never
 * the shared default) and always satisfies the thinking/output invariant.
 */
export function resolveProfile(mode: AgentMode, getEnv: (key: string) => string | undefined): AgentProfile {
  const base = AGENT_PROFILES[mode];
  const suffix = mode.toUpperCase();
  const profile: AgentProfile = {
    model: envModel(getEnv(`GEMINI_MODEL_${suffix}`)) ?? base.model,
    temperature: envNumber(getEnv(`GEMINI_TEMPERATURE_${suffix}`), 0, 2) ?? base.temperature,
    thinkingBudget: envInt(getEnv(`GEMINI_THINKING_${suffix}`), 0, 8192) ?? base.thinkingBudget,
    maxOutputTokens: envInt(getEnv(`GEMINI_MAX_TOKENS_${suffix}`), 256, 8192) ?? base.maxOutputTokens,
    timeoutMs: base.timeoutMs,
  };
  if (profile.maxOutputTokens <= profile.thinkingBudget + THINKING_HEADROOM) {
    // Raise, don't throw — a misconfigured secret must still yield a working profile.
    profile.maxOutputTokens = profile.thinkingBudget + THINKING_HEADROOM * 2;
  }
  return profile;
}
