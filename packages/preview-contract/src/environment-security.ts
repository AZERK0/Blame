const localDatabaseCredentialKeys = new Set([
  "DATABASE_PASSWORD",
  "DB_PASSWORD",
  "DB_ROOT_PASSWORD",
  "MARIADB_PASSWORD",
  "MARIADB_ROOT_PASSWORD",
  "MONGO_INITDB_ROOT_PASSWORD",
  "MYSQL_PASSWORD",
  "MYSQL_ROOT_PASSWORD",
  "PGPASSWORD",
  "POSTGRES_PASSWORD",
  "POSTGRESQL_PASSWORD",
  "REDIS_PASSWORD",
]);

const databaseUrlKeys = new Set([
  "DATABASE_URL",
  "DB_URL",
  "MONGO_URL",
  "MONGODB_URI",
  "REDIS_URL",
]);

const databaseProtocols = new Set([
  "mariadb:",
  "mongodb:",
  "mysql:",
  "postgres:",
  "postgresql:",
  "redis:",
]);

export function isLocalPreviewDatabaseCredentialKey(key: string) {
  return localDatabaseCredentialKeys.has(key.toUpperCase());
}

export function isDatabaseEnvironmentKey(key: string) {
  const normalized = key.toUpperCase();
  return (
    databaseUrlKeys.has(normalized) ||
    normalized === "PGPASSWORD" ||
    normalized.startsWith("DB_") ||
    normalized.startsWith("MYSQL_") ||
    normalized.startsWith("MARIADB_") ||
    normalized.startsWith("POSTGRES_") ||
    normalized.startsWith("POSTGRESQL_") ||
    normalized.startsWith("MONGO_") ||
    normalized.startsWith("MONGODB_") ||
    normalized.startsWith("REDIS_")
  );
}

export function normalizeLocalPreviewDatabaseEnvironmentValue(
  key: string,
  value: string,
) {
  if (isLocalPreviewDatabaseCredentialKey(key)) return "blame";
  if (!databaseUrlKeys.has(key.toUpperCase())) return value;
  const parsed = localDatabaseUrl(value);
  if (!parsed || !parsed.password) return value;
  parsed.password = "blame";
  return parsed.toString();
}

export function isLocalPreviewDatabaseEnvironmentValue(
  key: string,
  value: string,
) {
  if (isLocalPreviewDatabaseCredentialKey(key)) return value === "blame";
  if (!databaseUrlKeys.has(key.toUpperCase())) return false;
  const parsed = localDatabaseUrl(value);
  return parsed?.password === "blame";
}

function localDatabaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!databaseProtocols.has(parsed.protocol)) return undefined;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(parsed.hostname)) return undefined;
    if (["localhost", "host.docker.internal"].includes(parsed.hostname)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
