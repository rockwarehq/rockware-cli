import { Command, Option } from "commander";
import { ApiClient } from "../api/client.js";
import { SITE } from "../api/queries.js";
import { checkProfileName, profileNameFor, resolveHost } from "../config.js";
import type { Credential } from "../credentials.js";
import { action, type Context, type IO } from "../context.js";
import { RwError } from "../errors.js";
import { fields } from "../format.js";
import { browserLogin, discover, registerClient, revoke } from "../oauth.js";

// rw auth: sign in, see who you are, sign out.

/** What `--scope` asks the consent page for. */
const SCOPES = {
  read: ["data:read"],
  write: ["data:read", "data:write", "webhooks:write"],
} as const;

interface Site {
  id: string;
  name: string;
  timezone: string;
}

/** Check a token by asking which plant it belongs to. */
async function siteFor(host: string, token: string): Promise<Site> {
  const client = new ApiClient({ host, accessToken: async () => token, canRefresh: false });
  const { site } = await client.request<{ site: Site | null }>(SITE);
  if (!site) throw new RwError("auth", "That token works, but isn't tied to a plant");
  return site;
}

interface LoginOptions {
  host?: string;
  withToken?: boolean;
  scope: keyof typeof SCOPES;
  browser: boolean;
  expectSite?: string;
  default?: boolean;
}

async function login(ctx: Context, options: LoginOptions) {
  // Without --host, sign in again to the profile you'd run as (after a
  // logout, or when the sign-in expired).
  const existingName = ctx.flags.profile ?? (options.host ? undefined : ctx.session.profileName());
  const existing = existingName ? ctx.session.profiles[existingName] : undefined;
  const hostInput = options.host ?? existing?.host ?? ctx.io.env.RW_HOST;
  if (!hostInput) {
    throw new RwError("usage", "Which Rockware do you want to sign in to?", {
      hint: "Pass --host with your tenant, like `rw auth login --host acme`.",
    });
  }
  const host = resolveHost(hostInput);
  const name = checkProfileName(existingName ?? profileNameFor(host));

  let credential: Credential;
  let clientId = existing?.host === host ? existing.clientId : undefined;
  if (options.withToken) {
    credential = { kind: "token", token: await readToken(ctx) };
  } else {
    const metadata = await discover(host);
    clientId ??= await registerClient(metadata);
    const run = (id: string) =>
      browserLogin({
        metadata,
        clientId: id,
        scopes: [...SCOPES[options.scope]],
        announce: (url) => {
          ctx.io.stderr.write(
            options.browser
              ? `Opening your browser to sign in. If it doesn't open, go to:\n\n  ${url}\n\n`
              : `To sign in, open this in your browser:\n\n  ${url}\n\n`,
          );
          ctx.io.stderr.write("Waiting for you to approve rw…\n");
        },
        openBrowser: options.browser ? undefined : () => {},
      });
    credential = await run(clientId);
  }

  // Never save a credential that doesn't work, or that's for the wrong plant.
  const token = credential.kind === "token" ? credential.token : credential.accessToken;
  const site = await siteFor(host, token);
  if (options.expectSite && options.expectSite !== site.id) {
    if (credential.kind === "oauth") await revoke(credential);
    throw new RwError("auth", `That sign-in is for ${site.name} (${site.id}), not ${options.expectSite}`, {
      hint: "Nothing was saved. Sign in again and pick the right plant.",
    });
  }

  ctx.session.saveProfile(
    name,
    { host, auth: credential.kind, clientId: credential.kind === "oauth" ? credential.clientId : clientId, site },
    credential,
    Boolean(options.default),
  );

  const scopes = credential.kind === "oauth" ? credential.scopes : null;
  const wanted = SCOPES[options.scope];
  const missing = scopes
    ? wanted.filter((scope) => !scopes.includes(scope) && !(scope === "data:read" && scopes.includes("read")))
    : [];
  const data = { profile: name, host, site, auth: credential.kind, scopes, store: ctx.session.store.backend };
  return {
    data,
    summary:
      `Signed in to ${site.name} as profile "${name}".` +
      (missing.length > 0
        ? ` You weren't given ${missing.join(", ")}: writes need a plant admin, or an API token.`
        : ""),
    breadcrumbs: [
      { action: "See the plant's stations", cmd: "rw stations list" },
      { action: "Check everything is set up", cmd: "rw doctor" },
    ],
    human: () =>
      fields({ profile: name, host, plant: `${site.name} (${site.id})`, scopes: scopes ?? "API token" }, ctx.style),
  };
}

/** An API token from stdin. Never from an argument: those end up in shell history. */
async function readToken(ctx: Context): Promise<string> {
  const text = ctx.io.stdin.isTTY
    ? await ctx.prompt("Paste your API token (it won't show): ", { hidden: true })
    : await ctx.readStdin();
  const token = text.trim();
  if (!token)
    throw new RwError("usage", "No token given", { hint: "Pipe it in: rw auth login --with-token < token.txt" });
  if (!token.startsWith("rw_app_")) {
    throw new RwError("usage", "That isn't a Rockware API token (they start with rw_app_)", {
      hint: "Make one in IMM under Settings → Developers.",
    });
  }
  return token;
}

async function status(ctx: Context) {
  const { name, profile } = ctx.session.current();
  const credential = ctx.io.env.RW_TOKEN
    ? ({ kind: "token", token: ctx.io.env.RW_TOKEN } as const)
    : ctx.session.credential(name);
  if (!credential)
    throw new RwError("auth", `Profile "${name}" isn't signed in`, { hint: `Sign in: rw auth login -P ${name}` });
  const site = await siteFor(profile.host, await ctx.session.accessToken());
  const data = {
    profile: name,
    host: profile.host,
    site,
    auth: credential.kind,
    scopes: credential.kind === "oauth" ? credential.scopes : null,
    fromEnv: Boolean(ctx.io.env.RW_TOKEN),
    store: ctx.session.store.backend,
  };
  return {
    data,
    summary: `Signed in to ${site.name} on ${profile.host}.`,
    human: () =>
      fields(
        {
          profile: name,
          host: profile.host,
          plant: `${site.name} (${site.id})`,
          "signed in with": credential.kind === "oauth" ? "browser" : data.fromEnv ? "RW_TOKEN" : "API token",
          scopes: data.scopes ?? "the API token's",
          "kept in": data.fromEnv ? "environment" : data.store,
        },
        ctx.style,
      ),
  };
}

async function logout(ctx: Context) {
  const { name } = ctx.session.current();
  const credential = ctx.session.credential(name);
  const revoked = credential?.kind === "oauth" ? await revoke(credential) : false;
  ctx.session.store.delete(name);
  return {
    data: { profile: name, revoked },
    summary:
      credential?.kind === "token"
        ? `Signed out of "${name}". The API token still works until it's revoked in IMM.`
        : `Signed out of "${name}".`,
    breadcrumbs: [{ action: "Sign in again", cmd: `rw auth login -P ${name}` }],
    human: () => "",
  };
}

export function authCommand(io: () => IO): Command {
  const auth = new Command("auth").description("Sign in, see who you are, sign out");

  auth
    .command("login")
    .description("Sign in through your browser, or with an API token")
    .option("--host <tenant|url>", "Your Rockware, like `acme` or https://acme-api.rockware.io")
    .option("--with-token", "Read an API token (rw_app_…) from stdin, for scripts and CI")
    .addOption(new Option("--scope <scope>", "What to ask for").choices(Object.keys(SCOPES)).default("read"))
    .option("--no-browser", "Print the sign-in link instead of opening a browser")
    .option("--expect-site <id>", "Refuse to save unless the token is for this plant")
    .option("--default", "Make this the default profile")
    .addHelpText(
      "after",
      "\nExamples:\n  rw auth login --host acme\n  rw auth login --host acme --scope write\n  rw auth login --host acme -P acme-ci --with-token < token.txt",
    )
    .action(action<LoginOptions>(io, (ctx, _args, options) => login(ctx, options)));

  auth.command("status").description("Show the profile, host and plant you're signed in to").action(action(io, status));
  auth
    .command("logout")
    .description("Sign out of the profile, and end the connection on the server")
    .action(action(io, logout));

  return auth;
}
