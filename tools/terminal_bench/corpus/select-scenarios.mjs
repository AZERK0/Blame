export function selectedScenarios(scenarios, selection) {
  const ids = new Set(
    selection
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const selected =
    !selection || selection === "all"
      ? scenarios
      : scenarios.filter((scenario) => ids.has(scenario.id));
  if (selection && selection !== "all" && selected.length !== ids.size)
    throw new Error("One or more selected scenarios do not exist.");
  if (!selected.length || selected.length > 10)
    throw new Error(
      "Select between one and ten scenarios per campaign with --scenarios.",
    );
  return selected;
}
