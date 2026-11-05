# Setup guide for AI agents

Follow this when a user asks you to connect or install
`@hannta/garmin-connect-personal-api-mcp`. It's a read-only MCP server for their Garmin
Connect data.

## Rules

- Never ask for the Garmin key in chat, and never put it in a command or a config file.
- Never read or print the key file.
- Change the client's config only to add this server, and keep everything else in it.

## Steps

1. **Check Node.js.** Run `node --version`. Version 22 or newer is needed; if it's older,
   ask the user to update it, then stop.

2. **Add the server to the client you're running in.** Name it `garmin`. If the user named
   another client, use that one instead.

   | Client      | How                                                                       |
   | ----------- | ------------------------------------------------------------------------- |
   | Claude Code | `claude mcp add garmin -- npx -y @hannta/garmin-connect-personal-api-mcp` |
   | Codex CLI   | `codex mcp add garmin -- npx -y @hannta/garmin-connect-personal-api-mcp`  |
   | Gemini CLI  | `gemini mcp add garmin npx -y @hannta/garmin-connect-personal-api-mcp`    |
   | Others      | Merge the entry below into the client's MCP config file                   |

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

3. **Check for a key.** Run:

   ```bash
   npx -y @hannta/garmin-connect-personal-api-mcp auth --check
   ```

   If it works, go to step 5.

4. **Get the key saved.** Tell the user to create a key in Garmin Connect on the web, on
   the **Personal API Key** page, and that Garmin shows it only once. Then run:

   ```bash
   npx -y @hannta/garmin-connect-personal-api-mcp auth
   ```

   It opens a page on the user's computer, prints the link, and waits up to 10 minutes for
   the key, so run it in the background if your commands have a shorter time limit. Give
   the user the link in case the page didn't open. The command exits once the key is saved.

   If you're on a remote machine or there's no browser, ask the user to run this in their
   own terminal instead:

   ```bash
   npx -y @hannta/garmin-connect-personal-api-mcp auth --terminal
   ```

5. **Check the setup.** Run this, and fix anything marked `FAIL`:

   ```bash
   npx -y @hannta/garmin-connect-personal-api-mcp doctor
   ```

6. **Finish.** Tell the user to restart or reload the client so it loads the server, and
   to try "How did I sleep last night?". Claude on the web and on mobile can't use a local
   server: for those, point them to `docs/DEPLOY.md` in the repository.
