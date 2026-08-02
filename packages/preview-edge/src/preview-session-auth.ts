import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export type PreviewEdgeSession = {
  sessionId: string;
  endpointId: string;
  ownerUserId: string;
  exp: number;
};

const cookieName = "__Host-blame_preview";

export class PreviewSessionAuth {
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret) < 32) throw new Error("Preview Edge cookie secret is too short.");
  }

  issue(input: Omit<PreviewEdgeSession, "exp">, ttlSeconds = 300) {
    const session = { ...input, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
    const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
    const value = `${encoded}.${this.signature(encoded)}`;
    return `${cookieName}=${value}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Lax`;
  }

  authenticate(headers: IncomingHttpHeaders): PreviewEdgeSession | null {
    try {
      const value = parseCookies(headers.cookie)[cookieName];
      if (!value) return null;
      const [encoded, signature, extra] = value.split(".");
      if (!encoded || !signature || extra || !safeEqual(signature, this.signature(encoded))) return null;
      const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewEdgeSession;
      if (
        !session.sessionId ||
        !session.endpointId ||
        !session.ownerUserId ||
        !Number.isSafeInteger(session.exp) ||
        session.exp <= Math.floor(Date.now() / 1000)
      ) {
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  private signature(value: string) {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }
}

function parseCookies(value: string | undefined) {
  return Object.fromEntries(
    (value ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator > 0 ? [part.slice(0, separator), part.slice(separator + 1)] : [part, ""];
      }),
  );
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
