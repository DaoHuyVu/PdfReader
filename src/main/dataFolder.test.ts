import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { describeDataFolder, documentsDir, resolveDataFolder } from './dataFolder'

describe('resolveDataFolder', () => {
  it('uses PDFREADER_DATA_DIR when set', () => {
    expect(resolveDataFolder({ PDFREADER_DATA_DIR: 'X:\\dev-data', OneDrive: 'C:\\OneDrive' })).toBe('X:\\dev-data')
  })

  it('defaults to a folder inside personal OneDrive (OneDriveConsumer)', () => {
    expect(
      resolveDataFolder({ OneDriveConsumer: 'C:\\Users\\me\\OneDrive', APPDATA: 'C:\\AppData' })
    ).toBe(join('C:\\Users\\me\\OneDrive', 'PdfReaderData'))
  })

  it('falls back to APPDATA when only work OneDrive (%OneDrive%) is set', () => {
    expect(
      resolveDataFolder({ OneDrive: 'C:\\Users\\me\\OneDrive - Tenant', APPDATA: 'C:\\AppData' })
    ).toBe(join('C:\\AppData', 'PdfReader'))
  })

  it('falls back to APPDATA when only work OneDrive (%OneDriveCommercial%) is set', () => {
    expect(
      resolveDataFolder({ OneDriveCommercial: 'C:\\Users\\me\\OneDrive - Tenant', APPDATA: 'C:\\AppData' })
    ).toBe(join('C:\\AppData', 'PdfReader'))
  })

  it('falls back to APPDATA without any OneDrive', () => {
    expect(resolveDataFolder({ APPDATA: 'C:\\AppData' })).toBe(join('C:\\AppData', 'PdfReader'))
  })

  it('prefers PDFREADER_DATA_DIR over OneDriveConsumer', () => {
    expect(
      resolveDataFolder({
        PDFREADER_DATA_DIR: 'X:\\dev-data',
        OneDriveConsumer: 'C:\\Users\\me\\OneDrive',
        APPDATA: 'C:\\AppData'
      })
    ).toBe('X:\\dev-data')
  })

  it('throws when nothing is available', () => {
    expect(() => resolveDataFolder({})).toThrow(/data folder/i)
  })

  it('throws when only work OneDrive is set and APPDATA is missing', () => {
    expect(() => resolveDataFolder({ OneDrive: 'C:\\Users\\me\\OneDrive - Tenant' })).toThrow(/data folder/i)
  })
})

describe('documentsDir', () => {
  it('is the documents subfolder', () => {
    expect(documentsDir('D:\\data')).toBe(join('D:\\data', 'documents'))
  })
})

describe('resolveDataFolder with a Settings folder', () => {
  it('uses the Settings folder after the env override and before OneDrive', () => {
    const env = { OneDriveConsumer: 'C:\\Users\\me\\OneDrive', APPDATA: 'C:\\AppData' }
    expect(resolveDataFolder(env, 'E:\\Sync\\Reader')).toBe('E:\\Sync\\Reader')
    expect(resolveDataFolder({ ...env, PDFREADER_DATA_DIR: 'X:\\dev' }, 'E:\\Sync\\Reader')).toBe('X:\\dev')
    expect(resolveDataFolder(env, null)).toBe(join('C:\\Users\\me\\OneDrive', 'PdfReaderData'))
  })
})

describe('describeDataFolder', () => {
  it('names where the folder came from', () => {
    expect(describeDataFolder({ PDFREADER_DATA_DIR: 'X:\\dev' }).source).toBe('env')
    expect(describeDataFolder({ APPDATA: 'C:\\AppData' }, 'E:\\R').source).toBe('settings')
    expect(describeDataFolder({ OneDriveConsumer: 'C:\\OD', APPDATA: 'C:\\AppData' }).source).toBe('onedrive')
    expect(describeDataFolder({ APPDATA: 'C:\\AppData' })).toEqual({ path: join('C:\\AppData', 'PdfReader'), source: 'appdata' })
  })
})
