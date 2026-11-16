/**
 * ai-generate-3d's `studio` add-on gate (migration 039). Edge code is not
 * importable here (it calls Deno.serve at module load), so this pins the
 * gate's TEXT and its ORDER in the request path:
 *   resolver error → 503 (fail closed)  →  aiStudio  →  studio === false  →  spend credits.
 * The gate must compare `=== false`: before 039 is applied the key is absent,
 * and absent has to mean "allowed".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(resolve(__dirname, '../../supabase/functions/ai-generate-3d/index.ts'), 'utf8');

describe('ai-generate-3d studio gate', () => {
  it('blocks only an explicit false, with the existing upgrade_required shape', () => {
    expect(SRC).toMatch(
      /\(features as Record<string, unknown> \| null\)\?\.studio === false\) \{\s*return json\(403, \{ error: 'upgrade_required' \}\);/,
    );
    expect(SRC).not.toMatch(/\.studio !== true/);
    expect(SRC).not.toMatch(/!\s*\(?features[^\n]*\.studio\b/);
  });

  it('sits after the fail-closed resolver check and before any credit is spent', () => {
    const failClosed = SRC.indexOf("return json(503, { error: 'features_unavailable' })");
    const aiStudio = SRC.indexOf('?.aiStudio !== true');
    const studio = SRC.indexOf('?.studio === false');
    const spend = SRC.indexOf("sb.rpc('spend_credits'");
    expect(failClosed).toBeGreaterThan(0);
    expect(aiStudio).toBeGreaterThan(failClosed);
    expect(studio).toBeGreaterThan(aiStudio);
    expect(spend).toBeGreaterThan(studio);
  });
});
