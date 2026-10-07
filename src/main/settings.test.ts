import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/settings'
import { applySettingsPatch, parseSettings, SettingsStore } from './settings'

describe('parseSettings', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ dataFolder: 'relative\\dir', theme: 'neon', invertPages: 'yes' })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values', () => {
    expect(parseSettings({ dataFolder: 'D:\\Data', theme: 'dark', invertPages: true })).toEqual({
      dataFolder: 'D:\\Data',
      theme: 'dark',
      invertPages: true
    })
  })
})

describe('applySettingsPatch', () => {
  it('applies valid fields only', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { theme: 'light' })).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' })
    expect(applySettingsPatch({ ...DEFAULT_SETTINGS, dataFolder: 'D:\\x' }, { dataFolder: null }).dataFolder).toBeNull()
  })

  it('rejects unknown keys and invalid values', () => {
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { color: 'red' })).toThrow(/Unknown setting/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { dataFolder: 'relative' })).toThrow(/absolute/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { theme: 'neon' })).toThrow(/theme/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { invertPages: 1 })).toThrow(/invertPages/)
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, 'x')).toThrow(/object/)
  })
})

describe('SettingsStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfreader-settings-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads defaults when the file is missing or corrupt', async () => {
    expect(await new SettingsStore(join(dir, 'settings.json')).load()).toEqual(DEFAULT_SETTINGS)
    await writeFile(join(dir, 'settings.json'), '{ broken')
    expect(await new SettingsStore(join(dir, 'settings.json')).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates atomically and serializes them', async () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    await Promise.all([store.update({ theme: 'dark' }), store.update({ invertPages: true })])
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({
      dataFolder: null,
      theme: 'dark',
      invertPages: true
    })
    expect(await readdir(dir)).toEqual(['settings.json'])
  })

  it('rejects an update without writing when the settings file cannot be read', async () => {
    const filePath = join(dir, 'settings.json')
    await mkdir(filePath) // reading a directory fails with EISDIR, not ENOENT
    const store = new SettingsStore(filePath)
    await expect(store.update({ invertPages: true })).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['settings.json'])
    expect(await readdir(filePath)).toEqual([])
    await rm(filePath, { recursive: true })
    await expect(store.update({ invertPages: true })).resolves.toMatchObject({ invertPages: true })
  })

  it('starts from defaults when updating a missing or corrupt file', async () => {
    const filePath = join(dir, 'settings.json')
    const store = new SettingsStore(filePath)
    await store.update({ theme: 'dark' })
    await writeFile(filePath, '{ broken')
    expect(await store.update({ invertPages: true })).toEqual({ ...DEFAULT_SETTINGS, invertPages: true })
  })

  it('rejects an invalid patch without writing', async () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    await expect(store.update({ theme: 'neon' })).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})
