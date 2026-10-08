/** Coalesces updates by key; persistence and durable retries belong to callers. */
export function createDebouncedUpdateQueue<Update>(delayMs: number) {
  const pending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; update: Update }
  >()

  function take(key: string) {
    const entry = pending.get(key)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    pending.delete(key)
    return entry.update
  }

  return {
    get(key: string) {
      return pending.get(key)?.update
    },
    schedule(key: string, update: Update, persist: (update: Update) => void) {
      take(key)
      const entry = {
        update,
        timer: setTimeout(() => {
          // A cancelled callback must never consume a newer update for this key.
          if (pending.get(key) !== entry) return
          pending.delete(key)
          persist(update)
        }, delayMs),
      }
      pending.set(key, entry)
    },
    take,
    clear() {
      for (const key of pending.keys()) take(key)
    },
  }
}
