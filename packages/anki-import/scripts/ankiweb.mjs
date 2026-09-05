// Read-only public AnkiWeb endpoints used by the shared-deck page (not account APIs).
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function fields(bytes) {
  const map = new Map()
  let offset = 0
  function varint() {
    let n = 0n,
      shift = 0n
    for (;;) {
      if (offset >= bytes.length || shift > 63n) throw new Error('Invalid protobuf')
      const b = bytes[offset++]
      n |= BigInt(b & 127) << shift
      if (!(b & 128)) return Number(n)
      shift += 7n
    }
  }
  while (offset < bytes.length) {
    const tag = varint(),
      number = tag >>> 3,
      wire = tag & 7
    let value
    if (wire === 0) value = varint()
    else if (wire === 2) {
      const length = varint()
      value = bytes.subarray(offset, offset + length)
      offset += length
    } else if (wire === 1) {
      value = bytes.subarray(offset, offset + 8)
      offset += 8
    } else if (wire === 5) {
      value = bytes.subarray(offset, offset + 4)
      offset += 4
    } else throw new Error('Unknown protobuf wire type')
    map.set(number, [...(map.get(number) ?? []), value])
  }
  return map
}
const number = (map, n) => map.get(n)?.[0] ?? 0
const string = (map, n) => new TextDecoder().decode(map.get(n)?.[0] ?? new Uint8Array())
let lastRequest = 0
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(Math.max(0, 15000 - (Date.now() - lastRequest)))
    lastRequest = Date.now()
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (response.status === 429) {
      const reason = (await response.text()).slice(0, 180)
      console.error(JSON.stringify({ path: new URL(url).pathname, status: 429, reason }))
      if (reason.includes('log in')) throw new Error('ANKIWEB_LOGIN_REQUIRED')
      const seconds = Math.max(60, Number(response.headers.get('retry-after')) || 60)
      if (seconds > 60) throw new Error(`Rate limited; retry after ${seconds}s`)
      await delay(seconds * 1000)
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).pathname}`)
    return response
  }
  throw new Error('Rate limited after three spaced attempts')
}
export async function listDecks(search) {
  const decoded = fields(
    new Uint8Array(
      await (
        await get(`https://ankiweb.net/svc/shared/list-decks?search=${encodeURIComponent(search)}`)
      ).arrayBuffer(),
    ),
  )
  return (decoded.get(1) ?? [])
    .map((bytes) => {
      const row = fields(bytes)
      return {
        id: number(row, 1),
        title: string(row, 2),
        up: number(row, 3),
        down: number(row, 4),
        notes: number(row, 6),
        audio: number(row, 7),
        images: number(row, 8),
      }
    })
    .sort((a, b) => b.up - b.down - (a.up - a.down))
}
export async function metadata(id) {
  const decoded = fields(
    new Uint8Array(
      await (await get(`https://ankiweb.net/svc/shared/item-info?sharedId=${id}`)).arrayBuffer(),
    ),
  )
  if (!decoded.has(1)) throw new Error(`Shared deck unavailable: ${id}`)
  const info = fields(decoded.get(1)[0]),
    deck = fields(info.get(10)?.[0] ?? new Uint8Array())
  return {
    id,
    title: string(info, 5),
    up: number(info, 18),
    down: number(info, 19),
    size: number(info, 7),
    updatedAt: new Date(number(info, 8) * 1000).toISOString(),
    notes: number(deck, 1),
    audio: number(deck, 2),
    images: number(deck, 3),
    sourceUrl: `https://ankiweb.net/shared/info/${id}`,
    downloadKey: string(deck, 5),
  }
}
export async function download(id, directory) {
  const { downloadKey, ...info } = await metadata(id)
  if (!downloadKey) throw new Error('No public download key')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `${id}.apkg`)
  const response = await get(
    `https://ankiweb.net/svc/shared/download-deck/${id}?t=${encodeURIComponent(downloadKey)}`,
  )
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes[0] !== 80 || bytes[1] !== 75)
    throw new Error('Downloaded response is not a ZIP archive')
  const report = {
    ...info,
    downloadedAt: new Date().toISOString(),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    file: `${id}.apkg`,
  }
  await writeFile(path, bytes)
  await writeFile(resolve(directory, `${id}.json`), JSON.stringify(report, null, 2) + '\n')
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'list')
    for (const term of args)
      console.log(JSON.stringify({ term, decks: (await listDecks(term)).slice(0, 8) }))
  else if (command === 'info')
    for (const id of args) {
      const { downloadKey, ...info } = await metadata(Number(id))
      console.log(JSON.stringify(info))
    }
  else if (command === 'download') {
    const directory = args.shift()
    for (const id of args) {
      try {
        console.log(JSON.stringify(await download(Number(id), directory)))
      } catch (error) {
        console.log(JSON.stringify({ id: Number(id), error: error.message }))
      }
    }
  } else if (command === 'verify') {
    const manifest = JSON.parse(await readFile(args[0], 'utf8'))
    for (const entry of manifest) {
      const data = await readFile(resolve(args[1], entry.file))
      if (createHash('sha256').update(data).digest('hex') !== entry.sha256)
        throw new Error(`Hash mismatch: ${entry.file}`)
    }
    console.log('All corpus hashes match')
  } else
    throw new Error(
      'Usage: ankiweb.mjs list <terms> | info <ids> | download <directory> <ids> | verify <manifest> <directory>',
    )
}
