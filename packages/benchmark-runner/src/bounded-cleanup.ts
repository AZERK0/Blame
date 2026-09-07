export function boundedCleanup<T>(operation: () => Promise<T>, timeoutMs: number) {
  return new Promise<{ completed: boolean; value?: T }>((resolve) => {
    const timer = setTimeout(() => resolve({ completed: false }), timeoutMs);
    const finish = (completed: boolean, value?: T) => {
      clearTimeout(timer);
      resolve({ completed, value });
    };
    Promise.resolve().then(operation).then(
      (value) => finish(true, value),
      () => finish(false),
    );
  });
}
