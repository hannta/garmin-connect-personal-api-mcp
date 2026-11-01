# garmin-connect-personal-api-mcp

> **Unofficial project.** Not affiliated with, endorsed by or supported by Garmin.
> "Garmin" and "Garmin Connect" are trademarks of Garmin Ltd. or its subsidiaries.

A self-hosted, read-only [MCP](https://modelcontextprotocol.io) server that gives Claude
(and other MCP clients) access to your own Garmin Connect training, recovery and health
data through the official **Garmin Connect Personal API**. It runs on your own
Cloudflare account, so it works in the Claude web and mobile apps as a custom connector.

**Status:** early development — not usable yet. See [PLAN.md](PLAN.md).

## Planned tools

First release:

| Tool                       | What it returns                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `garmin_get_day`           | One day at a glance: sleep, HRV, Body Battery, stress, resting HR, intensity minutes, activities |
| `garmin_search_activities` | Activities in a date range, with Garmin activity IDs                                             |
| `garmin_get_activity`      | One activity in depth: pace, HR zones, running dynamics, power, training effect, interval totals |
| `garmin_get_sleep`         | One night's sleep in detail                                                                      |
| `garmin_get_hrv`           | One night's HRV with baseline and status                                                         |
| `garmin_get_profile`       | Profile settings and heart-rate zones                                                            |

All output is metric (km, min/km, kg).

## Free vs. paid Cloudflare plan

Everything works on Cloudflare's **free Workers plan**. Tools read Garmin's JSON
endpoints, which stay well within the free plan's 10 ms CPU limit regardless of how long
an activity is.

The one exception is a planned, optional feature: **per-lap data from FIT files**
(`ENABLE_FIT_LAPS`). Decoding a FIT file takes roughly 20 ms for a 1-hour run and
50–60 ms for a marathon, which exceeds the free plan's limit. Enable it only on
**Workers Paid** ($5/month). With it off (the default), activity tools return interval
totals instead.

## Not available from the Personal API

Training Readiness, Training Status, VO2max, personal records, gear / shoe mileage and
strength sets are not exposed by the Personal API, so this server can't provide them.

## Development

Requires Node.js 24+.

```bash
npm install
cp .dev.vars.example .dev.vars   # then add your GARMIN_API_KEY
npm run check                     # typecheck, lint, format check, tests
npm run today                     # print today's recovery data using your key
```

`.dev.vars` is git-ignored. Tests use synthetic fixtures only — never real data.

## License

[MIT](LICENSE)
