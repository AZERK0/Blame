type WorkerRequest<Input> = {
  id: string
  input: Input
}

type WorkerResponse<Output> = {
  error?: string
  id: string
  result?: Output
}

type PendingWorkerTask = {
  abort?: () => void
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  signal?: AbortSignal
}

const workerClients = new Map<string, WorkerClient>()

export function runWorkerTask<Input, Output>(
  url: URL,
  input: Input,
  signal?: AbortSignal
) {
  return workerClient(url).request<Input, Output>(input, signal)
}

export function workerTaskAborted(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function workerClient(url: URL) {
  const key = url.href
  const current = workerClients.get(key)
  if (current) return current
  const next = new WorkerClient(key, url)
  workerClients.set(key, next)
  return next
}

class WorkerClient {
  private readonly key: string
  private readonly pending = new Map<string, PendingWorkerTask>()
  private readonly worker: Worker

  constructor(key: string, url: URL) {
    this.key = key
    this.worker = new Worker(url, { type: "module" })
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse<unknown>>) =>
      this.resolve(data)
    this.worker.onerror = (event) => this.fail(new Error(event.message))
  }

  request<Input, Output>(input: Input, signal?: AbortSignal) {
    return new Promise<Output>((resolve, reject) => {
      const id = crypto.randomUUID()
      const abort = () => this.abort(id)
      if (signal?.aborted) {
        reject(new DOMException("Worker task aborted", "AbortError"))
        return
      }
      this.pending.set(id, {
        abort,
        reject,
        resolve: (value) => resolve(value as Output),
        signal,
      })
      signal?.addEventListener("abort", abort, { once: true })
      this.worker.postMessage({ id, input } satisfies WorkerRequest<Input>)
    })
  }

  private abort(id: string) {
    const task = this.pending.get(id)
    if (!task) return
    this.pending.delete(id)
    task.reject(new DOMException("Worker task aborted", "AbortError"))
  }

  private resolve(data: WorkerResponse<unknown>) {
    const task = this.pending.get(data.id)
    if (!task) return
    this.pending.delete(data.id)
    if (task.abort) task.signal?.removeEventListener("abort", task.abort)
    if (data.error) task.reject(new Error(data.error))
    else task.resolve(data.result)
  }

  private fail(error: Error) {
    this.worker.terminate()
    workerClients.delete(this.key)
    for (const task of this.pending.values()) {
      if (task.abort) task.signal?.removeEventListener("abort", task.abort)
      task.reject(error)
    }
    this.pending.clear()
  }
}

export type { WorkerRequest, WorkerResponse }
