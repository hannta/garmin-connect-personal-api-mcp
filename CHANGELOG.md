# Changelog

All notable changes are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project scaffold: TypeScript, Wrangler, ESLint + Prettier, Vitest, GitHub Actions CI
- Garmin Personal API client: token exchange with KV caching, typed endpoints, error mapping
- Metric unit and time-zone-aware date helpers
- OAuth 2.1 sign-in with `OWNER_PASSPHRASE`: dynamic client registration and Client ID
  Metadata Documents, 1-hour access tokens, 30-day sliding refresh, failed-sign-in
  lockout, and sign-out of all apps by changing the passphrase
- MCP server at `/mcp` (stateless Streamable HTTP) with six
  read-only tools: `garmin_get_day`, `garmin_search_activities`, `garmin_get_activity`,
  `garmin_get_sleep`, `garmin_get_hrv`, `garmin_get_profile`
- Deployment guide: [docs/DEPLOY.md](docs/DEPLOY.md)
- Range tools: `garmin_get_days`, `garmin_get_daily_summaries`,
  `garmin_get_sleep_summaries`, `garmin_get_hrv_summaries`, `garmin_get_weight`, with a
  7-day default, one Garmin request per source and `summary` statistics
- `garmin_get_activity_streams`: Garmin-downsampled time series for one activity
- `garmin_search_activities`: weekly totals (`group_by: "week"`) and fastest splits
- Full endpoint coverage (26 tools): `garmin_get_body_battery`, `garmin_get_stress`,
  `garmin_get_steps`, `garmin_get_heart_rate`, `garmin_get_spo2`,
  `garmin_get_fitness_age`, `garmin_get_heart_rate_zones`, `garmin_get_weight_goals`,
  `garmin_get_activity_workouts` (decoded workout steps and targets), and, built from
  Garmin's OpenAPI spec: `garmin_get_hydration`, `garmin_get_wellness_activities`,
  `garmin_get_food_log`, `garmin_get_menstrual_cycle`, `garmin_get_menstrual_day`
- `garmin_get_day`: Body Battery events (sleep, activities) and minutes per stress level
- `garmin_get_heart_rate`: high / low heart-rate alerts; `garmin_get_fitness_age`:
  achievable fitness age and why it is missing
- `garmin_get_sleep`: optimal range per score component, sleep-need reasons, next
  night's sleep need, naps with times, respiration range, breathing disruptions,
  personalized insight; sleep range rows add nap minutes and breathing disruptions
- `garmin_get_activity`: min / max elevation, temperature and respiration, max cadence,
  estimated sweat loss, training-effect messages, personal-record flag, strength sets
  per exercise category, step length per interval type, VO2max and lactate threshold
  when Garmin provides them; activity rows add the personal-record flag
- `garmin_get_day`: calories burned and eaten, logged hydration, heart-rate alerts,
  Body Battery before sleep; daily summary rows add calories burned
- `garmin_get_profile`: training and long-run days; zones say whether resting HR
  auto-updates

### Changed

- Activity rows leave out distance and pace for activities without distance
