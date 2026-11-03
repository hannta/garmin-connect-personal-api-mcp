# garmin-connect-personal-api-mcp — Implementation Plan

> Unofficial project. Not affiliated with or endorsed by Garmin.

## Goal

A self-hosted, read-only [MCP](https://modelcontextprotocol.io) server that runs on a
free Cloudflare Workers account and exposes Garmin Connect training, recovery and
health data through the official **Garmin Connect Personal API**.

It is built for using Claude as a training coach: added as a custom connector on
claude.ai, it works in the Claude web and mobile apps. It is a **complete coaching
connector on its own** — activities, laps, streams, training load and best efforts,
plus how the body is handling it (sleep, HRV, Body Battery, stress, resting HR, …) —
so it works with or without Strava.

### Garmin vs. Strava coverage

Garmin is where watch data originates; Strava receives a copy. Garmin therefore has the
same activity data and more (running dynamics, training effect, full FIT channels).
What Strava adds is its own derived metrics and social features.

| Strava MCP capability                        | This server                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| List / search activities                     | ✅ `garmin_search_activities`                                                                          |
| Activity performance, zones                  | ✅ `garmin_get_activity` (plus running dynamics, power, training effect, RPE, interval totals)         |
| Per-lap splits                               | ⚠️ Only from FIT files — optional `ENABLE_FIT_LAPS` (needs Workers Paid for long runs)                 |
| Activity streams                             | ✅ `garmin_get_activity_streams` (later release; Garmin-downsampled `/details`, no FIT)                |
| Athlete zones, profile                       | ✅ `garmin_get_profile`                                                                                |
| Best efforts                                 | ✅ Fastest splits (1 km … marathon) in `garmin_search_activities` rows (later release; no PR endpoint) |
| Streaks, fitness / freshness                 | ✅ Weekly totals with `group_by: "week"` (later release; Garmin training load, HR-zone time, volume)   |
| Strength workout details                     | ⚠️ Sets, reps and weight per exercise category (`summarizedExerciseSets`); no individual sets          |
| Gear / shoe mileage                          | ❌ No gear endpoint in the Personal API                                                                |
| Training plans, segments, KOMs, kudos, clubs | ❌ Strava-only; not needed for coaching                                                                |

### Principles

- **Self-hosted, single user.** Everyone deploys their own instance to their own
  Cloudflare account with their own Garmin key. No shared service, no one else's data.
- **Public-repo ready from day one.** No personal identifiers, keys or real health
  data in the repo. All per-user values live in Worker config and secrets.
- **Read-only.** No tools that write to Garmin.
- **Coaching-shaped tools.** A few tools with compact output rather than a 1:1 mirror of
  every API endpoint. Basic tools deliberately match other Garmin MCP servers' names and
  scope; combined and calculated tools add what they don't.
- **Original code.** Other community projects may be used for inspiration only; no
  code is copied.
- **No deprecated features or libraries.** Check current docs and package status
  before adding a dependency or API; prefer the maintained successor.

## Architecture

```
Claude app (phone / web)
   │  MCP over HTTPS + OAuth bearer token
   ▼
Cloudflare Worker
   ├─ OAuth layer (workers-oauth-provider)
   │     └─ owner login page: OWNER_PASSPHRASE check, rate limited
   ├─ MCP handler (/mcp, Streamable HTTP, stateless createMcpHandler)
   │     └─ McpServer per request → coaching tools (zod input schemas)
   ├─ Garmin client (fetch, typed responses, error mapping)
   ├─ (optional, ENABLE_FIT_LAPS) FIT laps: unzip → decode → laps, cached in KV
   └─ Token manager
         ├─ Worker secret: GARMIN_API_KEY
         └─ KV: cached Garmin access token
   ▼
Garmin Connect Personal API
```

### Tech stack

- TypeScript 6.0 (strict), Cloudflare Workers, `wrangler` 4. TypeScript 7 is out, but
  `typescript-eslint` supports only `<6.1`; upgrade when it does. Runtime types come
  from `wrangler types` (`worker-configuration.d.ts`); `src/` has Workers types only,
  `test/` and `scripts/` add Node types via their own `tsconfig.json`
- MCP: `createMcpHandler` from `agents/mcp/server` with the MCP SDK v2
  (`@modelcontextprotocol/server`), stateless — a fresh `McpServer` per request,
  no Durable Objects or MCP sessions. Fallback: the SDK v2 Streamable HTTP
  transport directly. Not used: `McpAgent` and SDK v1 (`@modelcontextprotocol/sdk`),
  both deprecated / legacy
- `@cloudflare/workers-oauth-provider`, with a built-in passphrase login page
  (no third-party identity provider)
- `zod` for tool input schemas
- `@garmin/fitsdk` + `fflate` for FIT activity files — only for the optional
  `ENABLE_FIT_LAPS` feature, added later
- `vitest` 5 for tests, two projects: Garmin client, tools and MCP server in Node; the
  Worker with OAuth in workerd via `@cloudflare/vitest-plugin`
  (`@cloudflare/vitest-pool-workers` is deprecated)
- npm as the package manager
- ESLint + Prettier, GitHub Actions CI
- Repository: [hannta/garmin-connect-personal-api-mcp](https://github.com/hannta/garmin-connect-personal-api-mcp)
  (private for now)
- Hosting: free `*.workers.dev` URL; a custom domain can be added later

## Project layout

```
garmin-connect-personal-api-mcp/
├─ src/
│  ├─ index.ts           # Worker entry
│  ├─ oauth.ts           # OAuthProvider: routes, token lifetimes, grant checks
│  ├─ server.ts          # McpServer factory, tool registration
│  ├─ auth/
│  │  ├─ authorize.ts    # /authorize: sign-in page flow, passphrase check
│  │  ├─ page.ts         # sign-in page HTML + security headers
│  │  ├─ passphrase.ts   # constant-time check, grant fingerprint
│  │  └─ lockout.ts      # failed-attempt counters + lockout (KV)
│  ├─ garmin/
│  │  ├─ token.ts        # API key → access token, KV cache, refresh on 401
│  │  ├─ client.ts       # typed fetch wrapper, errors, retries
│  │  └─ endpoints.ts    # one function per Garmin endpoint
│  ├─ fit/               # later, optional (ENABLE_FIT_LAPS)
│  │  └─ laps.ts         # unzip + FIT decode → per-lap rows, cached in KV
│  ├─ tools/             # one file per MCP tool
│  ├─ lib/               # dates.ts, downsampling, privacy filters, units.ts,
│  │                     # weekly aggregation
│  └─ types.ts
├─ test/
│  ├─ fixtures/          # synthetic Garmin responses (never real data)
│  ├─ worker/            # OAuth flow tests in workerd (@cloudflare/vitest-plugin)
│  └─ *.test.ts          # Node tests
├─ docs/
│  └─ DEPLOY.md          # step-by-step self-hosting guide
├─ .github/workflows/ci.yml
├─ wrangler.jsonc
├─ .dev.vars.example     # secret names (local dev + Deploy to Cloudflare setup page)
├─ README.md
├─ SECURITY.md
├─ LICENSE              # MIT
└─ PLAN.md
```

## Configuration

| Name               | Kind                  | Purpose                                                                                                  |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `GARMIN_API_KEY`   | secret                | Garmin Connect Personal API key                                                                          |
| `OWNER_PASSPHRASE` | secret                | Sign-in passphrase (16+ chars); generate with `openssl rand -base64 32`. Changing it signs out every app |
| `OAUTH_KV`         | KV binding            | OAuth clients, grants and tokens                                                                         |
| `GARMIN_KV`        | KV binding            | Cached Garmin access token, failed-login counters, decoded activity summaries, small caches              |
| `TIMEZONE`         | var (optional)        | IANA time zone override, e.g. `Europe/Helsinki`; default comes from the Garmin profile                   |
| `ENABLE_FIT_LAPS`  | var (optional, later) | `true` enables per-lap data from FIT files. Off by default; long activities need Workers Paid            |

## Units

Garmin returns metric base units (meters, seconds, m/s, bpm, kcal; weight likely in
grams), and there is no request parameter to change this. The server stays **metric
only** — no imperial conversion, and the profile's `measurementSystem` is ignored.

Within metric, values are scaled to what a runner reads, and every key names its unit:

| Garmin returns                                               | Server returns                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| distance in m                                                | `distance_km` (activities), `*_m` for short distances / elevation    |
| duration in s                                                | `duration_s` plus a readable `duration` (`"1:42:05"`, `"7h 32m"`)    |
| speed in m/s                                                 | `pace_min_per_km` (`"4:48"`), derived; also `speed_kmh` where useful |
| weight in g                                                  | `weight_kg`                                                          |
| stride length / vertical oscillation in cm, GCT in ms        | `*_cm`, `*_ms`                                                       |
| timestamps (epoch ms, or GMT / local strings without offset) | ISO 8601 in the user's local time, with offset                       |

All conversion lives in `src/lib/units.ts` and is unit-tested. Imperial support can be
added later if the repo goes public and someone needs it.

## Time zone and dates

Garmin stores daily data (sleep, HRV, daily summaries) by the user's **local calendar
date**. Workers run in UTC, so "today" must be computed in the user's time zone —
otherwise `garmin_get_day()` returns the wrong day around midnight (e.g. until 02:00 /
03:00 in Finland). Other Garmin MCP servers avoid this only because they run on the
user's own machine and use its local clock.

Resolution order for the user's time zone:

1. Optional `TIMEZONE` var (IANA name, e.g. `Europe/Helsinki`) — explicit override
2. `timeZone` from the Garmin profile settings (confirmed in Phase 0; cached in KV)
3. UTC, with a warning in the tool response

Rules:

- All date inputs are `YYYY-MM-DD` local calendar dates; omitted dates mean "today" in
  the user's time zone
- Tool descriptions encourage Claude to pass explicit dates
- Activity times use Garmin's local start time; output timestamps are ISO 8601 with offset
- Date helpers live in `src/lib/dates.ts`, tested across midnight and DST changes

## Language

Tool names, descriptions, output field names, errors and docs are in **English**.
Claude still answers in the user's language.

## Tools

Tools return compact, coach-friendly output in metric units. Tool descriptions are
written so Claude picks the right one. Internally, `garmin/endpoints.ts` covers every
Personal API endpoint; tools are built on top of it.

The tools are released in stages: first a small set of basic tools plus one combined
day view, then range tools for trends.

Tools follow Garmin's data: one tool per kind of data (mirroring a Personal API
endpoint), plus a few merged tools that join endpoints Claude would otherwise call
together, like `garmin_get_day`. Claude (or any agent) pulls what it needs and does the
analysis itself; the server doesn't compute scores or interpret the data. Output stays
compact and metric (see Units) rather than raw Garmin JSON.

### Naming conventions

- Every tool starts with `garmin_` — matches other Garmin MCP servers and keeps tools
  distinguishable from other connectors (e.g. Strava's `search_activities`)
- `search_` for filtered lists, `get_` for everything else
- Singular for one item (`garmin_get_activity`), plural / summary words for ranges
  (`garmin_search_activities`, `garmin_get_sleep_summaries`, `garmin_get_days`)
- Basic tools use the same names and scope as other Garmin MCP servers

### First release — 5 basic tools + 1 combined

The basic tools give depth that `garmin_get_day` doesn't, so they don't overlap.

| Tool                                          | Answers questions like                                         | Garmin data                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `garmin_search_activities(start, end, type?)` | "Find yesterday's long run"                                    | Compact activity list: Garmin activity ID, type, date, distance, time, pace, avg HR, training effect, training load                                                                                                                                                                                                                                     |
| `garmin_get_activity(id)`                     | "How did my long run really go?" / "How did the intervals go?" | Activity summary: pace, grade-adjusted pace, HR, time in HR zones, running dynamics (cadence, GCT, vertical oscillation, stride), power, training effect and load, RPE / feel, Body Battery change; interval totals by type (warm-up / active / recovery) from `splitSummaries`. No per-lap / per-rep rows on the free plan; no planned-workout targets |
| `garmin_get_sleep(date)`                      | "How did I sleep last night?"                                  | One night (keyed by wake-up date): stages, score and qualifiers, sleep need, avg HR, respiration, sleep stress                                                                                                                                                                                                                                          |
| `garmin_get_hrv(date)`                        | "Is my HRV down?"                                              | One night's HRV: average, baseline range, status, overnight readings (trimmed)                                                                                                                                                                                                                                                                          |
| `garmin_get_profile()`                        | Context for interpreting HR                                    | Profile settings and HR zones                                                                                                                                                                                                                                                                                                                           |
| `garmin_get_day(date?)` — **combined**        | "Should I do intervals today?" (call for yesterday + today)    | Sleep summary, HRV summary, Body Battery, stress, resting HR, intensity minutes, plus a compact list of that day's activities. Partial data with warnings if one source fails                                                                                                                                                                           |

`garmin_get_day`'s description points to `garmin_get_activity`, `garmin_get_sleep` and
`garmin_get_hrv` for detail beyond the summary, and to `garmin_get_days` for ranges.

### Later releases — range tools

**Range rules** (all range tools):

- `start_date` / `end_date`, `YYYY-MM-DD` in the user's time zone. Neither given: the 7
  days ending today. Only one given: a 7-day range from or to it.
- **One Garmin request per source.** A range is fetched with Garmin's range endpoint in
  a single request — never one request per day. Merged tools make one request per source.
- **Longer than one request allows → error, not splitting.** The error names the
  maximum, e.g. "Sleep summaries cover at most 31 nights per call; split the range."
  Claude makes the extra calls itself, so one tool call is always one Garmin request
  per source. Activity lists page with `next_offset` instead.
- Each result has the rows plus a `summary` of plain statistics per metric: average,
  min, max and days with data. No scores, baselines of our own or interpretation.

| Tool                                                       | Answers questions like                                              | Garmin data (max range per call)                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `garmin_get_daily_summaries(start?, end?)`                 | "How has my resting HR moved this month?"                           | `/usersummary-service/v2/dailysummaries` — resting / min / max HR, Body Battery, stress, intensity minutes, steps, respiration per day (92 days)                                                                                     |
| `garmin_get_sleep_summaries(start?, end?)`                 | "Has my sleep been shorter this block?"                             | `/sleep-service/sleep/dailySleepSummariesByDate` — per night (wake-up date): duration, stages, score, sleep need, HR, respiration, sleep stress (31 nights)                                                                          |
| `garmin_get_hrv_summaries(start?, end?)`                   | "Is my HRV trending down?"                                          | `/hrv-service/hrv/daily/{start}/{end}` — per night: average, 5-min high, weekly average, baseline range, status (92 days)                                                                                                            |
| `garmin_get_weight(start?, end?)`                          | "How is my weight trending?"                                        | `/weight-service/weight/range/{start}/{end}` — daily weight and body composition, in kg (366 days: weigh-ins are sparse, so a year stays small)                                                                                      |
| `garmin_get_days(start?, end?)` — **merged**               | "Am I absorbing this training block?"                               | `garmin_get_day` over a range: daily summaries + sleep + HRV + per-day activity totals (count, minutes, km, training load) joined into one row per day (31 days, the sleep limit); four requests in total                            |
| `garmin_search_activities(…, group_by?)` — **new options** | "How has my volume built over 12 weeks?" / "Fastest 10k this year?" | `group_by: "week"` returns totals per week (first day from the profile): distance, time, elevation, count, longest, training load, time in HR zones. Rows also get fastest splits (1 km, mile, 5k, 10k, half, marathon) when present |
| `garmin_get_activity_streams(id, channels?, points?)`      | "Did my HR drift in the last 10 km?"                                | `/activity/{id}/details?maxChartSize=N` — Garmin-downsampled HR, pace, grade-adjusted pace, power, cadence, elevation, dynamics, stamina; location stripped                                                                          |

The 92-day maximums keep one response a reasonable size on the phone (Garmin itself
allows more; 92 nights of HRV is ~14k characters); the 31-night sleep limit is Garmin's. `group_by: "week"` works on one
page of up to 100 activities; a range with more returns an error asking for a shorter
range. `garmin_get_sleep` and `garmin_get_hrv` stay single-night tools for full detail.

**Left to Claude, from the rows:** recovery and load trends, acute vs. chronic load,
week-over-week change, easy-run efficiency (pace vs. HR), period comparisons. Not
planned as tools.

**Optional later feature:** per-lap rows in `garmin_get_activity` from FIT files, behind
`ENABLE_FIT_LAPS` (see below).

### Full endpoint coverage

Matches the tool set of the two closest projects (same names), so every Personal API
endpoint has a tool. Same range rules as above; maximums measured 2026-11-03.

| Tool                                                      | Garmin endpoint                                                  | Input (max per call)    | Output                                                                                                                           | Owner's account |
| --------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `garmin_get_body_battery(start?, end?, include_samples?)` | `/wellness-service/wellness/bodyBattery/reports/daily`           | range (31 days, Garmin) | Per day: charged, drained, events behind them (sleep, each activity: start, duration, impact, feedback). Samples only on request | data            |
| `garmin_get_stress(start?, end?)`                         | `/usersummary-service/stats/stress/daily/{start}/{end}`          | range (28 days, Garmin) | Per day: overall level, minutes at rest / low / medium / high                                                                    | data            |
| `garmin_get_steps(start?, end?)`                          | `/usersummary-service/stats/steps/daily/{start}/{end}`           | range (28 days, Garmin) | Per day: steps, goal, distance (km)                                                                                              | data            |
| `garmin_get_heart_rate(date?, include_samples?)`          | `/wellness-service/wellness/dailyHeartRate`                      | one date                | Resting / min / max HR, 7-day resting average; samples (averaged per 15 min) only on request                                     | data            |
| `garmin_get_spo2(date?, include_samples?)`                | `/wellness-service/wellness/daily/spo2acclimation/{date}`        | one date                | Average / lowest / sleep SpO2, 7-day average, altitude acclimation; hourly averages only on request                              | empty values    |
| `garmin_get_fitness_age(date?)`                           | `/fitnessage-service/fitnessage/v2/{date}`                       | one date                | Fitness age vs. chronological age, components (resting HR, BMI, vigorous days / minutes per week)                                | data            |
| `garmin_get_weight_goals(start?, end?)`                   | `/goal-service/goal/user/effective/weightgoal/{start}/{end}`     | range (366 days)        | Goals in effect: target (kg), start date, tracking period                                                                        | 1 goal          |
| `garmin_get_hydration(start?, end?)`                      | `/usersummary-service/stats/hydration/daily/{start}/{end}`       | range (31 days, Garmin) | Per day: intake, goal, sweat loss (ml)                                                                                           | empty           |
| `garmin_get_wellness_activities(start?, end?)`            | `/wellnessactivity-service/activity/summary/range/{start}/{end}` | range (92 days)         | Wellness activities (e.g. breathing / meditation) with summary values and zone time                                              | empty           |
| `garmin_get_food_log(date?)`                              | `/nutrition-service/food/logs/{date}`                            | one date                | Meals, logged foods, nutrients vs. daily goals                                                                                   | empty           |
| `garmin_get_menstrual_cycle(date?)`                       | `/periodichealth-service/menstrualcycle/summary/{date}`          | one date                | Cycle phase, day, fertile window, predictions                                                                                    | no data (204)   |
| `garmin_get_menstrual_day(date?)`                         | `/periodichealth-service/menstrualcycle/dayview/{date}`          | one date                | One day's logged symptoms, flow and cycle detail                                                                                 | no data         |
| `garmin_get_activity_workouts(id)`                        | `/activity-service/activity/{id}/workouts`                       | activity ID             | The structured workout followed (steps, targets), for planned vs. actual                                                         | `[]`            |
| `garmin_get_heart_rate_zones()`                           | `/biometric-service/heartRateZones/v2`                           | —                       | Same zones as `garmin_get_profile`, as its own tool so names match the other projects                                            | data            |

- **Built from the spec:** hydration, wellness activities, food log and menstrual cycle
  return no data on the owner's account, so their tools follow Garmin's OpenAPI spec
  (Swagger page, extracted to `discovery/raw/openapi.json`). Dates and times accept
  both the spec's objects and the strings Garmin really sends. Workouts are decoded
  (HR = % max or bpm + 100, power = % FTP or watts + 1000, speed m/s → pace). Sexual
  activity and sex drive logs are not returned. Fixtures are synthetic, from the spec.
- **No duplicate fetching:** `garmin_get_day` also gets stress-level minutes and Body
  Battery events from the daily summary it already reads (no extra request).
- **Sensitive data:** menstrual-cycle tools return data only if the user tracks it in
  Garmin Connect; nothing else changes (same sign-in, read-only).
- **Not added:** `garmin_download_activity` (a remote server can't save to the user's
  disk; FIT stays behind `ENABLE_FIT_LAPS`) and a single-date `garmin_get_daily_summary`
  (`garmin_get_day` and `garmin_get_daily_summaries` cover it).

**Known gaps (confirmed in Phase 0), documented in the README:**

- No Training Readiness, Training Status or VO2max (fitness age exists, but its
  components are resting HR, BMI and vigorous minutes — no VO2max).
- No gear endpoint, so no shoe mileage.
- No personal-records endpoint; best efforts come from per-activity fastest splits and
  may differ slightly from Garmin's own PRs.
- No individual strength sets; activity search has totals per exercise category.

### FIT files and the free plan's 10 ms CPU limit

Phase 0 measured FIT decoding at ~18 ms for a 1-hour run and ~50–60 ms for a marathon —
above the free plan's 10 ms CPU per request. On the free plan, a request over the limit
is stopped (Cloudflare error 1102); only that tool call fails, nothing is billed.

- **First release and later tools use no FIT at all.** All their data comes from JSON
  endpoints (well under 1 ms of parsing per response), so activity length doesn't matter.
- **Per-lap data** is the only thing that needs FIT. It's added later as an opt-in
  feature: `ENABLE_FIT_LAPS=true`, recommended with Workers Paid ($5/month, 30 s CPU).
  Each activity is decoded once and cached in KV.
- With `ENABLE_FIT_LAPS` unset, `garmin_get_activity` returns interval totals and a note
  that per-lap data needs the setting — FIT decoding never runs.
- **README note:** explain that FIT-based lap data for long activities doesn't fit the
  free plan, and that everything else works on it.

## Phases

### Phase 0 — API discovery

- [x] Create a Personal API key in Garmin Connect
- [x] Exchange it for an access token with `curl`; note token lifetime
- [x] Call 3–4 data endpoints (sleep, HRV, daily summary, activity)
- [x] Confirm base URL, rate limits, and whether readiness / training status / VO2max exist
- [x] Confirm the unit of every field we use (especially weight and timestamps / time zones)
- [x] Find the time-zone field in the profile settings (or another endpoint); confirm
      daily endpoints use local calendar dates
- [x] Check what activity search and activity details return (laps / splits, HR zones,
      running dynamics, training effect) without decoding FIT
- [x] Check the activity workouts endpoint on an interval session: returns `[]`, and the
      FIT file has no workout steps. The session wasn't a workout created in Garmin
      Connect, and the owner doesn't use those — so this stays untested
- [x] Read the Personal API terms (owner confirmed OK for AI use, Cloudflare hosting and
      an open-source client)
- [x] Check which daily-summary fields hold intensity minutes
- [x] Download a FIT file for a long run and a strength session: confirm laps, records,
      running dynamics and strength sets are present (decides whether
      `garmin_get_activity` needs FIT in the first release)
- [x] Measure unzip + decode CPU time for a marathon-length FIT file (measured in Node:
      ~18 ms for 1 h, ~50–60 ms for a marathon — over the free plan's 10 ms)
- [x] Write synthetic fixtures that match the real response shapes (`test/fixtures/`)

**Done when:** the real shape of every response we need is known and captured as
synthetic fixtures.

Findings: [discovery/FINDINGS.md](discovery/FINDINGS.md).

### Phase 1 — Repo scaffold + Garmin client

- [x] `git init`, remote `git@github.com:hannta/garmin-connect-personal-api-mcp.git`
- [x] npm `package.json`, TypeScript, ESLint + Prettier, vitest, `wrangler.jsonc`
- [x] `LICENSE` (MIT), `CHANGELOG.md`, README skeleton with the unofficial disclaimer and a
      "Free vs. Paid Cloudflare plan" note (everything works on the free plan except
      FIT-based lap data for long activities)
- [x] Deploy-button ready from the start: Worker at the repo root (no monorepo),
      KV bindings in `wrangler.jsonc`, `.dev.vars.example` listing the secrets,
      setup-page descriptions in `package.json` → `cloudflare.bindings`
- [x] Token manager (KV cache, refresh on 401) and typed client
- [x] Endpoint functions + unit tests against fixtures
- [x] `lib/units.ts` and `lib/dates.ts` with tests (midnight, DST, Garmin timestamp formats)
- [x] Local script: `npm run today`
- [x] CI workflow: types check, typecheck, lint, format check, test

**Done when:** CI is green and a local script prints today's recovery data.

### Phase 2 — MCP server (no auth yet)

- [x] Worker entry: `export default { fetch }` calling `createMcpHandler(createServer)`
      at `/mcp`, with a server factory (never a shared server instance)
- [x] Keep the default legacy-compatible mode (`legacy: "stateless"`): Claude's support
      for the 2026-07-28 stateless-only protocol is unconfirmed; revisit in Phase 4
- [x] First-release basic tools: `garmin_search_activities`, `garmin_get_activity`
      (incl. interval totals), `garmin_get_sleep`, `garmin_get_hrv`, `garmin_get_profile`
- [x] Combined tool: `garmin_get_day`
- [x] Privacy filters: every formatter whitelists its fields, so coordinates, location
      names and owner details never reach the output (tested)
- [x] Until OAuth exists, `/mcp` answers only on localhost (403 elsewhere; removed in Phase 3)
- [x] Tested locally with `wrangler dev` against real data (MCP JSON-RPC over HTTP), and
      in CI through the MCP client SDK and the Worker's `fetch` handler in Node
- [ ] Optional: check with MCP Inspector by hand

Notes:

- Activity times use the activity's own offset (Garmin local vs. GMT start time), so a
  race abroad shows its local start time. Daily data uses the profile time zone.
- `garmin_get_activity` also reads activity search for that date, because time in HR and
  power zones is only available there (two Garmin calls per activity).
- Measured in Node: ~0.5 ms CPU per warm request; bundle 225 KB gzipped.
- `compatibility_date` is 2026-10-30, the newest the local workerd supports.
- Worker-runtime tests with `@cloudflare/vitest-plugin` moved to Phase 3, where OAuth
  wiring needs them; Phase 2's handler runs fine in Node.

**Done when:** the six first-release tools are listed and all of them return real data. ✅

### Phase 3 — OAuth + lockdown

- [x] `workers-oauth-provider` 1.2 wrapping the MCP handler: the combined `OAuthProvider`
      (one Worker is both authorization server and resource; fully supported, and simpler
      to self-host than the split-Workers shape). Dynamic client registration and Client
      ID Metadata Documents (`global_fetch_strictly_public` flag)
- [x] Resource URL from the request origin (`<origin>/mcp`), one provider per hostname —
      no URL setting needed. `env` is copied per request because the library caches its
      helpers on `env` (otherwise the first hostname, e.g. a preview URL, wins; tested)
- [x] Token lifetimes: access token 1 hour, refresh token 30 days, renewed on each
      use (`refreshTokenIdleTTL`) — sign in again only after 30 days without use
- [x] Sign-in page on `/authorize`: client name (escaped), redirect host, loopback warning,
      passphrase field, Allow / Deny
- [x] Constant-time passphrase comparison (SHA-256 digests); passphrase must be 16+
      characters, otherwise sign-in is disabled with a setup message
- [x] CSRF and framing: the library's consent helpers bind the form to the browser with
      a one-time handle and `__Host-` cookie, so `COOKIE_ENCRYPTION_KEY` was dropped.
      Strict CSP (`default-src 'none'`), `no-store`, `X-Frame-Options: DENY`,
      `Referrer-Policy: no-referrer`
- [x] Lockout: 5 failures per IP or 20 in total → 15 minutes, counters in `GARMIN_KV`;
      only new sign-ins are blocked
- [x] Passphrase never logged; generic "Wrong passphrase." message
- [x] Revocation: grants store a passphrase fingerprint; after rotation `/mcp` returns
      401 and the refresh fails with `invalid_grant`, which revokes the grant
- [x] Tests in workerd: discovery, registration, sign-in page and escaping, wrong
      passphrase, CSRF, deny, lockout, token + refresh, MCP access, rotation, two hostnames
- [x] Full flow checked locally with `wrangler dev` and real Garmin data
- Not needed: tools reading the grant via `getMcpAuthContext()` — single user, and the
  grant check runs before the MCP handler

**Done when:** unauthenticated requests get 401, a wrong passphrase is rejected and
eventually locked out, the right one completes the OAuth flow, and rotating the
passphrase forces a new sign-in. ✅

### Phase 4 — Deploy + connect

- [x] Secrets via `wrangler secret put` (`GARMIN_API_KEY`, `OWNER_PASSPHRASE`); KV
      namespaces created — first deploy used `--secrets-file`; KV auto-provisioned, IDs
      kept out of `wrangler.jsonc`
- [x] `wrangler deploy` to `https://garmin-connect-personal-api-mcp.<subdomain>.workers.dev`
- [x] claude.ai → Settings → Connectors → Add custom connector (URL ending in `/mcp`)
- [x] Test from the phone with this connector alone, and together with Strava
- [x] Write `docs/DEPLOY.md` from the real steps taken

**Done when:** Claude on the phone answers coaching questions using only this connector's
first-release tools (range tools come in Phase 5).

### Phase 5 — Later-release tools

Built one at a time after the first release is in daily use, in this order (range
rules in Tools → Later releases):

- [x] Shared range handling: default 7 days, per-endpoint maximum with a clear error,
      `summary` statistics
- [x] `garmin_get_daily_summaries`
- [x] `garmin_get_sleep_summaries`
- [x] `garmin_get_hrv_summaries`
- [x] `garmin_get_days` (merged: one row per day from the three above)
- [x] `garmin_search_activities`: `group_by: "week"` and fastest splits in rows
- [x] `garmin_get_weight`
- [x] `garmin_get_activity_streams` (from `/details`, capped point count)
- [ ] Optional: `ENABLE_FIT_LAPS` — per-lap and per-rep interval rows in
      `garmin_get_activity` from FIT laps / splits,
      decoded once and cached in KV; off by default; documented as needing Workers Paid
      for long activities

**Done when:** each tool is deployed and answers its example question from the phone.

Deployed 2026-11-02 and tested from the Claude desktop app: 4 weeks of HRV and sleep
(`garmin_get_days`), 12 weeks of weekly running volume and HR drift on a long run
(streams) all answered correctly. Tool calls can exceed the free plan's CPU limit — see
the CPU decision below.

### Phase 6 — Full endpoint coverage

Tools in Tools → Full endpoint coverage, in this order (most useful for coaching first):

- [x] `garmin_get_body_battery`, plus Body Battery events in `garmin_get_day`
- [x] `garmin_get_stress`, plus stress-level minutes in `garmin_get_day`
- [x] `garmin_get_steps`
- [x] `garmin_get_heart_rate`
- [x] `garmin_get_fitness_age`
- [x] `garmin_get_heart_rate_zones`
- [x] `garmin_get_weight_goals`
- [x] `garmin_get_spo2`
- [x] `garmin_get_hydration`, `garmin_get_wellness_activities`, `garmin_get_food_log`
      (formatted from Garmin's OpenAPI spec; no data on the owner's account)
- [x] `garmin_get_menstrual_cycle`, `garmin_get_menstrual_day` (from the spec; no data)
- [x] `garmin_get_activity_workouts` (decoded workout steps and targets)
- [x] README tool list, CHANGELOG, server instructions

**Done when:** all 26 tools are deployed; the ones with data on the owner's account
answer a question from Claude; the untested ones return Garmin's response cleanly.

Tested 2026-11-03 against the owner's account from a local script (one request per tool,
the 28-day stress limit, `no_data` for hydration, wellness activities, menstrual cycle
and workouts). Deployed 2026-11-03; the live connector returns the new sleep fields.

### Phase 7 — Polish + go public (optional)

- [x] `SECURITY.md`
- [ ] Final README (incl. how to pull updates into a deployed copy and how to rotate the
      Garmin key)
- [ ] Switch repo visibility to public, and turn on private vulnerability reporting
      (Settings → Security) so SECURITY.md's reporting link works
- [ ] Add the "Deploy to Cloudflare" button to the README and test a from-scratch
      deploy with a second Cloudflare account (requires the public repo)

## Security & privacy

- Single-user instances; OAuth in front of every MCP request, granted only after the
  owner enters `OWNER_PASSPHRASE` (long random value, rate-limited sign-in,
  CSRF-protected)
- Sign-in happens once when adding the connector; refresh tokens keep it working
- Secrets only as Worker secrets — never committed, never logged
- Read-only tools only
- Precise GPS coordinates stripped by default
- Garmin responses and tokens never written to logs
- Activity names and notes treated as untrusted data, not instructions
- Fixtures are synthetic; no real health data in the repo

## Open decisions

- Optional later: pluggable login (GitHub / Cloudflare Access) for users who want 2FA

## Decisions made

- **Auth: built-in passphrase login (2026-11-01).** Chosen over GitHub OAuth and
  Cloudflare Access for the simplest self-hosting setup (one secret, no external app).
  Trade-off: no 2FA, and the login page is our own code, so it gets dedicated tests.
- **Units: metric only, as Garmin returns them (2026-11-01).** No imperial conversion
  and no `UNITS` setting. Values are scaled within metric (km, kg, min/km) with the
  unit in every key, so Claude doesn't have to do unit maths.
- **MCP transport: stateless `createMcpHandler` + MCP SDK v2 (2026-11-01).**
  `McpAgent` is deprecated and feature-frozen, and its Durable Object sessions add
  nothing for request/response tools. The only cross-request state (the Garmin token)
  lives in KV. Rule going forward: no deprecated features or libraries.
- **Deploy to Cloudflare button: yes, as the last step (2026-11-01).** The repo is
  structured for it from Phase 1; the button itself is added once the repo is public.
- **Tooling (2026-11-01):** npm; ESLint + Prettier.
- **Activity search tool (2026-11-01):** added so Claude can get Garmin activity IDs;
  also covers users who don't use Strava. Now `garmin_search_activities`.
- **Tool naming (2026-11-01):** `garmin_` prefix, `search_` / `get_` verbs, aligned with
  other Garmin MCP servers. `get_recovery_snapshot` → `garmin_get_day` (now also lists
  the day's activities), `get_profile_zones` → `garmin_get_profile`.
- **Staged tool release (2026-11-01):** first release = 5 basic tools with the same
  names and scope as other Garmin MCP servers (`garmin_search_activities`,
  `garmin_get_activity`, `garmin_get_sleep`, `garmin_get_hrv`, `garmin_get_profile`) +
  combined `garmin_get_day`. Calculated tools come in Phase 5. Rejected: a
  generic `garmin_get_daily_metrics` tool, and mirroring all ~25 endpoints as tools.
  Comparison table with other projects removed from the plan.
- **Tool additions (2026-11-01):** interval totals in `garmin_get_activity`; intensity minutes in `garmin_get_training_summary`; optional
  menstrual cycle phase in `garmin_get_health_metrics`. Not included: weight goals,
  wellness activities, fitness age; food log possible later.
- **Scope: works without Strava (2026-11-01).** The server covers training data too
  (activities, laps, streams, training summary, best efforts), not just recovery.
  Accepted gaps: gear / shoe mileage and Strava-only features. Per-lap FIT data is
  optional (`ENABLE_FIT_LAPS`), see the FIT decision below.
- **FIT files optional, free plan first (2026-11-01).** Phase 0 showed FIT decoding
  exceeds the free plan's 10 ms CPU limit for runs of ~1 h or longer, while streams,
  best efforts and training load are available from JSON endpoints. So no tool depends
  on FIT; per-lap data is a later opt-in (`ENABLE_FIT_LAPS`, recommended with Workers
  Paid). The README notes that large FIT files may not work on the free plan.
- **No planned vs. actual for now (2026-11-01).** The owner doesn't use workouts created
  in Garmin Connect, so `/activity/{id}/workouts` couldn't be tested (it returned `[]`
  for an interval session started on the watch). Listed under possible later. `garmin_get_activity` reports interval totals by type;
  per-rep rows come from FIT splits with `ENABLE_FIT_LAPS`.
- **Sign-in lifetime (2026-11-01):** access token 1 h, refresh token 30 days rolling.
  Signing in again after 30 days of no use is acceptable.
- **Hosting URL (2026-11-01):** free `*.workers.dev` to start.
- **Time zone (2026-11-01):** "today" is computed in the user's time zone, taken from
  the Garmin profile; optional `TIMEZONE` var overrides it; UTC with a warning as the
  last resort.
- **Language (2026-11-01):** English for tool names, descriptions, output, errors and docs.
- **Repository (2026-11-01):** `git@github.com:hannta/garmin-connect-personal-api-mcp.git`,
  private until Phase 7.
- **Activity times (2026-11-01):** activities use their own local time and offset
  (from Garmin's local + GMT start times), not the profile time zone. The Garmin account
  time zone stays `Europe/Athens`: Garmin offers no Helsinki option, and the two are
  identical all year.
- **Types file (2026-11-01):** `worker-configuration.d.ts` is committed and generated from
  `.dev.vars.example` (`npm run types`), so it's the same on every machine; CI runs
  `wrangler types --check`.
- **OAuth shape (2026-11-02):** one Worker with the combined `OAuthProvider`, not the
  library's recommended split Workers: a single Worker keeps self-hosting and the Deploy
  button simple, and the combined shape remains fully supported.
- **Tools mirror Garmin's data (2026-11-02):** supersedes "calculated tools" and the
  earlier rejection of mirroring endpoints. One tool per kind of Garmin data plus a few
  merged tools (`garmin_get_day`, `garmin_get_days`); Claude does the analysis. Closest
  projects ([trainingload-ai/garmin-personal-api-mcp](https://github.com/trainingload-ai/garmin-personal-api-mcp),
  [Mason-Levyy/garmin-personal-mcp](https://github.com/Mason-Levyy/garmin-personal-mcp))
  also mirror endpoints (~25 tools each, raw output, local only). Differences kept here:
  compact metric output, plain `summary` statistics, and fewer tools — endpoints whose
  data another tool already returns (steps, stress, Body Battery are in daily
  summaries) get no tool of their own. Dropped: `garmin_get_recovery_trend`,
  `garmin_get_training_summary`, `garmin_get_best_efforts`, `garmin_get_health_metrics`.
  Not now: hydration, SpO2, fitness age, food log, menstrual cycle.
- **Range calls (2026-11-02):** default 7 days; one Garmin request per source; a range
  over the endpoint's maximum returns an error asking Claude to split it, instead of
  the server splitting it.
- **Match the other projects' tool set (2026-11-03):** add the 13 tools that
  [trainingload-ai/garmin-personal-api-mcp](https://github.com/trainingload-ai/garmin-personal-api-mcp)
  and [Mason-Levyy/garmin-personal-mcp](https://github.com/Mason-Levyy/garmin-personal-mcp)
  both have, with the same names, plus `garmin_get_heart_rate_zones`. Supersedes "Not
  now" in the tool-mirroring decision. Tools for data the owner doesn't track pass
  Garmin's fields through instead of custom formatting.
- **Free-plan CPU: document and monitor (2026-11-03).** Tool calls can exceed the free
  plan's 10 ms CPU limit, mostly from OAuth, MCP SDK and zod overhead on fresh Worker
  instances, which our own code can't reliably get under. No benchmarks in the docs:
  README notes the limit, DEPLOY.md shows how to spot `exceededCpu`, and Workers Paid
  is the fix if Cloudflare starts enforcing it.
- **No cookie secret (2026-11-02):** `COOKIE_ENCRYPTION_KEY` dropped; the library's
  consent helpers provide CSRF protection.
- **Spec-based tools instead of pass-through (2026-11-03):** Garmin's Swagger page
  embeds the full OpenAPI spec. Its field names matched every real response we had (8
  endpoints), so the five endpoints without data on the owner's account are formatted
  like the others rather than passed through. Its date / time types (objects) don't
  match reality (strings), so both are accepted. Extras from the spec: heart-rate alerts
  and achievable fitness age.
- **Spec audit of the earlier tools (2026-11-03):** no unit or meaning errors (the
  spec's "weight in kilograms" is wrong: real values are grams, as the code assumes).
  Added fields Garmin really sends: sleep score optimal ranges, sleep-need reasons and
  the next night's need, naps with times, respiration range and breathing disruptions;
  activity min/max elevation, temperature and respiration, max cadence, sweat loss,
  training-effect messages, PR flag, strength sets per exercise category and per-interval
  step length; calories, hydration, HR alert count and pre-sleep Body Battery in the
  daily summary; training days in the profile. VO2max and lactate threshold are mapped
  but empty in real data. `garmin_get_sleep` now reads the one-day range endpoint,
  which returns the same fields plus naps and breathing disruptions.
- **Phase 7 scope (2026-11-03):** skipped: tuning tool descriptions from real usage,
  caching HR zones and profile, structured logging, and a reminder before the Garmin key
  expires. Kept: `SECURITY.md`, the final README, going public and the Deploy button.
