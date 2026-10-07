import type { Fingerprint, ReadingPosition } from '../shared/documentData'

export interface PendingPosition {
  reading: ReadingPosition
  pageCount: number
}

/** Batches Reading Position writes so OneDrive does not upload on every scroll. */
export class PositionSaver {
  private readonly pending = new Map<Fingerprint, PendingPosition>()
  private readonly timers = new Map<Fingerprint, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly write: (fingerprint: Fingerprint, position: PendingPosition) => Promise<void>,
    private readonly delayMs = 3000
  ) {}

  report(fingerprint: Fingerprint, position: PendingPosition): void {
    this.pending.set(fingerprint, position)
    const existing = this.timers.get(fingerprint)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.set(
      fingerprint,
      setTimeout(() => {
        this.flush(fingerprint).catch((err) => console.error('Failed to save reading position', err))
      }, this.delayMs)
    )
  }

  async flush(fingerprint: Fingerprint): Promise<void> {
    const timer = this.timers.get(fingerprint)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(fingerprint)
    const position = this.pending.get(fingerprint)
    if (!position) return
    this.pending.delete(fingerprint)
    await this.write(fingerprint, position)
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((fingerprint) => this.flush(fingerprint)))
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }
}
