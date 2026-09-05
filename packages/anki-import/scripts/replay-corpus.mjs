import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { download } from './ankiweb.mjs'

const [manifestPath, cachePath] = process.argv.slice(2)
if (!manifestPath || !cachePath)
  throw new Error('Usage: replay-corpus.mjs <manifest.json> <cache-directory>')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const directory = resolve(cachePath)
await mkdir(directory, { recursive: true })
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
for (const entry of manifest) {
  if (basename(entry.file) !== entry.file) throw new Error('Invalid corpus filename')
  const target = resolve(directory, entry.file)
  let bytes
  try {
    bytes = await readFile(target)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (!bytes) {
    if (entry.downloadUrl) {
      const response = await fetch(entry.downloadUrl, { signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`${entry.id}: HTTP ${response.status}`)
      bytes = Buffer.from(await response.arrayBuffer())
    } else {
      const incoming = resolve(directory, 'incoming')
      await download(Number(entry.id), incoming)
      bytes = await readFile(resolve(incoming, entry.file))
    }
    if (sha256(bytes) !== entry.sha256)
      throw new Error(`${entry.id}: upstream changed; refusing a different snapshot`)
    await writeFile(target + '.partial', bytes)
    await rename(target + '.partial', target)
  }
  if (sha256(bytes) !== entry.sha256) throw new Error(`${entry.id}: cached file hash mismatch`)
  await writeFile(resolve(directory, `${entry.id}.json`), JSON.stringify(entry, null, 2) + '\n')
  console.log(`${entry.id}: SHA-256 verified`)
}
