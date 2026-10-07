import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname, isAbsolute } from 'path'
import { DEFAULT_SETTINGS, THEMES, type Settings, type Theme } from '../shared/settings'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isTheme = (value: unknown): value is Theme => (THEMES as readonly unknown[]).includes(value)
const isFolder = (value: unknown): value is string => typeof value === 'string' && isAbsolute(value)

export function parseSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {}
  return {
    dataFolder: isFolder(r.dataFolder) ? r.dataFolder : DEFAULT_SETTINGS.dataFolder,
    theme: isTheme(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    invertPages: r.invertPages === true
  }
}

export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  if (!isRecord(patch)) throw new Error('Settings patch must be an object')
  const next: Settings = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'dataFolder') {
      if (value !== null && !isFolder(value)) throw new Error('dataFolder must be an absolute path or null')
      next.dataFolder = value
    } else if (key === 'theme') {
      if (!isTheme(value)) throw new Error(`Invalid theme: ${String(value)}`)
      next.theme = value
    } else if (key === 'invertPages') {
      if (typeof value !== 'boolean') throw new Error('invertPages must be a boolean')
      next.invertPages = value
    } else {
      throw new Error(`Unknown setting: ${key}`)
    }
  }
  return next
}

/** Settings for this machine. Updates are serialized and written atomically. */
export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    try {
      return parseSettings(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  /** Like load(), but only a missing or corrupt file yields defaults; other read errors propagate. */
  private async loadForUpdate(): Promise<Settings> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS }
      throw err
    }
    try {
      return parseSettings(JSON.parse(text))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  update(patch: unknown): Promise<Settings> {
    const run = this.queue.then(() => this.updateUnlocked(patch))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async updateUnlocked(patch: unknown): Promise<Settings> {
    const next = applySettingsPatch(await this.loadForUpdate(), patch)
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8')
    try {
      await rename(tempPath, this.filePath)
    } catch (err) {
      await unlink(tempPath).catch(() => undefined)
      throw err
    }
    return next
  }
}
