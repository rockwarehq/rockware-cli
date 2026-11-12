import { Command } from "commander";
import { action, type IO } from "../context.js";
import { RwError } from "../errors.js";
import { table } from "../format.js";
import { revoke } from "../oauth.js";

// rw profile: the Rockwares you've signed in to. One profile is one host and
// one plant.

export function profileCommand(io: () => IO): Command {
  const profile = new Command("profile").description("Switch between the Rockwares you've signed in to");

  profile
    .command("list")
    .description("List your profiles")
    .action(
      action(io, async (ctx) => {
        const current = ctx.session.profileName();
        const rows = Object.entries(ctx.session.profiles).map(([name, p]) => ({
          name,
          host: p.host,
          auth: p.auth,
          site: p.site ?? null,
          default: name === ctx.session.defaultProfile,
          current: name === current,
          signedIn: ctx.session.credential(name) !== null,
        }));
        return {
          data: rows,
          summary: rows.length === 1 ? "1 profile" : `${rows.length} profiles`,
          breadcrumbs: rows.length === 0 ? [{ action: "Sign in", cmd: "rw auth login --host <tenant>" }] : [],
          human: () =>
            table(
              rows,
              [
                { header: "", value: (row) => (row.current ? "*" : "") },
                { header: "NAME", value: (row) => row.name },
                { header: "HOST", value: (row) => row.host },
                { header: "PLANT", value: (row) => row.site?.name },
                {
                  header: "SIGNED IN",
                  value: (row) => (row.signedIn ? (row.auth === "oauth" ? "browser" : "API token") : "no"),
                },
              ],
              ctx.style,
            ),
        };
      }),
    );

  profile
    .command("use")
    .description("Make a profile the default")
    .argument("<name>", "The profile")
    .action(
      action(io, async (ctx, [name]) => {
        ctx.session.setDefault(name as string);
        return { data: { defaultProfile: name }, summary: `"${name}" is now the default profile.`, human: () => "" };
      }),
    );

  profile
    .command("remove")
    .description("Forget a profile and its saved sign-in")
    .argument("<name>", "The profile")
    .action(
      action(io, async (ctx, [name]) => {
        if (!ctx.session.profiles[name as string]) {
          throw new RwError("not_found", `There's no profile called "${name}"`, {
            hint: "See your profiles: rw profile list",
          });
        }
        const credential = ctx.session.credential(name as string);
        const revoked = credential?.kind === "oauth" ? await revoke(credential) : false;
        ctx.session.removeProfile(name as string);
        return { data: { removed: name, revoked }, summary: `Removed "${name}".`, human: () => "" };
      }),
    );

  return profile;
}
