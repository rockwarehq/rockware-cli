import { type Config, configDir, loadConfig, type Profile, resolveHost, saveConfig } from "./config.js";
import { type Credential, type CredentialStore, credentialStore } from "./credentials.js";
import { RwError } from "./errors.js";
import { refresh, withRefreshLock } from "./oauth.js";

// Which profile a command runs as, and its token.
//
// The profile is, in order: --profile, RW_PROFILE, the default profile, or
// the only one there is. RW_TOKEN (with RW_HOST, or a profile's host) skips
// the saved credential, for CI and other headless use.

/** Refresh when the access token has less than this long left. */
const REFRESH_EARLY_MS = 60_000;

export interface SessionOptions {
  profile?: string;
  env?: NodeJS.ProcessEnv;
  store?: CredentialStore;
}

export class Session {
  readonly env: NodeJS.ProcessEnv;
  readonly store: CredentialStore;
  private config: Config;
  private readonly requested?: string;

  constructor(options: SessionOptions = {}) {
    this.env = options.env ?? process.env;
    this.store = options.store ?? credentialStore(this.env);
    this.config = loadConfig(this.env);
    this.requested = options.profile ?? this.env.RW_PROFILE;
  }

  get profiles(): Record<string, Profile> {
    return this.config.profiles;
  }

  get defaultProfile(): string | undefined {
    return this.config.defaultProfile;
  }

  /** The profile's name, or undefined when there is none to use. */
  profileName(): string | undefined {
    if (this.requested) return this.requested;
    if (this.config.defaultProfile && this.config.profiles[this.config.defaultProfile]) {
      return this.config.defaultProfile;
    }
    const names = Object.keys(this.config.profiles);
    return names.length === 1 ? names[0] : undefined;
  }

  /** The profile to run as. Throws with a hint when there isn't one. */
  current(): { name: string; profile: Profile } {
    const envHost = this.env.RW_HOST;
    const name = this.profileName();
    const profile = name ? this.config.profiles[name] : undefined;
    if (profile) return { name: name as string, profile };
    if (this.env.RW_TOKEN && envHost)
      return { name: name ?? "env", profile: { host: resolveHost(envHost), auth: "token" } };
    if (name && this.requested) {
      throw new RwError("usage", `There's no profile called "${name}"`, { hint: "See your profiles: rw profile list" });
    }
    const many = Object.keys(this.config.profiles).length > 1;
    throw new RwError("auth", many ? "Pick a profile: there's more than one" : "You're not signed in", {
      hint: many ? "Run `rw profile use <name>`, or pass --profile." : "Sign in: rw auth login --host <tenant>",
    });
  }

  /** A token that works now, refreshing it first if it is about to expire. */
  async accessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    if (this.env.RW_TOKEN) return this.env.RW_TOKEN;
    const { name } = this.current();
    const credential = this.store.get(name);
    if (!credential) {
      throw new RwError("auth", `Profile "${name}" isn't signed in`, { hint: `Sign in: rw auth login -P ${name}` });
    }
    if (credential.kind === "token") return credential.token;
    if (!options.forceRefresh && credential.expiresAt - Date.now() > REFRESH_EARLY_MS) return credential.accessToken;

    return withRefreshLock(configDir(this.env), name, async () => {
      // Another rw may have refreshed while this one waited for the lock.
      const latest = this.store.get(name);
      if (latest?.kind === "oauth" && latest.accessToken !== credential.accessToken) return latest.accessToken;
      const renewed = await refresh(credential);
      this.store.set(name, renewed);
      return renewed.accessToken;
    });
  }

  credential(name: string): Credential | null {
    return this.store.get(name);
  }

  saveProfile(name: string, profile: Profile, credential: Credential, makeDefault: boolean) {
    this.store.set(name, credential);
    this.config = loadConfig(this.env);
    this.config.profiles[name] = profile;
    if (makeDefault || !this.config.defaultProfile) this.config.defaultProfile = name;
    saveConfig(this.config, this.env);
  }

  updateProfile(name: string, change: (profile: Profile) => Profile) {
    this.config = loadConfig(this.env);
    const profile = this.config.profiles[name];
    if (!profile) return;
    this.config.profiles[name] = change(profile);
    saveConfig(this.config, this.env);
  }

  setDefault(name: string) {
    if (!this.config.profiles[name]) {
      throw new RwError("usage", `There's no profile called "${name}"`, { hint: "See your profiles: rw profile list" });
    }
    this.config.defaultProfile = name;
    saveConfig(this.config, this.env);
  }

  removeProfile(name: string) {
    this.store.delete(name);
    delete this.config.profiles[name];
    if (this.config.defaultProfile === name) {
      const rest = Object.keys(this.config.profiles);
      this.config.defaultProfile = rest.length === 1 ? rest[0] : undefined;
    }
    saveConfig(this.config, this.env);
  }
}
