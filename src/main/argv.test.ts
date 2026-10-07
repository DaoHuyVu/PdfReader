import { describe, expect, it } from 'vitest'
import { findPdfArg } from './argv'

describe('findPdfArg', () => {
  it('finds a PDF path passed by Explorer', () => {
    expect(findPdfArg(['C:\\App\\PdfReader.exe', 'D:\\Books\\A Book.PDF'])).toBe('D:\\Books\\A Book.PDF')
  })

  it('ignores Chromium flags', () => {
    expect(findPdfArg(['app.exe', '--allow-file-access-from-files', 'D:\\a.pdf'])).toBe('D:\\a.pdf')
  })

  it('returns null when no PDF is given', () => {
    expect(findPdfArg(['electron.exe', '.'])).toBeNull()
  })

  it('never treats the executable itself as a document', () => {
    expect(findPdfArg(['weird.pdf'])).toBeNull()
  })
})
