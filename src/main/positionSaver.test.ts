import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PositionSaver, type PendingPosition } from './positionSaver'

function position(pageIndex: number): PendingPosition {
  return { pageCount: 10, reading: { pageIndex, offsetRatio: 0, zoom: { mode: 'fit-width' }, updatedAt: pageIndex } }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PositionSaver', () => {
  it('writes the latest position 3 s after the last report', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('fp', position(1))
    await vi.advanceTimersByTimeAsync(2000)
    saver.report('fp', position(2))
    await vi.advanceTimersByTimeAsync(2999)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('fp', position(2))
  })

  it('debounces each Document separately', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('a', position(1))
    saver.report('b', position(2))
    await vi.advanceTimersByTimeAsync(3000)
    expect(write).toHaveBeenCalledWith('a', position(1))
    expect(write).toHaveBeenCalledWith('b', position(2))
  })

  it('flush writes immediately and cancels the timer', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('fp', position(5))
    await saver.flush('fp')
    expect(write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when nothing is pending', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    await new PositionSaver(write).flush('fp')
    expect(write).not.toHaveBeenCalled()
  })

  it('flushAll writes every pending Document and clears hasPending', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const saver = new PositionSaver(write)
    saver.report('a', position(1))
    saver.report('b', position(2))
    expect(saver.hasPending()).toBe(true)
    await saver.flushAll()
    expect(write).toHaveBeenCalledTimes(2)
    expect(saver.hasPending()).toBe(false)
  })

  it('logs instead of throwing when a timed write fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const saver = new PositionSaver(vi.fn().mockRejectedValue(new Error('disk full')))
    saver.report('fp', position(1))
    await vi.advanceTimersByTimeAsync(3000)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('hasPending stays true while a write started by flush() is still running', async () => {
    let resolveWrite: () => void = () => undefined
    const write = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
    )
    const saver = new PositionSaver(write)
    saver.report('fp', position(1))
    const flushPromise = saver.flush('fp')
    expect(saver.hasPending()).toBe(true)
    resolveWrite()
    await flushPromise
    expect(saver.hasPending()).toBe(false)
  })

  it('flushAll does not resolve until a write started earlier by flush() resolves', async () => {
    let resolveWrite: () => void = () => undefined
    const write = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
    )
    const saver = new PositionSaver(write)
    saver.report('fp', position(1))
    const flushPromise = saver.flush('fp')

    let flushAllResolved = false
    const flushAllPromise = saver.flushAll().then(() => {
      flushAllResolved = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(flushAllResolved).toBe(false)

    resolveWrite()
    await flushPromise
    await flushAllPromise
    expect(flushAllResolved).toBe(true)
  })

  it('hasPending stays true after a failed write (the position is kept pending for a retry)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const saver = new PositionSaver(vi.fn().mockRejectedValue(new Error('disk full')))
    saver.report('fp', position(1))
    await saver.flush('fp').catch(() => undefined)
    expect(saver.hasPending()).toBe(true)
    error.mockRestore()
  })

  it('puts the position back into pending after a failed flush, and retries it on the next flush', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined)
    const saver = new PositionSaver(write)
    saver.report('fp', position(1))
    await expect(saver.flush('fp')).rejects.toThrow('disk full')
    expect(saver.hasPending()).toBe(true)

    await saver.flush('fp')
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenNthCalledWith(2, 'fp', position(1))
  })

  it('does not re-arm the timer after a failed flush (no new setTimeout)', async () => {
    const write = vi.fn().mockRejectedValue(new Error('disk full'))
    const saver = new PositionSaver(write)
    saver.report('fp', position(1))
    await expect(saver.flush('fp')).rejects.toThrow('disk full')
    await vi.advanceTimersByTimeAsync(10000)
    // Still only the one failed call from the explicit flush; the debounce timer was not re-armed.
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps a newer report that arrived while a failing flush was in flight (not overwritten by the failed one)', async () => {
    let rejectWrite: (err: unknown) => void = () => undefined
    const write = vi.fn().mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectWrite = reject
      })
    )
    const saver = new PositionSaver(write)
    saver.report('fp', position(1))
    const flushPromise = saver.flush('fp').catch(() => undefined)

    saver.report('fp', position(2))

    rejectWrite(new Error('disk full'))
    await flushPromise

    expect(saver.hasPending()).toBe(true)
    write.mockResolvedValueOnce(undefined)
    await saver.flush('fp')
    expect(write).toHaveBeenLastCalledWith('fp', position(2))
  })
})
