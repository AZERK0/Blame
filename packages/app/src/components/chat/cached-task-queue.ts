export function createCachedTaskQueue<T>(
  concurrency: number,
  maximumCachedTasks = Number.POSITIVE_INFINITY
) {
  const cache = new Map<string, Promise<T>>()
  const pending: Array<() => void> = []
  let active = 0

  return (key: string, task: () => Promise<T>) => {
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }

    const request = new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            pending.shift()?.()
          })
      }
      if (active < concurrency) run()
      else pending.push(run)
    }).catch((error) => {
      cache.delete(key)
      throw error
    })
    cache.set(key, request)
    while (cache.size > maximumCachedTasks) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      cache.delete(oldestKey)
    }
    return request
  }
}
