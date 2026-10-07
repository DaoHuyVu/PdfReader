import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from './throttle'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createThrottle', () => {
  it('delivers only the latest value once per interval', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(1)
    throttled.call(2)
    throttled.call(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
  })

  it('starts a new interval after delivering', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(1)
    vi.advanceTimersByTime(500)
    throttled.call(2)
    vi.advanceTimersByTime(500)
    expect(fn.mock.calls).toEqual([[1], [2]])
  })

  it('flush delivers the pending value immediately', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(7)
    throttled.flush()
    expect(fn).toHaveBeenCalledWith(7)
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when nothing is pending', () => {
    const fn = vi.fn()
    createThrottle(fn, 500).flush()
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel drops the pending value', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 500)
    throttled.call(1)
    throttled.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
