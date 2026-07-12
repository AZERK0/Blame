import {
  authorizeMcpServerOAuth,
  listMcpServerOAuthStatuses,
  updateMcpServerOAuthState,
} from "@cline/sdk";

export type McpOAuthStatus = {
  configured: boolean;
  lastAuthenticatedAt?: number;
  lastError?: string;
  serverName: string;
  supported: boolean;
};

export function listMcpOAuthStatuses(filePath: string): McpOAuthStatus[] {
  return listMcpServerOAuthStatuses({ filePath }).map(
    (status: {
      oauthConfigured: boolean;
      lastAuthenticatedAt?: number;
      lastError?: string;
      serverName: string;
      oauthSupported: boolean;
    }) => ({
      configured: status.oauthConfigured,
      lastAuthenticatedAt: status.lastAuthenticatedAt,
      lastError: status.lastError,
      serverName: status.serverName,
      supported: status.oauthSupported,
    }),
  );
}

export async function authorizeMcpOAuth(input: {
  filePath: string;
  openUrl(url: string): Promise<void>;
  serverName: string;
}) {
  return authorizeMcpServerOAuth({
    callbackHost: "127.0.0.1",
    clientName: "Blame",
    clientVersion: "0.0.0",
    filePath: input.filePath,
    openUrl: input.openUrl,
    serverName: input.serverName,
  });
}

export function clearMcpOAuth(filePath: string, serverName: string) {
  updateMcpServerOAuthState(serverName, () => ({}), { filePath });
}
