import { Unzip, UnzipInflate } from 'fflate'
import { Decompress } from 'fzstd'
import initSqlJs from 'sql.js'
import { Field, Type } from 'protobufjs/light'
import { APKG_MAX_BYTES } from './limits'

export const limits = {
  archive: APKG_MAX_BYTES,
  expanded: 500 * 1024 ** 2,
  collection: 250 * 1024 ** 2,
  media: 50 * 1024 ** 2,
  window: 64 * 1024 ** 2,
  files: 10000,
}
export type Row = Record<string, unknown>
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
export interface DecodedArchive {
  files: Record<string, Uint8Array>
  format: 'anki2' | 'anki21' | '21b'
  rows: Record<string, Row[]>
}
const integer = (data: Uint8Array, offset: number, size: number): number => {
  if (offset + size > data.length) throw new Error('APKG_TRUNCATED')
  let value = 0
  for (let n = size - 1; n >= 0; n--) value = value * 256 + data[offset + n]!
  if (!Number.isSafeInteger(value)) throw new Error('APKG_TOO_LARGE')
  return value
}
export function boundedZstd(data: Uint8Array, maximum: number): Uint8Array {
  let cursor = 0
  while (cursor < data.length) {
    if (integer(data, cursor, 4) !== 0xfd2fb528) throw new Error('APKG_INVALID_ZSTD')
    const flags = data[cursor + 4]!,
      single = !!(flags & 32),
      descriptor = data[cursor + 5]!
    if (flags & 24 || flags & 3) throw new Error('APKG_UNSUPPORTED_ZSTD')
    const sizeLength = flags >> 6 ? 2 ** (flags >> 6) : single ? 1 : 0
    const sizeOffset = cursor + (single ? 5 : 6)
    const contentSize = sizeLength
      ? integer(data, sizeOffset, sizeLength) + (sizeLength === 2 ? 256 : 0)
      : 0
    const base = 2 ** (10 + (descriptor >> 3))
    const window = single ? contentSize : base + (base / 8) * (descriptor & 7)
    if (window > limits.window || contentSize > maximum) throw new Error('APKG_ZSTD_LIMIT')
    cursor = sizeOffset + sizeLength
    let last = false
    while (!last) {
      const header = integer(data, cursor, 3)
      cursor += 3
      last = !!(header & 1)
      const kind = (header >> 1) & 3,
        size = header >>> 3
      if (kind === 3 || size > 131072) throw new Error('APKG_INVALID_ZSTD')
      cursor += kind === 1 ? 1 : size
      if (cursor > data.length) throw new Error('APKG_TRUNCATED')
    }
    if (flags & 4) cursor += 4
    if (cursor > data.length) throw new Error('APKG_TRUNCATED')
  }
  let total = 0
  const chunks: Uint8Array[] = []
  const decoder = new Decompress((chunk) => {
    total += chunk.length
    if (total > maximum) throw new Error('APKG_ZSTD_LIMIT')
    chunks.push(chunk.slice())
  })
  for (let offset = 0; offset < data.length; offset += 65536)
    decoder.push(data.subarray(offset, offset + 65536), offset + 65536 >= data.length)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
export function boundedZip(data: Uint8Array): Record<string, Uint8Array> {
  if (data.length > limits.archive) throw new Error('APKG_ARCHIVE_TOO_LARGE')
  let end = data.length - 22
  while (end >= Math.max(0, data.length - 65557) && integer(data, end, 4) !== 0x06054b50) end--
  if (end < 0 || integer(data, end, 4) !== 0x06054b50) throw new Error('APKG_BROKEN_ZIP')
  if (integer(data, end + 4, 4) !== 0) throw new Error('APKG_MULTIDISK')
  const count = integer(data, end + 10, 2),
    central = integer(data, end + 16, 4)
  if (end + 22 + integer(data, end + 20, 2) !== data.length) throw new Error('APKG_TRUNCATED')
  if (count > limits.files) throw new Error('APKG_ZIP_BOMB')
  const expected = new Map<string, number>(),
    checksums = new Map<string, number>()
  let cursor = central,
    total = 0
  for (let n = 0; n < count; n++) {
    if (integer(data, cursor, 4) !== 0x02014b50) throw new Error('APKG_BROKEN_ZIP')
    if (integer(data, cursor + 8, 2) & 1) throw new Error('APKG_ENCRYPTED_ZIP')
    const size = integer(data, cursor + 24, 4),
      nameLength = integer(data, cursor + 28, 2)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      data.subarray(cursor + 46, cursor + 46 + nameLength),
    )
    if (
      !name ||
      name.includes('\\') ||
      name.includes(String.fromCharCode(0)) ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').includes('..') ||
      expected.has(name)
    )
      throw new Error('APKG_PATH_TRAVERSAL')
    total += size
    if (total > limits.expanded) throw new Error('APKG_ZIP_BOMB')
    expected.set(name, size)
    checksums.set(name, integer(data, cursor + 16, 4))
    cursor += 46 + nameLength + integer(data, cursor + 30, 2) + integer(data, cursor + 32, 2)
  }
  if (cursor !== end) throw new Error('APKG_INVALID_CENTRAL_DIRECTORY')
  const files: Record<string, Uint8Array> = Object.create(null)
  let actual = 0,
    seen = 0
  const unzip = new Unzip((file) => {
    if (!expected.has(file.name) || Object.hasOwn(files, file.name))
      throw new Error('APKG_INVALID_ENTRY')
    let size = 0
    const chunks: Uint8Array[] = []
    files[file.name] = new Uint8Array()
    file.ondata = (error, chunk, final) => {
      if (error) throw error
      size += chunk.length
      actual += chunk.length
      if (size > expected.get(file.name)! || actual > limits.expanded)
        throw new Error('APKG_ZIP_BOMB')
      chunks.push(chunk.slice())
      if (final) {
        if (size !== expected.get(file.name)) throw new Error('APKG_SIZE_MISMATCH')
        const out = new Uint8Array(size)
        let offset = 0
        for (const c of chunks) {
          out.set(c, offset)
          offset += c.length
        }
        files[file.name] = out
        seen++
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let offset = 0; offset < data.length; offset += 4096)
    unzip.push(data.subarray(offset, offset + 4096), offset + 4096 >= data.length)
  if (seen !== count) throw new Error('APKG_TRUNCATED')
  for (const [name, bytes] of Object.entries(files))
    if (crc32(bytes) !== checksums.get(name)) throw new Error('APKG_ZIP_CHECKSUM')
  return files
}
const modelConfig = new Type('ModelConfig')
  .add(new Field('kind', 1, 'uint32'))
  .add(new Field('css', 3, 'string'))
const templateConfig = new Type('TemplateConfig')
  .add(new Field('qfmt', 1, 'string'))
  .add(new Field('afmt', 2, 'string'))
export async function decodeArchive(
  data: Uint8Array,
  options: { wasmUrl: string },
): Promise<DecodedArchive> {
  const files = boundedZip(data)
  let format: DecodedArchive['format']
  if (files.meta) {
    const meta = new Type('Meta')
      .add(new Field('version', 1, 'uint32'))
      .decode(files.meta) as unknown as { version: number }
    if (![1, 2, 3].includes(meta.version)) throw new Error('APKG_UNKNOWN_GENERATION')
    format = meta.version === 3 ? '21b' : meta.version === 2 ? 'anki21' : 'anki2'
  } else format = files['collection.anki21'] ? 'anki21' : 'anki2'
  const name =
    format === '21b'
      ? files['collection.anki21b']
        ? 'collection.anki21b'
        : 'collection.21b'
      : `collection.${format}`
  if (!files[name]) throw new Error('APKG_UNKNOWN_GENERATION')
  let collection = files[name]!
  if (format === '21b') collection = boundedZstd(collection, limits.collection)
  if (collection.length > limits.collection) throw new Error('APKG_INVALID_COLLECTION')
  const SQL = await initSqlJs({ locateFile: () => options.wasmUrl })
  const db = new SQL.Database(collection)
  const query = (sql: string): Row[] => {
    const r = db.exec(sql)[0]
    return r
      ? r.values.map((values) => Object.fromEntries(r.columns.map((key, i) => [key, values[i]])))
      : []
  }
  try {
    const col = query('select ver, models, decks from col')[0]
    if (!col || Number(col.ver) !== (format === '21b' ? 18 : 11))
      throw new Error('APKG_UNKNOWN_SCHEMA')
    if (format === '21b') {
      const fields = query('select ntid, ord, name from fields order by ord'),
        templates = query('select ntid, ord, name, config from templates order by ord')
      const models = Object.fromEntries(
        query('select id, name, config from notetypes').map((m) => {
          const config = modelConfig.toObject(modelConfig.decode(m.config as Uint8Array), {
            defaults: true,
          })
          return [
            String(m.id),
            {
              name: m.name,
              type: config.kind,
              css: config.css,
              flds: fields.filter((f) => f.ntid === m.id),
              tmpls: templates
                .filter((t) => t.ntid === m.id)
                .map((t) => ({
                  ...templateConfig.toObject(templateConfig.decode(t.config as Uint8Array), {
                    defaults: true,
                  }),
                  ord: t.ord,
                  name: t.name,
                })),
            },
          ]
        }),
      )
      col.models = JSON.stringify(models)
      col.decks = JSON.stringify(
        Object.fromEntries(
          query('select id,name from decks').map((d) => [
            String(d.id),
            { name: String(d.name).replaceAll('\x1f', '::') },
          ]),
        ),
      )
      let expanded = collection.length
      for (const [key, value] of Object.entries(files)) {
        if (key === 'media' || /^\d+$/.test(key)) {
          files[key] = boundedZstd(value, key === 'media' ? limits.media : limits.media)
          expanded += files[key]!.length
          if (expanded > limits.expanded) throw new Error('APKG_ZIP_BOMB')
        }
      }
    }
    const rows = {
      col: [col],
      notes: query('select id,guid,mid,flds,tags from notes'),
      cards: query(
        `select id,nid,did,ord${query('pragma table_info(cards)').some((c) => c.name === 'flags') ? ',flags' : ''} from cards`,
      ),
      revlog: query('select id,cid,ease,type from revlog order by id'),
    }
    delete files[name]
    return { files, format, rows }
  } finally {
    db.close()
  }
}
