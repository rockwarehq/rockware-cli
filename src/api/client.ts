import { RwError } from "../errors.js";
import { VERSION } from "../version.js";

// Calls the developer API: POST <host>/graphql with a Bearer token. Turns
// every way a call can fail into an RwError with the right code, so each
// command only handles its data.

export interface TokenSource {
  host: string;
  /** A working token. forceRefresh asks for a new one after a 401. */
  accessToken(options?: { forceRefresh?: boolean }): Promise<string>;
  /** Whether a 401 is worth one refresh and retry (browser sign-ins only). */
  canRefresh: boolean;
}

export interface GraphqlError {
  message: string;
  extensions?: { code?: string };
}

const CODES: Record<string, RwError["code"]> = {
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  BAD_USER_INPUT: "validation",
  GRAPHQL_VALIDATION_FAILED: "usage",
};

export class ApiClient {
  constructor(private readonly tokens: TokenSource) {}

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response = await this.post(query, variables, await this.tokens.accessToken());
    if (response.status === 401 && this.tokens.canRefresh) {
      response = await this.post(query, variables, await this.tokens.accessToken({ forceRefresh: true }));
    }
    const body = (await response.json().catch(() => null)) as { data?: T; errors?: GraphqlError[] } | null;
    const message = body?.errors?.map((error) => error.message).join("; ");

    if (response.status === 401) {
      throw new RwError("auth", message || "Not signed in", { hint: "Sign in again: rw auth login" });
    }
    if (response.status === 403) {
      const plantOff = /agent connections are turned off/i.test(message ?? "");
      throw new RwError("forbidden", message || "Not allowed", {
        hint: plantOff
          ? "A plant admin can turn them on in IMM under Settings → Connect an agent. Or use an API token: rw auth login --with-token"
          : undefined,
      });
    }
    if (response.status === 429) {
      const wait = response.headers.get("retry-after");
      throw new RwError("rate_limited", message || "Too many requests", {
        hint: wait ? `Try again in ${wait} seconds.` : "Try again in a minute.",
      });
    }
    if (response.status >= 500) {
      throw new RwError("api", message || `The server failed (HTTP ${response.status})`, { retryable: true });
    }
    if (!body) throw new RwError("api", `The server sent something that isn't JSON (HTTP ${response.status})`);
    if (body.errors?.length) {
      const first = body.errors[0]?.extensions?.code;
      const code = (first && CODES[first]) || (response.status === 400 ? "usage" : "api");
      throw new RwError(code, message ?? "The request failed", { details: body.errors });
    }
    return body.data as T;
  }

  private async post(query: string, variables: Record<string, unknown>, token: string): Promise<Response> {
    try {
      return await fetch(`${this.tokens.host}/graphql`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": `rw/${VERSION}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new RwError("network", `Can't reach ${this.tokens.host}: ${(error as Error).message}`, {
        hint: "Check your connection, or the host: rw auth status",
      });
    }
  }
}
