import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { configDir, writePrivateFile } from "./config.js";

// Where rw keeps each profile's secret: the operating system's keychain when
// it has one (macOS Keychain, or the Secret Service on Linux), else a file
// only you can read. RW_NO_KEYRING=1 always uses the file.
//
// Secrets go to the keychain tools on stdin, never as arguments, so they
// don't show up in the process list.

export type Credential =
  | {
      kind: "oauth";
      accessToken: string;
      refreshToken: string;
      /** When the access token stops working, in ms since 1970. */
      expiresAt: number;
      scopes: string[];
      clientId: string;
      tokenEndpoint: string;
      revocationEndpoint?: string;
    }
  | { kind: "token"; token: string };

export type Backend = "keychain" | "secret-service" | "file";

const SERVICE = "rw-cli";

export interface CredentialStore {
  readonly backend: Backend;
  get(profile: string): Credential | null;
  set(profile: string, credential: Credential): void;
  delete(profile: string): void;
}

export function credentialStore(env: NodeJS.ProcessEnv = process.env): CredentialStore {
  const file = new FileStore(join(configDir(env), "credentials.json"));
  if (env.RW_NO_KEYRING) return file;
  if (process.platform === "darwin" && has("security")) return new Fallback(new MacKeychain(), file);
  if (process.platform === "linux" && has("secret-tool")) return new Fallback(new SecretService(), file);
  return file;
}

function has(command: string): boolean {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

function parse(text: string | null): Credential | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Credential;
  } catch {
    return null;
  }
}

class FileStore implements CredentialStore {
  readonly backend = "file" as const;
  constructor(private readonly path: string) {}

  private all(): Record<string, Credential> {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, Credential>;
    } catch {
      return {};
    }
  }

  get(profile: string) {
    return this.all()[profile] ?? null;
  }

  set(profile: string, credential: Credential) {
    writePrivateFile(this.path, `${JSON.stringify({ ...this.all(), [profile]: credential }, null, 2)}\n`);
  }

  delete(profile: string) {
    const all = this.all();
    if (!(profile in all)) return;
    delete all[profile];
    if (Object.keys(all).length === 0) rmSync(this.path, { force: true });
    else writePrivateFile(this.path, `${JSON.stringify(all, null, 2)}\n`);
  }
}

// Profile names are checked (lowercase, digits, . _ -), so they are safe to
// put in a `security -i` command line. The secret goes in as hex.
class MacKeychain implements CredentialStore {
  readonly backend = "keychain" as const;

  get(profile: string) {
    const found = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", profile, "-w"], {
      encoding: "utf8",
    });
    return found.status === 0 ? parse(found.stdout.trim()) : null;
  }

  set(profile: string, credential: Credential) {
    const hex = Buffer.from(JSON.stringify(credential), "utf8").toString("hex");
    const command = `add-generic-password -U -s ${SERVICE} -a ${profile} -l "rw (${profile})" -X ${hex}\n`;
    const saved = spawnSync("security", ["-i"], { input: command, encoding: "utf8" });
    if (saved.status !== 0 || /error/i.test(saved.stderr)) {
      throw new Error(`Keychain refused the credential: ${saved.stderr.trim() || "unknown error"}`);
    }
  }

  delete(profile: string) {
    spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", profile], { stdio: "ignore" });
  }
}

class SecretService implements CredentialStore {
  readonly backend = "secret-service" as const;

  get(profile: string) {
    const found = spawnSync("secret-tool", ["lookup", "service", SERVICE, "account", profile], { encoding: "utf8" });
    return found.status === 0 ? parse(found.stdout.trim()) : null;
  }

  set(profile: string, credential: Credential) {
    const saved = spawnSync(
      "secret-tool",
      ["store", "--label", `rw (${profile})`, "service", SERVICE, "account", profile],
      { input: JSON.stringify(credential), encoding: "utf8" },
    );
    if (saved.status !== 0) throw new Error(`Secret Service refused the credential: ${saved.stderr.trim()}`);
  }

  delete(profile: string) {
    spawnSync("secret-tool", ["clear", "service", SERVICE, "account", profile], { stdio: "ignore" });
  }
}

/**
 * The keychain, falling back to the file when the keychain can't be used
 * (no desktop session over SSH, a locked keychain). Reads look in both.
 */
class Fallback implements CredentialStore {
  private used: Backend;
  constructor(
    private readonly primary: CredentialStore,
    private readonly file: FileStore,
  ) {
    this.used = primary.backend;
  }

  get backend() {
    return this.used;
  }

  get(profile: string) {
    const found = this.primary.get(profile);
    if (found) return found;
    const filed = this.file.get(profile);
    if (filed) this.used = "file";
    return filed;
  }

  set(profile: string, credential: Credential) {
    try {
      this.primary.set(profile, credential);
      this.file.delete(profile);
      this.used = this.primary.backend;
    } catch {
      this.file.set(profile, credential);
      this.used = "file";
    }
  }

  delete(profile: string) {
    this.primary.delete(profile);
    this.file.delete(profile);
  }
}
