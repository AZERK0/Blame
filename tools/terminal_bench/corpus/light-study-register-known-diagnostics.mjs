// Preserve shared computations while labeling previously discovered diagnostics
// according to this campaign's registration, without changing primary scores.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const directory = resolve(process.argv[2]);
const bytes = await readFile(join(directory, 'protocol.json'));
const protocol = JSON.parse(bytes);
if (!protocol.intervention.startsWith('T2:')) throw new Error('Expected the T2 registration');
const registration = { registeredAt: protocol.registeredAt,
  protocolSha256: createHash('sha256').update(bytes).digest('hex') };
for (const filename of ['slug-replay.json', 'exploratory-slug-sensitivity.json', 'motion-validation-review.json']) {
  const file = join(directory, filename);
  const report = JSON.parse(await readFile(file, 'utf8'));
  report.inheritedHelperDescription = report.selection ?? report.method;
  report.registration = registration;
  if (filename === 'motion-validation-review.json') {
    report.method = 'Previously identified adapted-motion validation correction registered before T2 outcomes. Apply the unchanged rule uniformly, subject to source review, and preserve original generic build candidates. No agent action, source, instruction or official score change.';
  } else {
    report.selection = 'Extended-diacritic counterexamples discovered during T1, registered as secondary diagnostics before T2 outcomes, applied uniformly. Preserve primary instruction audit and official scores; no solution repair or agent feedback. Shared helper filenames retain their historical exploratory label.';
  }
  await writeFile(file, JSON.stringify(report, null, 2)+'\n');
}
