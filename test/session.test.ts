import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileNameFor, resolveHost } from "../src/config.js";
import { credentialStore } from "../src/credentials.js";
import { Session } from "../src/session.js";

const freshEnv = () => ({ RW_CONFIG_DIR: mkdtempSync(join(tmpdir(), "rw-test-")), RW_NO_KEYRING: "1" });

describe("hosts", () => {
  it("turns a tenant into its API host", () => {
    expect(resolveHost("acme")).toBe("https://acme-api.rockware.io");
    expect(resolveHost("initech-west")).toBe("https://initech-west-api.rockware.io");
    expect(resolveHost("https://acme-api.rockware.io/")).toBe("https://acme-api.rockware.io");
    expect(resolveHost("acme-api.rockware.io")).toBe("https://acme-api.rockware.io");
    expect(resolveHost("http://localhost:30000")).toBe("http://localhost:30000");
  });

  it("only allows http on this computer", () => {
    expect(() => resolveHost("http://acme-api.rockware.io")).toThrow(/https/);
    expect(() => resolveHost("ftp://example.com")).toThrow();
  });

  it("names a profile after its tenant", () => {
    expect(profileNameFor("https://acme-api.rockware.io")).toBe("acme");
    expect(profileNameFor("http://localhost:30000")).toBe("local");
  });
});

describe("profiles", () => {
  const token = { kind: "token" as const, token: "rw_app_x" };
  const profile = (host: string) => ({ host, auth: "token" as const });

  it("asks you to sign in when there are none", () => {
    expect(() => new Session({ env: freshEnv() }).current()).toThrow(/not signed in/);
  });

  it("uses the only one, then the default, then --profile", () => {
    const env = freshEnv();
    new Session({ env }).saveProfile("acme", profile("https://acme-api.rockware.io"), token, false);
    expect(new Session({ env }).current().name).toBe("acme");

    new Session({ env }).saveProfile("globex", profile("https://globex-api.rockware.io"), token, false);
    expect(new Session({ env }).current().name).toBe("acme");
    new Session({ env }).setDefault("globex");
    expect(new Session({ env }).current().name).toBe("globex");
    expect(new Session({ env, profile: "acme" }).current().name).toBe("acme");
    expect(new Session({ env: { ...env, RW_PROFILE: "acme" } }).current().name).toBe("acme");
    expect(() => new Session({ env, profile: "nope" }).current()).toThrow(/no profile called "nope"/);
  });

  it("lets RW_TOKEN and RW_HOST run without a saved profile", async () => {
    const session = new Session({ env: { ...freshEnv(), RW_TOKEN: "rw_app_env", RW_HOST: "acme" } });
    expect(session.current().profile.host).toBe("https://acme-api.rockware.io");
    expect(await session.accessToken()).toBe("rw_app_env");
  });

  it("keeps secrets in a file only you can read when there's no keychain", () => {
    const env = freshEnv();
    const store = credentialStore(env);
    expect(store.backend).toBe("file");
    store.set("acme", token);
    expect(store.get("acme")).toEqual(token);
    expect(statSync(join(env.RW_CONFIG_DIR, "credentials.json")).mode & 0o777).toBe(0o600);
    store.delete("acme");
    expect(store.get("acme")).toBeNull();
  });

  it("forgets a removed profile and moves the default", () => {
    const env = freshEnv();
    const session = new Session({ env });
    session.saveProfile("a", profile("https://a-api.rockware.io"), token, false);
    session.saveProfile("b", profile("https://b-api.rockware.io"), token, false);
    session.removeProfile("a");
    const after = new Session({ env });
    expect(Object.keys(after.profiles)).toEqual(["b"]);
    expect(after.defaultProfile).toBe("b");
    expect(after.credential("a")).toBeNull();
  });
});
