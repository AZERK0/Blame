export type SecuritySecretSignal = {
  end: number;
  kind: string;
  start: number;
};

const knownSecretPatterns: { kind: string; pattern: RegExp }[] = [
  { kind: "AWS_ACCESS_KEY", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    kind: "GITHUB_TOKEN",
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/g,
  },
  { kind: "GITLAB_TOKEN", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "OPENAI_API_KEY", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: "SLACK_TOKEN", pattern: /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{16,}\b/g },
  { kind: "STRIPE_SECRET_KEY", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  {
    kind: "PRIVATE_KEY",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
];

const credentialAssignment =
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|private[_-]?key|secret|token)\b\s*[:=]\s*(["'`])([^\n"'`]{8,})\2/gi;

export function detectSecuritySecrets(content: string) {
  const signals: SecuritySecretSignal[] = [];
  for (const { kind, pattern } of knownSecretPatterns) {
    for (const match of content.matchAll(clonePattern(pattern))) {
      const start = match.index ?? 0;
      signals.push({ kind, start, end: start + match[0].length });
    }
  }
  for (const match of content.matchAll(clonePattern(credentialAssignment))) {
    const value = match[3] ?? "";
    if (!likelyCredential(value)) continue;
    const matchStart = match.index ?? 0;
    const offset = match[0].lastIndexOf(value);
    signals.push({
      kind: credentialKind(match[1] ?? "SECRET"),
      start: matchStart + offset,
      end: matchStart + offset + value.length,
    });
  }
  return nonOverlapping(signals);
}

export function redactSecuritySecrets(content: string) {
  let redacted = content;
  for (const signal of detectSecuritySecrets(content).reverse()) {
    redacted = `${redacted.slice(0, signal.start)}<REDACTED_SECRET:${signal.kind}>${redacted.slice(signal.end)}`;
  }
  return redacted;
}

export function redactSecurityValue<T>(value: T): T {
  if (typeof value === "string") return redactSecuritySecrets(value) as T;
  if (Array.isArray(value)) return value.map(redactSecurityValue) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactSecurityValue(item),
    ]),
  ) as T;
}

function likelyCredential(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /\s/.test(normalized)) return false;
  if (/\$\{|process\.env|import\.meta\.env|<[^>]+>/.test(normalized)) {
    return false;
  }
  return !/^(?:change-?me|development|example|password|sample|secret|test|token|your[_-].*)$/.test(
    normalized,
  );
}

function credentialKind(name: string) {
  return name.replaceAll("-", "_").toUpperCase();
}

function clonePattern(pattern: RegExp) {
  return new RegExp(pattern.source, pattern.flags);
}

function nonOverlapping(signals: SecuritySecretSignal[]) {
  const selected: SecuritySecretSignal[] = [];
  for (const signal of signals.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )) {
    if (selected.some((item) => signal.start < item.end)) continue;
    selected.push(signal);
  }
  return selected;
}
