# ChatGPT Archive — Chrome Extension

Saves conversations from chatgpt.com into the ChatGPT Archive desktop app.

The desktop app installs this for the user: **Settings & help → Chrome extension** copies it to
`~/ChatGPT Archive Extension` together with `pairing.json` (this Mac's access token), and walks
through chrome://extensions → Developer mode → drag the folder in. No token has to be pasted.

Loaded straight from this source folder (development), there is no `pairing.json`: paste the token
from the app (Settings & help → Advanced) into the extension's options under "Advanced settings".

## How it works

- `content.js` adds a green button to chatgpt.com. Its panel lists every chat from ChatGPT's own API
  (`/backend-api/conversations`, plus each project's chats via `/backend-api/gizmos/...`), falling
  back to the sidebar links if that fails, and marks chats already in the archive.
- `background.js` talks to the archive API (`http://127.0.0.1:47821` or a server set in options)
  and sends `X-Archive-Client: extension` so the app can show "connected".

## Using a server instead of this Mac

Options → Advanced settings → *Archive address*: the server address, e.g.
`https://archive.example.com`. Setup: `~/chatgpt-archive/deploy/README.md`.
