/**
 * Host-half regression tests. No dependencies, no browser.
 *
 * Run: node test/host.test.mjs
 *
 * Guards the two ways this plugin has taken the Harness down or gone silent:
 *   1. a bad appRoot used to spawn a missing binary, raise ENOENT asynchronously
 *      and — with no 'error' listener — kill the host process;
 *   2. the row must still register its routes and tools when it cannot start
 *      the sidecar, because that is the normal state before the app is fetched.
 */
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Import a COPY of the plugin from a temporary directory with no sibling `mora`
// checkout. Otherwise the plugin's own appRoot discovery finds the real app and
// the test spawns a live uvicorn — a test that starts servers is not a test.
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sandbox = mkdtempSync(path.join(tmpdir(), 'mora-host-test-'))
copyFileSync(path.join(pkgDir, 'index.js'), path.join(sandbox, 'index.js'))
copyFileSync(path.join(pkgDir, 'package.json'), path.join(sandbox, 'package.json'))
delete process.env.MORA_ROOT
const { apply } = await import(pathToFileURL(path.join(sandbox, 'index.js')).href)
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }))

const registered = { routes: [], tools: [] }
const cleanups = []
let logs = []

function fakeCtx() {
  return {
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => {}
    },
    webServer: {
      register(route) {
        registered.routes.push(route)
        return () => {}
      },
    },
    tools: {
      register(definition) {
        registered.tools.push(definition)
        return () => {}
      },
    },
    logger: { info: (message) => logs.push(String(message)) },
  }
}

function reset() {
  registered.routes.length = 0
  registered.tools.length = 0
  cleanups.length = 0
  logs = []
}

// 1. a deliberately invalid appRoot must not throw and must not spawn anything
{
  reset()
  assert.doesNotThrow(() => {
    apply(fakeCtx(), { appRoot: '/absolute/path/to/mora', port: 59999, autostart: true })
  }, 'apply() threw on an invalid appRoot')
  assert.ok(logs.some((l) => /appRoot|python|not found/i.test(l)), 'no explanation logged for the bad appRoot')
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.ok(logs.every((l) => !/starting sidecar/i.test(l)), 'the plugin tried to spawn with an unresolvable appRoot')
  console.log('ok  invalid appRoot does not throw and does not spawn')
}

// 2. routes and tools are registered even when the sidecar cannot start
{
  reset()
  apply(fakeCtx(), { appRoot: '/definitely/not/here', port: 59998 })
  const paths = registered.routes.map((r) => r.path)
  assert.ok(paths.includes('/mora/api'), `missing proxy route, got ${JSON.stringify(paths)}`)
  assert.ok(paths.includes('/mora/info'), `missing info route, got ${JSON.stringify(paths)}`)
  const names = registered.tools.map((t) => t.name).sort()
  assert.deepEqual(
    names,
    ['mora_add_song', 'mora_cards', 'mora_review', 'mora_song', 'mora_songs'],
    `unexpected tool set: ${JSON.stringify(names)}`,
  )
  for (const tool of registered.tools) {
    assert.equal(typeof tool.execute, 'function', `${tool.name} has no execute`)
    assert.equal(typeof tool.description, 'string', `${tool.name} has no description`)
    assert.equal(tool.parameters?.type, 'object', `${tool.name} has no object parameter schema`)
  }
  console.log('ok  proxy + info routes and 5 tools registered with no app')

  for (const cleanup of cleanups) {
    try {
      cleanup()
    } catch (error) {
      assert.fail(`cleanup threw: ${error?.message || error}`)
    }
  }
  console.log('ok  teardown is clean')
}

console.log('\nhost tests passed')
