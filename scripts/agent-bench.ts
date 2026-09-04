/**
 * agent-bench — replays src/lib/agentEvals fixtures against Gemini with the
 * EXACT request the ai-event-designer edge fn sends (same prompt builders,
 * schema, generationConfig and header), scores each answer with the client
 * normalizers, and prints one markdown table per mode × model × thinking.
 *
 * OWNER-RUN ONLY: needs GEMINI_API_KEY (env or .env.local) and spends real
 * quota; nothing in CI invokes it. `--record` writes the raw outputs to
 * src/lib/agentEvals/recorded/ so src/lib/agentEvals.test.ts can replay them.
 *
 *   npm run bench:agent -- --mode copilot,scene --models gemini-2.5-flash,gemini-2.5-flash-lite --thinking 0,512 [--record] [--fixtures <glob>]
 */
import { config as loadDotenv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProfile, type AgentMode } from '../supabase/functions/ai-event-designer/profiles.ts';
import {
  MODES, RECORDED_DIR, buildRequest, evaluate, loadFixtures, promptSha256,
  type LoadedFixture, type Recording,
} from '../src/lib/agentEvals/harness.ts';

const USAGE = `Usage: npm run bench:agent -- [--mode copilot,create,scene] [--models gemini-2.5-flash,gemini-2.5-flash-lite]
                            [--thinking 0,512] [--record] [--fixtures <glob>] [--help]
  --mode      comma list of modes (default: all three)
  --models    comma list of Gemini model ids (default: each mode's profile model)
  --thinking  comma list of thinking budgets (default: each mode's profile budget)
  --record    write raw outputs to src/lib/agentEvals/recorded/<model>[-t<thinking>]/<mode>/<fixture>.json
  --fixtures  glob on "<mode>/<name>" (e.g. "copilot/*", "*/jungle*")
Reads GEMINI_API_KEY from the environment or .env.local. Owner-run only — never CI.`;

interface Args { modes: AgentMode[]; models: string[] | null; thinking: number[] | null; record: boolean; fixtures: RegExp | null }

function parseArgs(argv: string[]): Args {
  const args: Args = { modes: [...MODES], models: null, thinking: null, record: false, fixtures: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (a === '--record') args.record = true;
    else if (a === '--mode') {
      args.modes = val().split(',').map((m) => m.trim()).filter(Boolean) as AgentMode[];
      for (const m of args.modes) if (!MODES.includes(m)) throw new Error(`unknown mode "${m}" (copilot | create | scene)`);
    } else if (a === '--models') args.models = val().split(',').map((m) => m.trim()).filter(Boolean);
    else if (a === '--thinking') {
      args.thinking = val().split(',').map((t) => Number(t.trim()));
      if (args.thinking.some((t) => !Number.isSafeInteger(t) || t < 0)) throw new Error('--thinking takes non-negative integers');
    } else if (a === '--fixtures') args.fixtures = new RegExp(`^${val().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    else throw new Error(`unknown argument "${a}"\n${USAGE}`);
  }
  return args;
}

function loadKey(): string | null {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  loadDotenv({ path: join(root, '.env.local'), quiet: true });
  const key = process.env.GEMINI_API_KEY?.trim().replace(/^["']|["']$/g, '');
  return key ? key : null;
}

interface Sample { latencyMs: number; validJson: boolean; hit: boolean; dropped: number; usage: Record<string, number | null> | null; error: string | null }

/** One Gemini call — the edge fn's request shape byte-for-byte (index.ts callGemini), no retry. */
async function callGemini(key: string, f: LoadedFixture, model: string, thinking: number, record: boolean): Promise<Sample> {
  const M = f.mode.toUpperCase();
  const profile = resolveProfile(f.mode, (k) => (k === `GEMINI_MODEL_${M}` ? model : k === `GEMINI_THINKING_${M}` ? String(thinking) : undefined));
  const req = buildRequest(f.fixture);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.systemPrompt }] },
    contents: req.contents,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: req.schema,
      temperature: profile.temperature,
      maxOutputTokens: profile.maxOutputTokens,
      thinkingConfig: { thinkingBudget: profile.thinkingBudget },
    },
  });
  const started = Date.now();
  const fail = (error: string): Sample => ({ latencyMs: Date.now() - started, validJson: false, hit: false, dropped: 0, usage: null, error });
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${profile.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.timeout(profile.timeoutMs),
    });
  } catch (e) {
    return fail(`network: ${(e as Error).name}`);
  }
  if (!res.ok) return fail(`http_${res.status}: ${(await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ')}`);
  const latencyMs = Date.now() - started;
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: Record<string, unknown>;
  };
  const text = json.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const um = json.usageMetadata;
  const usage = um
    ? { promptTokens: num(um.promptTokenCount), outputTokens: num(um.candidatesTokenCount), cachedTokens: num(um.cachedContentTokenCount), thoughtsTokens: num(um.thoughtsTokenCount) }
    : null;
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? '');
  } catch {
    return { latencyMs, validJson: false, hit: false, dropped: 0, usage, error: null };
  }
  const verdict = evaluate(f.fixture, raw);
  if (record) {
    const rec: Recording = { recordedAt: new Date().toISOString(), model, thinkingBudget: thinking, promptSha256: promptSha256(req.systemPrompt), raw, usage };
    const path = join(RECORDED_DIR, thinking > 0 ? `${model}-t${thinking}` : model, f.mode, `${f.name}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(rec, null, 2) + '\n');
  }
  if (verdict.failures.length > 0) console.error(`  ✗ ${model} t${thinking} ${f.key}: ${verdict.failures.join(' · ')}`);
  return { latencyMs, validJson: verdict.validJson, hit: verdict.failures.length === 0, dropped: verdict.dropped, usage, error: null };
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((100 * n) / d)}%`);
const quantile = (xs: number[], q: number) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]);
const sum = (ss: Sample[], k: string) => ss.reduce((acc, s) => acc + (s.usage?.[k] ?? 0), 0);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const key = loadKey();
  if (!key) {
    console.error('agent-bench: GEMINI_API_KEY is not set.\n  Put GEMINI_API_KEY=... in .env.local (gitignored) or export it before running.\n  This bench calls Gemini and spends quota — it is owner-run only and never part of CI.');
    process.exit(2);
  }
  const all = loadFixtures().filter((f) => args.modes.includes(f.mode) && (args.fixtures === null || args.fixtures.test(f.key)));
  if (all.length === 0) { console.error('agent-bench: no fixtures match'); process.exit(2); }

  // Every fixture × model × thinking, run 2 at a time with ≥1s between starts (rate limits).
  const jobs: { f: LoadedFixture; model: string; thinking: number }[] = [];
  for (const f of all) {
    const profile = resolveProfile(f.mode, () => undefined);
    for (const model of args.models ?? [profile.model]) for (const thinking of args.thinking ?? [profile.thinkingBudget]) jobs.push({ f, model, thinking });
  }
  console.log(`agent-bench: ${all.length} fixtures × ${jobs.length / all.length} configs = ${jobs.length} requests${args.record ? ' (recording)' : ''}`);
  const results = new Map<string, Sample[]>();
  let next = 0;
  let lastStart = 0;
  let errored = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const wait = lastStart + 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      const sample = await callGemini(key, job.f, job.model, job.thinking, args.record);
      if (sample.error) { errored++; console.error(`  ! ${job.model} t${job.thinking} ${job.f.key}: ${sample.error}`); }
      const k = `${job.f.mode}|${job.model}|${job.thinking}`;
      results.set(k, [...(results.get(k) ?? []), sample]);
    }
  };
  await Promise.all([worker(), worker()]);

  console.log('\n| mode | model | thinking | n | valid JSON | expected hit | dropped | p50 ms | p95 ms | prompt tok | output tok | cached tok | thoughts tok | errors |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, ss] of [...results.entries()].sort()) {
    const [mode, model, thinking] = k.split('|');
    const ok = ss.filter((s) => s.error === null);
    const lat = ok.map((s) => s.latencyMs);
    console.log(`| ${mode} | ${model} | ${thinking} | ${ss.length} | ${pct(ok.filter((s) => s.validJson).length, ok.length)} | ${pct(ok.filter((s) => s.hit).length, ok.length)} | ${ok.reduce((a, s) => a + s.dropped, 0)} | ${quantile(lat, 0.5)} | ${quantile(lat, 0.95)} | ${sum(ok, 'promptTokens')} | ${sum(ok, 'outputTokens')} | ${sum(ok, 'cachedTokens')} | ${sum(ok, 'thoughtsTokens')} | ${ss.length - ok.length} |`);
  }
  if (args.record) console.log(`\nrecorded under ${RECORDED_DIR} — commit them; npx vitest run src/lib/agentEvals.test.ts replays them.`);
  if (errored > 0) { console.error(`\nagent-bench: ${errored} request(s) errored`); process.exit(1); }
}

main().catch((e) => { console.error(`agent-bench: ${(e as Error).message}`); process.exit(2); });
