# Garmin Connect Personal API notes

How the Garmin Connect Personal API actually behaves, tested against the live API with a
real key (November 2026). Garmin's
[OpenAPI spec](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
documents most of it; this page covers what the spec leaves out or gets wrong.

## Auth

- Base URL: `https://personal.connectapi.garmin.com`
- Token: `POST /personalapitoken-service/personal-api/personal-api-key/token` with
  header `Authorization: ApiKey <key>`. The response body is the raw access token (a
  JWT), not JSON.
- The access token lasts **24 hours**; its expiry is in the JWT `exp` claim.
- Data calls: `Authorization: Bearer <token>`.
- No rate-limit headers are returned. Responses are
  `cache-control: no-cache, no-store, private`.
- `Accept: application/json` on a file download returns **406**; use `Accept: */*`.

## Endpoints

| Endpoint                                                                    | Notes                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /userprofile-service/userprofile/settings`                             | Has `timeZone` (IANA), `measurementSystem`, `firstDayOfWeek`                                             |
| `GET /biometric-service/heartRateZones/v2`                                  | Array per sport: zone floors, max HR, LTHR, method                                                       |
| `GET /usersummary-service/v2/dailysummaries?startDate&endDate`              | `{data:[…]}`: steps, calories, resting / min / max HR, intensity minutes, stress, Body Battery, …        |
| `GET /sleep-service/sleep/dailySleep?date`                                  | One night, keyed by the **wake-up date**. Stage seconds, score, sleep need, HR, respiration; no timeline |
| `GET /hrv-service/hrv/{date}`                                               | `hrvSummary` (averages, baseline, status) and `hrvReadings[]` (~96 per night, every 5 min)               |
| `GET /activitylist-service/activities/search/activities`                    | ~100 fields per activity (see below)                                                                     |
| `GET /activity-service/activity/{id}`                                       | `summaryDTO` + `splitSummaries[]`; **no per-lap array**                                                  |
| `GET /activity-service/activity/{id}/workouts`                              | The structured workout the activity followed; `[]` for activities not started from one                   |
| `GET /activity-service/activity/{id}/details?maxChartSize=N`                | **Not in the spec.** Server-side downsampled time series (see below)                                     |
| `GET /download-service/files/activity/{id}`                                 | ZIP containing one `.fit` file. Holds the full GPS track, so it's never passed on                        |
| `…/activity/{id}/splits`, `/typedsplits`, `/hrTimeInZones`, `/exerciseSets` | 404: not in the Personal API                                                                             |
| Training Readiness, VO2max (`maxmet`), personal records, gear               | 404: not in the Personal API                                                                             |

## Range limits

The largest range one request accepts. Longer ranges return 400 (or 500 where noted).

| Endpoint                                                               | Largest range            |
| ---------------------------------------------------------------------- | ------------------------ |
| `GET /sleep-service/sleep/dailySleepSummariesByDate?startDate&endDate` | 31 nights                |
| `GET /usersummary-service/v2/dailysummaries?startDate&endDate`         | 180 days (364: 500)      |
| `GET /hrv-service/hrv/daily/{start}/{end}`                             | 365 days                 |
| `GET /usersummary-service/stats/steps/daily/{start}/{end}`             | 28 days                  |
| `GET /usersummary-service/stats/stress/daily/{start}/{end}`            | 28 days                  |
| `GET /usersummary-service/stats/hydration/daily/{start}/{end}`         | 31 days                  |
| `GET /wellness-service/wellness/bodyBattery/reports/daily?…`           | 31 days                  |
| `GET /wellnessactivity-service/activity/summary/range/{start}/{end}`   | 366 days worked          |
| `GET /goal-service/goal/user/effective/weightgoal/{start}/{end}`       | 366 days worked          |
| `GET /activitylist-service/activities/search/activities?…&limit`       | 100 per page (1000: 500) |

Single-date endpoints: fitness age, SpO2, heart rate, food log, menstrual cycle. Without
data, range endpoints return `[]` and the menstrual cycle summary returns 204 No Content.

## Activities

Each activity in the search result already includes:

- distance, duration, moving duration, avg / max speed, avg grade-adjusted speed
- avg / max HR, time in each HR zone (`hrTimeInZone_1..5`) and power zone
- cadence, stride length, ground contact time, vertical oscillation / ratio, power
- aerobic / anaerobic training effect, `activityTrainingLoad`, intensity minutes
- `fastestSplit_1000`, `_1609`, `_5000`, `_10000`, `_21098`, `_42195` (seconds): best
  efforts within the activity, present when it was long enough
- strength sessions: `summarizedExerciseSets` (category, sets, reps, volume, max weight)

Activity details add RPE / feel, stamina, temperature, respiration and
`splitSummaries[]` grouped by type (`INTERVAL_WARMUP`, `INTERVAL_ACTIVE`,
`INTERVAL_RECOVERY`, `RWD_RUN`, …) with totals per type, but not one row per lap.

**Streams:** `/details?maxChartSize=100` returned 128 rows for an hour-long run of about
3 900 records (server-side downsampling). `metricDescriptors[]` maps column index to
key and unit; channels include HR, speed, grade-adjusted speed, power, cadence,
elevation, running dynamics, respiration, stamina, Body Battery and lat / long (stripped
by this server).

**FIT files** are the only source of per-lap data:

- `lap` messages have pace, HR, power, cadence, running dynamics, intensity and trigger.
  Their distances add up to the activity's total.
- `split` messages hold each interval rep (`split_type` active, recovery, warm-up, …),
  plus run / walk detection splits and, on a plain run, one active split for the whole
  activity.
- Strength files have no `lap` messages, although activity search says `lapCount: 1`.
- Cadence on foot is per leg: `lap` has an integer plus `avg_fractional_cadence`, `split`
  a value with its fraction included. Doubled, both match `averageRunningCadence…`.
- Sizes: a marathon was a 440 KB ZIP holding a 1 MB FIT file.

## Units and formats

- Metric base units: meters, seconds, m/s, bpm. **Weight is in grams**, although the
  spec says kilograms. Stride length and vertical oscillation are in cm, ground contact
  time in ms.
- Timestamps come in three formats:
  - epoch ms (`*Local` variants are local wall time encoded as if UTC)
  - ISO-like strings without offset, paired GMT + local (`"YYYY-MM-DDTHH:MM:SS.0"`)
  - space-separated strings (`"YYYY-MM-DD HH:MM:SS"` in activity search)
- Dates and times are objects in the spec (`ConnectDate` `{date, localDate}`,
  `LocalTime` `{hour, minute}`) but strings in real responses.
- Daily endpoints use the local calendar date in the profile's `timeZone`.

## Where the spec differs from real data

- **Sleep:** `/sleep/dailySleepSummariesByDate` for one date returns the same fields as
  `/sleep/dailySleep`, plus naps (`dailyNapDTOS`) and `breathingDisruptionSeverity`. The
  single-night endpoint only has the nap total.
- **Missing enums:** menstrual `currentPhase` (an undocumented integer), `flow`,
  `symptoms`, `moods`.
- **In the spec but empty so far:** `vO2MaxValue`, `lactateThresholdBpm`,
  `trainingStressScore`, `maxAvgPower_*` in activity search.
- **Unused spec paths:** the older `/usersummary-service/usersummary/daily` and
  `/weight-service/weight/all`.
