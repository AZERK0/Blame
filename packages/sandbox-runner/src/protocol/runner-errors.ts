export function runnerError(code: string, message: string) {
  return Object.assign(new Error(message), { runnerCode: code });
}

export function runnerErrorCode(error: unknown) {
  const code = (error as { runnerCode?: unknown })?.runnerCode;
  return typeof code === "string" ? code : "RUNNER_INTERNAL";
}
