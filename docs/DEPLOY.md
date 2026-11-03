# Deploying

This guide puts the server on your own Cloudflare account and connects it to an MCP
client. It takes about ten minutes and fits in the Workers **free plan**.

You need:

- A Garmin Connect Personal API key
- A Cloudflare account (free)
- Node.js 24+ and a clone of this repository
- An MCP client that supports remote servers with OAuth, e.g. a Claude plan with custom
  connectors

## 1. Sign in to Cloudflare

```bash
npm install
npx wrangler login
```

This opens a browser page where you allow Wrangler to manage Workers on your account.

## 2. Deploy

```bash
npx wrangler deploy
```

The first deploy creates the two KV namespaces (`OAUTH_KV`, `GARMIN_KV`) for you and
prints the Worker's URL, e.g. `https://garmin-connect-personal-api-mcp.<subdomain>.workers.dev`.
The KV IDs are not written to `wrangler.jsonc`; later deploys keep the namespaces
already bound to the Worker.

## 3. Set the secrets

Generate a passphrase and save it in your password manager first — you type it once per
app you connect:

```bash
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32; echo
```

Then set both secrets. Each command prompts for the value without echoing it:

```bash
npx wrangler secret put GARMIN_API_KEY
npx wrangler secret put OWNER_PASSPHRASE
```

Until both are set, Garmin tools return a setup error and the sign-in page says sign-in
isn't configured.

Alternatively, deploy and set the secrets in one step with
`npx wrangler deploy --secrets-file secrets.json`, where `secrets.json` holds
`{"GARMIN_API_KEY": "…", "OWNER_PASSPHRASE": "…"}`. Delete the file afterwards.

## 4. Check it

```bash
curl -i -X POST https://<your-worker>/mcp
```

Expect `401` with a `WWW-Authenticate` header pointing at
`/.well-known/oauth-protected-resource/mcp`. That means sign-in is required, as it
should be.

## 5. Connect a client

### Claude

1. In Claude (web or desktop), open **Settings → Connectors → Add custom connector**.
2. Name it, e.g. "Garmin", and enter the URL ending in `/mcp`:
   `https://<your-worker>/mcp`. Leave the advanced OAuth settings empty; Claude
   registers itself.
3. Click **Connect**. The server's sign-in page opens and shows that Claude is asking.
   Enter your passphrase and click **Allow**.

The connector then works in the Claude mobile apps too. Turn it on in a chat from the
tools menu and ask, for example, "How did I sleep last night, and how was my run?"

### Other MCP clients

Add a remote MCP server with the URL `https://<your-worker>/mcp` (Streamable HTTP). The
client needs OAuth support: it registers itself, opens the server's sign-in page, and
you enter your passphrase.

## Updating

```bash
git pull
npm ci
npx wrangler deploy
```

Secrets, KV data and connected apps survive deploys.

## Operating

- **Logs:** `npx wrangler tail` streams requests and errors live. The API key,
  tokens and passphrase are never logged.
- **CPU limit (free plan):** to check whether calls hit the free plan's CPU limit, open
  the Worker in the Cloudflare dashboard → **Metrics** and look for **Exceeded CPU Time
  Limits**, or run `npx wrangler tail --format json` and look for
  `"outcome": "exceededCpu"`. Clients show these failures as a connector error
  (Cloudflare error 1102). If they appear, switch the account to Workers Paid
  ($5/month); no code changes needed.
- **Sign out every app:** run `npx wrangler secret put OWNER_PASSPHRASE` with a new
  value. Each app then needs to connect again.
- **Rotate the Garmin key:** `npx wrangler secret put GARMIN_API_KEY`. The Garmin token
  cache is keyed by the API key, so the new key takes effect on the next request.
- **Time zone:** dates follow the Garmin profile's time zone. To override, add
  `"vars": { "TIMEZONE": "Europe/Helsinki" }` to `wrangler.jsonc` and deploy (vars set
  only in the dashboard are removed by the next deploy).

## Removing

```bash
npx wrangler delete
```

Then delete the two KV namespaces under **Storage & Databases → Workers KV** in the
Cloudflare dashboard, and remove the connector from your MCP client.
