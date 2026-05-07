# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub Release is now created automatically alongside the npm publish on tag pushes (`v*`). Release notes are extracted from the matching `CHANGELOG.md` section, with auto-generated PR list appended below. Pre-release tags (containing `-`, e.g. `v0.2.0-rc.1`) publish to npm under the `next` dist-tag and are marked as pre-releases on GitHub.
- CI workflow now also runs on tag pushes (was previously branch-only, which silently skipped the publish job).
- Git hooks via husky + lint-staged. `pre-commit` runs Biome on staged files; `pre-push` runs typecheck + tests. Installed automatically via the `prepare` script after `npm install`.
- `npm run verify` composite script (lint + typecheck + test + build) — same gate as CI and `prepublishOnly`.
- `strava_api_conventions` meta tool. Returns the canonical Strava conventions cheat sheet — pagination iteration rule, object representations (`resource_state`), polyline encoding, ISO-8601 dates, status codes, rate limits, OAuth scopes. Call once when integrating to avoid common mistakes.
- `strava_oauth_authorize_url` meta tool. Builds the Strava OAuth authorize URL for a given `client_id` and scope list. Works without existing credentials.
- `strava_oauth_exchange_code` meta tool. Exchanges an authorization code for access + refresh tokens. End-to-end OAuth bootstrap from inside the MCP host.
- `notes` field on `strava_describe_endpoint` output. Now includes contextual hints — pagination iteration warning when the endpoint paginates, ISO-8601 reminder for date params, multipart hint for upload bodies, polyline reminder for endpoints that return `map.polyline`.
- Pagination iteration hint inlined in the Zod description of every paginated tool, so the LLM sees the rule without an extra tool call.

### Changed

- `src/spec.ts` now resolves `$ref` parameters from `spec.parameters` (e.g. `#/parameters/page`, `#/parameters/perPage`) so describe output and notes see the real parameter shapes instead of empty `{$ref}` objects.

## [0.1.0] - 2026-05-07

### Added

- MCP server (stdio transport) wrapping the Strava v3 API.
- 34 tools covering every operation in the public Strava swagger spec — Athletes, Activities, Segments, Segment Efforts, Clubs, Gear, Routes, Uploads, Streams (read + write).
- `dry_run: true` flag on every endpoint tool. When set, no API call is made; the tool returns the request descriptor plus copy-pasteable `curl`, TypeScript `fetch`, and Python `requests` snippets.
- `strava_describe_endpoint` meta tool. Looks up an MCP tool name or Strava `operationId` and returns the OpenAPI spec slice (parameters, response codes, recommended OAuth scopes, rate-limit note, doc link). Works without credentials.
- OAuth refresh-token flow with automatic access-token renewal. Static `STRAVA_ACCESS_TOKEN` mode also supported for quick experiments.
- `StravaApiError` typed error class surfaces HTTP status, URL, and response body for non-2xx responses.
- Bundled `strava-spec.json` (Strava swagger 2.0) so describe and dry-run work offline.
- Vitest unit tests for client, snippet formatters, and spec lookup.
- Biome formatter + linter, GitHub Actions CI (Node 20 and 22), and tag-gated npm publish workflow.
