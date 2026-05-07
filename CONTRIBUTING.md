# Contributing to strava-mcp-kit

Thanks for considering a contribution. This project aims to be a small, well-typed MCP server that mirrors the Strava v3 API one-to-one. Contributions that keep the surface aligned with the Strava swagger spec are especially welcome.

## Project layout

```
src/
├── index.ts          entry point — wires McpServer + stdio transport
├── client.ts         Strava REST client, OAuth refresh, buildRequest() (used by dry_run)
├── snippets.ts       formats a built request into curl / TypeScript / Python snippets
├── spec.ts           loads strava-spec.json, exposes describeOperation()
├── tools.ts          Zod-typed tool registry: 34 endpoint tools + describe meta tool
└── strava-spec.json  Strava swagger 2.0 spec (copied to dist/ on build)
tests/                vitest unit tests (no network)
.github/workflows/    CI (typecheck, lint, test, build) + tag-gated npm publish
```

## Dev setup

Requires Node 18+ (CI runs against 20 and 22). Recommended: 20.

```sh
git clone <your-fork>
cd strava-mcp-kit
npm install
npm run dev          # run the server with tsx (no build step)
npm run inspect      # open the official MCP inspector pointed at this server
```

A working tool round-trip needs Strava credentials, but the developer-mode features (`dry_run` flag and `strava_describe_endpoint`) work without any credentials.

## Adding a new Strava endpoint

When Strava extends their API:

1. Refresh `src/strava-spec.json` from <https://developers.strava.com/swagger/swagger.json>.
2. Open `src/tools.ts`.
3. Add an entry to the `TOOL_TO_OPERATION` map mapping the new MCP tool name to Strava's `operationId`.
4. Add a tool registration block in `buildTools()`:

   ```ts
   add({
     name: "strava_get_something_new",
     description: "One-line description Claude will see.",
     schema: {
       id: z.number().int().describe("Resource id."),
     },
     build: ({ id }) => ({
       path: `/something/${id}`,
       opts: { query: { /* ... */ } },
     }),
   });
   ```

5. The `dry_run` flag is injected automatically by the registration wrapper — do not add it to your schema.
6. Update the tool table in `README.md`.
7. Add a one-line entry under `## [Unreleased]` in `CHANGELOG.md`.

## Coding style

- TypeScript strict mode. No `any`. Use `unknown` and narrow at boundaries.
- Immutable updates — spread, do not mutate.
- Descriptor pattern only. Tool handlers return `{ path, opts }`. Never call `fetch` outside `client.ts`.
- No `console.log`. Use `process.stderr.write` for diagnostics so MCP stdout stays JSON-RPC-clean.
- No emojis in source code or comments.
- Comments only when the *why* is non-obvious. Default to no comment.
- Files stay under ~500 lines; split when they grow.

The repo runs Biome for formatting and linting. Run `npm run lint:fix` before pushing.

## Tests

```sh
npm test              # run once
npm run test:watch    # watch mode
npm run verify        # lint + typecheck + test + build (matches CI)
```

Tests live under `tests/` and are pure unit tests (no network, no fetch mocks). When you add an endpoint, prefer adding a test in `tests/spec.test.ts` confirming the operation is described, and a snippet test in `tests/snippets.test.ts` if the body shape is novel.

## Cutting a release

Releases publish via [npm Trusted Publisher (OIDC)](https://docs.npmjs.com/trusted-publishers) configured to allow only `Guutong/strava-mcp-kit`'s `ci.yml` workflow. Each release tarball carries a Sigstore provenance attestation (`npm publish --provenance`) so consumers can verify it was built from this repo.

The release workflow is one command:

```sh
npm run release:patch    # 0.1.0 -> 0.1.1
npm run release:minor    # 0.1.0 -> 0.2.0
npm run release:major    # 0.1.0 -> 1.0.0
```

Each script runs `npm version <bump>`, which bumps `package.json`, creates a release commit, and creates an annotated `vX.Y.Z` tag, then pushes both with `--follow-tags`. GitHub Actions takes it from there: CI runs typecheck/lint/test/build, then the `publish` job runs `npm publish` and creates the matching GitHub Release with notes from `CHANGELOG.md`.

Pre-release tags (containing `-`, e.g. `v0.2.0-rc.1`) publish under the npm `next` dist-tag and are marked as pre-releases on GitHub.

Always update `CHANGELOG.md` first — move `[Unreleased]` content into a new `## [X.Y.Z] - YYYY-MM-DD` section before running the release script. The publish job extracts that section verbatim into the GitHub Release notes.

## Git hooks

This repo ships husky + lint-staged. After `npm install`, the `prepare` script wires the hooks automatically.

| Hook | What it runs | Why |
|---|---|---|
| `pre-commit` | `lint-staged` — Biome `check --write` on staged `.ts` / `.js` / `.json` / `.md` / `.yml` files | Auto-format and catch lint errors locally; aborts the commit on unfixable issues |
| `pre-push` | `npm run typecheck && npm test` | Catch type errors and broken tests before they hit CI |

The pre-commit hook only inspects staged files, so it stays fast (sub-second on this repo). Pre-push is heavier (~30s for a clean run) but you only pay it when actually pushing.

If you need to bypass a hook in a genuine emergency, use `git commit --no-verify` or `git push --no-verify`. Don't make this a habit — fix the underlying issue instead.

## Pull request checklist

- [ ] `npm run typecheck` green
- [ ] `npm run lint` green
- [ ] `npm test` green
- [ ] `npm run build` succeeds
- [ ] README tool table updated if tools changed
- [ ] CHANGELOG entry under `## [Unreleased]`
- [ ] No new top-level dependencies without discussion
- [ ] Single logical change per PR

## Reporting bugs and security issues

Functional bugs: open an issue using the bug report template. Include the tool you called, the arguments, and any stderr output from the server.

Security issues (anything involving leaked tokens or auth bypass): do not open a public issue. Email the maintainers — see `CODE_OF_CONDUCT.md` for the contact placeholder.

## License

By contributing you agree that your contributions are licensed under the MIT License (see `LICENSE`).
