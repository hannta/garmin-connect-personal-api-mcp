# Changelog

All notable changes are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project scaffold: TypeScript, Wrangler, ESLint + Prettier, Vitest, GitHub Actions CI
- Garmin Personal API client: token exchange with KV caching, typed endpoints, error mapping
- Metric unit and time-zone-aware date helpers
- MCP server at `/mcp` (stateless Streamable HTTP, localhost only until OAuth) with six
  read-only tools: `garmin_get_day`, `garmin_search_activities`, `garmin_get_activity`,
  `garmin_get_sleep`, `garmin_get_hrv`, `garmin_get_profile`
