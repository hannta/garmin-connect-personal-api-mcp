# Security

This is a single-user server: one person runs it, on their own computer or their own
Cloudflare account, to read their own Garmin data.

## Reporting a vulnerability

Report it privately with **Report a vulnerability** on the repository's **Security** tab,
not in a public issue. Only the latest release is supported.

## Running locally

- **Key:** saved in `~/.config/garmin/connect-personal-api-key`, readable only by your
  user account, but in plain text: any program running as you can read it.
- **Sign-in:** none. Your MCP client starts the server and talks to it directly, and no
  network port is open while it runs.
- **Setup page:** `auth` runs a page on `127.0.0.1` only, on a random path, until the key
  is saved or 10 minutes pass. The key never goes through your AI assistant.
- **Your data:** read-only, sent only to your MCP client. The Garmin token, your time zone
  and lap rows (30 days) are cached in private files in
  `~/.cache/garmin-connect-personal-api-mcp`.
- **Updates:** releases after 1.1.0 are built by GitHub Actions, and each one goes live
  on npm only after two-factor approval. To decide when you update,
  [pin a version](docs/LOCAL.md#updating).

## Hosting on Cloudflare

- **Sign-in:** OAuth 2.1 in front of `/mcp`. Tokens are issued only after you enter
  `OWNER_PASSPHRASE` (at least 16 characters, compared in constant time). Repeated wrong
  attempts pause sign-in for 15 minutes. Access tokens last 1 hour; a sign-in lasts
  30 days from its last use. Changing the passphrase signs out every app.
- **Approving apps:** any app can register itself, but none gets in without the
  passphrase. Check that the host on the sign-in page is the one you expect (e.g.
  `claude.ai`).
- **Secrets:** the Garmin key and passphrase live only in Worker secrets and are never
  logged or returned.
- **Your data:** read-only. KV holds sign-in data, the Garmin token and your time zone.
  The only health data stored is lap rows from `garmin_get_activity_laps`, cached for
  30 days. Location, sexual activity and sex drive logs are never returned or
  stored. Tests use synthetic data only.

## Limits

- On Cloudflare, sign-in is the passphrase alone: use a long random value.
- Activity names and notes reach the AI assistant as text and could contain
  instructions; all tools are read-only, which limits the impact.
- Anyone with access to your Cloudflare account can read the secrets: protect it with
  2FA.
