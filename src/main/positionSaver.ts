import type { Fingerprint, ReadingPosition } from '../shared/documentData'

export interface PendingPosition {
  reading: ReadingPosition
  pageCount: number
}

/** Batches Reading Position writes so OneDrive does not upload on every scroll. */
export class PositionSaver {
  private readonly pending = new Map<Fingerprint, PendingPosition>()
  private readonly timers = new Map<Fingerprint, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Set<Promise<void>>()

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
    const writePromise = this.write(fingerprint, position)
    this.inFlight.add(writePromise)
    try {
      await writePromise
    } catch (err) {
      // Put it back for a retry, unless a newer report for this Fingerprint already took its place.
      if (!this.pending.has(fingerprint)) this.pending.set(fingerprint, position)
      throw err
    } finally {
      this.inFlight.delete(writePromise)
    }
  }

  async flushAll(): Promise<void> {
    const started = [...this.pending.keys()].map((fingerprint) => this.flush(fingerprint))
    const inFlightSnapshot = [...this.inFlight]
    await Promise.all([Promise.all(started), Promise.allSettled(inFlightSnapshot)])
  }

  hasPending(): boolean {
    return this.pending.size > 0 || this.inFlight.size > 0
  }
}
