export type PreviewFailureCode =
  | "INVALID_MANIFEST"
  | "UNSUPPORTED_CAPABILITY"
  | "PROVIDER_AUTH"
  | "PROVIDER_QUOTA"
  | "PROVISION_FAILED"
  | "SOURCE_SYNC_FAILED"
  | "SYNC_CONFLICT"
  | "ENGINE_START_FAILED"
  | "ENDPOINT_NOT_LISTENING"
  | "HEALTHCHECK_FAILED"
  | "PREVIEW_ACCESS_DENIED"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL";

export type PreviewFailure = {
  code: PreviewFailureCode;
  message: string;
  providerCode?: string;
  correlationId?: string;
  retryable: boolean;
};

export class PreviewRuntimeError extends Error {
  readonly failure: PreviewFailure;

  constructor(failure: PreviewFailure, options?: ErrorOptions) {
    super(failure.message, options);
    this.name = "PreviewRuntimeError";
    this.failure = failure;
  }
}

export function previewFailure(
  error: unknown,
  fallbackCode: PreviewFailureCode = "INTERNAL",
): PreviewFailure {
  if (error instanceof PreviewRuntimeError) return error.failure;
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : "Unexpected preview runtime failure.",
    retryable: false,
  };
}
