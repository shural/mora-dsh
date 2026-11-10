/**
 * Client-half regression tests. Hermetic: every network call is intercepted, so
 * no Mora backend, no audio on disk and no network are needed.
 *
 * Run: node test/panel.test.mjs      (needs: npm i --no-save playwright react@18 react-dom@18)
 *
 * Guards the regression that made the panel look "half working": a refactor
 * deleted the effect that filled linesRef, so the transport never advanced the
 * active line. The highlight froze on line 1 for the whole song, 「循环本句」
 * silently did nothing, and follow-scroll had no index to follow.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.resolve(here, '..')
const read = (file) => readFileSync(path.join(pkgDir, file), 'utf8')
const readDep = (file) => readFileSync(path.join(pkgDir, 'node_modules', file), 'utf8')

const LINE_COUNT = 30
const LINE_SECONDS = 6
const SONG_SECONDS = LINE_COUNT * LINE_SECONDS

function token(id, surface, kana, morae, pos, gloss, role = null, rt = null) {
  return {
    id, surface,
    ruby: rt ? [{ text: surface, rt }] : [{ text: surface }],
    kana, romaji: kana, morae, pos, dictForm: null,
    glossZh: gloss, role, naturalness: 'green', note: null, flags: [], saved: false,
  }
}

const SONG = {
  id: 'demo',
  title: 'Demo Song',
  artist: 'Test Artist',
  duration: SONG_SECONDS,
  audioUrl: '/api/media/demo/audio',
  offset: 0,
  synced: true,
  cards: [],
  lines: Array.from({ length: LINE_COUNT }, (_, i) => ({
    id: `l${i}`,
    text: `第${i + 1}句のテスト`,
    start: i * LINE_SECONDS,
    end: i * LINE_SECONDS + LINE_SECONDS - 1,
    glossZh: `第 ${i + 1} 句`,
    naturalness: 'green',
    note: null,
    tokens: [
      token(`l${i}t0`, '第', 'だい', ['だ', 'い'], '名詞-普通名詞', '第', null, 'だい'),
      token(`l${i}t1`, '句', 'く', ['く'], '名詞-普通名詞', '句'),
      token(`l${i}t2`, 'の', 'の', ['の'], '助詞-格助詞', null, '的・所属'),
      token(`l${i}t3`, 'テスト', 'てすと', ['て', 'す', 'と'], '名詞-普通名詞', '测试'),
    ],
  })),
}

const LIST = [{
  id: 'demo', title: 'Demo Song', artist: 'Test Artist',
  duration: SONG_SECONDS, audioUrl: '/api/media/demo/audio',
  coverUrl: null, linesTotal: LINE_COUNT, cards: 0, synced: true, thumbHue: 120,
}]

/** A valid 16-bit mono PCM wav, long enough to seek into. */
function makeWav(seconds = SONG_SECONDS, sampleRate = 8000) {
  const frames = seconds * sampleRate
  const dataSize = frames * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body,#root{height:100%;margin:0}.harness{height:100%}</style></head>
<body><div class="harness"><div id="root"></div></div>
<script>${readDep('react/umd/react.development.js')}</script>
<script>${readDep('react-dom/umd/react-dom.development.js')}</script>
<script>
window.__ModuleLoader__ = {
  load({ id, factory }) {
    window.__PLUGIN__ = { id, mod: factory((name) => {
      if (name === 'react') return window.React
      throw new Error('unexpected require: ' + name)
    }) }
  },
}
</script>
<script>
(function () {
  const Real = window.Audio
  window.__AUDIOS__ = []
  window.Audio = function (...args) { const el = new Real(...args); window.__AUDIOS__.push(el); return el }
  window.Audio.prototype = Real.prototype
})()
</script>
<script>${read('client.js')}</script>
<script>
const captured = {}
const ctx = { slots: { inject: (key, cb) => cb(), register: (opts, component) => { captured[opts.name + ':' + (opts.id || opts.key || '')] = component; return () => {} } } }
window.__PLUGIN__.mod.apply(ctx)
if (!captured['main:mora']) throw new Error('main:mora was not registered')
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(captured['main:mora']))
</script></body></html>`

const WAV = makeWav()
let browser

try {
  const args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio']
  // Prefer the installed Google Chrome (no 150 MB download, and it decodes the
  // same media the app does); fall back to Playwright's bundled build.
  try {
    browser = await chromium.launch({ channel: 'chrome', args })
    console.log('using system Chrome')
  } catch {
    browser = await chromium.launch({ args })
    console.log('using bundled Chromium')
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 520 } })
  page.on('pageerror', (error) => console.log('  [pageerror]', String(error).slice(0, 200)))

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML })
    if (pathname === '/mora/info') return json({ port: 0, origin: '' })
    if (pathname === '/mora/api/songs') return json(LIST)
    if (pathname === '/mora/api/songs/demo') return json(SONG)
    if (pathname.startsWith('/mora/api/media/')) {
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: WAV })
    }
    if (pathname.startsWith('/mora/api/')) return json({})
    return route.fulfill({ status: 404, body: 'not found' })
  })

  await page.goto('http://mora.test/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.mora-line', { timeout: 20000 })

  const lineCount = await page.locator('.mora-line').count()
  assert.equal(lineCount, LINE_COUNT, `expected ${LINE_COUNT} lines, rendered ${lineCount}`)
  console.log(`ok  rendered ${lineCount} lyric lines`)

  // the audio element must be created, and the song must be a seekable blob
  await page.waitForFunction(
    () => {
      const el = (window.__AUDIOS__ || [])[0]
      return el && (el.src || '').startsWith('blob:') && el.readyState >= 1
    },
    { timeout: 20000 },
  )
  console.log('ok  song loaded as a blob (seekable)')

  const scrollable = await page.evaluate(() => {
    const main = document.querySelector('.mora-main')
    return main.scrollHeight > main.clientHeight + 50
  })
  assert.ok(scrollable, 'the panel does not scroll; the follow-scroll test would be meaningless')
  console.log('ok  content overflows the panel (scroll is meaningful)')

  const top = () => page.evaluate(() => Math.round(document.querySelector('.mora-main').scrollTop))
  const activeIndex = () =>
    page.evaluate(() => Array.from(document.querySelectorAll('.mora-line')).findIndex((l) => l.classList.contains('is-active')))
  const seek = (seconds) =>
    page.evaluate((t) => {
      const el = (window.__AUDIOS__ || [])[0]
      el.currentTime = t
    }, seconds)

  // play
  await page.click('.mora-play')
  await page.waitForTimeout(700)
  const playing = await page.evaluate(() => !((window.__AUDIOS__ || [])[0] || {}).paused)
  assert.ok(playing, 'pressing play did not start playback')
  console.log('ok  play starts playback')

  // THE regression: the active line must advance with the transport
  assert.equal(await top(), 0, 'panel scrolled before playback reached a later line')
  await seek(120)
  await page.waitForTimeout(1200)
  const index = await activeIndex()
  assert.ok(index >= 15, `active line stayed at ${index + 1}; the transport lost its line list (linesRef)`)
  console.log(`ok  active line advanced to ${index + 1}`)

  // follow-scroll: the sung line is brought into view
  const scrolled = await top()
  assert.ok(scrolled > 300, `panel did not scroll to follow playback (scrollTop=${scrolled})`)
  const visible = await page.evaluate(() => {
    const main = document.querySelector('.mora-main').getBoundingClientRect()
    const line = document.querySelector('.mora-line.is-active')?.getBoundingClientRect()
    return !!line && line.top >= main.top - 2 && line.bottom <= main.bottom + 2
  })
  assert.ok(visible, 'the active line is not inside the viewport')
  console.log(`ok  followed the song (scrollTop=${scrolled}, line visible)`)

  // guard: a manual scroll must not be yanked back
  await page.evaluate(() => {
    document.querySelector('.mora-main').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -800 }))
  })
  await seek(175)
  await page.waitForTimeout(1000)
  const afterWheel = await top()
  assert.ok(
    Math.abs(afterWheel - scrolled) < 300,
    `manual scroll was overridden: ${scrolled} -> ${afterWheel}`,
  )
  console.log(`ok  manual scroll respected (scrollTop stayed near ${scrolled})`)

  console.log('\npanel tests passed')
} finally {
  await browser?.close()
}
