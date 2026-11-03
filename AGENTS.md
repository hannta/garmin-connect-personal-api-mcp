# AGENTS.md

Guidance for coding agents working in this repository. Architecture and conventions are
in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); Garmin API behaviour is in
[docs/garmin-api-notes.md](docs/garmin-api-notes.md).

## Project

A read-only, single-user MCP server for the Garmin Connect Personal API, running on
Cloudflare Workers (TypeScript, Wrangler). Each user deploys their own copy with their
own Garmin key.

## Commands

```bash
npm ci              # install
npm run check       # types, typecheck, lint, format check, tests — run before finishing
npm test            # tests only (vitest: Node + workerd projects)
npm run format      # Prettier
npm run today       # call the real Garmin API with the key in .dev.vars
npm run dev         # local server at http://localhost:8787/mcp
```

After changing `wrangler.jsonc` or bindings, run `npm run types` to regenerate
`worker-configuration.d.ts`.

## Rules

- **Secrets:** `GARMIN_API_KEY` and `OWNER_PASSPHRASE` live in `.dev.vars` (git-ignored)
  and Worker secrets. Never print, log, commit or paste them.
- **No real data in the repo.** Test fixtures in `test/fixtures/` are synthetic. Don't
  commit real Garmin responses, activity IDs, deployment URLs or personal details.
- **Read-only.** Never add a tool that writes to Garmin.
- **Privacy.** Tools never return location data, or the sexual activity and sex drive
  logs from menstrual tracking.
- **Original code.** Don't copy code from other Garmin projects.
- **Dependencies:** check that a library or API isn't deprecated before using it.
- **Don't deploy or push** unless asked.

## Adding or changing a tool

- Endpoint function in `src/garmin/endpoints.ts`, response type in
  `src/garmin/types.ts`, tool in `src/tools/`, registered in `src/server.ts`.
- Follow the conventions in docs/DEVELOPMENT.md: `garmin_` names, metric units in field
  names, local dates, range limits as errors rather than server-side splitting.
- Add a synthetic fixture and tests; update `TOOL_NAMES` in `test/server.test.ts`, the
  README tools table and the CHANGELOG.
