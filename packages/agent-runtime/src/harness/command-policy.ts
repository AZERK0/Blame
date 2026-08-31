export const blockedCommandParts = [
  "rm -rf",
  "sudo",
  "curl | sh",
  "wget | sh",
  "> /dev/",
];

export function blockedCommandReason(command: string) {
  const normalized = command.toLocaleLowerCase();
  const match = blockedCommandParts.find((part) => normalized.includes(part));
  return match ? `Command is denied by the shell policy: ${match}` : undefined;
}
