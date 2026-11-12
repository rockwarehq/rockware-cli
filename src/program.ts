import { Command, Option } from "commander";
import { apiCommand } from "./commands/api.js";
import { authCommand } from "./commands/auth.js";
import { commandsCommand } from "./commands/catalog.js";
import { completionCommand } from "./commands/completion.js";
import { doctorCommand } from "./commands/doctor.js";
import { profileCommand } from "./commands/profile.js";
import { recordCommands, siteCommand } from "./commands/records.js";
import { webhooksCommand } from "./commands/webhooks.js";
import { upsertCommands } from "./commands/writes.js";
import { type IO, processIO } from "./context.js";
import { VERSION } from "./version.js";

// rw's command tree. Commands are `rw <noun> <verb>`: `rw stations list`,
// `rw webhooks create`. A noun on its own only shows its help.

export function buildProgram(io: () => IO = processIO): Command {
  const program = new Command("rw")
    .description("Rockware on the command line")
    .version(VERSION, "-v, --version")
    .addOption(new Option("-P, --profile <name>", "Run as this profile").env("RW_PROFILE"))
    .option("--json", "Answer in JSON (the default when piped)")
    .option("-q, --quiet", "Answer with the data alone, as JSON")
    .option("--no-color", "No color, even in a terminal")
    .showSuggestionAfterError()
    .addHelpText(
      "after",
      "\nStart here:\n  rw auth login --host <tenant>   Sign in through your browser\n  rw stations list                List the plant's stations\n  rw commands                     Every command\n  rw doctor                       Check your setup",
    );

  program.addCommand(authCommand(io));
  program.addCommand(profileCommand(io));
  program.addCommand(siteCommand(io));
  for (const group of recordCommands(io)) {
    const upsert = upsertCommands[group.name()];
    if (upsert) group.addCommand(upsert(io));
    program.addCommand(group);
  }
  program.addCommand(webhooksCommand(io));
  program.addCommand(apiCommand(io));
  program.addCommand(doctorCommand(io));
  program.addCommand(commandsCommand(io, () => program));
  program.addCommand(completionCommand(io, () => program));

  // Usage mistakes become RwErrors in main.ts, so they answer like any other
  // failure (commander doesn't print them or exit).
  for (const command of [program, ...allCommands(program)]) {
    command.exitOverride();
    command.configureOutput({ outputError: () => {} });
  }
  return program;
}

function allCommands(command: Command): Command[] {
  return command.commands.flatMap((sub) => [sub, ...allCommands(sub)]);
}
