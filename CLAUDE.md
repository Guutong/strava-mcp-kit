# CLAUDE.md

Instructions for Claude Code (and other AI assistants) working on this repository.

## What this project is

`strava-mcp-kit` is an MCP server that wraps every operation in the Strava v3 API. It serves two audiences in one binary:

- **End users** with credentials: every tool calls Strava and returns real data.
- **Developers** without credentials: the `dry_run: true` flag and `strava_describe_endpoint` meta tool let an LLM teach Strava's API surface and emit copy-pasteable code.

Treat both audiences as first-class. Do not break either when changing code.

## Architecture map

| File | Responsibility | Do |
|---|---|---|
| `src/index.ts` | Boot McpServer, read env, attach stdio transport. | Keep tiny. |
| `src/client.ts` | All HTTP for the Strava REST API. `request()` for live, `buildRequest()` for dry_run, `ensureAccessToken()` for OAuth refresh. | All `fetch` calls for `/api/v3/*` live here. |
| `src/snippets.ts` | Pure formatter: `BuiltRequest` → curl / TypeScript / Python text. | Pure functions only. |
| `src/spec.ts` | Loads bundled `strava-spec.json` once at startup. Resolves `$ref` parameters. Exposes `describeOperation` (with `notes`) and `listOperationIds`. | No network. |
| `src/conventions.ts` | Strava conventions cheat-sheet text + OAuth helpers (`buildAuthorizeUrl`, `exchangeAuthorizationCode`). The OAuth helpers are the only place outside `client.ts` that hits Strava — they target the `/oauth/*` endpoints, not `/api/v3/*`. | Keep the conventions text in sync with the Strava docs. |
| `src/tools.ts` | One Zod-typed tool registration per Strava operation, plus 4 meta tools (`strava_api_conventions`, `strava_describe_endpoint`, `strava_oauth_authorize_url`, `strava_oauth_exchange_code`). The wrapper auto-injects `dry_run` and routes to live or snippet output. | Heavy lifting goes here. |

## Tool registration pattern

Every Strava endpoint follows this shape:

```ts
add({
  name: "strava_get_activity_by_id",
  description: "Get a detailed activity by id.",
  schema: {
    id: z.number().int().describe("Activity id."),
    include_all_efforts: z.boolean().optional(),
  },
  build: ({ id, include_all_efforts }) => ({
    path: `/activities/${id}`,
    opts: { query: { include_all_efforts } },
  }),
});
```

`build()` returns a request descriptor `{ path, opts }`. It does NOT call fetch. The dispatcher decides whether to execute (live) or format snippets (dry_run).

`build()` may be async and accept a second `BuildContext` argument when needed (e.g. file uploads — read the file only when not in dry_run). Keep this opt-in; most tools stay sync.

## How to add a new endpoint

1. Refresh `src/strava-spec.json` from <https://developers.strava.com/swagger/swagger.json> if needed.
2. Add `tool_name` -> `operationId` to the `TOOL_TO_OPERATION` map in `src/tools.ts`.
3. Add an `add({...})` block following the pattern above.
4. Update the tool table in `README.md` and add a `## [Unreleased]` line in `CHANGELOG.md`.
5. Run `npm run typecheck && npm run lint && npm test && npm run build`.

## Meta tools — what they exist for

The non-endpoint tools are not optional decoration; they replace docs lookups for the LLM.

- `strava_api_conventions` — returns the canonical conventions text. The pagination iteration rule is the most easily-missed detail; this tool exists so the LLM never has to guess.
- `strava_describe_endpoint` — returns the OpenAPI slice plus `notes` (pagination, ISO-8601, multipart, polyline reminders) computed in `src/spec.ts`.
- `strava_oauth_authorize_url` and `strava_oauth_exchange_code` — let an LLM walk a user through OAuth bootstrap from inside the host. They live in `conventions.ts` rather than `client.ts` because they target the OAuth endpoints, not the v3 API.

When you add a feature that the LLM should be aware of (new convention, new common pitfall, new scope), update either `STRAVA_CONVENTIONS_TEXT` in `src/conventions.ts` or `notesFor()` in `src/spec.ts` so it surfaces through the meta tools.

## What NOT to do

- Do NOT call `fetch` outside `src/client.ts` — except in `src/conventions.ts` where the OAuth bootstrap helpers explicitly target `https://www.strava.com/oauth/*`.
- Do NOT add `dry_run` to a tool's schema — the wrapper injects it.
- Do NOT add backward-compat shims, feature flags, or speculative abstractions for endpoints Strava has not yet shipped.
- Do NOT use `console.log`. The MCP transport uses stdout for JSON-RPC. Diagnostics go to `process.stderr.write`.
- Do NOT add `any`. Use `unknown` and narrow.
- Do NOT introduce a second HTTP client, state-management library, or build tool. Keep dependencies minimal.
- Do NOT bundle codegen output (e.g. `swagger-codegen` clients). The hand-written wrapper is intentional.
- Do NOT add emojis to source files or commit messages.

## Testing expectations

- Unit tests live under `tests/`. They must not hit the network.
- For new endpoints, add a `describeOperation('newOpId')` assertion in `tests/spec.test.ts`.
- For new body shapes (multipart with new field types, etc.), add a snippet shape test in `tests/snippets.test.ts`.
- `tests/client.test.ts` exercises `buildRequest()` only. We do not mock `fetch`.

## Cross-references

- Coding style and full PR checklist: `CONTRIBUTING.md`.
- Audience-facing docs: `README.md`.
- Release notes: `CHANGELOG.md`.
