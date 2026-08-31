import { pathToFileURL } from "node:url";

type NavigationEvent = {
  preventDefault(): void;
  url: string;
};

type NavigationGuardInput = {
  openExternal(url: string): void;
  rendererFile: string;
  rendererUrl?: string;
};

const externalProtocols = new Set(["http:", "https:", "mailto:"]);

export function createMainWindowNavigationGuard(input: NavigationGuardInput) {
  const rendererLocation = resolveRendererLocation(input);

  return {
    handleNavigation(event: NavigationEvent) {
      if (isRendererLocation(event.url, rendererLocation)) return;
      event.preventDefault();
      openExternalUrl(event.url, input.openExternal);
    },
    handleRedirect(event: NavigationEvent) {
      if (isRendererLocation(event.url, rendererLocation)) return;
      event.preventDefault();
    },
    handleWindowOpen({ url }: { url: string }) {
      openExternalUrl(url, input.openExternal);
      return { action: "deny" as const };
    },
  };
}

function resolveRendererLocation(input: NavigationGuardInput) {
  return input.rendererUrl
    ? new URL(input.rendererUrl)
    : pathToFileURL(input.rendererFile);
}

function isRendererLocation(url: string, rendererLocation: URL) {
  const candidate = parseUrl(url);
  if (!candidate) return false;
  if (rendererLocation.origin !== "null") {
    return candidate.origin === rendererLocation.origin;
  }
  return (
    candidate.protocol === rendererLocation.protocol &&
    candidate.host === rendererLocation.host &&
    candidate.pathname === rendererLocation.pathname
  );
}

function openExternalUrl(url: string, openExternal: (url: string) => void) {
  const candidate = parseUrl(url);
  if (!candidate || !externalProtocols.has(candidate.protocol)) return;
  openExternal(candidate.toString());
}

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
