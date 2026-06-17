export function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;

  const runNext = () => {
    active -= 1;
    const next = queue.shift();
    if (!next) return;
    active += 1;
    next();
  };

  return async function limit<T>(task: () => Promise<T>) {
    if (active < concurrency) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    try {
      return await task();
    } finally {
      runNext();
    }
  };
}
