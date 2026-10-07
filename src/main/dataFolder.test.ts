import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { documentsDir, resolveDataFolder } from './dataFolder'

describe('resolveDataFolder', () => {
  it('uses PDFREADER_DATA_DIR when set', () => {
    expect(resolveDataFolder({ PDFREADER_DATA_DIR: 'X:\\dev-data', OneDrive: 'C:\\OneDrive' })).toBe('X:\\dev-data')
  })

  it('defaults to a folder inside OneDrive', () => {
    expect(resolveDataFolder({ OneDrive: 'C:\\Users\\me\\OneDrive', APPDATA: 'C:\\AppData' })).toBe(
      join('C:\\Users\\me\\OneDrive', 'PdfReaderData')
    )
  })

  it('falls back to APPDATA without OneDrive', () => {
    expect(resolveDataFolder({ APPDATA: 'C:\\AppData' })).toBe(join('C:\\AppData', 'PdfReader'))
  })

  it('throws when nothing is available', () => {
    expect(() => resolveDataFolder({})).toThrow(/data folder/i)
  })
})

describe('documentsDir', () => {
  it('is the documents subfolder', () => {
    expect(documentsDir('D:\\data')).toBe(join('D:\\data', 'documents'))
  })
})
