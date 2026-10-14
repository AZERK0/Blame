// Explicit argv for new projects. Historical project defaults stay historical.
export function projectVerifiers(task, executable = process.execPath) {
  const npmTests = paths => ["npm", "test", "--", "--maxWorkers=1", "--minWorkers=1", "--pool=forks", ...paths];
  const defaults = task.project === "date-fns" ? {
    selected: npmTests(task.selectedTests), types: ["npm", "run", "types"], full: npmTests([]),
  } : task.project === "lodash" ? {
    selected: [executable, "test/test.js"], types: [executable, "--check", "lodash.js"], full: [executable, "test/test.js"],
  } : {};
  const commands = {...defaults, ...task.verifierCommands};
  for (const key of ["selected", "types", "full"])
    if (!Array.isArray(commands[key]) || !commands[key].length || commands[key].some(v => typeof v !== "string"))
      throw Error(`Project ${task.project} requires explicit ${key} argv`);
  return commands;
}
