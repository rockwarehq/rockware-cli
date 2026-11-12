import { Command } from "commander";
import { action, type IO } from "../context.js";
import { table } from "../format.js";

// rw commands: every command, its arguments and flags, read from the command
// tree itself. Agents read it with --json instead of guessing. The same list
// makes the shell completions, and the surface test keeps it from changing
// by accident.

export interface CatalogEntry {
  command: string;
  description: string;
  arguments: Array<{ name: string; required: boolean; description: string }>;
  options: Array<{ flags: string; description: string; choices?: readonly string[] }>;
}

/** Every command that does something (not the groups), in order. */
export function catalog(program: Command): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const walk = (command: Command, path: string[]) => {
    for (const sub of command.commands) {
      const here = [...path, sub.name()];
      if (sub.commands.length > 0) {
        walk(sub, here);
        continue;
      }
      entries.push({
        command: here.join(" "),
        description: sub.description(),
        arguments: sub.registeredArguments.map((arg) => ({
          name: arg.name(),
          required: arg.required,
          description: arg.description,
        })),
        options: sub.options.map((option) => ({
          flags: option.flags,
          description: option.description,
          ...(option.argChoices ? { choices: option.argChoices } : {}),
        })),
      });
    }
  };
  walk(program, []);
  return entries;
}

/** The global flags every command takes. */
export function globalOptions(program: Command) {
  return program.options.map((option) => ({ flags: option.flags, description: option.description }));
}

export function commandsCommand(io: () => IO, program: () => Command): Command {
  return new Command("commands").description("List every command, with its arguments and flags").action(
    action(io, async (ctx) => {
      const entries = catalog(program());
      return {
        data: { commands: entries, globalOptions: globalOptions(program()) },
        summary: `${entries.length} commands. Help for one: rw <command> --help`,
        human: () =>
          table(
            entries,
            [
              { header: "COMMAND", value: (entry) => `rw ${entry.command}` },
              { header: "WHAT IT DOES", value: (entry) => entry.description },
            ],
            ctx.style,
          ),
      };
    }),
  );
}
