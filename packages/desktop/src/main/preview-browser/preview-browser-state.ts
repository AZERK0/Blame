export type PreviewBrowserState = {
  application?: PreviewApplicationState;
  error?: string;
  id: string;
  loading: boolean;
  url?: string;
};

export type PreviewBrowserStateUpdate = Omit<
  Partial<Omit<PreviewBrowserState, "id">>,
  "application" | "error"
> & { application?: PreviewApplicationState | null; error?: string | null };

export type PreviewApplicationState = {
  status: "ready" | "failed" | "unverified";
  httpStatus?: number;
  diagnostic?: string;
};

export function updatedPreviewBrowserState(
  current: PreviewBrowserState | undefined,
  fallback: PreviewBrowserState,
  update: PreviewBrowserStateUpdate,
): PreviewBrowserState {
  const error =
    update.error === null ? undefined : (update.error ?? current?.error);
  const application =
    update.application === null
      ? undefined
      : (update.application ?? current?.application);
  return {
    id: fallback.id,
    loading: update.loading ?? fallback.loading,
    url: update.url ?? fallback.url,
    ...(application ? { application } : {}),
    ...(error ? { error } : {}),
  };
}
