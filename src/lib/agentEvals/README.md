# Agent evals

- `fixtures/<mode>/<name>.json` — one conversation per file (`copilot` · `create` · `scene`) with the exact snapshot/catalogs the model sees and an `expect` block: `tools` = exact tool set, `toolsAnyOf` = allowed tools, `toolsNoneOf` = tools that must not appear among the RAW proposals (checked before the client normalizer — a forbidden tool the normalizer would drop anyway still fails, because the model proposing it is the defect), `maxActions`, `args`, `planFields`, `asksQuestion`, `scene.hasPlan/shaderId`. Field values may be a literal, `{ "$match": "<regex>" }` (a string must match) or `{ "$notMatch": "<regex>" }` (must miss — on the string, or the JSON of a non-string value such as a pack's `challenges` array). Committed; validated on every CI run by `src/lib/agentEvals.test.ts`.
- `recorded/<model>[-t<thinking>]/<mode>/<name>.json` — the RAW model output for a fixture plus `promptSha256` of the system prompt it answered. Committed after an owner bench run; CI replays each through the client normalizer and fails when the current prompt no longer matches the recording's sha ("re-record: prompt changed").
- `harness.ts` — pure: builds the request through the real `prompt.ts` builders and scores an output with the real normalizers. Bench and test share it.

Counts today: 12 copilot · 5 create · 4 scene. The four `copilot` fixtures added with the Wave A+B brief work cover prompt injection through a challenge title (`injected-challenge-title`), a failed snapshot (`snapshot-failed-no-edits` — no id-based mutation may be proposed), a brief's `avoid` list (`brief-avoid-respected`) and the registry pack route (`pack-by-id` — expects `packId`, which exists only once `add_challenge_pack.packId` lands in `src/lib/copilotTools.ts`); `create/you-decide-fills-plan` covers the deferral rule. Copilot snapshots carry the newer meta fields (`startsAt`, `brief`, `copy`, `defaultExperienceId`, per-challenge `hasCheck`) as plain JSON — the fixture type is cast at load, so a snapshot without them is still valid.

**Copy mode has no fixtures.** It is a single-turn free-text job (four guest lines from a brief) with no tool set, no plan fields and no normalizer to score against; its shape is pinned by `src/lib/agentPrompt.test.ts` (section order, fence last, byte-stable prefix, flat STRING schema) instead.

Record (owner only — needs `GEMINI_API_KEY` in `.env.local`, never CI):

    npm run bench:agent -- --mode copilot,create,scene --models gemini-2.5-flash --thinking 0 --record

Compare models / thinking budgets without recording: drop `--record` and widen `--models` / `--thinking`.
