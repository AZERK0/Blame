export type RuntimeProfileId = "local-container" | "vercel-compose";

export type LocalRuntimeBackend = "linux-native" | "lima" | "wsl2";

export type RuntimePreference = {
  profile: RuntimeProfileId;
  source: "account-default" | "project-override" | "story-override";
  confirmedCloudUploadAt?: string;
};

export const runtimeProfiles = [
  "local-container",
  "vercel-compose",
] as const satisfies readonly RuntimeProfileId[];

export function isRuntimeProfileId(value: unknown): value is RuntimeProfileId {
  return runtimeProfiles.includes(value as RuntimeProfileId);
}

export function isCloudRuntimeProfile(profile: RuntimeProfileId) {
  return profile !== "local-container";
}

export function resolveRuntimePreference(input: {
  account?: RuntimePreference;
  project?: RuntimePreference;
  story?: RuntimePreference;
}): RuntimePreference {
  return (
    input.story ??
    input.project ??
    input.account ?? {
      profile: "local-container",
      source: "account-default",
    }
  );
}

export function assertCloudUploadConsent(preference: RuntimePreference) {
  if (
    isCloudRuntimeProfile(preference.profile) &&
    !preference.confirmedCloudUploadAt
  ) {
    throw new Error("Cloud runtime requires explicit upload consent.");
  }
}
