import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { Fingerprint } from '../shared/documentData'

export interface RecentEntry {
  fingerprint: Fingerprint
  path: string
  openedAt: number
}

export const MAX_RECENT = 20

export function addRecent(list: RecentEntry[], entry: RecentEntry, max = MAX_RECENT): RecentEntry[] {
  const path = entry.path.toLowerCase()
  const rest = list.filter((e) => e.fingerprint !== entry.fingerprint && e.path.toLowerCase() !== path)
  return [entry, ...rest].slice(0, max)
}

function isRecentEntry(value: unknown): value is RecentEntry {
  const v = value as RecentEntry
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.fingerprint === 'string' &&
    typeof v.path === 'string' &&
    typeof v.openedAt === 'number'
  )
}

/** Recent Documents for this machine only; paths differ between machines. */
export class RecentStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async list(): Promise<RecentEntry[]> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      return Array.isArray(raw) ? raw.filter(isRecentEntry) : []
    } catch {
      return []
    }
  }

  /** Serialized so concurrent opens cannot collide or drop entries. A failed add does not block later ones. */
  async add(entry: RecentEntry): Promise<void> {
    const run = this.queue.then(() => this.addUnlocked(entry), () => this.addUnlocked(entry))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async addUnlocked(entry: RecentEntry): Promise<void> {
    const next = addRecent(await this.list(), entry)
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }
}

/**
 * The Recent entry for the same path but a different Fingerprint: the file changed since it was
 * last opened here, so its old data can be offered for Carry Over.
 */
export function findCarryOverSource(entries: RecentEntry[], path: string, fingerprint: Fingerprint): RecentEntry | null {
  const target = path.toLowerCase()
  return entries.find((e) => e.path.toLowerCase() === target && e.fingerprint !== fingerprint) ?? null
}
