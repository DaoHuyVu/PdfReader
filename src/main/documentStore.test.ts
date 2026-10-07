import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDocumentData, parseDocumentData, type Highlight, type ReadingPosition } from '../shared/documentData'
import { DocumentStore } from './documentStore'

const FP = 'a'.repeat(64)
let dir: string
let store: DocumentStore

function reading(pageIndex: number, updatedAt: number): ReadingPosition {
  return { pageIndex, offsetRatio: 0, zoom: { mode: 'fit-width' }, updatedAt }
}

function highlight(id: string): Highlight {
  return {
    id,
    color: 'yellow',
    note: null,
    text: id,
    parts: [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }] }],
    createdAt: 1,
    updatedAt: 1
  }
}

async function readMain() {
  return parseDocumentData(JSON.parse(await readFile(join(dir, `${FP}.json`), 'utf8')))
}

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'pdfreader-store-')), 'documents')
  store = new DocumentStore(dir, () => 12345)
})

afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true })
})

describe('DocumentStore', () => {
  it('returns empty data for an unknown Document without writing a file', async () => {
    expect(await store.load(FP)).toEqual(emptyDocumentData(FP))
    expect(await readdir(dir)).toEqual([])
  })

  it('persists updates', async () => {
    await store.update(FP, (d) => ({ ...d, pageCount: 10, reading: reading(3, 100) }))
    expect((await store.load(FP)).reading).toEqual(reading(3, 100))
    expect((await readMain()).pageCount).toBe(10)
  })

  it('leaves no temp files after writing', async () => {
    await store.update(FP, (d) => ({ ...d, pageCount: 1 }))
    expect(await readdir(dir)).toEqual([`${FP}.json`])
  })

  it('serializes concurrent updates to the same Document', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.update(FP, (d) => ({ ...d, highlights: [...d.highlights, highlight(`h${i}`)] }))
      )
    )
    expect((await store.load(FP)).highlights).toHaveLength(10)
  })

  it('merges a OneDrive Conflict Copy, saves the result, and deletes the copy', async () => {
    await store.update(FP, (d) => ({ ...d, reading: reading(3, 1000) }))
    const copy = { ...emptyDocumentData(FP), reading: reading(9, 2000), highlights: [highlight('from-laptop')] }
    await writeFile(join(dir, `${FP}-LAPTOP.json`), JSON.stringify(copy))

    const loaded = await store.load(FP)

    expect(loaded.reading).toEqual(reading(9, 2000))
    expect(loaded.highlights.map((h) => h.id)).toEqual(['from-laptop'])
    expect(await readdir(dir)).toEqual([`${FP}.json`])
    expect((await readMain()).reading).toEqual(reading(9, 2000))
  })

  it('merges a Conflict Copy even when the main file is missing', async () => {
    const copy = { ...emptyDocumentData(FP), reading: reading(4, 1) }
    await store.update(FP, (d) => d)
    await rm(join(dir, `${FP}.json`))
    await writeFile(join(dir, `${FP}-PC-2.json`), JSON.stringify(copy))
    expect((await store.load(FP)).reading).toEqual(reading(4, 1))
  })

  it('leaves an unreadable Conflict Copy in place', async () => {
    await store.update(FP, (d) => ({ ...d, pageCount: 2 }))
    await writeFile(join(dir, `${FP}-LAPTOP.json`), '{ half synced')
    expect((await store.load(FP)).pageCount).toBe(2)
    expect((await readdir(dir)).sort()).toEqual([`${FP}-LAPTOP.json`, `${FP}.json`])
  })

  it('backs up a corrupt main file instead of deleting it', async () => {
    await store.update(FP, (d) => d)
    await writeFile(join(dir, `${FP}.json`), '{ oops')
    expect(await store.load(FP)).toEqual(emptyDocumentData(FP))
    expect(await readdir(dir)).toEqual([`${FP}.corrupt-12345.bak`])
  })

  it('does not touch other Documents', async () => {
    const other = 'b'.repeat(64)
    await store.update(other, (d) => ({ ...d, pageCount: 7 }))
    await store.update(FP, (d) => ({ ...d, pageCount: 3 }))
    expect((await store.load(other)).pageCount).toBe(7)
  })
})
