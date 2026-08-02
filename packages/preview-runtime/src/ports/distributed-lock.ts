export type LockLease = { key: string; fencingToken: number };

export interface DistributedLock {
  withLock<T>(
    key: string,
    operation: (lease: LockLease) => Promise<T>,
  ): Promise<T>;
}
