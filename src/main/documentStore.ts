import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  emptyDocumentData,
  mergeDocumentData,
  parseDocumentData,
  type DocumentData,
  type Fingerprint
} from '../shared/documentData'

const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Retries `operation` on EPERM/EBUSY/EACCES (OneDrive file locks); other errors rethrow immediately. */
export async function withRetry<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (attempt >= attempts || !RETRYABLE_CODES.has(code)) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
    }
  }
}

/** One JSON file per Document in the Data Folder. See docs/adr/0002. */
export class DocumentStore {
  private readonly queues = new Map<Fingerprint, Promise<unknown>>()

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now
  ) {}

  load(fingerprint: Fingerprint): Promise<DocumentData> {
    return this.enqueue(fingerprint, () => this.loadUnlocked(fingerprint))
  }

  update(fingerprint: Fingerprint, mutate: (data: DocumentData) => DocumentData): Promise<DocumentData> {
    return this.enqueue(fingerprint, async () => {
      const next = mutate(await this.loadUnlocked(fingerprint))
      await this.writeAtomic(fingerprint, next)
      return next
    })
  }

  private enqueue<T>(fingerprint: Fingerprint, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(fingerprint) ?? Promise.resolve()
    const run = previous.then(task, task)
    const tail = run.catch(() => undefined)
    this.queues.set(fingerprint, tail)
    void tail.then(() => {
      if (this.queues.get(fingerprint) === tail) this.queues.delete(fingerprint)
    })
    return run
  }

  private mainPath(fingerprint: Fingerprint): string {
    return join(this.dir, `${fingerprint}.json`)
  }

  private async loadUnlocked(fingerprint: Fingerprint): Promise<DocumentData> {
    await mkdir(this.dir, { recursive: true })
    let data = emptyDocumentData(fingerprint)

    const mainPath = this.mainPath(fingerprint)
    const main = await readIfExists(mainPath)
    if (main !== null) {
      try {
        data = parseDocumentData(JSON.parse(main))
      } catch {
        await withRetry(() => rename(mainPath, join(this.dir, `${fingerprint}.corrupt-${this.now()}.bak`)))
      }
    }

    const mergedCopies: string[] = []
    for (const name of await readdir(this.dir)) {
      if (!name.startsWith(`${fingerprint}-`) || !name.endsWith('.json')) continue
      const copyPath = join(this.dir, name)
      try {
        const copy = parseDocumentData(JSON.parse(await readFile(copyPath, 'utf8')))
        if (copy.fingerprint !== fingerprint) continue
        data = mergeDocumentData(data, copy)
        mergedCopies.push(copyPath)
      } catch {
        // Unreadable or half-synced Conflict Copy: leave it for a later load.
      }
    }

    if (mergedCopies.length > 0) {
      await this.writeAtomic(fingerprint, data)
      for (const copyPath of mergedCopies) {
        await withRetry(() => unlink(copyPath)).catch((err) => {
          console.error('Failed to delete merged conflict copy', copyPath, err)
        })
      }
    }
    return data
  }

  private async writeAtomic(fingerprint: Fingerprint, data: DocumentData): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tempPath = join(this.dir, `${fingerprint}.json.${randomUUID()}.tmp`)
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')
    try {
      await withRetry(() => rename(tempPath, this.mainPath(fingerprint)))
    } catch (err) {
      await unlink(tempPath).catch(() => undefined)
      throw err
    }
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
