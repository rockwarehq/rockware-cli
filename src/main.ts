#!/usr/bin/env node
import { CommanderError } from "commander";
import { processIO } from "./context.js";
import { RwError, toRwError } from "./errors.js";
import { styleFor } from "./format.js";
import { printError, resolveMode } from "./output.js";
import { buildProgram } from "./program.js";

// rw's entry point. Runs one command, and turns any failure into the error
// envelope (or a readable message) and its exit code.

export async function main(argv: string[]): Promise<number> {
  const io = processIO();
  const program = buildProgram(() => io);
  // Worked out before parsing, so even a usage mistake answers in the right form.
  const mode = resolveMode(
    { json: argv.includes("--json"), quiet: argv.includes("-q") || argv.includes("--quiet") },
    io.stdoutIsTTY,
  );
  const style = styleFor({ color: !argv.includes("--no-color"), isTTY: io.stderrIsTTY, env: io.env });
  try {
    await program.parseAsync(argv, { from: "user" });
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version print and finish; that's success.
      // A bare group (`rw stations`) shows its help too.
      if (["commander.helpDisplayed", "commander.version", "commander.help"].includes(error.code)) return 0;
      const message = error.message.replace(/^error: /, "");
      printError(new RwError("usage", message, { hint: "See how: rw <command> --help" }), mode, io, style.red);
      return 2;
    }
    const rw = toRwError(error);
    printError(rw, mode, io, style.red);
    return rw.exitCode;
  }
}

process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
