import {
  diffLines,
  type DiffCodeLine,
} from "@/components/backlog/development/development-diff-parser"
import type { WorkerRequest, WorkerResponse } from "@/lib/worker-task"

type DiffWorkerInput = {
  patch: string
}

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<WorkerRequest<DiffWorkerInput>>) => void)
    | null
  postMessage: (message: WorkerResponse<DiffCodeLine[]>) => void
}

workerScope.onmessage = ({ data }) => {
  const response: WorkerResponse<DiffCodeLine[]> = {
    id: data.id,
    result: diffLines(data.input.patch),
  }
  workerScope.postMessage(response)
}
