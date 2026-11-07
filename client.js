/**
 * Mora — Client half.
 *
 * Registers two seats in the Harness Web UI:
 *   sidebar.panellist  (id: mora)  -> the icon that opens the panel
 *   main               (key: mora) -> the reading panel itself
 *
 * The panel is a native React component styled with --dsw-alias-* theme tokens;
 * it renders NO iframe. The karaoke player stays in the standalone app and is
 * reached through an explicit link.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-mora',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/mora/api'

    const ZH = {
      panel: 'Mora 日文歌',
      panelLabel: 'Mora',
      title: 'Mora',
      subtitle: '逐词拆解日语歌词',
      refresh: '刷新',
      player: '打开完整播放器',
      connect: '正在连接 Mora…',
      offline: '连不上 Mora 后端',
      offlineHint: '在 Mora 目录运行 ./run.sh，或确认插件配置里的 appRoot / port。',
      retry: '重试',
      empty: 'Mora 里还没有歌。',
      emptyHint: '在 Mora 目录运行 ./run.sh，用歌名添加一首（比如 Say YES），或者直接让助手帮你加。',
      noLyrics: '这首歌还没有歌词。',
      noLyricsHint: '打开完整播放器粘贴歌词，或让助手重新抓一次。',
      lines: '行',
      cards: '张卡',
      legendDaily: '日常可用',
      legendPoetic: '诗意但成立',
      legendSongOnly: '只存在于歌词',
      clickWord: '点词看读音',
      kana: '读音',
      romaji: '罗马音',
      pos: '词性',
      timingLrc: '歌词自带时间轴',
      timingAsr: '按演唱位置对齐',
      timingNone: '未同步',
      loadingSong: '读取歌词…',
    }

    const EN = {
      panel: 'Mora — Japanese songs',
      panelLabel: 'Mora',
      title: 'Mora',
      subtitle: 'Read Japanese lyrics word by word',
      refresh: 'Refresh',
      player: 'Open full player',
      connect: 'Connecting to Mora…',
      offline: 'Mora backend is unreachable',
      offlineHint: 'Run ./run.sh in the Mora folder, or check appRoot / port in the plugin config.',
      retry: 'Retry',
      empty: 'No songs in Mora yet.',
      emptyHint: 'Run ./run.sh in the Mora folder and add a song by name, or ask the assistant to add one.',
      noLyrics: 'This song has no lyrics yet.',
      noLyricsHint: 'Paste lyrics in the full player, or ask the assistant to re-fetch.',
      lines: 'lines',
      cards: 'cards',
      legendDaily: 'usable daily',
      legendPoetic: 'poetic but valid',
      legendSongOnly: 'lyrics only',
      clickWord: 'Click a word for its reading',
      kana: 'reading',
      romaji: 'romaji',
      pos: 'part of speech',
      timingLrc: 'timed from lyrics',
      timingAsr: 'aligned to the vocal',
      timingNone: 'not synced',
      loadingSong: 'Reading lyrics…',
    }

    const CONTENT_HEADS = new Set([
      '名詞', '代名詞', '動詞', '形容詞', '形状詞', '副詞', '連体詞', '接頭辞', '接尾辞',
    ])
    const POS_LABEL = {
      名詞: '名词', 代名詞: '代词', 動詞: '动词', 形容詞: '形容词', 形状詞: '形容动词',
      副詞: '副词', 連体詞: '连体词', 接続詞: '接续词', 感動詞: '感叹词',
      助詞: '助词', 助動詞: '助动词', 接頭辞: '前缀', 接尾辞: '后缀', 記号: '标点',
    }

    const posHead = (token) => String(token.pos || '').split('-')[0] || String(token.pos || '')
    const isContentWord = (token) => CONTENT_HEADS.has(posHead(token))

    function groupTokens(tokens) {
      const groups = []
      for (const token of tokens || []) {
        if (!((token.morae || []).length)) continue
        if (!groups.length || isContentWord(token)) groups.push([token])
        else groups[groups.length - 1].push(token)
      }
      return groups
    }

    function fmtTime(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0))
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
    }

    function chipMeaning(token) {
      return token.glossZh || token.role || POS_LABEL[posHead(token)] || ''
    }

    async function getJson(path, signal) {
      const res = await fetch(API + path, { headers: { accept: 'application/json' }, signal })
      const body = await res.text()
      if (!res.ok) {
        let message = `HTTP ${res.status}`
        try {
          const parsed = JSON.parse(body)
          message = parsed.error || parsed.detail || message
        } catch {
          if (body) message = body.slice(0, 160)
        }
        throw new Error(message)
      }
      return body ? JSON.parse(body) : null
    }

    function Ruby({ segments, showFurigana }) {
      return h(
        React.Fragment,
        null,
        (segments || []).map((segment, index) =>
          segment.rt
            ? h(
                'ruby',
                { key: index },
                segment.text,
                h('rt', null, segment.rt),
              )
            : h('span', { key: index }, segment.text),
        ),
      )
    }

    function MoraIcon({ size = 18, active = false }) {
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      const dots = [3, 6.5, 10, 13.5, 17]
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        dots.map((cx, index) =>
          h('circle', {
            key: `d${index}`,
            cx,
            cy: 13.5,
            r: index === 1 ? 1.9 : 1.2,
            fill: index === 1 ? color : 'currentColor',
            opacity: index === 1 ? 1 : 0.42,
          }),
        ),
        h('path', {
          d: 'M3.2 8.6c1.6-3.1 2.4-3.1 3.4-.6s2 2.5 3.4-.4 2.3-2.6 3.5-.7 2 1.6 3.1-.2',
          stroke: color,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          fill: 'none',
        }),
      )
    }

    const CSS = `
.mora-page{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.mora-head{display:flex;align-items:center;gap:12px;padding:14px 22px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.mora-headmark{display:flex;align-items:center;gap:8px;min-width:0}
.mora-headname{font-size:15px;font-weight:600;letter-spacing:.01em}
.mora-headsub{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mora-headspace{flex:1}
.mora-btn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;font-family:inherit;transition:background .15s,color .15s,border-color .15s}
.mora-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mora-btn:disabled{opacity:.5;cursor:default}
.mora-link{color:var(--dsw-alias-brand-primary);text-decoration:none;font-size:12px;padding:5px 9px;border-radius:7px}
.mora-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mora-body{flex:1;display:flex;min-height:0}
.mora-rail{width:214px;flex:0 0 214px;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px}
.mora-railitem{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;font:inherit;padding:8px 10px;border-radius:8px;cursor:pointer}
.mora-railitem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mora-railitem[aria-current="true"]{background:var(--dsw-alias-interactive-bg-active)}
.mora-railtitle{font-size:13px;font-weight:520;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mora-railmeta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mora-main{flex:1;min-width:0;overflow:auto;padding:16px 26px 48px}
.mora-songhead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.mora-songtitle{font-size:19px;font-weight:600}
.mora-songartist{color:var(--dsw-alias-label-secondary);font-size:13px}
.mora-chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}
.mora-chip{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:99px;padding:2px 9px}
.mora-legend{display:flex;gap:12px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-bottom:14px}
.mora-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:middle}
.mora-line{display:flex;gap:14px;padding:11px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.mora-line:first-of-type{border-top:0}
.mora-idx{color:var(--dsw-alias-label-tertiary);font-size:11px;padding-top:7px;font-variant-numeric:tabular-nums;min-width:18px}
.mora-linebody{min-width:0;flex:1}
.mora-text{font-size:19px;line-height:1.75;margin:0;font-weight:500;letter-spacing:.01em}
.mora-text ruby{margin:0 1px}
.mora-text rt{font-size:.5em;color:var(--dsw-alias-label-tertiary);font-weight:400;letter-spacing:0}
.mora-strip{display:flex;flex-wrap:wrap;gap:6px 8px;margin-top:8px}
.mora-group{display:inline-flex;align-items:flex-end;gap:1px;padding:2px 4px 3px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.mora-word{display:flex;flex-direction:column;align-items:center;gap:1px;border:0;background:transparent;color:inherit;font:inherit;padding:1px 4px;border-radius:5px;cursor:pointer}
.mora-word:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mora-word[data-selected="true"]{background:var(--dsw-alias-interactive-bg-active);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.mora-wordjp{font-size:14px;line-height:1.3;white-space:nowrap}
.mora-wordzh{font-size:10.5px;line-height:1.25;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mora-word[data-glue="true"] .mora-wordjp{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.mora-word[data-glue="true"] .mora-wordzh{font-size:9.5px;color:var(--dsw-alias-label-tertiary)}
.mora-gloss{margin:7px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mora-note{margin:5px 0 0;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.mora-detail{flex:0 0 auto;display:flex;gap:16px;align-items:center;padding:9px 22px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary);min-height:38px;box-sizing:border-box}
.mora-detail b{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mora-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:40px;text-align:center;color:var(--dsw-alias-label-secondary)}
.mora-state-title{font-size:14px;color:var(--dsw-alias-label-primary)}
.mora-state-text{font-size:12px;color:var(--dsw-alias-label-tertiary);max-width:40em;line-height:1.7}
.mora-skel{height:10px;border-radius:99px;background:var(--dsw-alias-bg-skeleton);margin:7px 0}
.mora-player{display:flex;align-items:center;gap:10px;padding:8px 22px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;flex:0 0 auto}
.mora-play{width:30px;height:30px;border-radius:50%;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-bg-base);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit}
.mora-play:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.mora-play:disabled{opacity:.5;cursor:default}
.mora-time{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;min-width:86px}
.mora-rates{display:flex;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:2px}
.mora-rate{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;padding:2px 6px;border-radius:5px;cursor:pointer}
.mora-rate[data-on="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.mora-btn[data-on="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.mora-sing{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 22px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.mora-sing-score{font-weight:600;color:var(--dsw-alias-label-primary)}
.mora-diff{font-size:13px;padding:1px 2px;border-radius:3px}
.mora-diff--eq{color:var(--dsw-alias-state-success-primary)}
.mora-diff--del{color:var(--dsw-alias-state-error-primary);text-decoration:line-through}
.mora-diff--ins{color:var(--dsw-alias-state-warn-primary)}
.mora-diff--sub{color:var(--dsw-alias-state-error-primary)}
.mora-sing-hint{color:var(--dsw-alias-label-tertiary)}
.mora-close{margin-left:auto;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;font-family:inherit}
.mora-line{border-radius:8px;cursor:pointer}
.mora-line.is-active{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent)}
.mora-line.is-active .mora-text{color:var(--dsw-alias-brand-primary)}
.mora-err{color:var(--dsw-alias-state-error-primary);font-size:11.5px}
@media (max-width:820px){.mora-rail{display:none}.mora-main{padding:14px 16px 40px}}
`

    function MoraPanel() {
      const [locale, setLocale] = useState('zh')
      const [songs, setSongs] = useState(null)
      const [songId, setSongId] = useState(null)
      const [song, setSong] = useState(null)
      const [info, setInfo] = useState(null)
      const [error, setError] = useState(null)
      const [songError, setSongError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [selected, setSelected] = useState(null)
      const [nonce, setNonce] = useState(0)
      const audioRef = useRef(null)
      const recRef = useRef(null)
      const linesRef = useRef([])
      const lineRefs = useRef([])
      const offsetRef = useRef(0)
      const lastSecondRef = useRef(-1)
      const [playing, setPlaying] = useState(false)
      const [rate, setRate] = useState(1)
      const [loopLine, setLoopLine] = useState(false)
      const [time, setTime] = useState(0)
      const [duration, setDuration] = useState(0)
      const [activeIndex, setActiveIndex] = useState(0)
      const [recording, setRecording] = useState(false)
      const [singResult, setSingResult] = useState(null)
      const [singError, setSingError] = useState(null)

      const dict = locale === 'en' ? EN : ZH
      const t = useCallback((key) => dict[key] || ZH[key] || key, [dict])

      const load = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const list = await getJson('/songs')
          setSongs(Array.isArray(list) ? list : [])
          if (list?.length && !songId) setSongId(list[0].id)
        } catch (unknown) {
          setError(String(unknown?.message || unknown))
          setSongs(null)
        } finally {
          setBusy(false)
        }
      }, [songId])

      useEffect(() => {
        void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [nonce])

      useEffect(() => {
        let alive = true
        fetch('/mora/info')
          .then((res) => (res.ok ? res.json() : null))
          .then((value) => alive && value && setInfo(value))
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        if (!songId) return undefined
        let alive = true
        setSongError(null)
        setSelected(null)
        getJson(`/songs/${encodeURIComponent(songId)}`)
          .then((value) => {
            if (alive) setSong(value)
          })
          .catch((unknown) => {
            if (alive) setSongError(String(unknown?.message || unknown))
          })
        return () => {
          alive = false
        }
      }, [songId, nonce])

      const totals = useMemo(() => {
        const lines = song?.lines?.length || 0
        const tokens = (song?.lines || []).reduce((sum, line) => sum + (line.tokens?.length || 0), 0)
        return { lines, tokens }
      }, [song])

      const playerHref =
        info?.origin && songId ? `${info.origin}/song/${encodeURIComponent(songId)}` : null

      useEffect(() => {
        linesRef.current = song?.lines || []
        offsetRef.current = Number(song?.offset) || 0
      }, [song])

      // keep the current line in view while singing along
      useEffect(() => {
        if (!playing) return
        const el = lineRefs.current[activeIndex]
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }, [activeIndex, playing])

      // reset transport when switching songs
      useEffect(() => {
        setActiveIndex(0)
        setSingResult(null)
        setSingError(null)
        setPlaying(false)
        setTime(0)
        lastSecondRef.current = -1
        const el = audioRef.current
        if (el) {
          el.pause()
          el.currentTime = 0
        }
      }, [songId])

      // rAF transport: active line + A-B loop on the current line
      useEffect(() => {
        if (!playing) return undefined
        let raf = 0
        const tick = () => {
          const el = audioRef.current
          const lineArr = linesRef.current
          const off = offsetRef.current
          if (el) {
            const t = el.currentTime
            // 60fps would re-render every word chip on every frame; the clock
            // only needs whole seconds, and line changes have their own state.
            const second = Math.floor(t)
            if (second !== lastSecondRef.current) {
              lastSecondRef.current = second
              setTime(t)
            }
            let idx = -1
            for (let i = 0; i < lineArr.length; i += 1) {
              const start = Number(lineArr[i].start)
              if (start >= 0 && t >= start + off) idx = i
            }
            if (idx >= 0) setActiveIndex((prev) => (prev === idx ? prev : idx))
            if (loopLine && idx >= 0) {
              const end = Number(lineArr[idx].end) + off
              if (end > 0 && t >= end) el.currentTime = Math.max(0, Number(lineArr[idx].start) + off)
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [playing, loopLine])

      const togglePlay = useCallback(() => {
        const el = audioRef.current
        if (!el) return
        if (el.paused) {
          el.preservesPitch = true
          el.playbackRate = rate
          void el
            .play()
            .then(() => setPlaying(true))
            .catch((error) => setSingError(`播放失败：${error?.message || error}`))
        } else {
          el.pause()
          setPlaying(false)
        }
      }, [rate])

      const changeRate = useCallback((next) => {
        setRate(next)
        const el = audioRef.current
        if (el) {
          el.preservesPitch = true
          el.playbackRate = next
        }
      }, [])

      const seekTo = useCallback((index) => {
        const line = linesRef.current[index]
        const el = audioRef.current
        if (!line || !el || Number(line.start) < 0) return
        el.currentTime = Math.max(0, Number(line.start) + offsetRef.current)
        setTime(el.currentTime)
        setActiveIndex(index)
      }, [])

      const submitSing = useCallback(
        async (blob, lineId) => {
          try {
            const form = new FormData()
            form.append('file', blob, 'rec.webm')
            const res = await fetch(`${API}/songs/${encodeURIComponent(songId)}/lines/${encodeURIComponent(lineId)}/sing`, {
              method: 'POST',
              body: form,
            })
            const text = await res.text()
            const payload = text ? JSON.parse(text) : null
            if (!res.ok || !payload) throw new Error(payload?.error || payload?.detail || `HTTP ${res.status}`)
            setSingResult(payload)
            setSingError(null)
          } catch (error) {
            setSingError(String(error?.message || error))
          }
        },
        [songId],
      )

      const toggleRecord = useCallback(async () => {
        if (recording) {
          try {
            recRef.current?.stop()
          } catch {
            // already stopped
          }
          return
        }
        const line = linesRef.current[activeIndex]
        if (!line) return
        if (!navigator.mediaDevices?.getUserMedia) {
          setSingError('这个环境不支持录音')
          return
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const chunks = []
          const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size) chunks.push(event.data)
          }
          recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop())
            setRecording(false)
            const blob = new Blob(chunks, { type: 'audio/webm' })
            if (blob.size) void submitSing(blob, line.id)
          }
          recRef.current = recorder
          setSingResult(null)
          setSingError(null)
          recorder.start()
          setRecording(true)
          // a line is a few seconds; stop by itself if the user forgets
          window.setTimeout(() => {
            if (recorder.state === 'recording') recorder.stop()
          }, 14000)
        } catch (error) {
          setSingError(`麦克风不可用：${error?.message || error}`)
        }
      }, [recording, activeIndex, submitSing])

      const body = (() => {
        if (error) {
          return h(
            'div',
            { className: 'mora-state' },
            h('div', { className: 'mora-state-title' }, t('offline')),
            h('div', { className: 'mora-state-text' }, error),
            h('div', { className: 'mora-state-text' }, t('offlineHint')),
            h('button', { type: 'button', className: 'mora-btn', onClick: () => setNonce((n) => n + 1) }, t('retry')),
          )
        }
        if (songs === null) {
          return h(
            'div',
            { className: 'mora-main' },
            h('div', { className: 'mora-state' }, t('connect')),
            h('div', { className: 'mora-skel', style: { width: '38%' } }),
            h('div', { className: 'mora-skel', style: { width: '62%' } }),
            h('div', { className: 'mora-skel', style: { width: '48%' } }),
          )
        }
        if (!songs.length) {
          return h(
            'div',
            { className: 'mora-state' },
            h('div', { className: 'mora-state-title' }, t('empty')),
            h('div', { className: 'mora-state-text' }, t('emptyHint')),
          )
        }
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'mora-rail' },
            songs.map((item) =>
              h(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  className: 'mora-railitem',
                  'aria-current': item.id === songId,
                  onClick: () => setSongId(item.id),
                },
                h('div', { className: 'mora-railtitle' }, item.title),
                h(
                  'div',
                  { className: 'mora-railmeta' },
                  `${item.artist || '—'} · ${item.linesTotal}${t('lines')}`,
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'mora-main' },
            songError
              ? h('div', { className: 'mora-state' }, h('div', { className: 'mora-state-text' }, songError))
              : song === null
                ? h('div', { className: 'mora-state' }, t('loadingSong'))
                : renderSong(song, selected, setSelected, t, totals, activeIndex, lineRefs, seekTo),
          ),
        )
      })()

      return h(
        'div',
        { className: 'mora-page' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'mora-head' },
          h(
            'div',
            { className: 'mora-headmark' },
            h(MoraIcon, { size: 18, active: true }),
            h('span', { className: 'mora-headname' }, t('title')),
          ),
          h('span', { className: 'mora-headsub' }, t('subtitle')),
          h('span', { className: 'mora-headspace' }),
          playerHref
            ? h('a', { className: 'mora-link', href: playerHref, target: '_blank', rel: 'noreferrer' }, t('player'))
            : null,
          h(
            'button',
            { type: 'button', className: 'mora-btn', onClick: () => setNonce((n) => n + 1), disabled: busy },
            t('refresh'),
          ),
        ),
        h('audio', {
          ref: audioRef,
          src: songId ? `${API}/media/${encodeURIComponent(songId)}/audio` : undefined,
          preload: 'metadata',
          style: { display: 'none' },
          onLoadedMetadata: (event) => setDuration(Number(event.currentTarget.duration) || 0),
          onEnded: () => setPlaying(false),
        }),
        song && (song.lines || []).length
          ? h(
              'div',
              { className: 'mora-player' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'mora-play',
                  onClick: togglePlay,
                  'aria-label': playing ? '暂停' : '播放',
                  title: playing ? '暂停' : '播放',
                },
                playing ? '❚❚' : '▶',
              ),
              h('span', { className: 'mora-time' }, `${fmtTime(time)} / ${fmtTime(duration || song.duration)}`),
              h(
                'div',
                { className: 'mora-rates' },
                [0.5, 0.65, 0.75, 0.9, 1].map((value) =>
                  h(
                    'button',
                    {
                      key: value,
                      type: 'button',
                      className: 'mora-rate',
                      'data-on': String(rate === value),
                      onClick: () => changeRate(value),
                    },
                    `${value}×`,
                  ),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mora-btn',
                  'data-on': String(loopLine),
                  onClick: () => setLoopLine((value) => !value),
                  title: '只在当前这一句里循环',
                },
                loopLine ? '循环本句 ●' : '循环本句',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mora-btn',
                  'data-on': String(recording),
                  onClick: toggleRecord,
                  disabled: !(song.lines || []).length,
                  title: `录下第 ${activeIndex + 1} 句，和自己的唱法比对`,
                },
                recording ? '● 停止录音' : '🎤 录这一句',
              ),
              h(
                'span',
                { className: 'mora-railmeta' },
                recording ? '正在录音…' : `第 ${activeIndex + 1} 句`,
              ),
            )
          : null,
        singError
          ? h(
              'div',
              { className: 'mora-sing' },
              h('span', { className: 'mora-err' }, singError),
              h('button', { type: 'button', className: 'mora-close', onClick: () => setSingError(null) }, '✕'),
            )
          : null,
        singResult
          ? h(
              'div',
              { className: 'mora-sing' },
              h('span', { className: 'mora-sing-score' }, `吻合 ${singResult.score}%`),
              h('span', null, `${singResult.moraeOk}/${singResult.moraeTotal} 音`),
              h(
                'span',
                null,
                (singResult.diff || []).map((item, index) =>
                  h(
                    'span',
                    {
                      key: index,
                      className: `mora-diff mora-diff--${item.op || 'eq'}`,
                      title: item.op === 'sub' ? `${item.a} → ${item.b}` : undefined,
                    },
                    item.op === 'ins' ? item.b : item.a,
                  ),
                ),
              ),
              h('span', { className: 'mora-sing-hint' }, singResult.hint || ''),
              h('button', { type: 'button', className: 'mora-close', onClick: () => setSingResult(null) }, '✕'),
            )
          : null,
        h('div', { className: 'mora-body' }, body),
        selected
          ? h(
              'footer',
              { className: 'mora-detail' },
              h('b', { lang: 'ja' }, selected.surface),
              h('span', { lang: 'ja' }, selected.kana || '—'),
              h('span', null, selected.romaji || ''),
              h('span', null, `${t('pos')} ${selected.pos || '—'}`),
              h('span', null, chipMeaning(selected)),
            )
          : null,
      )
    }

    function renderSong(song, selected, setSelected, t, totals, activeIndex, lineRefs, seekTo) {
      const timingKey =
        song.timingSource === 'lrc'
          ? 'timingLrc'
          : song.timingSource && song.timingSource !== 'none'
            ? 'timingAsr'
            : 'timingNone'
      const lines = song.lines || []
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'mora-songhead' },
          h('span', { className: 'mora-songtitle' }, song.title),
          h('span', { className: 'mora-songartist' }, song.artist || ''),
        ),
        h(
          'div',
          { className: 'mora-chips' },
          h('span', { className: 'mora-chip' }, `${totals.lines} ${t('lines')}`),
          h('span', { className: 'mora-chip' }, `${(song.cards || []).length} ${t('cards')}`),
          h('span', { className: 'mora-chip' }, t(timingKey)),
        ),
        h(
          'div',
          { className: 'mora-legend' },
          h('span', null, h('i', { className: 'mora-dot', style: { background: 'var(--dsw-alias-state-success-primary)' } }), t('legendDaily')),
          h('span', null, h('i', { className: 'mora-dot', style: { background: 'var(--dsw-alias-state-warn-primary)' } }), t('legendPoetic')),
          h('span', null, h('i', { className: 'mora-dot', style: { background: 'var(--dsw-alias-state-error-primary)' } }), t('legendSongOnly')),
          h('span', null, t('clickWord')),
        ),
        !lines.length
          ? h(
              'div',
              { className: 'mora-state' },
              h('div', { className: 'mora-state-title' }, t('noLyrics')),
              h('div', { className: 'mora-state-text' }, t('noLyricsHint')),
            )
          : lines.map((line, index) =>
              renderLine(line, index, selected, setSelected, index === activeIndex, lineRefs, seekTo),
            ),
      )
    }

    function renderLine(line, index, selected, setSelected, isActive, lineRefs, seekTo) {
      const groups = groupTokens(line.tokens)
      return h(
        'div',
        {
          className: isActive ? 'mora-line is-active' : 'mora-line',
          key: line.id,
          ref: (element) => {
            lineRefs.current[index] = element
          },
          onClick: () => seekTo(index),
        },
        h('span', { className: 'mora-idx' }, String(index + 1).padStart(2, '0')),
        h(
          'div',
          { className: 'mora-linebody' },
          h(
            'p',
            { className: 'mora-text', lang: 'ja' },
            (line.tokens || []).map((token, tokenIndex) =>
              h(Ruby, { key: token.id || tokenIndex, segments: token.ruby }),
            ),
          ),
          groups.length
            ? h(
                'div',
                { className: 'mora-strip' },
                groups.map((group, groupIndex) =>
                  h(
                    'span',
                    { className: 'mora-group', key: `g${groupIndex}` },
                    group.map((token) =>
                      h(
                        'button',
                        {
                          key: token.id,
                          type: 'button',
                          className: 'mora-word',
                          'data-glue': String(!isContentWord(token)),
                          'data-selected': String(selected?.id === token.id),
                          onClick: (event) => {
                            event.stopPropagation()
                            setSelected(selected?.id === token.id ? null : token)
                          },
                          title: token.kana || token.surface,
                        },
                        h('span', { className: 'mora-wordjp', lang: 'ja' }, token.surface),
                        h('span', { className: 'mora-wordzh' }, chipMeaning(token)),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          line.glossZh ? h('p', { className: 'mora-gloss' }, line.glossZh) : null,
          line.note ? h('p', { className: 'mora-note' }, line.note) : null,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'mora',
              order: 20,
              label: () => 'Mora',
            },
            MoraIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'mora' }, MoraPanel),
        )
      },
    }
  },
})
