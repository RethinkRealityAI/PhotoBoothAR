/**
 * Agent evals — deterministic in CI.
 *
 * (a) ALWAYS: every fixture under src/lib/agentEvals/fixtures/<mode>/ is
 *     well-formed, references real tool names / catalog ids / snapshot ids,
 *     alternates roles ending on the host, and builds its prompt through the
 *     REAL prompt.ts builders.
 * (b) WHEN src/lib/agentEvals/recorded/** has files (written by
 *     `npm run bench:agent -- --record`, owner-run against Gemini): each raw
 *     model output is replayed through the client normalizer and scored
 *     against its fixture's expectations, and its promptSha256 must match the
 *     CURRENT prompt — a prompt edit makes every stale recording a red test
 *     that says how to re-record.
 */
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from './copilotTools';
import { EVENT_TEMPLATES } from './eventTemplates';
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECE_MAP } from './headPieces';
import { GENERIC_FRAME_IDS } from './borders';
import {
  MODES,
  buildRequest,
  evaluate,
  loadFixtures,
  loadRecordings,
  promptSha256,
  type LoadedFixture,
} from './agentEvals/harness';

const RECORD_CMD = 'npm run bench:agent -- --record';
const fixtures = loadFixtures();
const byKey = new Map(fixtures.map((f) => [f.key, f]));
const toolNames: readonly string[] = TOOL_NAMES;
const filterIds = new Set(FILTER_SHADERS.map((s) => s.id));
const templateIds = new Set(EVENT_TEMPLATES.map((t) => t.id));

/** The body of one `# Title` section (same helper agentPrompt.test.ts uses). */
const sectionBody = (prompt: string, title: string): string => {
  const start = prompt.indexOf(`# ${title}\n`);
  if (start < 0) return '';
  const rest = prompt.slice(start + title.length + 3);
  const next = rest.search(/\n# /);
  return next < 0 ? rest : rest.slice(0, next);
};

describe('agentEvals fixtures (always)', () => {
  it('ships 8 copilot, 4 create and 4 scene fixtures', () => {
    const count = (mode: string) => fixtures.filter((f) => f.mode === mode).length;
    expect(count('copilot')).toBe(8);
    expect(count('create')).toBe(4);
    expect(count('scene')).toBe(4);
  });

  for (const f of fixtures) {
    describe(f.key, () => {
      const fx = f.fixture;

      it('has a valid mode and the file lives under that mode', () => {
        expect(MODES).toContain(fx.mode);
        expect(fx.mode).toBe(f.mode);
      });

      it('messages alternate user/assistant and end with the host', () => {
        expect(fx.messages.length).toBeGreaterThan(0);
        fx.messages.forEach((m, i) => {
          expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
          expect(m.content.trim()).not.toBe('');
        });
        expect(fx.messages[fx.messages.length - 1].role).toBe('user');
      });

      it('expects only real tool names', () => {
        for (const t of [...(fx.expect.tools ?? []), ...(fx.expect.toolsAnyOf ?? []), ...Object.keys(fx.expect.args ?? {})]) {
          expect(toolNames).toContain(t);
        }
      });

      it('references only real catalog ids and snapshot ids', () => {
        for (const c of fx.catalogs?.filters ?? []) expect(filterIds.has(c.id)).toBe(true);
        for (const c of fx.catalogs?.headPieces ?? []) expect(HEAD_PIECE_MAP[c.id]).toBeDefined();
        for (const c of fx.catalogs?.frames ?? []) expect(GENERIC_FRAME_IDS.has(c.id)).toBe(true);
        for (const s of fx.shaderCatalog ?? []) expect(filterIds.has(s.id)).toBe(true);
        for (const id of fx.headPieceIds ?? []) expect(HEAD_PIECE_MAP[id]).toBeDefined();
        for (const t of fx.templates ?? []) expect(templateIds.has(t.id as never)).toBe(true);
        if (fx.expect.scene?.shaderId !== undefined) {
          expect((fx.shaderCatalog ?? []).some((s) => s.id === fx.expect.scene?.shaderId)).toBe(true);
        }
        // Ids an expectation names must exist in the snapshot the model sees.
        const challengeIds = new Set((fx.snapshot?.challenges ?? []).map((c) => c.id));
        const experienceIds = new Set((fx.snapshot?.experiences ?? []).map((e) => e.id));
        for (const args of Object.values(fx.expect.args ?? {})) {
          if (typeof args.challengeId === 'string') expect(challengeIds.has(args.challengeId)).toBe(true);
          if (typeof args.experienceId === 'string') expect(experienceIds.has(args.experienceId)).toBe(true);
        }
      });

      it('copilot fixtures carry a snapshot; scene shaderId expectations are in the catalog', () => {
        if (fx.mode === 'copilot') expect(fx.snapshot).toBeDefined();
      });

      it('builds its prompt through the real builders without throwing', () => {
        const req = buildRequest(fx);
        expect(req.systemPrompt.length).toBeGreaterThan(500);
        expect(req.contents).toHaveLength(fx.messages.length);
        expect(req.contents[req.contents.length - 1].role).toBe('user');
        expect(promptSha256(req.systemPrompt)).toMatch(/^[0-9a-f]{64}$/);
        if (fx.mode === 'copilot') {
          const tools = sectionBody(req.systemPrompt, 'Tools');
          for (const t of [...(fx.expect.tools ?? []), ...(fx.expect.toolsAnyOf ?? [])]) {
            expect(tools).toMatch(new RegExp(`^- ${t} `, 'm'));
          }
          if (fx.snapshot) expect(req.systemPrompt).toContain(`slug ${fx.snapshot.slug}`);
        }
      });
    });
  }
});

describe('agentEvals recordings (when present)', () => {
  const recordings = loadRecordings();

  if (recordings.length === 0) {
    console.info(`[agentEvals] no recordings yet — run ${RECORD_CMD}`);
  }

  it('every recording names a fixture that still exists', () => {
    for (const r of recordings) expect(byKey.has(r.key), `${r.path}: no fixture ${r.key}`).toBe(true);
  });

  for (const r of recordings) {
    const f: LoadedFixture | undefined = byKey.get(r.key);
    if (!f) continue;

    describe(`${r.run} · ${r.key}`, () => {
      it(`was recorded against the CURRENT prompt (else re-record: prompt changed — run ${RECORD_CMD})`, () => {
        const current = promptSha256(buildRequest(f.fixture).systemPrompt);
        expect(
          r.recording.promptSha256,
          `re-record: prompt changed — run ${RECORD_CMD} (${r.path})`,
        ).toBe(current);
      });

      it('meets the fixture expectations after the client normalizer', () => {
        const verdict = evaluate(f.fixture, r.recording.raw);
        expect(verdict.validJson, `invalid model JSON in ${r.path}`).toBe(true);
        expect(verdict.failures, `${r.path}: ${verdict.failures.join(' · ')}`).toEqual([]);
      });
    });
  }
});
