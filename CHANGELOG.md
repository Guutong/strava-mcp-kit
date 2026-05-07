# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-05-07

### Changed

- Publish job now authenticates via npm Trusted Publisher (OIDC) — no long-lived `NPM_TOKEN` secret is required — and emits a [Sigstore provenance attestation](https://docs.npmjs.com/generating-provenance-statements) (`npm publish --provenance`). The npm package page shows a "Provenance" badge linking each tarball to the exact GitHub Actions run that built it.
- CI now upgrades to the latest `npm` before publishing because the runner-default npm is too old to auto-exchange the GitHub Actions OIDC token for a Trusted Publisher token.

## [0.1.2] - 2026-05-07

### Added

- Ship TypeScript `.d.ts` declarations and source-mapped declaration files so anyone embedding the server programmatically (`import { StravaClient } from "@guutong/strava-mcp-kit/client"`) gets full types and click-through in IDEs.
- Subpath exports for the public modules: `client`, `tools`, `conventions`, `spec`, `snippets`, plus the default entry. The CLI binary `strava-mcp-kit` is unchanged.
- README "types: TypeScript" badge backed by the npm registry's `types` field.

## [0.1.1] - 2026-05-07

### Changed

- Published to npm under the scoped name `@guutong/strava-mcp-kit`. Use `npx -y @guutong/strava-mcp-kit` or `npm install -g @guutong/strava-mcp-kit`. The unscoped binary name stays `strava-mcp-kit`.

### Added

- `release:patch`, `release:minor`, `release:major` scripts that bump the version, create an annotated `vX.Y.Z` tag, and push with `--follow-tags`. The push triggers CI, npm publish, and GitHub Release in one go.

## [0.1.0] - 2026-05-07

Initial release.

### Added — MCP server

- MCP server (stdio transport) wrapping the Strava v3 API.
- 34 endpoint tools covering every operation in the public Strava swagger spec — Athletes, Activities, Segments, Segment Efforts, Clubs, Gear, Routes, Uploads, Streams (read + write).
- 4 meta tools:
  - `strava_describe_endpoint` — looks up an MCP tool name or Strava `operationId` and returns the OpenAPI spec slice (parameters, response codes, recommended OAuth scopes, rate-limit note, doc link, contextual notes). Works without credentials.
  - `strava_api_conventions` — returns the canonical Strava conventions cheat sheet (pagination iteration rule, `resource_state` levels, polyline encoding, ISO-8601 dates, status codes, rate limits, OAuth scopes).
  - `strava_oauth_authorize_url` — builds the Strava OAuth authorize URL for a given `client_id` and scope list. Works without existing credentials.
  - `strava_oauth_exchange_code` — exchanges an authorization code for access + refresh tokens. Enables end-to-end OAuth bootstrap from inside the MCP host.

### Added — developer experience

- `dry_run: true` flag on every endpoint tool. When set, no API call is made; the tool returns the request descriptor plus copy-pasteable `curl`, TypeScript `fetch`, and Python `requests` snippets. Works for read and write tools, including multipart uploads (file is not read in dry-run).
- Pagination iteration hint inlined in the Zod description of every paginated tool, so the LLM sees the rule without an extra tool call.
- `notes` field on `strava_describe_endpoint` output. Includes contextual hints — pagination iteration warning when the endpoint paginates, ISO-8601 reminder for date params, multipart hint for upload bodies, polyline reminder for endpoints that return `map.polyline`.

### Added — runtime

- OAuth refresh-token flow with automatic access-token renewal. Static `STRAVA_ACCESS_TOKEN` mode also supported for quick experiments.
- `StravaApiError` typed error class surfaces HTTP status, URL, and response body for non-2xx responses.
- Bundled `strava-spec.json` (Strava swagger 2.0) so `describe_endpoint` and `dry_run` work offline.
- `src/spec.ts` resolves `$ref` parameters from `spec.parameters` (e.g. `#/parameters/page`, `#/parameters/perPage`) so describe output sees real parameter shapes instead of `$ref` placeholders.

### Added — tooling

- Biome formatter + linter (`npm run lint`, `npm run lint:fix`).
- Vitest unit tests for client, snippet formatters, spec lookup, conventions, and per-endpoint notes (50 tests).
- `npm run verify` composite script (lint + typecheck + test + build) — same gate as CI and `prepublishOnly`.
- Husky + lint-staged. `pre-commit` runs Biome on staged files; `pre-push` runs typecheck + tests. Installed automatically by the `prepare` script after `npm install`.
- GitHub Actions CI runs typecheck, lint, test, and build against Node 20 and 22 on every push to `main`, every pull request, and every `v*` tag push.
- Tag-gated release workflow. On `v*` tag push, CI runs and then the `publish` job runs `npm publish --access public` and creates a GitHub Release with notes extracted from this changelog. Pre-release tags (containing `-`, e.g. `v0.2.0-rc.1`) publish under the `next` dist-tag and are marked as pre-releases on GitHub.
