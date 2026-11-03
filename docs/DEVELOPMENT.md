# Development

How the server is built and the conventions to keep when changing it. For setup and
commands, see the README's **Development** section.

## Principles

- **Single user, self-hosted.** Each person deploys their own copy with their own Garmin
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

| Path               | What's there                                                |
| ------------------ | ----------------------------------------------------------- |
| `src/index.ts`     | Worker entry                                                |
| `src/oauth.ts`     | OAuth routes, token lifetimes, grant checks                 |
| `src/auth/`        | Sign-in page, passphrase check, lockout                     |
| `src/server.ts`    | MCP server and tool registration                            |
| `src/garmin/`      | Token, client, one function per endpoint, response types    |
| `src/tools/`       | The MCP tools and their shared helpers (ranges, formatting) |
| `src/lib/`         | Date / time-zone and unit helpers                           |
| `test/`            | Node tests; `test/worker/` runs the OAuth flow in workerd   |
| `test/fixtures/`   | Synthetic Garmin responses                                  |
| `scripts/today.ts` | `npm run today`: check a Garmin key locally                 |
| `docs/`            | Deployment guide, [Garmin API notes](garmin-api-notes.md)   |

## Conventions

- **Tool names:** start with `garmin_`; `search_` for filtered lists, `get_` for the
  rest; singular for one item (`garmin_get_activity`), plural or "summaries" for ranges.
- **Units:** metric only, with the unit in every field name (`distance_km`,
  `duration_s`, `pace_min_per_km`, `weight_kg`). Conversions live in `src/lib/units.ts`.
- **Dates:** inputs are `YYYY-MM-DD` local calendar dates; an omitted date means today
  in the user's time zone. Sleep and HRV are keyed by the wake-up date. Timestamps in
  output are ISO 8601 with offset.
- **Time zone:** the `TIMEZONE` var, else the Garmin profile's time zone (cached in KV),
  else UTC with a warning in the response. Workers run in UTC, so "today" must never
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

- **No FIT decoding.** Decoding a FIT file for a run of an hour or more exceeds the free
  plan's CPU limit, and streams, splits and training load are available from JSON
  endpoints. Per-lap data would need FIT, so it's left out; it could come back as an
  opt-in feature for Workers Paid.
- **Built-in passphrase sign-in.** No third-party identity provider, so a deployment
  needs nothing beyond Cloudflare and a Garmin key. Changing the passphrase signs out
  every app.
- **Spec-based tools.** Tools for data the developer's account doesn't have (hydration,
  food log, wellness activities, menstrual cycle) follow Garmin's OpenAPI spec. Dates
  accept both the spec's objects and the strings Garmin really sends.
