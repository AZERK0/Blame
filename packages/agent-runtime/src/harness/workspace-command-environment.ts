export function workspaceCommandEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => name !== "NODE_ENV" && !name.startsWith("BLAME_"),
    ),
  );
}
