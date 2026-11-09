/**
 * Mora — Host half.
 *
 * Owns three things:
 *   1. the Python sidecar's lifecycle (attach to a running one, else spawn it)
 *   2. a same-origin proxy at /mora/api so the Client panel can fetch without CORS
 *   3. agent tools over the same HTTP API the web app uses
 *
 * The UI itself is a native React component in the Client half; this file never
 * serves HTML.
 */
import http from 'node:http'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULTS = {
  appRoot: '',
  port: 8787,
  python: '',
  autostart: true,
  proxyPath: '/mora/api',
}

/** A placeholder or an empty value means "work it out". */
function usableRoot(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.includes('/absolute/path/to/')) return ''
  if (!existsSync(path.join(text, 'server', 'main.py'))) return ''
  return path.resolve(text)
}

/**
 * Find the Mora checkout without needing a machine-specific path in a public
 * repo: explicit config, then MORA_ROOT, then the sibling `../mora` checkout
 * next to this package (the layout both repos are published in).
 */
function resolveAppRoot(configured) {
  const candidates = [configured, process.env.MORA_ROOT]
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    candidates.push(path.resolve(here, '..', 'mora'))
  } catch {
    // import.meta.url unavailable — rely on config / env
  }
  for (const candidate of candidates) {
    const root = usableRoot(candidate)
    if (root) return root
  }
  return ''
}

/** Resolved settings for this row. */
function settings(config = {}) {
  const merged = { ...DEFAULTS, ...(config || {}) }
  merged.port = Number(merged.port) || DEFAULTS.port
  merged.appRoot = resolveAppRoot(merged.appRoot)
  if (!merged.python || !existsSync(merged.python)) {
    merged.python = merged.appRoot ? path.join(merged.appRoot, '.venv', 'bin', 'python') : ''
  }
  return merged
}

async function probe(cfg, timeoutMs = 1200) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`http://127.0.0.1:${cfg.port}/api/ping`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

function startSidecar(cfg, log) {
  if (!cfg.appRoot || !cfg.python) {
    log('mora: appRoot/python not configured; not starting the sidecar')
    return null
  }
  // A wrong appRoot must never take the Harness down with it: spawn raises
  // ENOENT asynchronously through the 'error' event, and an unhandled one is an
  // uncaught exception that kills the host process (and the desktop app with it).
  if (!existsSync(cfg.python)) {
    log(`mora: python not found at ${cfg.python} — set config.appRoot in your profile patch`)
    return null
  }
  if (!existsSync(cfg.appRoot)) {
    log(`mora: appRoot not found at ${cfg.appRoot} — set config.appRoot in your profile patch`)
    return null
  }
  log(`mora: starting sidecar on :${cfg.port}`)
  let child
  try {
    child = spawn(
      cfg.python,
      ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', String(cfg.port)],
      { cwd: cfg.appRoot, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    )
  } catch (error) {
    log(`mora: could not start the sidecar: ${error?.message || error}`)
    return null
  }
  child.on('error', (error) => log(`mora: sidecar failed to start: ${error?.message || error}`))
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', (buf) => {
    const text = String(buf)
    if (text.includes('Application startup complete') || text.includes('ERROR')) {
      log(`mora: ${text.trim().slice(0, 200)}`)
    }
  })
  child.on('exit', (code) => log(`mora: sidecar exited (${code})`))
  return child
}

/** /mora/api/* -> http://127.0.0.1:<port>/api/* */
function createProxy(cfg) {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const strip = cfg.proxyPath.replace(/\/api$/, '')
    const upstream = url.pathname.startsWith(strip) ? url.pathname.slice(strip.length) : url.pathname
    const headers = { ...req.headers, host: `127.0.0.1:${cfg.port}` }
    delete headers.connection
    const call = http.request(
      {
        host: '127.0.0.1',
        port: cfg.port,
        path: (upstream || '/') + url.search,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      },
    )
    call.on('error', (error) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      }
      res.end(JSON.stringify({ error: `Mora 后端未响应：${error.message}` }))
    })
    req.pipe(call)
  }
}

/** Thin JSON client for the tools. */
function api(cfg) {
  const base = `http://127.0.0.1:${cfg.port}/api`

  const request = async (path, init) => {
    const res = await fetch(base + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    })
    const text = await res.text()
    let body
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { error: text.slice(0, 300) }
    }
    if (!res.ok) throw new Error(body?.error || body?.detail || `HTTP ${res.status}`)
    return body
  }

  const waitJob = async (jobId, signal, limitMs = 300000) => {
    const started = Date.now()
    for (;;) {
      if (signal?.aborted) throw new Error('已取消')
      const job = await request(`/jobs/${jobId}`)
      if (job.status === 'done') return job
      if (job.status === 'error') throw new Error(job.error || '任务失败')
      if (Date.now() - started > limitMs) throw new Error('任务超时')
      await new Promise((r) => setTimeout(r, 900))
    }
  }

  return {
    request,
    waitJob,
    ping: () => probe(cfg),
  }
}

function text(value) {
  return [{ type: 'text', text: value }]
}

function lineBreakdown(song, line) {
  const words = (line.tokens || [])
    .filter((token) => (token.morae || []).length > 0)
    .map((token) => {
      const meaning = token.glossZh || token.role || token.pos?.split('-')[0] || ''
      return `${token.surface}(${meaning})`
    })
  return words.join(' ')
}

function describeSong(song, start = 0, count = 40) {
  const lines = (song.lines || []).slice(start, start + count)
  const rows = lines.map((line, offset) => {
    const index = start + offset
    const natural = line.naturalness ? ` [${line.naturalness}]` : ''
    const gloss = line.glossZh ? `\n      译：${line.glossZh}` : ''
    return `${String(index + 1).padStart(2, '0')}. ${line.text}${natural}\n      ${lineBreakdown(song, line) || '（无分词）'}${gloss}`
  })
  const header = `${song.title} — ${song.artist}（${Math.round(song.duration || 0)}s，${(song.lines || []).length} 行）`
  const more = (song.lines || []).length > start + count
    ? `\n…还有 ${(song.lines || []).length - start - count} 行，用 start 参数继续`
    : ''
  return `${header}\n\n${rows.join('\n')}${more}`
}

// Cordis resolves only declared services; without this the row cannot read them.
export const inject = ['tools', 'webServer']

export function apply(ctx, config) {
  const cfg = settings(config)
  const log = (message) => {
    try {
      ctx.logger?.info?.(message) ?? console.log(message)
    } catch {
      // logging must never break activation
    }
  }
  const client = api(cfg)
  let sidecar = null

  ctx.effect(() => {
    let disposed = false
    const boot = async () => {
      if (await probe(cfg)) {
        log(`mora: attached to the running sidecar on :${cfg.port}`)
        return
      }
      if (!cfg.autostart) {
        log('mora: sidecar not running and autostart is off')
        return
      }
      if (!disposed) sidecar = startSidecar(cfg, log)
    }
    void boot()
    return () => {
      disposed = true
      if (sidecar) {
        try {
          sidecar.kill('SIGTERM')
        } catch {
          // already gone
        }
        sidecar = null
      }
    }
  })

  ctx.effect(() =>
    ctx.webServer.register({ kind: 'prefix', path: cfg.proxyPath, handler: createProxy(cfg) }),
  )

  // the Client needs the sidecar's real origin to link out to the full player
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/mora/info',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ port: cfg.port, origin: `http://127.0.0.1:${cfg.port}` }))
      },
    }),
  )

  const tools = [
    {
      name: 'mora_songs',
      description:
        '列出 Mora（日语歌词学习库）里已有的歌曲，以及每首歌的行数和卡片数。用户问“我有哪些歌 / 继续学哪首”时先调这个。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object', properties: { songs: { type: 'array' } } },
        render: (_args, value) => {
          const songs = value?.songs || []
          if (!songs.length) return text('Mora 里还没有歌。用 mora_add_song 输入歌名即可。')
          return text(
            songs
              .map((s) => `· ${s.title} — ${s.artist}（${s.id}，${s.linesTotal} 行，${s.cards} 张卡）`)
              .join('\n'),
          )
        },
      },
      execute: async () => ({ songs: await client.request('/songs') }),
    },
    {
      name: 'mora_add_song',
      description:
        '按歌名（或 YouTube/Bilibili 链接）把一首日语歌加入 Mora：自动找同步歌词、下载音频、生成逐词释义。首次可能需要 1-3 分钟。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '歌名，如 "Say Yes"，或一个视频链接' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { songId: { type: 'string' }, lines: { type: 'number' } } },
        render: (_args, value) =>
          text(
            `已加入：${value?.title} — ${value?.artist}\n` +
              `songId: ${value?.songId} · ${value?.lines} 行 · 歌词来源 ${value?.lyricsSource} · 时间轴 ${value?.timingSource}`,
          ),
      },
      execute: async (args, exec) => {
        const started = await client.request('/ingest', {
          method: 'POST',
          body: JSON.stringify({ query: String(args?.query || '').trim() }),
        })
        const job = await client.waitJob(started.jobId, exec?.signal)
        return job.result
      },
    },
    {
      name: 'mora_song',
      description:
        '读取一首歌的歌词，逐词给出中文释义与语法作用（助词会标出它连接的关系），同时给出整句翻译和自然度。讲解歌词、拆句子、回答“这句什么意思”时用。',
      parameters: {
        type: 'object',
        properties: {
          songId: { type: 'string', description: 'mora_songs 返回的 id' },
          start: { type: 'number', description: '从第几行开始（0 起），默认 0' },
          count: { type: 'number', description: '读多少行，默认 40' },
        },
        required: ['songId'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } } },
        render: (_args, value) => text(value?.text || ''),
      },
      execute: async (args) => {
        const song = await client.request(`/songs/${encodeURIComponent(String(args?.songId))}`)
        const start = Math.max(0, Number(args?.start) || 0)
        const count = Math.min(200, Math.max(1, Number(args?.count) || 40))
        return { title: song.title, text: describeSong(song, start, count) }
      },
    },
    {
      name: 'mora_cards',
      description: '列出 Mora 里已存成复习卡片的词（词形、读音、释义、是否到期）。',
      parameters: {
        type: 'object',
        properties: { songId: { type: 'string', description: '可选，只看某首歌的卡片' } },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { cards: { type: 'array' } } },
        render: (_args, value) => {
          const cards = value?.cards || []
          if (!cards.length) return text('还没有卡片。可以在 mora_song 里挑词，或用面板里的「加入复习」。')
          return text(
            cards
              .map(
                (c) =>
                  `· ${c.surface}（${c.kana}）${c.glossZh || ''} — ${c.songTitle || c.songId}${c.due ? `，下次 ${String(c.due).slice(0, 16).replace('T', ' ')}` : ''}`,
              )
              .join('\n'),
          )
        },
      },
      execute: async (args) => {
        const all = await client.request('/cards')
        const cards = args?.songId ? all.filter((c) => c.songId === args.songId) : all
        return { cards }
      },
    },
    {
      name: 'mora_review',
      description:
        '给一张 Mora 复习卡片打分，推进间隔重复。grade：0 重来 / 1 困难 / 2 良好 / 3 简单。',
      parameters: {
        type: 'object',
        properties: {
          cardId: { type: 'string', description: 'mora_cards 返回的 id' },
          grade: { type: 'number', enum: [0, 1, 2, 3], description: '0 重来 / 1 困难 / 2 良好 / 3 简单' },
        },
        required: ['cardId', 'grade'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { due: { type: 'string' } } },
        render: (_args, value) => text(`已记录。下次复习：${String(value?.due || '').slice(0, 16).replace('T', ' ')}`),
      },
      execute: async (args) =>
        client.request(`/cards/${encodeURIComponent(String(args?.cardId))}/review`, {
          method: 'POST',
          body: JSON.stringify({ grade: Number(args?.grade) || 0 }),
        }),
    },
  ]

  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool))
  }

  log(`mora: ready (appRoot=${cfg.appRoot || 'unresolved'}, sidecar :${cfg.port}, proxy ${cfg.proxyPath})`)
}
