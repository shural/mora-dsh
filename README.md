# @local/dsh-mora

DSH bundle that puts **Mora** (the local Japanese-song learning app) inside the Harness:
a sidebar panel plus five tools the assistant can call.

Installed as a linked local bundle into the `desktop` profile:

```bash
plugin_manager install_bundle target=/Users/media/Documents/dsh_playground/mora-dsh
```

## What it adds

| Seat / surface | What it is |
|---|---|
| `sidebar.panellist` (id `mora`, order 20) | the icon in the sidebar panel row |
| `main` (key `mora`) | the study panel: song rail, lyrics, per-word strip, and a practice bar |
| tools | `mora_songs`, `mora_add_song`, `mora_song`, `mora_cards`, `mora_review` |
| routes | `/mora/api/*` (proxy to the sidecar), `/mora/info` (its origin) |

The panel is a **native React component** styled with `--dsw-alias-*` tokens — not an iframe,
so it follows the host theme and light/dark.

It can also be practised in, not just read:

- ▶ play / pause the real audio (streamed through the proxy with Range support)
- 0.5×–1.0× tempo with `preservesPitch` (slowing down does not change the key)
- 「循环本句」 A–B loops the line you are on; clicking a line seeks to it
- the active line is highlighted and auto-scrolled while playing
- 🎤 「录这一句」 records with MediaRecorder, posts it to `/sing`, and shows the
  mora-level diff (green = matched, struck-through red = dropped, amber = extra),
  a match score, and the plain-language hint

The full browser app at `127.0.0.1:8787` is untouched and still the better place for a
long karaoke session (bigger type, draggable A–B); the panel links to it.

## How it runs

`index.js` (Host) probes `127.0.0.1:<port>/api/ping`:

- reachable → attach to the running sidecar (e.g. one started with `./run.sh`)
- not reachable → spawn `.venv/bin/python -m uvicorn server.main:app` in `appRoot`
- on plugin dispose → SIGTERM the child it spawned

Config lives in `cordis.patch.yml`:

```yaml
- insert:
    - id: mora
      name: '@local/dsh-mora'
      config:
        appRoot: /Users/media/Documents/dsh_playground/mora
        port: 8787
        autostart: true
```

## Files

```
index.js           Host: sidecar lifecycle, proxy, routes, tools
client.js          Client: sidebar icon + main panel (plain JS, no build step)
cordis.patch.yml   the row this bundle inserts
locale/{en,zh}.json  plugin list title/description
icon.svg           panel + plugin artwork
```

## Notes

- `/mora/api/*` and `/mora/info` are registered as plain web routes, so they are **not** behind
  the GUI's token auth. They bind to the Harness listener, which is loopback-only — the same
  exposure as the sidecar's own `127.0.0.1:8787`.
- Editing `index.js` requires re-importing the Host module: `remove_bundle` then
  `install_bundle`, and a Harness restart for a fresh module generation. Client changes need a
  page refresh unless `pnpm run dev:web` is running.
- Visible text uses a local `ZH`/`EN` dictionary rather than `ctx.locale`, so the panel can't
  blank itself if the locale API differs; the plugin-list metadata still ships in `locale/*.json`.
