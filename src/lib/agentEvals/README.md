# Agent evals

- `fixtures/<mode>/<name>.json` — one conversation per file (`copilot` · `create` · `scene`) with the exact snapshot/catalogs the model sees and an `expect` block (`tools` = exact tool set, `toolsAnyOf` = allowed tools, `maxActions`, `args`, `planFields`, `asksQuestion`, `scene.hasPlan/shaderId`). Committed; validated on every CI run by `src/lib/agentEvals.test.ts`.
- `recorded/<model>[-t<thinking>]/<mode>/<name>.json` — the RAW model output for a fixture plus `promptSha256` of the system prompt it answered. Committed after an owner bench run; CI replays each through the client normalizer and fails when the current prompt no longer matches the recording's sha ("re-record: prompt changed").
- `harness.ts` — pure: builds the request through the real `prompt.ts` builders and scores an output with the real normalizers. Bench and test share it.

Record (owner only — needs `GEMINI_API_KEY` in `.env.local`, never CI):

    npm run bench:agent -- --mode copilot,create,scene --models gemini-2.5-flash --thinking 0 --record

Compare models / thinking budgets without recording: drop `--record` and widen `--models` / `--thinking`.
