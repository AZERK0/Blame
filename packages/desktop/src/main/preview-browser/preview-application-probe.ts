import type { PreviewApplicationState } from "./preview-browser-state.ts";

type ExecuteJavaScript = (source: string) => Promise<unknown>;

export async function probePreviewApplication(
  executeJavaScript: ExecuteJavaScript,
  timeoutMs: number,
): Promise<PreviewApplicationState> {
  try {
    const result = await boundedProbe(
      executeJavaScript(previewApplicationProbeSource(timeoutMs)),
      timeoutMs,
    );
    return classifyPreviewApplication(result);
  } catch (error) {
    return {
      status: "failed",
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

export function classifyPreviewApplication(
  value: unknown,
): PreviewApplicationState {
  const result = value as { httpStatus?: unknown; text?: unknown };
  const httpStatus =
    typeof result?.httpStatus === "number" ? result.httpStatus : undefined;
  const text = typeof result?.text === "string" ? result.text : "";
  const compilerDiagnostic = text.match(
    /(?:failed to compile|module not found|build error|internal server error)[\s\S]{0,1000}/iu,
  )?.[0];
  const failed =
    !httpStatus || httpStatus >= 500 || Boolean(compilerDiagnostic);
  return {
    status: failed ? "failed" : "ready",
    ...(httpStatus ? { httpStatus } : {}),
    ...(compilerDiagnostic
      ? { diagnostic: compilerDiagnostic }
      : failed
        ? { diagnostic: `Preview returned HTTP ${httpStatus ?? "unknown"}.` }
        : {}),
  };
}

function previewApplicationProbeSource(timeoutMs: number) {
  return `fetch(location.href,{cache:"no-store",signal:AbortSignal.timeout(${timeoutMs})}).then(async response=>({httpStatus:response.status,text:(await response.text()).slice(0,2000)}))`;
}

async function boundedProbe(
  probe: Promise<unknown>,
  timeoutMs: number,
): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Preview application probe timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
