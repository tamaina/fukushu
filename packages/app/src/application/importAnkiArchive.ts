import { unzipSync } from 'fflate'

const TEXT_EXTENSIONS = /\.(csv|tsv|txt)$/i
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
}

const normalizePath = (value: string): string =>
  value
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/')

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

export interface AnkiArchive {
  source: string
  sourceFileName: string
  missingMedia: string[]
}

export function readAnkiArchive(buffer: ArrayBuffer): AnkiArchive {
  const files = unzipSync(new Uint8Array(buffer))
  const names = Object.keys(files).filter((name) => !name.endsWith('/'))
  const textFiles = names.filter((name) => TEXT_EXTENSIONS.test(name))
  if (textFiles.length !== 1) throw new Error('ZIP must contain exactly one CSV, TSV, or TXT file.')
  if (names.some((name) => name.split('/').includes('..') || name.startsWith('/')))
    throw new Error('ZIP contains an unsafe path.')
  const total = names.reduce((sum, name) => sum + (files[name]?.byteLength ?? 0), 0)
  if (total > 50 * 1024 * 1024) throw new Error('Expanded ZIP is larger than 50 MB.')
  const sourceName = textFiles[0]!
  let source = new TextDecoder('utf-8', { fatal: true })
    .decode(files[sourceName])
    .replace(/^\uFEFF/, '')
  const media = new Map<string, string>()
  for (const name of names) {
    if (name === sourceName) continue
    const normalized = normalizePath(name)
    const extension = normalized.split('.').pop()?.toLowerCase() ?? ''
    const mime = MIME_TYPES[extension]
    if (!mime || mime === 'image/svg+xml') continue
    media.set(normalized, `data:${mime};base64,${base64(files[name]!)}`)
    media.set(normalized.split('/').pop()!, `data:${mime};base64,${base64(files[name]!)}`)
  }
  const missing = new Set<string>()
  source = source.replace(
    /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
    (all, prefix, name, suffix) => {
      if (/^(?:data:|https?:)/i.test(name)) return all
      const replacement = media.get(normalizePath(name))
      if (!replacement) {
        missing.add(name)
        return all
      }
      return `${prefix}${replacement}${suffix}`
    },
  )
  source = source.replace(/\[sound:([^\]]+)\]/gi, (_all, name: string) => {
    const replacement = media.get(normalizePath(name))
    if (!replacement) {
      missing.add(name)
      return `<span class="missing-media">[sound:${name}]</span>`
    }
    return `<audio controls preload="none" src="${replacement}"></audio>`
  })
  return { source, sourceFileName: sourceName, missingMedia: [...missing] }
}
