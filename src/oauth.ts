import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import type { Credential } from "./credentials.js";
import { RwError } from "./errors.js";
import { VERSION } from "./version.js";

// Signing in through the browser, with the OAuth that Rockware's server
// (IMM) already has for agents. rw is a "native app" (RFC 8252):
//
// 1. Find the server's endpoints (/.well-known/oauth-authorization-server).
// 2. Register rw as a client the first time (dynamic registration).
// 3. Listen on a free port on 127.0.0.1, and open the browser at the
//    server's authorize URL, with a PKCE challenge and a random state.
// 4. The person approves on IMM's consent page, for one plant.
// 5. The browser comes back to 127.0.0.1 with a code. rw checks the state
//    and the issuer, and trades the code (and the PKCE verifier) for tokens.
//
// The access token lasts 15 minutes; rw refreshes it when needed.

export interface ServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
}

export const CLIENT_NAME = "rw command line";
const CALLBACK_PATH = "/callback";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export async function discover(host: string): Promise<ServerMetadata> {
  const response = await send(`${host}/.well-known/oauth-authorization-server`, { method: "GET" });
  if (!response.ok) {
    throw new RwError("api", `${host} didn't say how to sign in (HTTP ${response.status})`, {
      hint: "Check the host. To use an API token instead: rw auth login --with-token",
    });
  }
  const metadata = (await response.json()) as ServerMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new RwError("api", `${host} sent incomplete sign-in settings`);
  }
  return metadata;
}

export async function registerClient(metadata: ServerMetadata): Promise<string> {
  if (!metadata.registration_endpoint) throw new RwError("api", "This server doesn't let rw register itself");
  const response = await send(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The port is left out: the server accepts any port on loopback.
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [`http://127.0.0.1${CALLBACK_PATH}`] }),
  });
  if (!response.ok) throw new RwError("api", `Couldn't register rw with the server (HTTP ${response.status})`);
  return ((await response.json()) as { client_id: string }).client_id;
}

export interface LoginOptions {
  metadata: ServerMetadata;
  clientId: string;
  scopes: string[];
  /** Shows the person the URL, in case the browser doesn't open. */
  announce: (url: string) => void;
  /** Opens the URL. Tests replace it. */
  openBrowser?: (url: string) => void;
  timeoutMs?: number;
}

/** The whole browser sign-in. Resolves with the new credential. */
export async function browserLogin(options: LoginOptions): Promise<Extract<Credential, { kind: "oauth" }>> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const callback = await listenForCallback(options.timeoutMs ?? LOGIN_TIMEOUT_MS);
  const redirectUri = `http://127.0.0.1:${callback.port}${CALLBACK_PATH}`;
  try {
    const url = new URL(options.metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: options.clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: options.scopes.join(" "),
    }).toString();
    options.announce(url.toString());
    (options.openBrowser ?? openBrowser)(url.toString());

    const params = await callback.result;
    if (params.get("state") !== state) {
      throw new RwError("auth", "The sign-in answer didn't match this request, so rw ignored it", {
        hint: "Start again with `rw auth login`.",
      });
    }
    const iss = params.get("iss");
    if (iss && iss !== options.metadata.issuer) {
      throw new RwError("auth", `The sign-in answer came from ${iss}, not ${options.metadata.issuer}`);
    }
    const error = params.get("error");
    if (error) {
      const reason = params.get("error_description") ?? error;
      throw new RwError(error === "access_denied" ? "forbidden" : "auth", `Sign-in failed: ${reason}`);
    }
    const code = params.get("code");
    if (!code) throw new RwError("auth", "The sign-in answer had no code");

    return await tokenRequest(options.metadata, options.clientId, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  } finally {
    callback.close();
  }
}

/** A new access token from the refresh token. The refresh token rotates. */
export async function refresh(credential: Extract<Credential, { kind: "oauth" }>) {
  return tokenRequest(
    { token_endpoint: credential.tokenEndpoint, revocation_endpoint: credential.revocationEndpoint },
    credential.clientId,
    { grant_type: "refresh_token", refresh_token: credential.refreshToken },
  );
}

/** Ends the connection on the server. Best effort: a failure is not an error. */
export async function revoke(credential: Extract<Credential, { kind: "oauth" }>): Promise<boolean> {
  if (!credential.revocationEndpoint) return false;
  try {
    const response = await send(credential.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: credential.refreshToken, client_id: credential.clientId }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function tokenRequest(
  endpoints: Pick<ServerMetadata, "token_endpoint" | "revocation_endpoint">,
  clientId: string,
  params: Record<string, string>,
): Promise<Extract<Credential, { kind: "oauth" }>> {
  const response = await send(endpoints.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: clientId }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const description = typeof body.error_description === "string" ? body.error_description : `HTTP ${response.status}`;
    throw new RwError("auth", `The server refused the sign-in: ${description}`, {
      hint: "Sign in again with `rw auth login`.",
    });
  }
  return {
    kind: "oauth",
    accessToken: String(body.access_token),
    refreshToken: String(body.refresh_token),
    expiresAt: Date.now() + Number(body.expires_in ?? 900) * 1000,
    scopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [],
    clientId,
    tokenEndpoint: endpoints.token_endpoint,
    revocationEndpoint: endpoints.revocation_endpoint,
  };
}

interface Callback {
  port: number;
  result: Promise<URLSearchParams>;
  close(): void;
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></body>`;

/** A one-request web server on 127.0.0.1, on a port the system picks. */
function listenForCallback(timeoutMs: number): Promise<Callback> {
  return new Promise((resolve, reject) => {
    let settle!: (params: URLSearchParams) => void;
    let fail!: (error: Error) => void;
    const result = new Promise<URLSearchParams>((res, rej) => {
      settle = res;
      fail = rej;
    });
    const server: Server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      const failed = url.searchParams.has("error");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        failed
          ? PAGE("Sign-in didn't finish", "Go back to your terminal to see why.")
          : PAGE("You're signed in to the Rockware CLI", "You can close this tab and go back to your terminal."),
      );
      settle(url.searchParams);
    });
    const timer = setTimeout(() => {
      fail(new RwError("auth", "Sign-in timed out", { hint: "Start again with `rw auth login`." }));
    }, timeoutMs);
    timer.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No port to listen on"));
      resolve({
        port: address.port,
        result,
        close: () => {
          clearTimeout(timer);
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
}

/** Opens the URL with $BROWSER when set (a common convention), else the system's way. */
function openBrowser(url: string) {
  const [command, args] = process.env.BROWSER
    ? [process.env.BROWSER, [url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL was printed; the person can open it themselves.
  }
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "user-agent": `rw/${VERSION}` },
    });
  } catch (error) {
    throw new RwError("network", `Can't reach ${new URL(url).origin}: ${(error as Error).message}`);
  }
}

/**
 * Only one rw refreshes a profile's token at a time. The refresh token
 * rotates, so two at once could both use the old one. A lock older than
 * 30 seconds is from an rw that died, and is taken over.
 */
export async function withRefreshLock<T>(dir: string, profile: string, work: () => Promise<T>): Promise<T> {
  const locks = join(dir, "locks");
  mkdirSync(locks, { recursive: true, mode: 0o700 });
  const lock = join(locks, `${profile}.lock`);
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { recursive: true, force: true });
      } catch {
        // Gone already: try again.
      }
      if (Date.now() > deadline) {
        throw new RwError("rate_limited", "Another Rockware CLI is signing in or refreshing this profile", {
          hint: "Try again in a moment.",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
