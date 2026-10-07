import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addRecent, RecentStore, type RecentEntry } from './recent'

function entry(fingerprint: string, path: string, openedAt = 1): RecentEntry {
  return { fingerprint, path, openedAt }
}

describe('addRecent', () => {
  it('puts the new entry first', () => {
    expect(addRecent([entry('a', 'C:\\a.pdf')], entry('b', 'C:\\b.pdf'))).toEqual([
      entry('b', 'C:\\b.pdf'),
      entry('a', 'C:\\a.pdf')
    ])
  })

  it('replaces an entry for the same Document opened from a new path', () => {
    expect(addRecent([entry('a', 'C:\\old\\a.pdf')], entry('a', 'D:\\new\\a.pdf', 2))).toEqual([
      entry('a', 'D:\\new\\a.pdf', 2)
    ])
  })

  it('replaces an entry for the same path, ignoring case', () => {
    expect(addRecent([entry('old-fp', 'C:\\Books\\A.pdf')], entry('new-fp', 'c:\\books\\a.pdf'))).toEqual([
      entry('new-fp', 'c:\\books\\a.pdf')
    ])
  })

  it('keeps at most max entries', () => {
    const list = Array.from({ length: 5 }, (_, i) => entry(`fp${i}`, `C:\\${i}.pdf`))
    expect(addRecent(list, entry('new', 'C:\\new.pdf'), 3).map((e) => e.fingerprint)).toEqual(['new', 'fp0', 'fp1'])
  })
})

describe('RecentStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfreader-recent-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is empty when the file does not exist', async () => {
    expect(await new RecentStore(join(dir, 'recent.json')).list()).toEqual([])
  })

  it('is empty when the file is corrupt', async () => {
    await writeFile(join(dir, 'recent.json'), 'not json')
    expect(await new RecentStore(join(dir, 'recent.json')).list()).toEqual([])
  })

  it('persists added entries', async () => {
    const path = join(dir, 'recent.json')
    await new RecentStore(path).add(entry('a', 'C:\\a.pdf'))
    await new RecentStore(path).add(entry('b', 'C:\\b.pdf'))
    expect((await new RecentStore(path).list()).map((e) => e.fingerprint)).toEqual(['b', 'a'])
  })

  it('drops malformed entries', async () => {
    await writeFile(join(dir, 'recent.json'), JSON.stringify([entry('a', 'C:\\a.pdf'), { path: 3 }]))
    expect(await new RecentStore(join(dir, 'recent.json')).list()).toEqual([entry('a', 'C:\\a.pdf')])
  })

  it('keeps all entries from ten concurrent adds and leaves no temp file', async () => {
    const path = join(dir, 'recent.json')
    const store = new RecentStore(path)
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.add(entry(`fp${i}`, `C:\\${i}.pdf`, i)))
    )
    const list = await store.list()
    expect(list).toHaveLength(10)
    const names = await readdir(dir)
    expect(names.some((n) => n.includes('.tmp'))).toBe(false)
  })
})
