import { beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { createRequire } from 'node:module'
import { File as NodeFile } from 'node:buffer'
const wasmUrl = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm')
vi.stubGlobal('File', NodeFile)
import { strToU8, zipSync } from 'fflate'
import { parseApkg } from '../src'
const parseFile = async (file: File) =>
  parseApkg(new Uint8Array(await file.arrayBuffer()), { wasmUrl })

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: () => (wasmUrl.startsWith('/@fs/') ? wasmUrl.slice(4) : wasmUrl),
  })
})

function collection(): Uint8Array {
  const db = new SQL.Database()
  db.run('create table col (models text, decks text, ver integer default 11)')
  db.run('create table notes (id integer, guid text, mid integer, flds text, tags text)')
  db.run('create table cards (id integer, nid integer, did integer, ord integer)')
  db.run('create table revlog (id integer, cid integer, ease integer, type integer)')
  const models = JSON.stringify({
    10: {
      name: 'Basic',
      flds: [{ name: 'Front' }, { name: 'Back' }],
      tmpls: [
        { ord: 0, qfmt: '{{Front}}<script>alert(1)</script>', afmt: '{{FrontSide}}<hr>{{Back}}' },
        { ord: 1, qfmt: '{{Back}}', afmt: '{{Front}}' },
      ],
      css: 'body { color: red } @import "https://bad.invalid/x.css";',
    },
  })
  db.run('insert into col(models,decks) values (?, ?)', [
    models,
    JSON.stringify({ 20: { name: 'Deck A' }, 21: { name: 'Deck B' } }),
  ])
  db.run('insert into notes values (1, ?, 10, ?, ?)', [
    'stable-guid',
    'Question<img src="a.png">\x1fAnswer',
    'tag-a tag-b',
  ])
  db.run('insert into cards values (101, 1, 20, 0), (102, 1, 21, 1)')
  db.run(
    'insert into revlog values (1700000000000, 101, 1, 0), (1700000001000, 101, 4, 1), (1700000002000, 101, 0, 4)',
  )
  const result = db.export()
  db.close()
  return result
}

const packageFile = (name: string) =>
  new File(
    [
      zipSync({
        [name]: collection(),
        media: name.includes('21b')
          ? new Uint8Array([0x0a, 0x09, 0x0a, 0x05, 0x61, 0x2e, 0x70, 0x6e, 0x67, 0x10, 0x01])
          : strToU8('{"0":"a.png"}'),
        0: new Uint8Array([0x89]),
      }) as BlobPart,
    ],
    'fixture.apkg',
  )

describe('APKG import', () => {
  it.each([
    ['collection.anki2', 'anki2'],
    ['collection.anki21', 'anki21'],
  ] as const)('reads %s', async (collectionName, format) => {
    const result = await parseFile(packageFile(collectionName))
    expect(result.format).toBe(format)
    expect(result.decks.map((deck) => deck.name)).toEqual(['Deck A', 'Deck B'])
    expect(result.decks[0]!.cards[0]!.key).toBe('stable-guid:0')
    expect(result.decks[0]!.cards[0]!.frontHtml).not.toContain('script')
    expect(result.stats.reviewCount).toBe(2)
    expect(result.stats.skippedReviewCount).toBe(1)
    expect(result.media).toHaveLength(1)
    expect(result.decks[0]!.cards[0]!.frontHtml).toContain('fukushu-media:')
  })

  it('rejects traversal and unknown packages', async () => {
    await expect(
      parseFile(new File([zipSync({ '../bad': strToU8('x') }) as BlobPart], 'bad.apkg')),
    ).rejects.toThrow(/PATH_TRAVERSAL|UNKNOWN_GENERATION/)
    await expect(
      parseFile(new File([zipSync({ hello: strToU8('x') }) as BlobPart], 'bad.apkg')),
    ).rejects.toThrow('APKG_UNKNOWN_GENERATION')
  })
})
