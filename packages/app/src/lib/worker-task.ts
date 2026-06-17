type WorkerRequest<Input> = {
  id: string
  input: Input
}

type WorkerResponse<Output> = {
  error?: string
  id: string
  result?: Output
}

export function runWorkerTask<Input, Output>(
  url: URL,
  input: Input,
  signal?: AbortSignal
) {
  return new Promise<Output>((resolve, reject) => {
    const id = crypto.randomUUID()
    const worker = new Worker(url, { type: "module" })
    const abort = () => {
      worker.terminate()
      reject(new DOMException("Worker task aborted", "AbortError"))
    }

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener("abort", abort, { once: true })

    worker.onmessage = ({ data }: MessageEvent<WorkerResponse<Output>>) => {
      if (data.id !== id) return
      worker.terminate()
      signal?.removeEventListener("abort", abort)
      if (data.error) reject(new Error(data.error))
      else resolve(data.result as Output)
    }

    worker.onerror = (event) => {
      worker.terminate()
      signal?.removeEventListener("abort", abort)
      reject(new Error(event.message))
    }

    worker.postMessage({ id, input } satisfies WorkerRequest<Input>)
  })
}

export function workerTaskAborted(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export type { WorkerRequest, WorkerResponse }
