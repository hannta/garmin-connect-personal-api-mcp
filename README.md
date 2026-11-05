# Garmin Connect Personal API MCP

> Not affiliated with or endorsed by Garmin. Garmin and Garmin Connect are trademarks of
> Garmin Ltd.

A read-only [MCP](https://modelcontextprotocol.io) server that gives AI assistants your
own Garmin Connect training, recovery and health data through the official **Garmin
Connect Personal API**. Run it on your own computer, or host it on your own Cloudflare
account to use it from anywhere.

> AI agents: to set this up for a user, follow [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md).

## Setup

You need a Garmin Connect Personal API key, which you create in Garmin Connect on the web.

### Run locally

The quickest way, for Claude Code, Claude Desktop, Cursor, VS Code and other clients that
run local servers. Needs Node.js 22+.

Paste this into your coding agent:

```text
Connect @hannta/garmin-connect-personal-api-mcp
```

Or do it yourself: [docs/LOCAL.md](docs/LOCAL.md).

### Host on Cloudflare

For Claude on the web and on mobile, and any other client that connects to remote servers
with OAuth. The free plan is enough, apart from one
[known limitation](docs/DEPLOY.md#known-limitations).

- **One click:**

  [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hannta/garmin-connect-personal-api-mcp)

- **Manual:** follow [docs/DEPLOY.md](docs/DEPLOY.md).

Then [connect your MCP client](docs/DEPLOY.md#5-connect-a-client), such as Claude,
ChatGPT, Cursor or VS Code.

## Tools

| Tool                             | What it returns                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `garmin_get_day`                 | One day at a glance: sleep, HRV, Body Battery, stress, resting HR, intensity minutes, activities                             |
| `garmin_get_days`                | The same over a date range, one row per day, with daily activity totals and training load                                    |
| `garmin_search_activities`       | Activities in a date range with Garmin IDs and fastest splits, or totals per week                                            |
| `garmin_get_activity`            | One activity in depth: pace, HR zones, running dynamics, power, training effect, interval totals, strength sets per exercise |
| `garmin_get_activity_streams`    | One activity's time series (HR, pace, grade-adjusted pace, cadence, power, elevation, …)                                     |
| `garmin_get_activity_laps`       | One row per lap and interval rep, from the activity's FIT file                                                               |
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

### Good to know

- Range tools default to the last 7 days. If a range is too long for one Garmin
  request, the error says the maximum and the assistant splits it into several calls.
- Output is metric, with the unit in every field name. Dates are `YYYY-MM-DD` in your
  time zone; sleep and HRV are keyed by the wake-up date.
- Location, sexual activity and sex drive data are never returned.
- **Known limitation:** `garmin_get_activity_laps` can fail on long activities on the
  Cloudflare free plan. See [Known limitations](docs/DEPLOY.md#known-limitations).

## Development

Requires Node.js 24+.

```bash
npm install
cp .dev.vars.example .dev.vars   # then add GARMIN_API_KEY and OWNER_PASSPHRASE
npm run check                     # typecheck, lint, format check, tests
npm run today                     # print today's recovery data using your key
npm run dev                       # MCP server at http://localhost:8787/mcp
npm run build                     # local server in dist/cli.mjs
```

To try the local server, connect the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) to it and sign in with
`OWNER_PASSPHRASE`.

Architecture and conventions: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

[MIT](LICENSE)
