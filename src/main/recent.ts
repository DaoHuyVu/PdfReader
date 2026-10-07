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
  constructor(private readonly filePath: string) {}

  async list(): Promise<RecentEntry[]> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      return Array.isArray(raw) ? raw.filter(isRecentEntry) : []
    } catch {
      return []
    }
  }

  async add(entry: RecentEntry): Promise<void> {
    const next = addRecent(await this.list(), entry)
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }
}
