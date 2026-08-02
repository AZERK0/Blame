export type PreviewEndpointProtocol = "http" | "https" | "ws" | "wss";

export type PreviewEndpointRoute = {
  serviceId: string;
  endpointId: string;
  protocol: PreviewEndpointProtocol;
  logicalHost: "localhost";
  logicalPort: number;
  targetHost: string;
  targetPort: number;
  sandboxPort: number;
  publicUrl: string;
  basePathMode: "root" | "explicit-prefix";
  externallyCompatible: boolean;
};

export type EndpointMap = {
  revision: number;
  primaryEndpointId: string;
  primaryPublicUrl: string;
  routes: PreviewEndpointRoute[];
  supportsWebSocket: boolean;
  integratedPreviewRequired: boolean;
  incompatibilityReasons: string[];
};

export function publicEndpointMap(map: EndpointMap): EndpointMap {
  return {
    ...map,
    routes: map.routes.map((route) => ({ ...route })),
  };
}
