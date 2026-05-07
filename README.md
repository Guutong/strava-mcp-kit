# strava-mcp-kit

[![npm version](https://img.shields.io/npm/v/@guutong/strava-mcp-kit.svg)](https://www.npmjs.com/package/@guutong/strava-mcp-kit)
[![npm downloads](https://img.shields.io/npm/dm/@guutong/strava-mcp-kit.svg)](https://www.npmjs.com/package/@guutong/strava-mcp-kit)
[![CI](https://github.com/Guutong/strava-mcp-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Guutong/strava-mcp-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

A [Model Context Protocol](https://modelcontextprotocol.io) server for the [Strava v3 API](https://developers.strava.com/docs/reference/). Covers every endpoint in the [public swagger spec](https://developers.strava.com/swagger/swagger.json) — 34 endpoint tools across Athletes, Activities, Segments, Segment Efforts, Clubs, Gear, Routes, Uploads, and Streams (read + write), plus **4 meta tools** for OAuth bootstrap, conventions, and offline endpoint lookup. Every endpoint tool accepts `dry_run: true`.

The server is hand-written on top of the spec (instead of `swagger-codegen`'s bulky generated client). It uses `fetch` directly with Zod-validated tool schemas, which keeps the runtime small and the surface easy to audit.

### Meta tools at a glance

| Tool | Why it matters |
|---|---|
| `strava_api_conventions` | One call returns the Strava conventions cheat sheet — pagination iteration rule, object representations, polylines, dates, status codes, rate limits, scopes. Skip the docs site. |
| `strava_describe_endpoint` | Look up any endpoint's parameters, response, scopes, rate limit, and inline notes (pagination hint, date format, polyline reminder) without making a call. |
| `strava_oauth_authorize_url` | Build the OAuth authorize URL for the user to open in a browser. Works without existing credentials. |
| `strava_oauth_exchange_code` | Exchange the authorization code for access + refresh tokens. Bootstrap a fresh integration in two tool calls. |

## Two modes — pick one (or both)

### Mode 1 — End user (fitness analysis)

Set `STRAVA_*` env vars and every tool calls Strava live. Useful prompts an LLM can answer once connected:

- Weekly **time-in-zone** breakdown → polarized / pyramidal / threshold mix
- **TSS / training load** by intensity × duration
- **HR drift** within a single activity → aerobic decoupling
- **FTP / threshold pace trend** via repeated segment efforts
- **Overtraining** signals from rising recovery HR
- Week-over-week comparisons in distance, intensity, and elevation

### Mode 2 — Developer (Strava SDK assistant)

**No credentials required.** The server boots without any env vars and gives an LLM everything it needs to integrate with Strava without alt-tabbing to the docs:

- `strava_api_conventions` — full conventions cheat sheet (pagination iteration rule, object representations, polylines, dates, status codes, scopes).
- `strava_describe_endpoint` — full OpenAPI spec slice for any endpoint (parameters, response, scopes, rate limits, contextual notes).
- `dry_run: true` — every endpoint tool accepts this flag. When true, the server returns the request descriptor plus copy-pasteable `curl`, TypeScript `fetch`, and Python `requests` snippets. Works for both read and write tools — see exactly how `POST /activities` should send its multipart body before you write any code.
- `strava_oauth_authorize_url` + `strava_oauth_exchange_code` — bootstrap a fresh Strava integration in two tool calls, no curl required.

Ask Claude:

> "Show me how to call `getActivityStreams` for activity 12345 with heartrate and watts. Use dry_run."

## Install

Published to npm as `@guutong/strava-mcp-kit`. Requires Node 18+. CI runs against Node 20 and 22.

Use directly via `npx` (zero install):

```sh
npx -y @guutong/strava-mcp-kit
```

Or install globally:

```sh
npm install -g @guutong/strava-mcp-kit
strava-mcp-kit       # binary name stays unscoped
```

Or develop from source:

```sh
git clone https://github.com/Guutong/strava-mcp-kit.git
cd strava-mcp-kit
npm install
npm run build
```

Or run from source without a build step:

```sh
npm run dev
```

Open the [official MCP inspector](https://github.com/modelcontextprotocol/inspector) pointed at this server:

```sh
npm run inspect
```

## OAuth setup (one time)

### Option A — bootstrap from inside the MCP host (recommended)

Once the server is connected to your LLM client, ask it:

```
1. Use strava_oauth_authorize_url with client_id="12345" and scopes=["read","activity:read_all","profile:read_all"].
   Open the returned URL in a browser, click Authorize, and paste the `code` query parameter back here.

2. Then call strava_oauth_exchange_code with that client_id, my client_secret, and the code.
   Save the refresh_token it returns.
```

The LLM walks you through the redirect (the redirect URL itself fails to load — that is expected). You end up with `access_token`, `refresh_token`, `expires_at`, and the athlete summary in one tool result. Set the refresh token in your MCP host config and you are done.

### Option B — manual curl

1. Create a Strava API application at <https://www.strava.com/settings/api>. Set `Authorization Callback Domain` to `localhost` for dev.
2. Open this URL in a browser, replacing `YOUR_CLIENT_ID`:
   ```
   https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=read,activity:read_all,profile:read_all,activity:write,profile:write
   ```
3. Copy the `code` from the redirect URL bar.
4. Exchange:
   ```sh
   curl -X POST https://www.strava.com/api/v3/oauth/token \
     -d client_id=YOUR_CLIENT_ID -d client_secret=YOUR_CLIENT_SECRET \
     -d code=AUTH_CODE -d grant_type=authorization_code
   ```

### Scopes

| Scope | Required for |
|---|---|
| `read` | Public profile, public clubs, public segments |
| `activity:read_all` | Read all activities including private |
| `profile:read_all` | Athlete weight, FTP, max HR |
| `activity:write` | Tools marked `(w)` — create/update activity, star segment, upload |
| `profile:write` | `strava_update_logged_in_athlete` |

Drop write scopes if you only need read access.

### Configure environment variables

```sh
export STRAVA_CLIENT_ID=12345
export STRAVA_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export STRAVA_REFRESH_TOKEN=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

Shortcut for short experiments: set `STRAVA_ACCESS_TOKEN` directly. Token expires after ~6 hours.

## Use with Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "strava": {
      "command": "npx",
      "args": ["-y", "@guutong/strava-mcp-kit"],
      "env": {
        "STRAVA_CLIENT_ID": "12345",
        "STRAVA_CLIENT_SECRET": "your-client-secret",
        "STRAVA_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

If you cloned from source, point at the local build instead:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/strava-mcp-kit/dist/index.js"]
}
```

Restart Claude Desktop and verify that the `strava_*` tools show up in the tools panel.

## Use with Claude Code

```sh
claude mcp add strava \
  --env STRAVA_CLIENT_ID=... \
  --env STRAVA_CLIENT_SECRET=... \
  --env STRAVA_REFRESH_TOKEN=... \
  -- node /absolute/path/to/strava-mcp-kit/dist/index.js
```

## Tools (38 total)

`(w)` marks a tool that needs `activity:write` or `profile:write` scope.

| Group | Tool | Purpose |
|---|---|---|
| **Meta** | `strava_api_conventions` | Returns the Strava conventions cheat sheet (pagination, dates, polylines, status codes, scopes). No credentials needed. |
|  | `strava_describe_endpoint` | Full OpenAPI spec slice (params, response, scopes, rate limits, contextual notes) — no credentials needed |
|  | `strava_oauth_authorize_url` | Build the OAuth authorize URL for any client_id and scope set |
|  | `strava_oauth_exchange_code` | Exchange the authorization code for access + refresh tokens |
| **Athlete** | `strava_get_logged_in_athlete` | Profile, weight, FTP, max HR |
|  | `strava_update_logged_in_athlete` (w) | Update athlete weight |
|  | `strava_get_logged_in_athlete_zones` | HR / power zones |
|  | `strava_get_athlete_stats` | Year-to-date and all-time totals |
| **Activities** | `strava_get_logged_in_athlete_activities` | List activities (filter with `after` / `before` epoch) |
|  | `strava_get_activity_by_id` | Detailed activity |
|  | `strava_create_activity` (w) | Create a manual activity |
|  | `strava_update_activity_by_id` (w) | Update name, sport_type, gear, etc. |
|  | `strava_get_activity_laps` | Lap data |
|  | `strava_get_activity_zones` | Time-in-zone splits (Strava Summit only) |
|  | `strava_get_activity_streams` | Raw time-series (HR, watts, cadence, latlng, altitude...) |
|  | `strava_get_activity_comments` | Comments |
|  | `strava_get_activity_kudoers` | Athletes who gave kudos |
| **Segments** | `strava_get_segment_by_id` | Segment details |
|  | `strava_get_starred_segments` | Starred segments |
|  | `strava_star_segment` (w) | Star or unstar a segment |
|  | `strava_explore_segments` | Find segments inside a bounding box |
|  | `strava_get_segment_streams` | Streams |
| **Segment Efforts** | `strava_get_segment_efforts` | All your efforts on a segment over time |
|  | `strava_get_segment_effort_by_id` | Single effort |
|  | `strava_get_segment_effort_streams` | Streams |
| **Clubs** | `strava_get_logged_in_athlete_clubs`, `strava_get_club_by_id`, `strava_get_club_members`, `strava_get_club_admins`, `strava_get_club_activities` | Club info |
| **Gear** | `strava_get_gear_by_id` | Bike or shoe details |
| **Routes** | `strava_get_routes_by_athlete`, `strava_get_route_by_id`, `strava_get_route_streams` | Routes |
|  | `strava_export_route_gpx`, `strava_export_route_tcx` | Export route to GPS file |
| **Uploads** | `strava_create_upload` (w) | Upload a GPX/TCX/FIT activity (`dry_run` does not read the file) |
|  | `strava_get_upload_by_id` | Poll upload status |

Every endpoint tool accepts a special `dry_run: boolean` argument. When true, the tool does not call the Strava API; it returns the request descriptor and copy-pasteable code snippets in `curl`, TypeScript, and Python.

### Supported stream keys

`time`, `distance`, `latlng`, `altitude`, `velocity_smooth`, `heartrate`, `cadence`, `watts`, `temp`, `moving`, `grade_smooth`

## Strava API conventions

The single most important rule the LLM should know: **paginate by iterating until you receive an empty array** — Strava can return fewer than `per_page` items even when more pages remain. The full set of conventions (object representations via `resource_state`, polyline encoding, ISO-8601 dates, rate limits, scopes) lives behind the `strava_api_conventions` tool. Call it once at the start of an integration session and the LLM has the rules it needs.

`strava_describe_endpoint` also embeds the relevant subset of these conventions per endpoint as `notes` — pagination warning where applicable, ISO-8601 reminder for date params, multipart hint for upload bodies, polyline reminder for endpoints that return `map.polyline`.

## Example prompts — Developer mode (no credentials)

```
Call strava_api_conventions and show me the pagination rule and rate limits.
```

```
Use strava_describe_endpoint for getActivityStreams. Show me the parameters,
response shape, and which OAuth scope I need.
```

```
Call strava_get_activity_streams with dry_run=true, id=12345678,
keys=["heartrate","watts"]. Give me the Python requests snippet.
```

```
I want to upload a FIT file from my app. Use strava_create_upload with
dry_run, file_path="/tmp/ride.fit", data_type="fit". Show me the multipart
body shape so I can replicate it.
```

Sample dry-run output:

```json
{
  "request": {
    "method": "GET",
    "url": "https://www.strava.com/api/v3/activities/12345678/streams?keys=heartrate%2Cwatts&key_by_type=true",
    "headers": {
      "Authorization": "Bearer <STRAVA_ACCESS_TOKEN>",
      "Accept": "application/json"
    }
  },
  "snippets": {
    "curl": "curl -X GET '...' -H 'Authorization: Bearer <STRAVA_ACCESS_TOKEN>' ...",
    "typescript": "const res = await fetch(...);\nconst data = await res.json();",
    "python": "import requests\n\nurl = '...'\n..."
  },
  "notes": [
    "Authorization header uses a placeholder. Replace <STRAVA_ACCESS_TOKEN> with a real bearer token."
  ]
}
```

## Example prompts — End-user mode (fitness analysis)

```
Pull my last 30 days of activities. Compute total distance, time, and weekly
load. Flag any week-over-week jumps over 10%. Estimate what % of time I
spent in Zone 2 vs Zones 4-5.
```

```
Find the segment I rode most often this month. Compare my last 5 efforts.
Watch pace, average HR, and HR drift. Am I getting fitter or fatigued?
```

```
For activity 12345678, fetch heartrate + watts + velocity_smooth streams.
Build a time-in-zone histogram. Compare TSS to my FTP from
strava_get_logged_in_athlete.
```

## Environment variables

| Var | Required | Description |
|---|---|---|
| `STRAVA_ACCESS_TOKEN` | Either this or the trio below | Short-lived bearer token (~6 hours). |
| `STRAVA_CLIENT_ID` | For refresh-token mode | From your Strava app settings. |
| `STRAVA_CLIENT_SECRET` | For refresh-token mode | From your Strava app settings. |
| `STRAVA_REFRESH_TOKEN` | For refresh-token mode | Long-lived refresh token. |
| `STRAVA_API_BASE_URL` | No | Override API base. Default `https://www.strava.com/api/v3`. |

If you only use developer mode (`dry_run` + `describe_endpoint`) you can leave all of these unset. Live tools then return a clear `Strava credentials missing` error if you forget to pass `dry_run`.

## Project layout

```
src/
├── index.ts          Entry — boots McpServer with stdio transport
├── client.ts         REST client, OAuth refresh, buildRequest() (used by dry_run)
├── snippets.ts       Formats a built request into curl / TypeScript / Python
├── spec.ts           Loads strava-spec.json, exposes describeOperation() with notes
├── conventions.ts    Conventions cheat sheet text + OAuth helpers (URL builder, code exchange)
├── tools.ts          Zod-typed tool registry: 34 endpoint tools + 4 meta tools
└── strava-spec.json  Strava swagger 2.0 spec (copied to dist/ at build time)
tests/                Vitest unit tests (no network, no fetch mocks)
.github/workflows/    CI (typecheck, lint, test, build) + tag-gated npm publish
```

## Contributing

Pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, the descriptor pattern used by every tool, and the step-by-step recipe for adding a new Strava endpoint. Contributors are expected to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). For AI assistants helping on the repo, see [CLAUDE.md](CLAUDE.md).

Quick start for contributors:

```sh
npm install
npm run dev          # run the server with tsx
npm run inspect      # MCP inspector UI
npm run lint:fix     # Biome format + lint with autofix
npm test             # vitest
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, and build on every PR against Node 20 and 22. A tag push (`v*`) additionally publishes to npm — set `NPM_TOKEN` in repo secrets to enable that.

## Troubleshooting

**`Strava credentials missing`**
No env vars set, and `dry_run` was not passed. Either configure `STRAVA_ACCESS_TOKEN` or the `CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN` trio, or pass `dry_run: true`.

**`StravaApiError 401`**
Access token expired and there is no refresh token configured, or the refresh token was revoked. Re-run the OAuth flow.

**`StravaApiError 403`**
Missing scope. Reading a private activity needs `activity:read_all`. Writes need `activity:write` or `profile:write`.

**`StravaApiError 429`**
Rate limit hit. Strava allows 100 requests / 15 min and 1000 / day per access token, shared across all endpoints. Wait until the next 15-minute window or 00:00 UTC.

## Limitations

- `strava_get_activity_zones` requires Strava Summit on the athlete account.
- Stream endpoints default to `key_by_type=true` (matches Strava's own recommendation).
- `strava_get_athlete_stats` only returns data for the authenticated athlete's id.
- The bundled `strava-spec.json` reflects the Strava swagger at the time of release. If the API gains new endpoints, refresh the spec and add a tool — see `CONTRIBUTING.md`.

## License

MIT — see [LICENSE](LICENSE).
