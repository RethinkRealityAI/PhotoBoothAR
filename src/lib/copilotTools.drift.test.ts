/**
 * Drift guard: supabase/functions/ai-event-designer/tools.generated.ts must be
 * exactly what scripts/gen-agent-tools.ts renders from the registry. Importing
 * the generated module here also pulls it into `npm run lint` (tsc), so an
 * undeclared identifier in it cannot reach a deploy (the PR #28 class).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES as GENERATED_TOOL_NAMES, TOOLS_SECTION } from '../../supabase/functions/ai-event-designer/tools.generated.ts';
import { TOOL_NAMES, renderToolsGeneratedFile, renderToolsSection } from './copilotTools';

const generatedPath = new URL('../../supabase/functions/ai-event-designer/tools.generated.ts', import.meta.url);

describe('tools.generated.ts drift', () => {
  it('is byte-identical to renderToolsGeneratedFile() — otherwise run `npm run gen:agent-tools`', () => {
    const file = readFileSync(generatedPath, 'utf8');
    expect(file, 'tools.generated.ts is stale: run `npm run gen:agent-tools` and commit the result').toBe(renderToolsGeneratedFile());
  });

  it('carries the registry\'s TOOL_NAMES in registry order', () => {
    expect([...GENERATED_TOOL_NAMES]).toEqual([...TOOL_NAMES]);
  });

  it('carries the live # Tools section', () => {
    expect(TOOLS_SECTION).toBe(renderToolsSection());
    expect(TOOLS_SECTION.startsWith('# Tools\n')).toBe(true);
  });

  it('is marked generated so nobody edits it by hand', () => {
    const firstLine = readFileSync(generatedPath, 'utf8').split('\n')[0];
    expect(firstLine).toMatch(/@generated/);
    expect(firstLine).toMatch(/DO NOT EDIT/);
    expect(firstLine).toMatch(/npm run gen:agent-tools/);
  });
});
