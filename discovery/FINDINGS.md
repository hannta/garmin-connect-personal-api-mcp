# Phase 0 — API discovery findings (2026-11-01)

Tested against the Garmin Connect Personal API with a real key from a Garmin Epix Pro
(Gen 2). Raw responses are in `discovery/raw/` (git-ignored, personal data). This file
contains shapes and conclusions only — no personal values.

Helpers: `discovery/garmin.sh` (token + GET, never prints the key) and
`discovery/shape.py` (prints the shape of a JSON response).

## Auth

- Base URL: `https://personal.connectapi.garmin.com`
- Token: `POST /personalapitoken-service/personal-api/personal-api-key/token` with
  header `Authorization: ApiKey <key>`. Response body is the raw access token (a JWT),
  not JSON.
- Access token lifetime: **24 hours** (`exp - iat` = 1440 min). Expiry can be read from
  the JWT `exp` claim — no extra call needed.
- Data calls: `Authorization: Bearer <token>`.
- No rate-limit headers are returned (`x-ratelimit-*`, `retry-after` absent on 200).
  Responses are `cache-control: no-cache, no-store, private`.
- `Accept: application/json` on a file download returns **406**; use `Accept: */*`.

## Endpoints tested

| Endpoint                                                                               | Status  | Notes                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /userprofile-service/userprofile/settings`                                        | 200     | Has **`timeZone`** (IANA, e.g. `Europe/…`), `measurementSystem`, `firstDayOfWeek`                                                                                                                                                |
| `GET /biometric-service/heartRateZones/v2`                                             | 200     | Array per sport; zone floors, max HR, LTHR, method (`HR_MAX`, …)                                                                                                                                                                 |
| `GET /usersummary-service/v2/dailysummaries?startDate&endDate`                         | 200     | `{data:[…]}` — steps, floors, calories, **resting / min / max HR**, **intensity minutes** (`moderate`, `vigorous`, `goal`), stress, **Body Battery** (min / max / charged / drained / latest + feedback), hydration, respiration |
| `GET /sleep-service/sleep/dailySleep?date`                                             | 200     | One night, keyed by the **wake-up date**. Stage seconds (deep / light / REM / awake), score (`sleepScores.overall.value` + qualifiers), sleep need, avg HR, respiration, avg sleep stress. No stage timeline                     |
| `GET /hrv-service/hrv/{date}`                                                          | 200     | `hrvSummary`: last-night avg, 5-min high, weekly avg, baseline bands, status (`BALANCED`, …); `hrvReadings[]` (~96 per night, 5-min)                                                                                             |
| `GET /wellness-service/wellness/bodyBattery/reports/daily?startDate&endDate`           | 200     | Daily report with samples                                                                                                                                                                                                        |
| `GET /usersummary-service/stats/stress/daily/{start}/{end}`                            | 200     | Overall level + durations per stress band                                                                                                                                                                                        |
| `GET /wellness-service/wellness/dailyHeartRate?date`                                   | 200     | All-day HR samples                                                                                                                                                                                                               |
| `GET /weight-service/weight/range/{start}/{end}`                                       | 200     | `dailyWeightSummaries[]`, weight in **grams**                                                                                                                                                                                    |
| `GET /activitylist-service/activities/search/activities?startDate&endDate&start&limit` | 200     | Array, ~100 fields per activity (see below)                                                                                                                                                                                      |
| `GET /activity-service/activity/{id}`                                                  | 200     | `summaryDTO` + `splitSummaries[]`; **no per-lap array**                                                                                                                                                                          |
| `GET /activity-service/activity/{id}/workouts`                                         | 200     | `[]` for an activity not started from a structured workout                                                                                                                                                                       |
| `GET /activity-service/activity/{id}/details?maxChartSize=N`                           | **200** | **Server-side downsampled streams** (not used by other projects) — see below                                                                                                                                                     |
| `GET /download-service/files/activity/{id}`                                            | 200     | ZIP containing one `.fit` file                                                                                                                                                                                                   |
| `…/activity/{id}/splits`, `/typedsplits`, `/hrTimeInZones`, `/exerciseSets`            | 404     | Not in the Personal API                                                                                                                                                                                                          |
| `/metrics-service/…/trainingreadiness`, `…/maxmet` (VO2max)                            | 404     | **Confirmed gap**                                                                                                                                                                                                                |
| `/personalrecord-service/…`, `/gear-service/…`                                         | 404     | **Confirmed gap**                                                                                                                                                                                                                |

## Activity search — richer than expected

Each activity in the search result already includes:

- distance, duration, moving duration, avg / max speed, **avg grade-adjusted speed**
- avg / max HR, **time in each HR zone** (`hrTimeInZone_1..5`) and power zone
- cadence, stride length, ground contact time, vertical oscillation / ratio, power,
  normalized power
- **aerobic / anaerobic training effect**, `trainingEffectLabel`,
  **`activityTrainingLoad`**, moderate / vigorous intensity minutes
- **`fastestSplit_1000`, `_1609`, `_5000`, `_10000`, `_21098`, `_42195`** (seconds) —
  best efforts within the activity, present when the activity is long enough
- `startTimeLocal` / `startTimeGMT`, `lapCount`, `differenceBodyBattery`

Activity details add RPE / feel (`directWorkoutRpe`, `directWorkoutFeel`), stamina,
temperature, respiration and `splitSummaries[]` grouped by type (`INTERVAL_WARMUP`,
`INTERVAL_ACTIVE`, `INTERVAL_RECOVERY`, `RWD_RUN`, `RWD_WALK`, `RWD_STAND`) with
count and totals per type — but not one row per lap.

## Range endpoints and limits (tested 2026-11-02)

Found via the endpoint list of Garmin's Python client
([garmin-connect-personal-api-python](https://pypi.org/project/garmin-connect-personal-api-python/)).

| Endpoint                                                               | Largest range that worked                                                     | Over the limit |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| `GET /sleep-service/sleep/dailySleepSummariesByDate?startDate&endDate` | 31 nights; same fields as `dailySleep`                                        | 94 nights: 400 |
| `GET /usersummary-service/v2/dailysummaries?startDate&endDate`         | 180 days                                                                      | 364 days: 500  |
| `GET /hrv-service/hrv/daily/{start}/{end}`                             | 365 days                                                                      | —              |
| `GET /activitylist-service/activities/search/activities?…&limit`       | 100 per page (~470 KB, < 1 ms to parse)                                       | 1000: 500      |
| `GET /fitnessage-service/fitnessage/v2/{date}`                         | single date; components: resting HR, BMI, vigorous days / minutes — no VO2max | —              |

Other endpoints in that client, tested 2026-11-03 (largest range per request):

| Endpoint                                                             | Range limit       | On the owner's account                                                   |
| -------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `GET /usersummary-service/stats/steps/daily/{start}/{end}`           | 28 days (29: 400) | steps, goal, distance per day                                            |
| `GET /usersummary-service/stats/stress/daily/{start}/{end}`          | 28 days (29: 400) | overall level + rest / low / medium / high durations                     |
| `GET /usersummary-service/stats/hydration/daily/{start}/{end}`       | 31 days (32: 400) | `[]`                                                                     |
| `GET /wellness-service/wellness/bodyBattery/reports/daily?…`         | 31 days (32: 400) | charged, drained, samples, activity events; `chunks=N` sets sample count |
| `GET /wellnessactivity-service/activity/summary/range/{start}/{end}` | 366 days worked   | `[]`                                                                     |
| `GET /goal-service/goal/user/effective/weightgoal/{start}/{end}`     | 366 days worked   | one goal (grams)                                                         |
| `GET /wellness-service/wellness/daily/spo2acclimation/{date}`        | single date       | averages null (SpO2 not recorded), hourly + altitude arrays              |
| `GET /nutrition-service/food/logs/{date}`                            | single date       | goals only, no meals                                                     |
| `GET /periodichealth-service/menstrualcycle/summary/{date}`          | single date       | 204 No Content                                                           |

Body Battery activity events have `eventType`, `eventStartTimeGmt`, `timezoneOffset`,
`durationInMilliseconds`, `bodyBatteryImpact`, `feedbackType` and `shortFeedback`.

## Activity details (streams) endpoint

`/details?maxChartSize=100` returned 128 rows for a 3 900-record activity (server-side
downsampling, ~100 KB JSON). `metricDescriptors[]` maps column index → key + unit;
27 channels including HR, speed, grade-adjusted speed, power, cadence, elevation,
distance, GCT, vertical oscillation, stride length, respiration, temperature, stamina,
Body Battery, performance condition, timestamp and lat / long (to be stripped).

## FIT files

Decoded with `@garmin/fitsdk` 21.218.0 + `fflate` 0.8.3 (Node 24, Apple Silicon):

| Activity            | ZIP / FIT size  | Records | Laps | Unzip   | Decode       |
| ------------------- | --------------- | ------- | ---- | ------- | ------------ |
| Marathon (~3 h)     | 430 KB / 1.0 MB | ~11 000 | 43   | 6–10 ms | **48–61 ms** |
| Interval run (~1 h) | 170 KB          | ~3 900  | 30   | 1–3 ms  | **~18 ms**   |
| Strength (~45 min)  | 20 KB           | ~2 700  | —    | <1 ms   | ~2.5 ms      |

- **Exceeds the free Workers plan's 10 ms CPU limit** for any run of ~1 h or longer.
- FIT is the only source of **per-lap** data (lap messages have pace, HR, power,
  cadence, dynamics, intensity, lap trigger).
- Strength sets: only a single set message on this device / session — not usable.
- No `workout_step` messages in these files (no structured workout was used).

## Units and timestamps

- Metric base units confirmed: meters, seconds, m/s, bpm; **weight in grams**;
  stride length and vertical oscillation in **cm**, GCT in **ms**.
- Timestamps come in **three formats**, so `src/lib/dates.ts` must handle all:
  - epoch ms (sleep: `sleepStartTimestampGMT`; `*Local` variants are local wall time
    encoded as if UTC)
  - ISO-like strings without offset, paired GMT + local (`"2026-10-31T23:04:14.0"`)
  - space-separated strings (`"2026-10-30 16:38:17"` in activity search)
- Daily endpoints use the **local calendar date**; the profile's `timeZone` gives the
  zone, so the planned time-zone approach works.

## Impact on the plan

1. **Streams without FIT:** `garmin_get_activity_streams` can use `/details` with
   `maxChartSize` — no FIT decoding, fits the free plan.
2. **Best efforts without FIT:** `garmin_get_best_efforts` can take the minimum of
   `fastestSplit_*` across activities from activity search.
3. **Training load:** `garmin_get_training_summary` can use `activityTrainingLoad`,
   training effect, HR-zone times and intensity minutes from activity search.
4. **Per-lap data needs FIT**, which doesn't fit the free CPU limit for typical runs.
   Without FIT, `garmin_get_activity` has interval totals (warm-up / active / recovery)
   from `splitSummaries`, but not each rep.
5. **Planned vs. actual untested.** On an interval session started on the watch (not a
   workout created in Garmin Connect; `INTERVAL_*` split types present), `/workouts`
   returns `[]` and the FIT file has no `workout` / `workout_step` messages or lap step
   indexes. The endpoint likely only returns data for workouts created in Garmin Connect,
   which the owner doesn't use. Per-rep
   interval data exists only in FIT `split` messages (11 active / 10 recovery here).
6. **Strength sets** aren't available.
7. **Gaps confirmed:** Training Readiness, VO2max, personal records, gear.

## Still open from Phase 0

- [x] Test `/activity/{id}/workouts` on an interval session (returns `[]`; workouts created
      in Garmin Connect not available to test — see point 5)
- [x] Read the Personal API terms — confirmed OK by the owner
- [ ] Write synthetic fixtures from these shapes (can be done at the start of Phase 1)

## OpenAPI spec (2026-11-03)

The Swagger page (developer.garmin.com/gc-developer-program/personal/swagger-docs/)
embeds the full OpenAPI 3.0.1 spec: 26 paths, 109 schemas, with field descriptions and
units. Saved locally as `discovery/raw/openapi.json` (git-ignored).

- **Field names:** every field in our recorded responses (8 endpoints) is in the spec.
- **Types:** dates / times are objects in the spec (`ConnectDate` `{date, localDate}`,
  `LocalTime` `{hour, minute}`) but strings in real responses (`"2020-01-09"`,
  `"07:00:00"`).
- **Gaps:** enum values are missing for menstrual `currentPhase` (integer), `flow`,
  `symptoms`, `moods`.
- **Not in the spec:** `/activity-service/activity/{id}/details` (streams) — works, but
  undocumented.
- **Unused spec paths:** FIT download (behind `ENABLE_FIT_LAPS`), the older
  `/usersummary-service/usersummary/daily`, and `/weight-service/weight/all` (individual
  weigh-ins).
- **Workouts:** a Garmin-suggested long run returned one workout (`sport: GENERIC`,
  `workoutPhrase: LONG_WORKOUT`, no steps); field names match the spec.

## Spec audit of the earlier endpoints (2026-11-03)

- **Weight:** the spec says `weight` is in kilograms; real values are grams (7 digits,
  e.g. 72400.0).
- **Sleep:** `/sleep/dailySleepSummariesByDate` for one date returns exactly the same
  fields and values as `/sleep/dailySleep`, plus `dailyNapDTOS` (nap times, offset in
  minutes, feedback), `breathingDisruptionSeverity` and `kidSleepNote`. The single-night
  endpoint only has the nap total.
- **Strength:** activity search has `summarizedExerciseSets` (category, sets, reps,
  volume g × reps, max weight g, duration ms) and total sets / reps; activity details
  don't.
- **In the spec, empty in real data:** `vO2MaxValue`, `lactateThresholdBpm`,
  `trainingStressScore`, `maxAvgPower_*` (activity search); `heartRate.alertCount`,
  `bodyBattery.endOfDayValue`, `calories.consumedValue` (daily summary, likely only
  when there are alerts / logged food).
