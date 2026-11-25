# Beamwall MCP — the Claude connector

`supabase/functions/beamwall-mcp` is a remote MCP server. With it connected,
Claude can make routine platform changes directly — create and configure
events, upload frames and 3D models, add looks and challenges, attach
shared-library props, run admin-suite actions — with no code change or deploy.

## Connect it (2 minutes)
1. Sign in at **beamwall.app/admin/connector** (platform admins only).
2. **Create connector link**: name it, pick what Claude may do
   (*Look only* · *Make changes* · *Full admin*), pick an expiry. The link is
   shown **once** — the database keeps only its SHA-256.
3. In Claude: **Settings → Connectors → Add custom connector**. Name
   "Beamwall", paste the link as the URL, leave OAuth empty.
4. Turn the connector on in a chat or project and ask, e.g. *"Create a test
   event called Gold Night, add a gold frame, and give me the booth link."*

Claude Code: `claude mcp add --transport http beamwall https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/beamwall-mcp --header "Authorization: Bearer <key>"`.

The key can sit in the URL path (claude.ai custom connectors cannot send
headers), a `Bearer` header, `x-beamwall-token`, or `?key=`.

## Tools
| Tool | Scope | What it does |
|---|---|---|
| `beamwall_guide` | read | Data model, config keys, recipes. Claude reads this first. |
| `list_events` / `get_event` | read | Find events; one event with config, looks, library links, challenges, flags, links. |
| `list_library` / `get_look` | read | Search the shared library; one look in full (template for new looks). |
| `list_changes` | read | Audit log of MCP calls, with change ids. |
| `create_event` | write | Draft event in the owner's org (deluxe by default). `test: true` → `zz-test-` slug. |
| `update_event` | write | Name/type/dates + JSON Merge Patch on `config` (known keys only). `dry_run`. |
| `set_event_status` | write | draft/live/ended/archived. Leaving *live* needs `confirm` = slug. |
| `upload_asset` | write | PNG/JPG/WebP/SVG/GLB/GLTF from https URL (≤50 MB) or base64 (≤8 MB) → public URL. |
| `add_look` / `update_look` | write | Event-owned looks (border, 2d_filter, shader, 3d_attachment, composite). |
| `attach_library_look` / `detach_library_look` | write | Library prop on/off for an event. |
| `add_challenge` / `update_challenge` | write | Photo missions. |
| `remove_look` / `remove_challenge` | destructive | Delete, `confirm` = id. Undoable. |
| `undo_change` | destructive | Restore a row from its snapshot, `confirm` = change id. Refuses if edited since (unless `force`). |
| `admin_action` | admin | Allow-listed admin-api actions (library publish/drafts/categories, flags, tiers, landing CMS…). Kill switches and deletions need `confirm` = action name. |

**Never reachable**: password resets, bans, credit grants, admin membership,
Stripe sync, paid plan changes, catalog prices. Those stay human-only in /admin.

## Security model
- verify_jwt **OFF**; the function authenticates every request itself before
  any method runs: key → SHA-256 → `mcp_tokens` (not revoked/expired) → owner
  still `is_platform_admin` → per-key rate limit (120 tool calls/min).
- Every `tools/call` (reads too) writes one `mcp_audit` row: redacted args
  (base64 bodies replaced by their size), status, and for writes the row
  before and after. `/admin/connector` shows the log.
- `admin_action` calls admin-api AS the key's owner, with a short-lived session
  minted server-side (auth.admin.generateLink → verifyOtp, nothing emailed,
  reused until a minute before expiry). admin-api is unchanged: it still
  verifies the JWT and asserts platform_admins itself. This shows up as a
  sign-in for the owner in Supabase auth logs.
- Uploads: https only, private/link-local hosts refused, redirects re-checked,
  magic bytes must match the extension.

## Files
`core.ts` (pure: tool registry, validation, merge patch, SSRF guard, undo
planner — tested by `src/lib/beamwallMcp.test.ts`) · `index.ts` (transport,
auth, handlers, audit) · `deno.json`. **Deploy all three files**, verify_jwt
false. Tables + RPCs: migration `056_mcp_access`.

## Adding a tool
Add a `ToolDef` to `TOOLS` in core.ts and a handler of the same name in
index.ts; return `{ table, targetId, before, after }` for writes so the change
is undoable. The vitest suite checks names, required args and confirm args.
