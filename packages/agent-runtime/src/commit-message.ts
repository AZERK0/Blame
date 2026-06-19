export function fallbackCommitSubject(title: string, files: string[]) {
  const subject = commitSubjectFromTitle(title);
  return subject ?? fallbackChangedFilesSubject(files);
}

function commitSubjectFromTitle(title: string) {
  const subject = title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*[.!?]+$/g, "")
    .trim();
  if (!subject) return undefined;
  return subject.charAt(0).toLowerCase() + subject.slice(1);
}

function fallbackChangedFilesSubject(files: string[]) {
  if (
    files.length &&
    files.every((file) => /\.(test|spec)\.[jt]sx?$/.test(file))
  )
    return "cover backlog item";
  if (files.length && files.every((file) => /\.(md|mdx|txt)$/.test(file)))
    return "document backlog item";
  return "complete backlog item";
}
