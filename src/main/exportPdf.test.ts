import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExportAnnotation } from '../shared/ipc'
import { exportFileName, isExportAnnotation, sameFilePath, writeAnnotatedPdf, writeFileAtomic } from './exportPdf'

const ANNOTATION: ExportAnnotation = {
  pageIndex: 0,
  quadPoints: [10, 700, 60, 700, 10, 690, 60, 690],
  rect: [10, 690, 60, 700],
  color: [1, 0.89, 0.2],
  note: 'Ghi chú quan trọng'
}

async function samplePdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([600, 800])
  return doc.save()
}

async function annotsOf(bytes: Uint8Array, pageIndex = 0): Promise<{ doc: PDFDocument; annots: PDFDict[] }> {
  const doc = await PDFDocument.load(bytes)
  const array = doc.getPage(pageIndex).node.Annots()
  const annots = (array?.asArray() ?? []).map((ref) => doc.context.lookup(ref, PDFDict))
  return { doc, annots }
}

describe('writeAnnotatedPdf', () => {
  it('adds a Highlight annotation with quad points, color, author and Note popup', async () => {
    const output = await writeAnnotatedPdf(await samplePdf(), [ANNOTATION], new Date('2026-10-07T10:00:00Z'))
    const { annots } = await annotsOf(output)
    expect(annots).toHaveLength(2)
    const [highlight, popup] = annots
    expect(highlight.get(PDFName.of('Subtype'))?.toString()).toBe('/Highlight')
    const quads = highlight.lookup(PDFName.of('QuadPoints'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber())
    expect(quads).toEqual(ANNOTATION.quadPoints)
    const color = highlight.lookup(PDFName.of('C'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber())
    expect(color).toEqual([1, 0.89, 0.2])
    expect(highlight.lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe('Ghi chú quan trọng')
    expect(highlight.lookup(PDFName.of('T'), PDFHexString).decodeText()).toBe('PdfReader')
    expect(highlight.get(PDFName.of('AP'))).toBeInstanceOf(PDFDict)
    expect(popup.get(PDFName.of('Subtype'))?.toString()).toBe('/Popup')
    expect(popup.get(PDFName.of('Parent'))).toBeInstanceOf(PDFRef)
  })

  it('adds no Contents or Popup without a Note, and targets the right page', async () => {
    const output = await writeAnnotatedPdf(await samplePdf(2), [{ ...ANNOTATION, pageIndex: 1, note: null }], new Date())
    expect((await annotsOf(output, 0)).annots).toHaveLength(0)
    const { annots } = await annotsOf(output, 1)
    expect(annots).toHaveLength(1)
    expect(annots[0].get(PDFName.of('Contents'))).toBeUndefined()
    expect(annots[0].get(PDFName.of('Popup'))).toBeUndefined()
  })

  it('ignores annotations for pages that do not exist and leaves the input untouched', async () => {
    const source = await samplePdf()
    const copy = Uint8Array.from(source)
    const output = await writeAnnotatedPdf(source, [{ ...ANNOTATION, pageIndex: 5 }], new Date())
    expect((await annotsOf(output)).annots).toHaveLength(0)
    expect(source).toEqual(copy)
  })
})

describe('isExportAnnotation', () => {
  it('accepts a valid annotation and rejects malformed ones', () => {
    expect(isExportAnnotation(ANNOTATION)).toBe(true)
    expect(isExportAnnotation({ ...ANNOTATION, quadPoints: [1, 2, 3] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, quadPoints: [] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, color: [2, 0, 0] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, rect: [0, 0, 1] })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, pageIndex: -1 })).toBe(false)
    expect(isExportAnnotation({ ...ANNOTATION, note: 5 })).toBe(false)
  })
})

describe('exportFileName', () => {
  it('adds " (highlighted)" before the extension', () => {
    expect(exportFileName('Hợp đồng.PDF')).toBe('Hợp đồng (highlighted).pdf')
    expect(exportFileName('a.b.pdf')).toBe('a.b (highlighted).pdf')
    expect(exportFileName('noext')).toBe('noext (highlighted).pdf')
  })
})

describe('sameFilePath', () => {
  it('compares resolved paths case-insensitively', () => {
    expect(sameFilePath('D:\\Books\\A.pdf', 'd:\\books\\x\\..\\a.PDF')).toBe(true)
    expect(sameFilePath('D:\\Books\\A.pdf', 'D:\\Books\\A (highlighted).pdf')).toBe(false)
  })
})

describe('writeFileAtomic', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfreader-export-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes the bytes and leaves no temp file', async () => {
    await writeFileAtomic(join(dir, 'out.pdf'), Uint8Array.from([1, 2, 3]))
    expect([...(await readFile(join(dir, 'out.pdf')))]).toEqual([1, 2, 3])
    expect(await readdir(dir)).toEqual(['out.pdf'])
  })
})
