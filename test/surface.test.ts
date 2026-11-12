import { expect, it } from "vitest";
import { catalog, globalOptions } from "../src/commands/catalog.js";
import { buildProgram } from "../src/program.js";

// rw's surface: every command, argument and flag, one per line, kept in
// surface.txt. Scripts and agents depend on these, so removing or renaming
// one should be on purpose. When this fails:
// - you added something: update the snapshot (vitest -u) and commit it;
// - you removed or renamed something: that breaks people's scripts. Say so
//   in the PR, and in the release notes.

it("matches surface.txt", async () => {
  const program = buildProgram();
  const lines = [
    ...globalOptions(program).map((option) => `rw ${option.flags}`),
    ...catalog(program).flatMap((entry) => [
      `rw ${entry.command}`,
      ...entry.arguments.map((arg) => `rw ${entry.command} ${arg.required ? `<${arg.name}>` : `[${arg.name}]`}`),
      ...entry.options.map((option) => `rw ${entry.command} ${option.flags}`),
    ]),
  ];
  await expect(`${lines.join("\n")}\n`).toMatchFileSnapshot("../surface.txt");
});
