import { existsSync } from "node:fs";
import { Command } from "commander";
import { SITE } from "../api/queries.js";
import { configPath, loadConfig } from "../config.js";
import { action, type Context, type IO } from "../context.js";
import { toRwError } from "../errors.js";
import { discover } from "../oauth.js";
import { VERSION } from "../version.js";

// rw doctor: check each thing rw needs, in order, and say how to fix the
// first one that's wrong. Exits 1 when any check fails.

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

async function runChecks(ctx: Context): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (check: Check) => {
    checks.push(check);
    return check.ok;
  };

  add({ name: "rw", ok: true, detail: `version ${VERSION}, ${process.platform}-${process.arch}` });

  const path = configPath(ctx.io.env);
  try {
    loadConfig(ctx.io.env);
    add({ name: "config", ok: true, detail: existsSync(path) ? path : `${path} (not made yet)` });
  } catch (error) {
    add({ name: "config", ok: false, detail: toRwError(error).message, hint: toRwError(error).hint });
    return checks;
  }

  let current: ReturnType<Context["session"]["current"]>;
  try {
    current = ctx.session.current();
    add({ name: "profile", ok: true, detail: `${current.name} → ${current.profile.host}` });
  } catch (error) {
    add({ name: "profile", ok: false, detail: toRwError(error).message, hint: toRwError(error).hint });
    return checks;
  }

  if (ctx.io.env.RW_TOKEN) {
    add({ name: "sign-in", ok: true, detail: "RW_TOKEN is set, and used instead of the saved sign-in" });
  } else {
    const credential = ctx.session.credential(current.name);
    const signedIn = add({
      name: "sign-in",
      ok: credential !== null,
      detail: credential
        ? `${credential.kind === "oauth" ? "browser" : "API token"}, kept in ${ctx.session.store.backend}`
        : "not signed in",
      hint: credential ? undefined : `Sign in: rw auth login -P ${current.name}`,
    });
    if (!signedIn) return checks;
  }

  if (current.profile.auth === "oauth") {
    try {
      await discover(current.profile.host);
      add({ name: "host", ok: true, detail: `${current.profile.host} answers` });
    } catch (error) {
      add({ name: "host", ok: false, detail: toRwError(error).message, hint: toRwError(error).hint });
      return checks;
    }
  }

  try {
    const { site } = await ctx.api().request<{ site: { id: string; name: string } | null }>(SITE);
    add({ name: "api", ok: Boolean(site), detail: site ? `signed in to ${site.name} (${site.id})` : "no plant" });
  } catch (error) {
    const rw = toRwError(error);
    add({ name: "api", ok: false, detail: rw.message, hint: rw.hint });
  }
  return checks;
}

export function doctorCommand(io: () => IO): Command {
  return new Command("doctor").description("Check that rw is set up and can reach Rockware").action(
    action(io, async (ctx) => {
      const checks = await runChecks(ctx);
      const failed = checks.filter((check) => !check.ok);
      if (failed.length > 0) process.exitCode = 1;
      return {
        data: { ok: failed.length === 0, checks },
        summary:
          failed.length === 0 ? "Everything looks good." : `${failed.length} problem${failed.length === 1 ? "" : "s"}.`,
        human: () =>
          checks
            .map(
              (check) =>
                `${check.ok ? ctx.style.green("✓") : ctx.style.red("✗")} ${check.name.padEnd(8)} ${check.detail}` +
                (check.hint ? `\n  ${ctx.style.dim(check.hint)}` : ""),
            )
            .join("\n"),
      };
    }),
  );
}
