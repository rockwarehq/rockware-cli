import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RwError } from "./errors.js";

// rw's settings: profiles, kept in config.json in rw's config folder.
//
// A profile is one Rockware host you sign in to, like `acme`
// (https://acme-api.rockware.io). Every token belongs to one plant, so a
// profile is also one plant. Secrets are not kept here: see credentials.ts.

export interface Profile {
  /** The API's origin, like https://acme-api.rockware.io. */
  host: string;
  /** How this profile signs in: through the browser, or with an API token. */
  auth: "oauth" | "token";
  /** The OAuth client rw registered on this host, reused for the next login. */
  clientId?: string;
  /** The plant the token belongs to, as it was at sign-in. */
  site?: { id: string; name: string };
}

export interface Config {
  defaultProfile?: string;
  profiles: Record<string, Profile>;
}

/** rw's config folder: RW_CONFIG_DIR, else the platform's usual place. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RW_CONFIG_DIR) return env.RW_CONFIG_DIR;
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "rw");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "rw");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "config.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let text: string;
  try {
    text = readFileSync(configPath(env), "utf8");
  } catch {
    return { profiles: {} };
  }
  try {
    const parsed = JSON.parse(text) as Partial<Config>;
    return { defaultProfile: parsed.defaultProfile, profiles: parsed.profiles ?? {} };
  } catch {
    throw new RwError("error", `Can't read ${configPath(env)}: it isn't valid JSON`, {
      hint: "Fix or delete the file, then sign in again with `rw auth login`.",
    });
  }
}

export function saveConfig(config: Config, env: NodeJS.ProcessEnv = process.env): void {
  writePrivateFile(configPath(env), `${JSON.stringify(config, null, 2)}\n`);
}

/** Write a file only this user can read, all at once (a crash never leaves half a file). */
export function writePrivateFile(path: string, contents: string): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, contents, { mode: 0o600 });
  renameSync(temp, path);
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export function checkProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw new RwError("usage", `"${name}" can't be a profile name`, {
      hint: "Use lowercase letters, digits, dots, dashes or underscores.",
    });
  }
  return name;
}

/**
 * Where a host points. A tenant name like `acme` means
 * https://acme-api.rockware.io. A URL is used as given, but it must be
 * https, except on this computer (local development).
 */
export function resolveHost(input: string): string {
  const value = input.trim();
  if (/^[a-z0-9][a-z0-9-]*$/i.test(value) && !value.includes(".")) {
    return `https://${value.toLowerCase()}-api.rockware.io`;
  }
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new RwError("usage", `"${input}" isn't a host`, {
      hint: "Use a tenant name like `acme`, or a URL like https://acme-api.rockware.io.",
    });
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !local) {
    throw new RwError("usage", "rw only talks to Rockware over https", {
      hint: "http is allowed only for localhost, for local development.",
    });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RwError("usage", `"${input}" isn't an http(s) URL`);
  }
  return url.origin;
}

/** A short profile name for a host: the tenant, like `acme`, or `local`. */
export function profileNameFor(host: string): string {
  const { hostname } = new URL(host);
  const tenant = /^([a-z0-9-]+)-api\.rockware\.io$/.exec(hostname)?.[1];
  if (tenant) return tenant;
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return "local";
  return checkProfileName(hostname.replace(/[^a-z0-9.-]/g, "-").slice(0, 63));
}
