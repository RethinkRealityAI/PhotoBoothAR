/**
 * gen-agent-tools — renders the Platform Copilot's tool registry
 * (src/lib/copilotTools.ts) into the Deno-side module the ai-event-designer
 * prompt imports: supabase/functions/ai-event-designer/tools.generated.ts.
 *
 * Run: npm run gen:agent-tools   (tsx; no build step)
 * Guard: src/lib/copilotTools.drift.test.ts re-renders and compares byte-for-
 * byte, so an edit to the registry without a re-run fails CI in the same PR.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToolsGeneratedFile } from '../src/lib/copilotTools.ts';

const target = fileURLToPath(
  new URL('../supabase/functions/ai-event-designer/tools.generated.ts', import.meta.url),
);
const content = renderToolsGeneratedFile();

try {
  writeFileSync(target, content, 'utf8');
} catch (err) {
  console.error(`gen-agent-tools: could not write ${target}`, err);
  process.exit(1);
}
console.log(`gen-agent-tools: wrote ${target} (${Buffer.byteLength(content, 'utf8')} bytes)`);
