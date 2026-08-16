export type PreviewBridgeProvider = "cloud" | "local";

export type DesktopBridgeGrant = {
  sessionId: string;
  endpointRevision: number;
  integratedPreviewRequired: boolean;
  primaryRouteId: string;
  routes: Array<{
    routeId: string;
    serviceId: string;
    endpointId: string;
    logicalHost: "localhost";
    logicalPort: number;
    protocol: "http" | "https" | "ws" | "wss";
    providerUrl: string;
    provider?: PreviewBridgeProvider;
    capability?: string;
    capabilityExpiresAt: string;
  }>;
};

export type PreviewBridgeSource =
  | { kind: "cloud"; sessionId: string }
  | { kind: "local"; worktree: string };
