import { posix } from "node:path";

const validationManifests = new Set([
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "pytest.ini",
]);

export function validationScopePaths(
  paths: string[],
  files: string[],
  cwd: string,
) {
  const packages = files
    .filter((path) => validationManifests.has(posix.basename(path)))
    .map((path) => posix.dirname(path))
    .sort((left, right) => right.length - left.length);
  return paths.filter((path) => {
    const owner =
      packages.find(
        (directory) => directory === "." || path.startsWith(`${directory}/`),
      ) ?? ".";
    return owner === cwd;
  });
}
