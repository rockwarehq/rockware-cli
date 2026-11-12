import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "../src/api/client.js";
import { browserLogin, discover, registerClient, withRefreshLock } from "../src/oauth.js";

// A small fake of IMM's OAuth and /graphql, so the sign-in and the client's
// failure handling can be tested without a database. The real server's side
// is tested in Rockware's server repo.

let server: Server;
let host: string;
const issued = { challenge: "", code: "the-code" };
let graphql: (req: IncomingMessage) => { status: number; body: unknown; headers?: Record<string, string> };

async function body(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text;
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", host);
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(value));
    };
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: host,
        authorization_endpoint: `${host}/oauth/authorize`,
        token_endpoint: `${host}/oauth/token`,
        registration_endpoint: `${host}/oauth/register`,
        revocation_endpoint: `${host}/oauth/revoke`,
      });
    }
    if (url.pathname === "/oauth/register") {
      const registered = JSON.parse(await body(req));
      expect(registered.redirect_uris).toEqual(["http://127.0.0.1/callback"]);
      return json(201, { client_id: "client-1" });
    }
    if (url.pathname === "/oauth/token") {
      const params = new URLSearchParams(await body(req));
      if (params.get("grant_type") === "authorization_code") {
        const verified = createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url");
        if (params.get("code") !== issued.code || verified !== issued.challenge) {
          return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        }
      }
      return json(200, { access_token: "rw_mcp_new", refresh_token: "rw_mcr_new", expires_in: 900, scope: "read" });
    }
    if (url.pathname === "/graphql") {
      const answer = graphql(req);
      return json(answer.status, answer.body, answer.headers);
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  host = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

/** A browser that approves at once: follows the authorize URL back to rw's callback. */
function approvingBrowser(change: (params: URLSearchParams) => void = () => {}) {
  return (authorizeUrl: string) => {
    const request = new URL(authorizeUrl).searchParams;
    expect(request.get("code_challenge_method")).toBe("S256");
    issued.challenge = request.get("code_challenge") ?? "";
    const back = new URL(request.get("redirect_uri") ?? "");
    back.searchParams.set("code", issued.code);
    back.searchParams.set("state", request.get("state") ?? "");
    back.searchParams.set("iss", host);
    change(back.searchParams);
    void fetch(back);
  };
}

describe("browser sign-in", () => {
  it("registers, comes back on a loopback port, and trades the code with PKCE", async () => {
    const metadata = await discover(host);
    const clientId = await registerClient(metadata);
    const credential = await browserLogin({
      metadata,
      clientId,
      scopes: ["data:read"],
      announce: () => {},
      openBrowser: approvingBrowser(),
    });
    expect(credential).toMatchObject({
      kind: "oauth",
      accessToken: "rw_mcp_new",
      refreshToken: "rw_mcr_new",
      scopes: ["read"],
      clientId: "client-1",
      tokenEndpoint: `${host}/oauth/token`,
    });
    expect(credential.expiresAt).toBeGreaterThan(Date.now() + 800_000);
  });

  it("ignores an answer for another request", async () => {
    const metadata = await discover(host);
    const login = browserLogin({
      metadata,
      clientId: "client-1",
      scopes: [],
      announce: () => {},
      openBrowser: approvingBrowser((params) => params.set("state", "someone-else")),
    });
    await expect(login).rejects.toMatchObject({ code: "auth", message: expect.stringMatching(/didn't match/) });
  });

  it("refuses an answer from another issuer", async () => {
    const metadata = await discover(host);
    const login = browserLogin({
      metadata,
      clientId: "client-1",
      scopes: [],
      announce: () => {},
      openBrowser: approvingBrowser((params) => params.set("iss", "https://evil.example")),
    });
    await expect(login).rejects.toMatchObject({ code: "auth" });
  });

  it("says when the person declined", async () => {
    const metadata = await discover(host);
    const login = browserLogin({
      metadata,
      clientId: "client-1",
      scopes: [],
      announce: () => {},
      openBrowser: approvingBrowser((params) => {
        params.delete("code");
        params.set("error", "access_denied");
        params.set("error_description", "The person declined the connection");
      }),
    });
    await expect(login).rejects.toMatchObject({ code: "forbidden", message: /declined/ });
  });
});

describe("API failures", () => {
  const client = (tokens: string[]) => {
    const handed: Array<boolean | undefined> = [];
    return {
      handed,
      api: new ApiClient({
        host,
        canRefresh: true,
        accessToken: async (options) => {
          handed.push(options?.forceRefresh);
          return tokens.shift() ?? "none";
        },
      }),
    };
  };

  it("refreshes once after a 401, then tries again", async () => {
    graphql = (req) =>
      req.headers.authorization === "Bearer good"
        ? { status: 200, body: { data: { site: { id: "s" } } } }
        : { status: 401, body: { errors: [{ message: "expired" }] } };
    const { api, handed } = client(["stale", "good"]);
    expect(await api.request("{ site { id } }")).toEqual({ site: { id: "s" } });
    expect(handed).toEqual([undefined, true]);
  });

  it("maps statuses to codes", async () => {
    const cases: Array<[number, unknown, Record<string, string>, object]> = [
      [
        429,
        { errors: [{ message: "slow down" }] },
        { "retry-after": "60" },
        { code: "rate_limited", retryable: true, hint: "Try again in 60 seconds." },
      ],
      [503, {}, {}, { code: "api", retryable: true }],
      [
        403,
        { errors: [{ message: "Agent connections are turned off for this plant" }] },
        {},
        { code: "forbidden", hint: expect.stringMatching(/Settings/) },
      ],
      [
        200,
        { errors: [{ message: "nope", extensions: { code: "FORBIDDEN" } }] },
        {},
        { code: "forbidden", retryable: false },
      ],
      [400, { errors: [{ message: 'Cannot query field "x"' }] }, {}, { code: "usage" }],
    ];
    for (const [status, response, headers, expected] of cases) {
      graphql = () => ({ status, body: response, headers });
      await expect(client(["t"]).api.request("{ site { id } }")).rejects.toMatchObject(expected);
    }
  });

  it("says when the host can't be reached, and that it's worth trying again", async () => {
    const api = new ApiClient({ host: "http://127.0.0.1:1", canRefresh: false, accessToken: async () => "t" });
    await expect(api.request("{ site { id } }")).rejects.toMatchObject({ code: "network", retryable: true });
  });
});

it("lets only one rw refresh a profile at a time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-lock-"));
  const order: string[] = [];
  const slow = (name: string) =>
    withRefreshLock(dir, "p", async () => {
      order.push(`${name} in`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push(`${name} out`);
    });
  await Promise.all([slow("a"), slow("b")]);
  expect(order).toEqual(["a in", "a out", "b in", "b out"]);
});
