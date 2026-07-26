export async function authRequest(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body));
  return responseData(body);
}

export function apiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BLAME_API_URL ?? "https://api.blame.so/api/v1"
  ).replace(/\/$/, "");
}

export async function claimAndApprove(userCode: string) {
  await authRequest(`/auth/device?user_code=${encodeURIComponent(userCode)}`);
  await authRequest("/auth/device/approve", {
    body: JSON.stringify({ userCode }),
    method: "POST",
  });
}

export function normalizeUserCode(value: string | null) {
  const userCode = value?.replaceAll("-", "").trim().toUpperCase() ?? "";
  if (!/^[A-Z2-9]{8}$/.test(userCode)) {
    throw new Error("This connection request is invalid or has expired.");
  }
  return userCode;
}

export function hasAuthenticatedUser(value: unknown) {
  const body = responseData(value);
  return isRecord(body) && isRecord(body.user);
}

export function responseData(value: unknown): unknown {
  if (!isRecord(value) || !("data" in value)) return value;
  return value.data;
}

export function readError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function responseError(value: unknown) {
  if (!isRecord(value)) return "The authentication service is unavailable.";
  if (typeof value.error_description === "string") {
    return value.error_description;
  }
  if (typeof value.message === "string") return value.message;
  return "The authentication service is unavailable.";
}
