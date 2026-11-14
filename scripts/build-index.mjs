/**
 * Generate the DSH plugin index (format 1) from this package's published npm
 * metadata, then write it to public/ for GitHub Pages.
 *
 *   node scripts/build-index.mjs
 *
 * The index format requires, per listed version: an exact version, a
 * publishTimestamp that is the registry publish time, and a valid engines.dsh
 * copied from the source manifest. Reading npm keeps all three honest instead
 * of hard-coding them in the repository.
 *
 * Until the package exists on npm, the script falls back to the local manifest
 * and says so loudly — the Pages site still deploys, and the next scheduled run
 * corrects the timestamp and version once the package is published.
 */
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const outDir = path.join(root, 'public')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

const warnings = []

async function localizedMeta() {
  const read = async (file) => {
    try {
      return JSON.parse(await readFile(path.join(root, 'locale', file), 'utf8'))
    } catch {
      return null
    }
  }
  const [en, zh] = await Promise.all([read('en.json'), read('zh.json')])
  const title = {}
  const description = {}
  if (en?.meta?.title) title.en = en.meta.title
  if (zh?.meta?.title) title.zh = zh.meta.title
  if (en?.meta?.description) description.en = en.meta.description
  if (zh?.meta?.description) description.zh = zh.meta.description
  // the format requires `en` on localized text
  if (!title.en) title.en = pkg.name
  if (!description.en) description.en = pkg.description
  return { title, description }
}

/** Latest publishable version according to npm, or null when unpublished. */
async function fromRegistry() {
  const url = `https://registry.npmjs.org/${pkg.name.replace('/', '%2F')}`
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`registry responded ${response.status} for ${pkg.name}`)
  const doc = await response.json()
  const version = doc['dist-tags']?.latest
  if (!version || !doc.versions?.[version]) return null
  const manifest = doc.versions[version]
  const engines = manifest.engines?.dsh
  if (!engines) throw new Error(`${pkg.name}@${version} has no engines.dsh; the index would be rejected`)
  const published = doc.time?.[version]
  if (!published) throw new Error(`npm has no publish time for ${pkg.name}@${version}`)
  return {
    version,
    publishTimestamp: Math.floor(new Date(published).getTime() / 1000),
    enginesDsh: engines,
    description: manifest.description || pkg.description,
    keywords: manifest.keywords || pkg.keywords || [],
    author: typeof manifest.author === 'string' ? manifest.author.split(' ')[0] : manifest.author?.name || pkg.author,
    homepage: manifest.homepage || pkg.homepage,
    repository: manifest.repository?.url || pkg.repository?.url,
  }
}

function fallback() {
  warnings.push(`WARNING: ${pkg.name} is not on npm yet. Emitting ${pkg.version} with a best-effort timestamp — install will fail until you run \`npm publish\`.`)
  return {
    version: pkg.version,
    publishTimestamp: Math.floor(Date.now() / 1000),
    enginesDsh: pkg.engines?.dsh,
    description: pkg.description,
    keywords: pkg.keywords || [],
    author: pkg.author,
    homepage: pkg.homepage,
    repository: pkg.repository?.url,
  }
}

const meta = await localizedMeta()
const source = (await fromRegistry()) ?? fallback()

let repository
if (source.repository) {
  const web = String(source.repository).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^ssh:\/\/git@/, 'https://')
  if (/^https?:\/\//.test(web)) repository = { url: web }
}

const index = {
  format: 1,
  title: { en: 'Mora', zh: 'Mora' },
  description: meta.description,
  plugins: [
    {
      name: pkg.name,
      title: meta.title,
      description: { en: source.description, ...(meta.description.zh ? { zh: meta.description.zh } : {}) },
      icon: 'icons/mora.svg',
      author: source.author,
      ...(source.homepage ? { homepage: source.homepage } : {}),
      ...(repository ? { repository } : {}),
      metadata: { keywords: source.keywords },
      'dist-tags': { latest: source.version },
      versions: [
        {
          version: source.version,
          publishTimestamp: source.publishTimestamp,
          source: { type: 'npm' },
          engines: { dsh: source.enginesDsh },
        },
      ],
    },
  ],
}

await mkdir(path.join(outDir, 'icons'), { recursive: true })
await writeFile(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')
await copyFile(path.join(root, 'icon.svg'), path.join(outDir, 'icons', 'mora.svg'))

console.log(`wrote public/index.json — ${pkg.name}@${source.version}, dsh ${source.enginesDsh}`)
for (const warning of warnings) console.warn(warning)
