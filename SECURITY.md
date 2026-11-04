# Security

Each deployment is a single-user server: one person runs it on their own Cloudflare
account to read their own Garmin data.

## Reporting a vulnerability

Report it privately with **Report a vulnerability** on the repository's **Security** tab,
not in a public issue. Only the latest commit on `main` is supported; if you run your
own copy, pull updates and redeploy.

## How it's protected

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

- Sign-in is the passphrase alone: use a long random value.
- Activity names and notes reach the AI assistant as text and could contain
  instructions; all tools are read-only, which limits the impact.
- Anyone with access to your Cloudflare account can read the secrets: protect it with
  2FA.
