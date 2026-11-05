# Running locally

The local server runs on your own computer as a small program that your MCP client
starts. It needs no Cloudflare account, and your Garmin data goes only from Garmin to
your MCP client.

You need:

- A Garmin Connect Personal API key
- Node.js 22+
- An MCP client that runs local servers, e.g. Claude Code, Claude Desktop, Cursor or
  VS Code

Claude on the web and on mobile can't reach a local server. For those,
[host it on Cloudflare](DEPLOY.md).

## With a coding agent

Paste this into Claude Code, Cursor, Codex or a similar agent:

```text
Connect @hannta/garmin-connect-personal-api-mcp
```

The agent follows [AGENT-SETUP.md](AGENT-SETUP.md). You enter the key on a temporary local
page, so it never goes through the chat.

## By hand

### 1. Save your key

```bash
npx -y @hannta/garmin-connect-personal-api-mcp auth
```

This opens a temporary page on your computer. Paste the key there; it's checked with
Garmin and saved. Without a browser, use `auth --terminal`, which asks for the key at a
hidden prompt, or reads it from stdin:

```bash
npx -y @hannta/garmin-connect-personal-api-mcp auth --terminal
```

If you've already saved a key with Garmin's own Personal API tools, skip this step: this
server uses the same file.

### 2. Add it to your client

[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?logo=cursor)](https://cursor.com/en/install-mcp?name=garmin&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBoYW5udGEvZ2FybWluLWNvbm5lY3QtcGVyc29uYWwtYXBpLW1jcCJdfQ==)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522garmin%2522%252C%2522type%2522%253A%2522stdio%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540hannta%252Fgarmin-connect-personal-api-mcp%2522%255D%257D)

Claude Code:

```bash
claude mcp add garmin -- npx -y @hannta/garmin-connect-personal-api-mcp
```

Codex CLI:

```bash
codex mcp add garmin -- npx -y @hannta/garmin-connect-personal-api-mcp
```

Gemini CLI:

```bash
gemini mcp add garmin npx -y @hannta/garmin-connect-personal-api-mcp
```

Claude Desktop, Cursor (`~/.cursor/mcp.json`), Windsurf
(`~/.codeium/windsurf/mcp_config.json`) and most other clients use this JSON. In Claude
Desktop, open **Settings → Developer → Edit Config**.

```json
{
  "mcpServers": {
    "garmin": {
      "command": "npx",
      "args": ["-y", "@hannta/garmin-connect-personal-api-mcp"]
    }
  }
}
```

On Windows, if the client can't start `npx`, use `"command": "cmd"` and put `"/c", "npx"`
first in `args`.

Restart the client and ask, for example, "How did I sleep last night, and how was my
run?"

## Commands

| Command           | What it does                                      |
| ----------------- | ------------------------------------------------- |
| `auth`            | Save your key on a temporary local page           |
| `auth --terminal` | Save your key from a hidden prompt, or from stdin |
| `auth --check`    | Check that the saved key works                    |
| `doctor`          | Check Node.js, the key and the cache              |
| `--version`       | Print the version                                 |

## Settings

Set these in the `env` of your client's config, or leave them out.

| Variable                       | What it does                                                     |
| ------------------------------ | ---------------------------------------------------------------- |
| `GARMIN_PERSONAL_API_KEY`      | The key itself, instead of the saved file                        |
| `GARMIN_PERSONAL_API_KEY_FILE` | Another file to read the key from                                |
| `TIMEZONE`                     | Time zone, e.g. `Europe/Helsinki` (default: your Garmin profile) |

## Files

| Path                                        | What it holds                                                     |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `~/.config/garmin/connect-personal-api-key` | Your key, in a private file                                       |
| `~/.cache/garmin-connect-personal-api-mcp/` | The Garmin token, your time zone and laps (kept 30 days), private |

## Replacing the key

Keys expire. Create a new one in Garmin Connect and run `auth` again. There's no need to
restart your client: the server reads the key on every call.

## Updating

`npx` can keep using the copy it already has. To change version, add it to the package
name in your client's config, e.g. `@hannta/garmin-connect-personal-api-mcp@1.2.0`, or use
`@latest`, then restart the client.

## Removing

Remove the server from your client, then delete the two paths under [Files](#files).
