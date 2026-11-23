# ChatGPT Archive — desktop app

Mac app (Electron + React) plus the Chrome extension that saves chats into it. The Python backend
lives in `~/chatgpt-archive/kb` and is copied into the app at build time.

```
electron/      main process: starts the backend, menu bar icon, setup helpers (Chrome, Claude, web-app
               tunnel, login item); ai.ts = the Ask AI chatbot (Groq / xAI Grok)
src/           the window (React): Home, All chats, Search, Ask AI, Groups, Settings & help, chat viewer
extension/     Chrome extension (green button on chatgpt.com)
scripts/       prepare-bundle (copies kb + uv + cloudflared), fetch-cloudflared, after-pack (ad hoc signing), icons, install guide PDF
build/         app icon, install guide (HTML → PDF, shipped inside the DMG)
```

## Build the installer

```sh
npm install
npm run fetch-cloudflared   # once: Cloudflare's official build (Homebrew's needs the newest macOS)
npm run dist        # → release/ChatGPT-Archive-<version>-mac-arm64.dmg (Apple silicon)
```

`dist` type-checks, builds, copies `~/chatgpt-archive/kb/*.py`, `uv` and `cloudflared` into `vendor/`
(it refuses a `cloudflared` that needs a newer macOS than `build.mac.minimumSystemVersion`),
renders the install guide and packages a DMG. There is no Apple Developer ID, so the app is signed
ad hoc: on another Mac the first open needs System Settings → Privacy & Security → **Open Anyway**
(the guide in the DMG explains this).

## What the packaged app does on a new Mac

- Data in `~/Library/Application Support/ChatGPTArchive` (or `~/chatgpt-archive` if a database
  already exists there). Token created on first start.
- The bundled `uv` downloads Python 3.13 and the libraries once (~150 MB), then the search model
  (~67 MB) when the first chats arrive. Never uses the system Python.
- Ingest API on 127.0.0.1:47821, MCP over HTTP on 127.0.0.1:47822; restarted if they crash;
  a "Try again" screen if first-time setup fails (e.g. no internet).
- Adds a LaunchAgent so it starts hidden in the menu bar at login (toggle in Settings).
- "Connect Chrome" copies the extension to `~/ChatGPT Archive Extension` with `pairing.json`
  (the token), so the user never pastes a token.
- "Connect Claude" merges an entry into Claude Desktop's config (backup: `*.before-chatgpt-archive`).
- "Connect a web app" opens a public HTTPS tunnel to the MCP server (ngrok if `.ngrok-domain` exists
  in the data folder and `ngrok` is installed, so the address is fixed; otherwise a Cloudflare quick
  tunnel whose address changes on each start). Tabs give steps for ChatGPT, Claude on the web and
  other apps: `<tunnel>/t/<token>/mcp` for connectors without auth headers, or `<tunnel>/mcp` plus
  `Authorization: Bearer <token>`. Reopened at launch while turned on.
- "Storage → Move to a server" (for saving space, or one archive for several computers): checks the
  server (`deploy/` in the backend folder), runs `kb/migrate.py` (uploads through `POST /import`,
  then verifies every chat id), and switches to server mode. In server mode nothing runs locally:
  the window, Ask AI and the connect links use `https://<server>` with its `ARCHIVE_TOKEN` (kept in
  `<userData>/server.json`, mode 0600), the extension is re-paired with the server added to its
  manifest's host_permissions (one reload in Chrome), and the local Claude Desktop entry is removed.
  "Free up space" re-verifies, then deletes the local database, exports and search model.
  "Just connect" is for a second Mac; "Use this Mac instead" switches back.
- "Ask AI" answers questions from the archive: hybrid search picks passages, Groq or xAI Grok writes
  the answer with [n] citations. Key in `<userData>/ai.json` (mode 0600), never sent to the window.

## Development

```sh
npm run dev                       # hot reload; backend from ~/chatgpt-archive/kb
npm run typecheck
```

Environment overrides (used by the automated tests): `CHATGPT_ARCHIVE_HOME` (data folder),
`CHATGPT_ARCHIVE_API_PORT` / `CHATGPT_ARCHIVE_MCP_PORT`, `CHATGPT_ARCHIVE_PROFILE` (separate
Electron profile, so a second copy can run), `CHATGPT_ARCHIVE_OFFSCREEN=1` (render without a window),
`CHATGPT_ARCHIVE_AI_BASE` (send Ask AI requests to another OpenAI-compatible server, e.g. a fake one),
`CHATGPT_ARCHIVE_MODELS` (search-model folder), `CHATGPT_ARCHIVE_EXTENSION_DIR` (where the extension is copied).
In VS Code's terminal, unset `ELECTRON_RUN_AS_NODE` before starting Electron.
