import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { shell } from "electron";

export type ExternalPreviewTicket = {
  ticket: string;
  expiresAt: string;
  openUrl: string;
};

export async function launchExternalPreview(ticket: ExternalPreviewTicket) {
  validateTicket(ticket);
  const pathToken = randomBytes(32).toString("base64url");
  const nonce = randomBytes(18).toString("base64url");
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== `/${pathToken}`) {
      response.writeHead(404, { "cache-control": "no-store" }).end();
      return;
    }
    const action = htmlAttribute(ticket.openUrl);
    const value = htmlAttribute(ticket.ticket);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; form-action ${new URL(ticket.openUrl).origin}; script-src 'nonce-${nonce}'; base-uri 'none'`,
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Opening preview</title><form id="open" method="post" action="${action}"><input type="hidden" name="ticket" value="${value}"></form><script nonce="${nonce}">document.getElementById('open').submit()</script>`,
    );
    response.once("finish", () => server.close());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const timeout = setTimeout(() => server.close(), 30_000);
  timeout.unref();
  try {
    await shell.openExternal(`http://127.0.0.1:${port}/${pathToken}`);
  } catch (error) {
    server.close();
    throw error;
  }
}

function validateTicket(ticket: ExternalPreviewTicket) {
  const url = new URL(ticket.openUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !/^[A-Za-z0-9_-]{40,100}$/.test(ticket.ticket) ||
    Date.parse(ticket.expiresAt) <= Date.now()
  )
    throw new Error("External preview ticket is invalid");
}

function htmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}
