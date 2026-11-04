# Changelog

All notable changes are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-04

First public release.

### Added

- Read-only MCP server at `/mcp` (stateless Streamable HTTP) on Cloudflare Workers, with
  27 tools for the Garmin Connect Personal API:
  - Daily overview: `garmin_get_day`, `garmin_get_days`
  - Activities: `garmin_search_activities`, `garmin_get_activity`,
    `garmin_get_activity_streams`, `garmin_get_activity_laps`,
    `garmin_get_activity_workouts`
  - Sleep and HRV: `garmin_get_sleep`, `garmin_get_sleep_summaries`, `garmin_get_hrv`,
    `garmin_get_hrv_summaries`
  - Daily metrics: `garmin_get_daily_summaries`, `garmin_get_body_battery`,
    `garmin_get_stress`, `garmin_get_steps`, `garmin_get_heart_rate`, `garmin_get_spo2`
  - Body and profile: `garmin_get_weight`, `garmin_get_weight_goals`,
    `garmin_get_fitness_age`, `garmin_get_heart_rate_zones`, `garmin_get_profile`
  - Nutrition and wellness: `garmin_get_hydration`, `garmin_get_food_log`,
    `garmin_get_wellness_activities`
  - Menstrual tracking: `garmin_get_menstrual_cycle`, `garmin_get_menstrual_day`
- Metric output with the unit in every field name, and dates in the user's time zone
- Built-in FIT reader for per-lap and per-rep data, which never reads position fields
- OAuth 2.1 sign-in with `OWNER_PASSPHRASE`: dynamic client registration and Client ID
  Metadata Documents, 1-hour access tokens, 30-day sliding refresh, failed-sign-in
  lockout, and sign-out of all apps by changing the passphrase
- [Deployment guide](docs/DEPLOY.md), including a Deploy to Cloudflare button
- [Security policy](SECURITY.md)

### Known limitations

- `garmin_get_activity_laps` can exceed the Cloudflare free plan's CPU limit on long
  activities. See [Known limitations](docs/DEPLOY.md#known-limitations).
