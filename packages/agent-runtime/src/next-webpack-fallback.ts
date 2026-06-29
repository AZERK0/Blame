export function commandWithNextWebpackFallback(command: string) {
  if (/\s--(?:webpack|turbo|turbopack)\b/.test(command)) return command;
  const direct = commandWithDirectNextWebpack(command);
  if (direct !== command) return direct;
  return commandWithPackageManagerWebpack(command);
}

function commandWithDirectNextWebpack(command: string) {
  return command.replace(/\b(next\s+dev)(?=\s|$)/, "$1 --webpack");
}

function commandWithPackageManagerWebpack(command: string) {
  return command.replace(
    /\b((?:(?:corepack|bun)\s+)?(?:pnpm|npm|bun|yarn)(?:\s+(?!--webpack|--turbo|--turbopack|&&|\|\||;)[^\s;&|]+)*\s+(?:run\s+)?dev)(?=(?:\s*(?:&&|\|\||;)|["')\]]|\s*$))/,
    (match) => `${match}${packageManagerArgumentSeparator(match)}--webpack`,
  );
}

function packageManagerArgumentSeparator(command: string) {
  if (/\b(?:pnpm|yarn|corepack\s+(?:pnpm|yarn))\b/.test(command)) return " ";
  return " -- ";
}
