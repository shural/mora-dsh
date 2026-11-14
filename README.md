# dsh-mora

DSH bundle that puts **Mora** (the local Japanese-song learning app) inside the Harness:
a sidebar panel plus five tools the assistant can call.

Installed as a linked local bundle into the `desktop` profile:

```bash
plugin_manager install_bundle target=<absolute path to this directory>
```

## What it adds

| Seat / surface | What it is |
|---|---|
| `sidebar.panellist` (id `mora`, order 20) | the icon in the sidebar panel row |
| `main` (key `mora`) | the study panel: song rail, lyrics, per-word strip, and a practice bar |
| tools | five, listed below |
| routes | `/mora/api/*` (proxy to the sidecar), `/mora/info` (its origin) |

The panel opens on whatever is in your library: pick a song on the left, and every line
shows its furigana, a word strip grouped into phrases with per-word meanings and particle
roles, the line translation, and a naturalness dot. Click a line to play just that line;
`0.5×–1.0×` tempo, A–B loop, and 🎤 records a line and diffs what you actually sang.

### Tools the assistant can call

| Tool | What it does |
|---|---|
| `mora_songs` | list the library with line and card counts |
| `mora_add_song` | add by name or URL: lyrics → audio → alignment → annotation (~40–60s) |
| `mora_song` | a range of lines with per-word glosses, roles, translation, naturalness — this is what lets the assistant explain grammar from your real annotations |
| `mora_cards` | saved vocabulary cards and their due dates |
| `mora_review` | grade a card, advancing the interval |

A typical exchange: *"为什么 SAY YES 第二句这么写？"* → the assistant calls `mora_song`, reads the
per-word breakdown and the grammar note, and answers from your own data rather than guessing.

The panel is a **native React component** styled with `--dsw-alias-*` tokens — not an iframe,
so it follows the host theme and light/dark.

It can also be practised in, not just read:

- ▶ play / pause the real audio. The song is fetched once and played from a
  `blob:` URL, so seeking always works even when a proxy/tunnel strips the
  range headers that make a network resource seekable (diagnosed from
  `seekable = 0:00~0:00` while the element still reported the right duration)
- 0.5×–1.0× tempo with `preservesPitch` (slowing down does not change the key)
- **click any lyric line to play exactly that line**, and it stops at the end of it
  (arm 「循环本句」 first if you want that line to loop instead)
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
      name: 'dsh-mora'
      config:
        appRoot: /absolute/path/to/mora
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

## Install

1. Install the [Mora](https://github.com/shural/mora) app first — this bundle only wraps it.
2. Edit `cordis.patch.yml` so `config.appRoot` points at your Mora checkout.
3. Install the bundle:

```
plugin_manager install_bundle target=<absolute path to this directory>
```

The Host half attaches to a sidecar already listening on `config.port`, or spawns
`.venv/bin/python -m uvicorn server.main:app` in `appRoot`. Nothing is served over the network.

## Screenshot

Not included: the panel is styled with the host's `--dsw-alias-*` tokens, so a faithful
screenshot has to come from a running Harness with the panel open. Drop one in
`docs/panel.png` and reference it here.

## License

MIT — see [LICENSE](LICENSE).
