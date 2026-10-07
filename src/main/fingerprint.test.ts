import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeFingerprint, FINGERPRINT_HEAD_BYTES, fingerprintFromHead } from './fingerprint'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pdfreader-fp-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('fingerprintFromHead', () => {
  it('is 64 lowercase hex characters', () => {
    expect(fingerprintFromHead(new Uint8Array([1, 2, 3]), 3)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('depends on the file size, not only the head bytes', () => {
    const head = new Uint8Array([1, 2, 3])
    expect(fingerprintFromHead(head, 3)).not.toBe(fingerprintFromHead(head, 4))
  })
})

describe('computeFingerprint', () => {
  it('gives the same fingerprint for a renamed or moved copy', async () => {
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'renamed copy.pdf')
    await writeFile(a, 'same pdf bytes')
    await copyFile(a, b)
    expect(await computeFingerprint(b)).toBe(await computeFingerprint(a))
  })

  it('gives different fingerprints for different content', async () => {
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'b.pdf')
    await writeFile(a, 'content one')
    await writeFile(b, 'content two')
    expect(await computeFingerprint(a)).not.toBe(await computeFingerprint(b))
  })

  it('matches fingerprintFromHead for a small file', async () => {
    const bytes = Buffer.from('small pdf')
    const path = join(dir, 'small.pdf')
    await writeFile(path, bytes)
    expect(await computeFingerprint(path)).toBe(fingerprintFromHead(bytes, bytes.length))
  })

  it('only reads the first 4 MiB: a change after that keeps the fingerprint (accepted trade-off)', async () => {
    const size = FINGERPRINT_HEAD_BYTES + 1024
    const original = Buffer.alloc(size, 1)
    const changedTail = Buffer.from(original)
    changedTail[size - 1] = 2
    const changedHead = Buffer.from(original)
    changedHead[100] = 2
    await writeFile(join(dir, 'o.pdf'), original)
    await writeFile(join(dir, 't.pdf'), changedTail)
    await writeFile(join(dir, 'h.pdf'), changedHead)
    const fp = await computeFingerprint(join(dir, 'o.pdf'))
    expect(await computeFingerprint(join(dir, 't.pdf'))).toBe(fp)
    expect(await computeFingerprint(join(dir, 'h.pdf'))).not.toBe(fp)
  })
})
