import type { McpServerConfig } from "@blame/app";
import { ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type McpSettings = { mcpServers: Record<string, Record<string, unknown>> };

export function registerMcpIpcHandlers() {
  ipcMain.handle("mcp:list", () => listServers());
  ipcMain.handle("mcp:save", async (_event, input, previousName) => {
    const server = validateServer(input);
    const settings = await readSettings();
    if (typeof previousName === "string" && previousName !== server.name) {
      delete settings.mcpServers[previousName];
    }
    settings.mcpServers[server.name] = serializeServer(server);
    await writeSettings(settings);
    return listServers(settings);
  });
  ipcMain.handle("mcp:remove", async (_event, input) => {
    const name = validateName(input);
    const settings = await readSettings();
    delete settings.mcpServers[name];
    await writeSettings(settings);
    return listServers(settings);
  });
  ipcMain.handle("mcp:set-enabled", async (_event, input, enabled) => {
    const name = validateName(input);
    if (typeof enabled !== "boolean") throw new Error("Invalid enabled state");
    const settings = await readSettings();
    const server = settings.mcpServers[name];
    if (!server) throw new Error("MCP server not found");
    server.disabled = !enabled;
    await writeSettings(settings);
    return listServers(settings);
  });
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
}

function listServers(
  settings?: McpSettings,
): Promise<McpServerConfig[]> | McpServerConfig[] {
  if (!settings)
    return readSettings().then(listServers) as Promise<McpServerConfig[]>;
  return Object.entries(settings.mcpServers).map(([name, value]) =>
    deserializeServer(name, value),
  );
}

function deserializeServer(
  name: string,
  value: Record<string, unknown>,
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
  if (transport === "stdio") {
    const command = requiredString(input.command, "Command");
    return {
      name,
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
    transport,
    disabled,
    url,
    headers: stringRecord(input.headers),
  };
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
