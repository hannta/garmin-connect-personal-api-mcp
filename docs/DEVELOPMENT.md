# Development

How the server is built and the conventions to keep when changing it. For setup and
commands, see the README's **Development** section.

## Principles

- **Single user, self-hosted.** Each person runs their own copy with their own Garmin
  key. No shared service, no one else's data.
- **Read-only.** No tool writes to Garmin.
- **No real data in the repo.** Test fixtures are synthetic; no keys, personal IDs or
  real health data are committed.
- **Tools follow Garmin's data.** One tool per kind of Garmin data, plus a few merged
  tools (`garmin_get_day`, `garmin_get_days`) for things usually asked together. Output
  is compact and metric; the server doesn't compute scores or interpret the data — the
  assistant does the analysis.
- **Original code, maintained libraries.** Other projects may inspire, but no code is
  copied. Check that a dependency or API isn't deprecated before adding it.

## Architecture

```
MCP client (Claude, …)
   │  MCP over HTTPS + OAuth bearer token
   ▼
Cloudflare Worker
   ├─ OAuth (@cloudflare/workers-oauth-provider)
   │     └─ sign-in page: OWNER_PASSPHRASE check, rate limited
   ├─ MCP handler (/mcp, Streamable HTTP, stateless: a new McpServer per request)
   │     └─ tools (zod input schemas)
   ├─ Garmin client (typed endpoints, error mapping)
   └─ Token provider: GARMIN_API_KEY → Garmin access token, cached in KV
   ▼
Garmin Connect Personal API
```

The local server is the same MCP server, tools and Garmin client behind a different front:

```
MCP client (Claude Code, …)
   │  MCP over stdio
   ▼
Node.js process (dist/cli.mjs, from npm)
   ├─ MCP server: tools, Garmin client
   ├─ Key: environment or ~/.config/garmin/connect-personal-api-key
   └─ Store: private files in ~/.cache/garmin-connect-personal-api-mcp
   ▼
Garmin Connect Personal API
```

| Path                   | What's there                                                |
| ---------------------- | ----------------------------------------------------------- |
| `src/index.ts`         | Worker entry                                                |
| `src/oauth.ts`         | OAuth routes, token lifetimes, grant checks                 |
| `src/auth/`            | Sign-in page, passphrase check, lockout                     |
| `src/local/`           | Local server: CLI, key handling, key page, file store       |
| `src/server.ts`        | MCP server and tool registration                            |
| `src/garmin/`          | Token, client, one function per endpoint, response types    |
| `src/tools/`           | The MCP tools and their shared helpers (ranges, formatting) |
| `src/lib/`             | Date / time-zone and unit helpers                           |
| `test/`                | Node tests; `test/worker/` runs the OAuth flow in workerd   |
| `test/fixtures/`       | Synthetic Garmin responses                                  |
| `scripts/today.ts`     | `npm run today`: check a Garmin key locally                 |
| `scripts/build-cli.ts` | `npm run build`: bundle the local server                    |
| `docs/`                | Setup guides, [Garmin API notes](garmin-api-notes.md)       |

## Conventions

- **Tool names:** start with `garmin_`; `search_` for filtered lists, `get_` for the
  rest; singular for one item (`garmin_get_activity`), plural or "summaries" for ranges.
- **Units:** metric only, with the unit in every field name (`distance_km`,
  `duration_s`, `pace_min_per_km`, `weight_kg`). Conversions live in `src/lib/units.ts`.
- **Dates:** inputs are `YYYY-MM-DD` local calendar dates; an omitted date means today
  in the user's time zone. Sleep and HRV are keyed by the wake-up date. Timestamps in
  output are ISO 8601 with offset.
- **Time zone:** the `TIMEZONE` var, else the Garmin profile's time zone (cached in the
  store), else UTC with a warning in the response. Workers run in UTC, so "today" must never
  come from the server clock.
- **Ranges:** default to the last 7 days and make one Garmin request per source. A range
  over the endpoint's maximum returns an error with the maximum, and the assistant
  splits it; the server doesn't. Range results include plain average / min / max in
  `summary`.
- **Errors:** tools return readable errors (`isError`) rather than protocol failures, so
  the assistant can explain them. Error messages never contain secrets.
- **Privacy:** location data and menstrual tracking's sexual activity and sex drive logs
  are never returned.
- **Language:** English for tool names, descriptions, output and docs.

## Decisions

- **Two ways to run, one server.** `createServer` takes plain settings (a function that
  returns the key, a store, a time zone) and knows nothing about Cloudflare or Node.js.
  Only `src/index.ts`, `src/oauth.ts` and `src/auth/` are Worker code, and only
  `src/local/` is Node.js code. Everything else uses web-standard APIs and must stay that
  way; `src/local/tsconfig.json` type-checks it without Worker types, and the root
  `tsconfig.json` without Node.js types.
- **The npm package is one bundled file.** `npm run build` puts all code in
  `dist/cli.mjs`, so the package has no runtime dependencies and starts quickly with
  `npx`. Every dependency is a `devDependency` for that reason; Wrangler bundles the same
  ones into the Worker.
- **Garmin's key file.** The local server uses the same variable and file as Garmin's own
  Personal API tools, so someone who already has a key needs no setup. It doesn't share
  their token cache: a token is cheap to get, and this keeps one code path for tokens.
- **No key in the chat.** `auth` takes the key on a temporary page on `127.0.0.1`, so an
  agent can run the setup without ever seeing the key.
- **Own FIT reader.** FIT files are the only source of per-lap data. `@garmin/fitsdk`
  took about 60 ms on a marathon, over the free plan's 10 ms CPU limit, and its license
  is proprietary and restricts distribution. `src/garmin/fit.ts` is a small original
  reader instead: it reads only the fields it lists and steps over the per-second
  records, which takes a few milliseconds. It never reads position fields. There's no
  setting to turn it off: on the free plan a long activity may still go over the limit,
  which fails only that call and is documented as a known limitation.
- **Built-in passphrase sign-in.** No third-party identity provider, so a deployment
  needs nothing beyond Cloudflare and a Garmin key. Changing the passphrase signs out
  every app.
- **Spec-based tools.** Tools for data the developer's account doesn't have (hydration,
  food log, wellness activities, menstrual cycle) follow Garmin's OpenAPI spec. Dates
  accept both the spec's objects and the strings Garmin really sends.
