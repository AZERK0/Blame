import type { CloudMcpServerConfig } from "@blame/app";

export type McpSettingsServer = Record<string, unknown>;
export type McpSettings = {
  mcpServers: Record<string, McpSettingsServer>;
};

const CLOUD_USER_ID = "blameCloudUserId";
const LOCAL_SETUP_REQUIRED = "blameCloudLocalSetupRequired";
const CLOUD_DISABLED = "blameCloudDisabled";

export function mergeCloudServers(
  settings: McpSettings,
  userId: string,
  cloudServers: CloudMcpServerConfig[],
  adoptLocal: boolean,
): McpSettings {
  const retainedServers = Object.fromEntries(
    Object.entries(settings.mcpServers).filter(
      ([, server]) => cloudOwner(server) !== userId,
    ),
  );
  const synchronizedServers = Object.fromEntries(
    cloudServers.map((server) => [
      server.name,
      mergeCloudServer(
        settings.mcpServers[server.name],
        server,
        userId,
        adoptLocal,
      ),
    ]),
  );
  return {
    ...settings,
    mcpServers: { ...retainedServers, ...synchronizedServers },
  };
}

export function cloudOwner(server: McpSettingsServer) {
  const metadata = serverMetadata(server);
  return typeof metadata?.[CLOUD_USER_ID] === "string"
    ? metadata[CLOUD_USER_ID]
    : undefined;
}

export function localSetupRequired(server: McpSettingsServer) {
  return serverMetadata(server)?.[LOCAL_SETUP_REQUIRED] === true;
}

export function cloudDisabled(server: McpSettingsServer) {
  if (!localSetupRequired(server)) return undefined;
  const disabled = serverMetadata(server)?.[CLOUD_DISABLED];
  return typeof disabled === "boolean" ? disabled : true;
}

export function completedCloudMetadata(server?: McpSettingsServer) {
  const metadata = server ? serverMetadata(server) : undefined;
  if (!metadata) return undefined;
  const completedMetadata = { ...metadata };
  delete completedMetadata[LOCAL_SETUP_REQUIRED];
  delete completedMetadata[CLOUD_DISABLED];
  return Object.keys(completedMetadata).length ? completedMetadata : undefined;
}

function mergeCloudServer(
  local: McpSettingsServer | undefined,
  cloud: CloudMcpServerConfig,
  userId: string,
  adoptLocal: boolean,
) {
  const localMatches = Boolean(
    local &&
    (cloudOwner(local) === userId || (adoptLocal && !cloudOwner(local))) &&
    sameCloudEndpoint(local, cloud),
  );
  const requiresSetup =
    !localMatches || Boolean(local && localSetupRequired(local));
  return {
    ...(localMatches ? local : {}),
    ...serializeCloudServer(cloud, requiresSetup),
    metadata: cloudMetadata(
      localMatches ? local : undefined,
      cloud,
      userId,
      requiresSetup,
    ),
  };
}

function serializeCloudServer(
  server: CloudMcpServerConfig,
  requiresSetup: boolean,
): McpSettingsServer {
  const common = {
    disabled: requiresSetup || server.disabled,
    timeout: server.timeout,
  };
  return server.transport === "stdio"
    ? { ...common, command: server.command, type: "stdio" }
    : { ...common, type: server.transport, url: server.url };
}

function cloudMetadata(
  local: McpSettingsServer | undefined,
  cloud: CloudMcpServerConfig,
  userId: string,
  requiresSetup: boolean,
) {
  return {
    ...(local ? serverMetadata(local) : {}),
    [CLOUD_USER_ID]: userId,
    [LOCAL_SETUP_REQUIRED]: requiresSetup || undefined,
    [CLOUD_DISABLED]: requiresSetup ? cloud.disabled : undefined,
  };
}

function sameCloudEndpoint(
  local: McpSettingsServer,
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

function serverMetadata(server: McpSettingsServer) {
  return isRecord(server.metadata) ? server.metadata : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
