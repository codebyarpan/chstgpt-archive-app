# ChatGPT Archive

**Save, search and organise your ChatGPT conversations on your Mac, and let your AI tools use them.**

ChatGPT Archive is a macOS menu-bar app with a companion Chrome extension. The extension saves your
chats from chatgpt.com into a local database. The app lets you browse them, search them by keyword or
by meaning, group them, and ask questions about them. It also exposes the archive to Claude Desktop,
ChatGPT and other AI apps over [MCP](https://modelcontextprotocol.io), so they can look things up in
what you discussed before.

Everything runs on your Mac by default. You can also move the archive to your own server.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Install (for users)](#install-for-users)
- [Build from source](#build-from-source)
- [Development](#development)
- [Project layout](#project-layout)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [License](#license)

## Features

| | |
|---|---|
| **One-click saving** | A green button on chatgpt.com lists every chat, including chats inside ChatGPT projects, marks the ones already saved, and sends the rest to the app. |
| **Browse** | Home dashboard, an *All chats* list grouped by ChatGPT project, and a chat viewer. |
| **Search** | Hybrid search: keyword (SQLite FTS5) plus meaning-based search with a local embedding model (`BAAI/bge-small-en-v1.5` through fastembed), merged with reciprocal rank fusion. |
| **Groups** | Your own collections of chats, independent of ChatGPT projects. |
| **Ask AI** | Ask a question and get an answer written from your own chats, with clickable `[n]` sources. Uses your Groq (has a free plan) or xAI Grok key. |
| **Connect Claude Desktop** | One button adds the archive as an MCP server in Claude Desktop's config. |
| **Connect a web app** | A secure public HTTPS link (Cloudflare tunnel or ngrok) for ChatGPT connectors, Claude on the web and other MCP clients. |
| **Server mode** | Move the archive to your own server to save disk space or share one archive between several Macs. Every chat is verified before anything local is deleted. |
| **Quiet by default** | Starts hidden in the menu bar at login, and restarts the backend if it crashes. |

### MCP tools

Any connected AI app gets these tools:

| Tool | What it does |
|---|---|
| `search_conversations` | Keyword search, optionally limited to a project or group |
| `semantic_search` | Search by meaning |
| `get_conversation` | Read a chat (supports paging through long ones) |
| `list_conversations`, `list_projects`, `list_groups` | Browse the archive |
| `create_group`, `add_to_group`, `remove_from_group` | Organise chats into groups (the only write tools) |

## How it works

```
 chatgpt.com                     Your Mac (or your server)
┌──────────────────┐            ┌──────────────────────────────────────────────┐
│ Chrome extension │──/ingest──▶│ Ingest API  127.0.0.1:47821  (FastAPI)       │
│ (green button)   │            │      │                                       │
└──────────────────┘            │      ▼                                       │
                                │ SQLite + FTS5 + embeddings  ◀── indexer      │
┌──────────────────┐            │      ▲                                       │
│ ChatGPT Archive  │──REST─────▶│      │                                       │
│ app (Electron)   │            │ MCP server  127.0.0.1:47822  (HTTP)          │
└──────────────────┘            └──────▲───────────────────────────▲───────────┘
                                       │                           │
                              Claude Desktop            Cloudflare / ngrok tunnel
                                                     → ChatGPT, Claude web, others
```

- **This repo**: the Electron app (main process, React window) and the Chrome extension (MV3).
- **Backend**: Python in a separate repo (`~/chatgpt-archive/kb`: `ingest_api.py`, `server.py`
  (MCP), `ingest.py`, `embed.py`, `migrate.py`). `npm run dist` copies it into the app bundle.
- The packaged app ships its own [`uv`](https://github.com/astral-sh/uv), which downloads Python
  3.13 and the libraries on first start. It never uses the system Python.

## Install (for users)

> Requires a Mac with Apple silicon (M1 or later) and macOS 12 or newer. *Connect a web app* needs
> macOS 15; the app explains this if your Mac is older.

1. Open `ChatGPT-Archive-<version>-mac-arm64.dmg` and drag **ChatGPT Archive** to **Applications**.
2. Open the app. The app has no Apple Developer ID, so macOS blocks the first launch. Go to
   **System Settings → Privacy & Security** and click **Open Anyway**.
3. Wait for first-time setup (it downloads about 150 MB once, so it needs internet).
4. In **Settings & help → Chrome extension**, click **Connect Chrome** and follow the steps
   (chrome://extensions → Developer mode → drag in the `~/ChatGPT Archive Extension` folder).
   The extension is paired automatically, so you never paste a token.
5. Open chatgpt.com, click the green button and save your chats.

A step-by-step guide (`How to install ChatGPT Archive.pdf`) is inside the DMG.

### Optional

- **Claude Desktop**: *Settings & help → Connect Claude*, then restart Claude Desktop.
- **Ask AI**: *Settings & help → AI chatbot*: pick Groq or xAI, paste a key, pick a model.
- **ChatGPT / Claude on the web**: *Settings & help → Connect a web app*. Each tab has steps for that app.
- **Your own server**: *Settings & help → Storage → Move to my own server* (server setup:
  `deploy/` in the backend repo). On a second Mac use **Just connect**; **Use this Mac instead**
  switches back. After the move is verified, **Free up space** deletes the local copy.

## Build from source

Prerequisites: Node.js 20+, Homebrew `uv`, and the backend checked out at `~/chatgpt-archive/kb`.

```sh
npm install
npm run fetch-cloudflared   # once: Cloudflare's official build, SHA-256 checked
npm run dist                # → release/ChatGPT-Archive-<version>-mac-arm64.dmg
```

`dist` type-checks, builds, copies the backend, `uv` and `cloudflared` into `vendor/`, renders the
install guide to PDF, and packages a DMG. It refuses a `cloudflared` that needs a newer macOS than
`build.mac.minimumSystemVersion`; Homebrew's build usually needs the newest macOS, which is why
`fetch-cloudflared` exists. The app is signed ad hoc (`scripts/after-pack.cjs`).

Rebuild the DMG after any change to the backend.

| Script | Purpose |
|---|---|
| `npm run dev` | Hot-reload app; runs the backend straight from `~/chatgpt-archive/kb` |
| `npm run typecheck` | TypeScript check of the window and main process |
| `npm run build` | Compile into `out/` |
| `npm run dist` | Full installer build (see above) |
| `npm run icons` | Regenerate app and tray icons |
| `npm run guide` | Render `build/install-guide.html` to PDF |

## Development

```sh
npm install
npm run dev
```

> In VS Code's integrated terminal, `ELECTRON_RUN_AS_NODE` is set. Run `unset ELECTRON_RUN_AS_NODE`
> before starting Electron, or it starts as plain Node.

The extension can be loaded straight from `extension/` (*Load unpacked*). Without `pairing.json`,
paste the token from *Settings & help → Advanced* into the extension's options.

### Environment overrides

These are mainly for running a second, isolated copy or for automated tests.

| Variable | Effect |
|---|---|
| `CHATGPT_ARCHIVE_HOME` | Data folder |
| `CHATGPT_ARCHIVE_API_PORT` / `CHATGPT_ARCHIVE_MCP_PORT` | Ports (default 47821 / 47822) |
| `CHATGPT_ARCHIVE_PROFILE` | Separate Electron profile, so a second copy can run |
| `CHATGPT_ARCHIVE_OFFSCREEN=1` | Render without showing a window |
| `CHATGPT_ARCHIVE_AI_BASE` | Send Ask AI requests to another OpenAI-compatible server |
| `CHATGPT_ARCHIVE_MODELS` | Search-model folder |
| `CHATGPT_ARCHIVE_EXTENSION_DIR` | Where *Connect Chrome* copies the extension |

## Project layout

```
electron/     main process: starts and watches the backend, menu-bar icon, login item,
              Connect Chrome / Claude / web app, server mode; ai.ts = Ask AI (Groq, xAI)
src/          the window (React + Tailwind): Home, All chats, Search, Ask AI, Groups,
              Settings & help, chat viewer
extension/    Chrome extension (MV3): content.js = button and panel, background.js = API calls
scripts/      prepare-bundle, fetch-cloudflared, after-pack (ad hoc signing), icons, install guide
build/        app icon and install guide (HTML → PDF, shipped in the DMG)
resources/    menu-bar icon
```

## Privacy and security

- **Local by default.** Chats, the search index and the embedding model stay in
  `~/Library/Application Support/ChatGPTArchive` (or `~/chatgpt-archive` if a database already
  exists there). Meaning-based search runs on your Mac, so no chat text is sent anywhere to build it.
- **Local servers listen on `127.0.0.1` only** and require a token that is created on first start.
- **Ask AI** sends your question and the matching passages to the service you chose (Groq or xAI).
  The key is stored in `ai.json` with mode 0600 and never reaches the window.
- **Connect a web app** makes the MCP server reachable from the internet while it is on. The token is
  part of the URL (`/t/<token>/mcp`) or sent as `Authorization: Bearer <token>`. Turn it off when you
  don't need it.
- **Server mode** keeps the server token in `server.json` (mode 0600).
- **Connect Claude** backs up Claude Desktop's config first (`*.before-chatgpt-archive`).

## Troubleshooting

| Problem | Fix |
|---|---|
| "App can't be opened" | System Settings → Privacy & Security → **Open Anyway** |
| Setup fails on first start | It needs internet once to download Python and libraries. Click **Try again**. |
| The extension says it is not connected | Make sure the app is running (menu-bar icon), then reload the chatgpt.com tab. After an app update, reload the extension in chrome://extensions. |
| Ports 47821 / 47822 are busy | Another copy (for example a dev build) is running. Quit it. |
| *Connect a web app* is unavailable | Needs macOS 15 or newer |
| The web-app link changed | Cloudflare quick tunnels get a new address on each start. For a fixed address, install `ngrok` and put your reserved domain in `.ngrok-domain` in the data folder. |

## Known limitations

- Apple silicon only; no Intel build yet.
- Not notarized (no Apple Developer ID), so the first launch needs *Open Anyway*.
- The Chrome extension is not on the Chrome Web Store; it is installed in Developer mode.

## License

MIT, see `package.json`.
