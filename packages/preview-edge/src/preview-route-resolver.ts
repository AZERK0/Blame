export type ResolvedPreviewRoute = {
  routeId: string;
  sessionId: string;
  endpointId: string;
  serviceId: string;
  logicalPort: number;
  generation: number;
  ownerUserId: string;
  upstreamUrl: string;
};

export type ConsumedAccessTicket = {
  sessionId: string;
  routeId: string;
  serviceId: string;
  endpointId: string;
  ownerUserId: string;
};

export interface PreviewRouteResolver {
  resolve(hostname: string): Promise<ResolvedPreviewRoute>;
  consumeTicket(
    ticket: string,
    hostname: string,
  ): Promise<ConsumedAccessTicket>;
}

export class PreviewControlRequestError extends Error {
  constructor(readonly status: number) {
    super(`Preview control request failed with status ${status}.`);
    this.name = "PreviewControlRequestError";
  }
}

export class ApiPreviewRouteResolver implements PreviewRouteResolver {
  constructor(
    private readonly controlOrigin: string,
    private readonly controlToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(controlOrigin);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("Preview Edge control origin must use HTTPS.");
    }
  }

  resolve(hostname: string) {
    return this.request<ResolvedPreviewRoute>("resolve", { hostname });
  }

  consumeTicket(ticket: string, hostname: string) {
    return this.request<ConsumedAccessTicket>("consume-ticket", {
      ticket,
      hostname,
    });
  }

  private async request<T>(path: string, body: Record<string, string>) {
    const response = await this.fetcher(
      new URL(`/internal/preview-edge/${path}`, this.controlOrigin),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) throw new PreviewControlRequestError(response.status);
    return (await response.json()) as T;
  }
}
