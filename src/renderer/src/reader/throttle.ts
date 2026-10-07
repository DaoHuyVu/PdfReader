export interface Throttled<T> {
  call(value: T): void
  flush(): void
  cancel(): void
}

/** Delivers at most one value per interval: the latest one, at the end of the interval. */
export function createThrottle<T>(fn: (value: T) => void, intervalMs: number): Throttled<T> {
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const fire = () => {
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    fn(value)
  }

  return {
    call(value) {
      pending = { value }
      if (timer === null) timer = setTimeout(fire, intervalMs)
    },
    flush() {
      if (timer !== null) clearTimeout(timer)
      fire()
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}
