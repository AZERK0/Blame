export type PreviewBrowserState = {
  error?: string;
  id: string;
  loading: boolean;
  url?: string;
};

export type PreviewBrowserStateUpdate = Omit<
  Partial<Omit<PreviewBrowserState, "id">>,
  "error"
> & { error?: string | null };

export function updatedPreviewBrowserState(
  current: PreviewBrowserState | undefined,
  fallback: PreviewBrowserState,
  update: PreviewBrowserStateUpdate,
): PreviewBrowserState {
  const error =
    update.error === null ? undefined : (update.error ?? current?.error);
  return {
    id: fallback.id,
    loading: update.loading ?? fallback.loading,
    url: update.url ?? fallback.url,
    ...(error ? { error } : {}),
  };
}
