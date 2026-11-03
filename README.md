# garmin-connect-personal-api-mcp

> **Unofficial project.** Not affiliated with, endorsed by or supported by Garmin.
> "Garmin" and "Garmin Connect" are trademarks of Garmin Ltd. or its subsidiaries.

A self-hosted, read-only [MCP](https://modelcontextprotocol.io) server that gives Claude
(and other MCP clients) access to your own Garmin Connect training, recovery and health
data through the official **Garmin Connect Personal API**. It runs on your own
Cloudflare account, so it works in the Claude web and mobile apps as a custom connector.

**Status:** early development. The daily, single-activity and date-range tools run on
Cloudflare; the full-coverage tools (Body Battery, stress, steps, …) are new. See
[PLAN.md](PLAN.md).

To run your own: [docs/DEPLOY.md](docs/DEPLOY.md).

## Tools

| Tool                             | What it returns                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `garmin_get_day`                 | One day at a glance: sleep, HRV, Body Battery, stress, resting HR, intensity minutes, activities                             |
| `garmin_get_days`                | The same over a date range, one row per day, with daily activity totals and training load                                    |
| `garmin_search_activities`       | Activities in a date range with Garmin IDs and fastest splits, or totals per week                                            |
| `garmin_get_activity`            | One activity in depth: pace, HR zones, running dynamics, power, training effect, interval totals, strength sets per exercise |
| `garmin_get_activity_streams`    | One activity's time series (HR, pace, grade-adjusted pace, cadence, power, elevation, …)                                     |
| `garmin_get_sleep`               | One night's sleep in detail: score components with optimal ranges, sleep need and why it changed, naps                       |
| `garmin_get_sleep_summaries`     | Sleep per night over a date range                                                                                            |
| `garmin_get_hrv`                 | One night's HRV with baseline, status and overnight readings                                                                 |
| `garmin_get_hrv_summaries`       | HRV per night over a date range                                                                                              |
| `garmin_get_daily_summaries`     | Resting HR, Body Battery, stress, intensity minutes, steps per day over a date range                                         |
| `garmin_get_weight`              | Weigh-ins and body composition over a date range                                                                             |
| `garmin_get_profile`             | Profile settings and heart-rate zones                                                                                        |
| `garmin_get_body_battery`        | Body Battery per day: charged, drained and the sleep / activity events behind it                                             |
| `garmin_get_stress`              | Stress per day: average level and minutes at rest / low / medium / high                                                      |
| `garmin_get_steps`               | Steps per day with goal and distance                                                                                         |
| `garmin_get_heart_rate`          | One day's resting / min / max heart rate, optionally averaged per 15 minutes                                                 |
| `garmin_get_spo2`                | One day's blood oxygen (Pulse Ox), optionally hourly with altitude                                                           |
| `garmin_get_fitness_age`         | Fitness age and its components (resting HR, BMI, vigorous days / minutes)                                                    |
| `garmin_get_heart_rate_zones`    | Heart-rate zones per sport                                                                                                   |
| `garmin_get_weight_goals`        | Weight goals in effect (target kg)                                                                                           |
| `garmin_get_activity_workouts`   | The structured workout an activity followed: steps, targets (HR, pace, power) and repeats                                    |
| `garmin_get_hydration`           | Hydration per day: intake, goal, sweat loss (ml)                                                                             |
| `garmin_get_food_log`            | One day's food log: calories and macros eaten vs. goals, per meal and food                                                   |
| `garmin_get_wellness_activities` | Wellness sessions (e.g. Health Snapshot, breathwork) with HR, stress, HRV, SpO2                                              |
| `garmin_get_menstrual_cycle`     | Cycle day, period and fertile window, predictions and cycle analysis                                                         |
| `garmin_get_menstrual_day`       | One day's logged flow, symptoms and moods, with that day's cycle summary                                                     |

The last five were built from Garmin's
[OpenAPI spec](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
because the developer's account has no such data; if their output looks wrong with your
data, please open an issue. They return `no_data` when nothing is logged. Sexual activity
and sex drive logs are never returned.

Range tools default to the last 7 days and make one Garmin request per source. A range
longer than one request allows (e.g. 31 nights of sleep) returns an error with the
maximum, and Claude splits it into several calls. Range results include plain average /
min / max statistics; the analysis is left to Claude.

All output is metric (km, min/km, kg), with the unit in every field name. Dates are
`YYYY-MM-DD` in your time zone (from your Garmin profile, or the `TIMEZONE` var);
sleep and HRV are keyed by the wake-up date. Location data is never returned.

## Free vs. paid Cloudflare plan

Everything works on Cloudflare's **free Workers plan**. Tool calls can go over the free
plan's 10 ms CPU limit, mostly from library overhead (OAuth and the MCP SDK); so far
Cloudflare hasn't rejected them. If calls start failing with "Exceeded CPU Time Limits"
(error 1102), switch to **Workers Paid** ($5/month) — see
[docs/DEPLOY.md](docs/DEPLOY.md#operating).

A planned, optional feature needs Workers Paid regardless: **per-lap data from FIT files**
(`ENABLE_FIT_LAPS`). Decoding a FIT file takes roughly 20 ms for a 1-hour run and
50–60 ms for a marathon, which exceeds the free plan's limit. Enable it only on
**Workers Paid** ($5/month). With it off (the default), activity tools return interval
totals instead.

## Security

- **Sign-in:** OAuth 2.1 in front of `/mcp`. You approve each app once on a sign-in page
  with your `OWNER_PASSPHRASE`; Claude then keeps access with refresh tokens. Access
  tokens last 1 hour; sign-in lasts 30 days from the last use.
- **Brute force:** 5 wrong passphrases from one IP, or 20 in total, pause sign-in for
  15 minutes. Connected apps keep working.
- **Sign everyone out:** change `OWNER_PASSPHRASE`. Every existing token and refresh
  token stops working.
- **Read-only:** no tool writes to Garmin. Location data is never returned.
- Secrets live only in Worker secrets; the API key, tokens and passphrase are never
  logged.

## Not available from the Personal API

Training Readiness, Training Status, a VO2max history, a personal-records list, gear /
shoe mileage and individual strength sets are not exposed by the Personal API, so this
server can't provide them. Strength activities do include sets, reps and weight per
exercise category. Activity search has a per-activity VO2max field in Garmin's spec,
but it has been empty so far; the tools return it when Garmin fills it.

## Development

Requires Node.js 24+.

```bash
npm install
cp .dev.vars.example .dev.vars   # then add GARMIN_API_KEY and OWNER_PASSPHRASE
npm run check                     # typecheck, lint, format check, tests
npm run today                     # print today's recovery data using your key
npm run dev                       # MCP server at http://localhost:8787/mcp
```

The MCP endpoint requires OAuth. Try it with the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) (Streamable HTTP,
`http://localhost:8787/mcp`): it registers itself, opens the sign-in page, and you enter
`OWNER_PASSPHRASE`.

`.dev.vars` is git-ignored. Tests use synthetic fixtures only — never real data.

## License

[MIT](LICENSE)
