import {
  authorizeMcpOAuth,
  clearMcpOAuth,
  listMcpOAuthStatuses,
} from "@blame/agent-runtime";
import type { CloudMcpServerConfig, McpServerConfig } from "@blame/app";
import { ipcMain, shell } from "electron";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type McpSettings = { mcpServers: Record<string, Record<string, unknown>> };
let settingsOperation: Promise<unknown> = Promise.resolve();
let authorizationRunning = false;

export function registerMcpIpcHandlers() {
  ipcMain.handle("mcp:list", () =>
    runSettingsOperation(async () => listServers()),
  );
  ipcMain.handle(
    "mcp:merge-cloud",
    (_event, userIdInput, input, adoptLocalInput) =>
      runSettingsOperation(async () => {
        const userId = validateUserId(userIdInput);
        const adoptLocal = adoptLocalInput === true;
        const cloudServers = validateCloudServers(input);
        const settings = await readSettings();
        const merged: McpSettings["mcpServers"] = Object.fromEntries(
          Object.entries(settings.mcpServers).filter(
            ([, server]) => cloudOwner(server) !== userId,
          ),
        );
        for (const cloudServer of cloudServers) {
          const local = settings.mcpServers[cloudServer.name];
          const preserveLocal =
            local &&
            (cloudOwner(local) === userId ||
              (adoptLocal && cloudOwner(local) === undefined)) &&
            sameCloudEndpoint(local, cloudServer);
          merged[cloudServer.name] = {
            ...(preserveLocal ? local : {}),
            ...serializeCloudServer(cloudServer),
            metadata: { blameCloudUserId: userId },
          };
        }
        await writeSettings({ ...settings, mcpServers: merged });
        return listServers({ ...settings, mcpServers: merged });
      }),
  );
  ipcMain.handle("mcp:detach-cloud", (_event, userIdInput) =>
    runSettingsOperation(async () => {
      const userId = validateUserId(userIdInput);
      const settings = await readSettings();
      settings.mcpServers = Object.fromEntries(
        Object.entries(settings.mcpServers).filter(
          ([, server]) => cloudOwner(server) !== userId,
        ),
      );
      await writeSettings(settings);
      return listServers(settings);
    }),
  );
  ipcMain.handle("mcp:save", (_event, input, previousName) =>
    runSettingsOperation(async () => {
      const server = validateServer(input);
      const settings = await readSettings();
      const existing =
        typeof previousName === "string"
          ? settings.mcpServers[previousName]
          : settings.mcpServers[server.name];
      if (typeof previousName === "string" && previousName !== server.name) {
        delete settings.mcpServers[previousName];
      }
      const preserveOAuth = existing && sameEndpoint(existing, server);
      settings.mcpServers[server.name] = {
        ...(existing ?? {}),
        ...serializeServer(server),
        ...(preserveOAuth && existing.oauth
          ? { oauth: existing.oauth }
          : { oauth: undefined }),
      };
      await writeSettings(settings);
      return listServers(settings);
    }),
  );
  ipcMain.handle("mcp:remove", (_event, input) =>
    runSettingsOperation(async () => {
      const name = validateName(input);
      const settings = await readSettings();
      delete settings.mcpServers[name];
      await writeSettings(settings);
      return listServers(settings);
    }),
  );
  ipcMain.handle("mcp:set-enabled", (_event, input, enabled) =>
    runSettingsOperation(async () => {
      const name = validateName(input);
      if (typeof enabled !== "boolean")
        throw new Error("Invalid enabled state");
      const settings = await readSettings();
      const server = settings.mcpServers[name];
      if (!server) throw new Error("MCP server not found");
      server.disabled = !enabled;
      await writeSettings(settings);
      return listServers(settings);
    }),
  );
  ipcMain.handle("mcp:authorize", (_event, input) =>
    runSettingsOperation(async () => {
      const name = validateName(input);
      if (authorizationRunning)
        throw new Error("Another MCP authorization is already in progress");
      authorizationRunning = true;
      try {
        await authorizeMcpOAuth({
          filePath: settingsPath(),
          serverName: name,
          openUrl: openAuthorizationUrl,
        });
        return listServers();
      } finally {
        await protectSettingsFile();
        authorizationRunning = false;
      }
    }),
  );
  ipcMain.handle("mcp:disconnect-oauth", (_event, input) =>
    runSettingsOperation(async () => {
      clearMcpOAuth(settingsPath(), validateName(input));
      await protectSettingsFile();
      return listServers();
    }),
  );
}

async function runSettingsOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = settingsOperation.then(operation, operation);
  settingsOperation = result.catch(() => undefined);
  return result;
}

async function openAuthorizationUrl(value: string) {
  const url = new URL(value);
  const loopbackHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]");
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !loopbackHttp)
  ) {
    throw new Error("The MCP server returned an unsafe authorization URL");
  }
  await shell.openExternal(url.toString());
}

function settingsPath() {
  const explicit = process.env.CLINE_MCP_SETTINGS_PATH?.trim();
  if (explicit) return explicit;
  const dataDir =
    process.env.CLINE_DATA_DIR?.trim() || join(homedir(), ".cline", "data");
  return join(dataDir, "settings", "cline_mcp_settings.json");
}

async function readSettings(): Promise<McpSettings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath(), "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers))
      throw new Error("Invalid MCP settings file");
    return { ...parsed, mcpServers: { ...parsed.mcpServers } } as McpSettings;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT")
      return { mcpServers: {} };
    throw error;
  }
}

async function writeSettings(settings: McpSettings) {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
  await protectSettingsFile();
}

async function protectSettingsFile() {
  if (process.platform !== "win32") await chmod(settingsPath(), 0o600);
}

function listServers(
  settings?: McpSettings,
): Promise<McpServerConfig[]> | McpServerConfig[] {
  if (!settings)
    return readSettings().then(listServers) as Promise<McpServerConfig[]>;
  const statuses = new Map(
    safeOAuthStatuses().map((status) => [status.serverName, status]),
  );
  return Object.entries(settings.mcpServers).map(([name, value]) =>
    deserializeServer(name, value, statuses.get(name)),
  );
}

function safeOAuthStatuses() {
  try {
    return listMcpOAuthStatuses(settingsPath());
  } catch {
    return [];
  }
}

function deserializeServer(
  name: string,
  value: Record<string, unknown>,
  oauth?: ReturnType<typeof listMcpOAuthStatuses>[number],
): McpServerConfig {
  const nested = isRecord(value.transport) ? value.transport : value;
  const transport =
    nested.type === "streamableHttp" || nested.type === "sse"
      ? nested.type
      : "stdio";
  return validateServer({
    ...nested,
    disabled: value.disabled === true,
    name,
    oauth: oauth ?? { configured: false, supported: transport !== "stdio" },
    transport,
  });
}

function serializeServer(server: McpServerConfig): Record<string, unknown> {
  const common = { disabled: server.disabled };
  if (server.transport === "stdio") {
    return {
      ...common,
      type: "stdio",
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: server.env,
    };
  }
  return {
    ...common,
    type: server.transport,
    url: server.url,
    headers: server.headers,
  };
}

function serializeCloudServer(
  server: CloudMcpServerConfig,
): Record<string, unknown> {
  return server.transport === "stdio"
    ? { command: server.command, disabled: server.disabled, type: "stdio" }
    : {
        disabled: server.disabled,
        type: server.transport,
        url: server.url,
      };
}

function validateCloudServers(input: unknown): CloudMcpServerConfig[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new Error("Invalid cloud MCP configuration");
  const names = new Set<string>();
  return input.map((value) => {
    if (!isRecord(value)) throw new Error("Invalid cloud MCP server");
    const name = validateName(value.name);
    if (names.has(name.toLocaleLowerCase()))
      throw new Error("Cloud MCP server names must be unique");
    names.add(name.toLocaleLowerCase());
    const transport = value.transport;
    if (transport === "stdio") {
      const command = requiredString(value.command, "Command");
      if (/\s/.test(command))
        throw new Error("Cloud MCP commands cannot contain arguments");
      return { command, disabled: value.disabled === true, name, transport };
    }
    if (transport !== "streamableHttp" && transport !== "sse")
      throw new Error("Invalid cloud MCP transport");
    const url = safeCloudUrl(requiredString(value.url, "URL"));
    return { disabled: value.disabled === true, name, transport, url };
  });
}

function safeCloudUrl(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Cloud MCP URLs cannot contain credentials or parameters");
  }
  return url.toString();
}

function cloudOwner(server: Record<string, unknown>) {
  return isRecord(server.metadata) &&
    typeof server.metadata.blameCloudUserId === "string"
    ? server.metadata.blameCloudUserId
    : undefined;
}

function sameCloudEndpoint(
  local: Record<string, unknown>,
  cloud: CloudMcpServerConfig,
) {
  const transport = isRecord(local.transport) ? local.transport : local;
  if (transport.type !== cloud.transport) return false;
  return cloud.transport === "stdio"
    ? transport.command === cloud.command
    : normalizedUrl(transport.url) === normalizedUrl(cloud.url);
}

function normalizedUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function validateUserId(input: unknown) {
  if (typeof input !== "string" || !/^[0-9a-f-]{20,80}$/i.test(input))
    throw new Error("Invalid cloud user");
  return input;
}

function validateServer(input: unknown): McpServerConfig {
  if (!isRecord(input)) throw new Error("Invalid MCP server");
  const name = validateName(input.name);
  const transport = input.transport;
  if (
    transport !== "stdio" &&
    transport !== "streamableHttp" &&
    transport !== "sse"
  )
    throw new Error("Invalid MCP transport");
  const disabled = input.disabled === true;
  const oauth = validateOAuthStatus(input.oauth, transport !== "stdio");
  if (transport === "stdio") {
    const command = requiredString(input.command, "Command");
    return {
      name,
      oauth,
      transport,
      disabled,
      command,
      args: stringArray(input.args),
      cwd: optionalString(input.cwd),
      env: stringRecord(input.env),
    };
  }
  const url = requiredString(input.url, "URL");
  try {
    new URL(url);
  } catch {
    throw new Error("Enter a valid server URL");
  }
  return {
    name,
    oauth,
    transport,
    disabled,
    url,
    headers: stringRecord(input.headers),
  };
}

function validateOAuthStatus(input: unknown, supported: boolean) {
  if (!isRecord(input)) return { configured: false, supported };
  return {
    configured: supported && input.configured === true,
    lastAuthenticatedAt:
      typeof input.lastAuthenticatedAt === "number"
        ? input.lastAuthenticatedAt
        : undefined,
    lastError:
      typeof input.lastError === "string" ? input.lastError : undefined,
    supported,
  };
}

function sameEndpoint(
  existing: Record<string, unknown>,
  server: McpServerConfig,
) {
  const transport = isRecord(existing.transport)
    ? existing.transport
    : existing;
  if (server.transport === "stdio") return false;
  return transport.type === server.transport && transport.url === server.url;
}

function validateName(value: unknown) {
  const name = requiredString(value, "Name");
  if (name.length > 80) throw new Error("Name is too long");
  return name;
}
function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required`);
  return value.trim();
}
function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([key, item]) => key.trim() && typeof item === "string"))
    throw new Error("Invalid key/value entry");
  return Object.fromEntries(entries) as Record<string, string>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
