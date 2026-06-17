import {
  markdownPreviewBlocks,
  type MarkdownPreviewBlock,
} from "@/components/backlog/drawer/markdown-preview-parser"
import type { WorkerRequest, WorkerResponse } from "@/lib/worker-task"

type MarkdownPreviewWorkerInput = {
  markdown: string
}

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<WorkerRequest<MarkdownPreviewWorkerInput>>) => void)
    | null
  postMessage: (message: WorkerResponse<MarkdownPreviewBlock[]>) => void
}

workerScope.onmessage = ({ data }) => {
  const response: WorkerResponse<MarkdownPreviewBlock[]> = {
    id: data.id,
    result: markdownPreviewBlocks(data.input.markdown),
  }
  workerScope.postMessage(response)
}
