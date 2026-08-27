import type { CoreSessionConfig } from "@cline/sdk";

type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type BeforeModel = NonNullable<AgentHooks["beforeModel"]>;
type BeforeModelResult = Awaited<ReturnType<BeforeModel>>;

export function composeHarnessHooks(...hooks: AgentHooks[]): AgentHooks {
  const beforeModel = hooks
    .map((hook) => hook.beforeModel)
    .filter((hook): hook is BeforeModel => Boolean(hook));
  return {
    ...hooks.reduce((merged, hook) => ({ ...merged, ...hook }), {}),
    ...(beforeModel.length
      ? { beforeModel: composeBeforeModel(beforeModel) }
      : {}),
  };
}

function composeBeforeModel(hooks: BeforeModel[]): BeforeModel {
  return async (initialContext: Parameters<BeforeModel>[0]) => {
    let context = initialContext;
    let combined: NonNullable<BeforeModelResult> = {};
    for (const hook of hooks) {
      const result = await hook(context);
      if (!result) continue;
      combined = mergeBeforeModelResults(combined, result);
      if (result.stop) return combined;
      context = {
        ...context,
        request: {
          ...context.request,
          ...(combined.messages ? { messages: combined.messages } : {}),
          ...(combined.tools ? { tools: combined.tools } : {}),
          ...(combined.options ? { options: combined.options } : {}),
        },
      };
    }
    return Object.keys(combined).length ? combined : undefined;
  };
}

function mergeBeforeModelResults(
  current: NonNullable<BeforeModelResult>,
  next: NonNullable<BeforeModelResult>,
) {
  return {
    ...current,
    ...next,
    ...(current.options || next.options
      ? { options: { ...current.options, ...next.options } }
      : {}),
  };
}
