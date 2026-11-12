import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { ApiClient } from "./api/client.js";
import { RwError } from "./errors.js";
import { type Style, styleFor } from "./format.js";
import { type OutputMode, type OutputStreams, printResult, type Result, resolveMode } from "./output.js";
import { Session } from "./session.js";

// What a command gets to work with: how to answer (mode, style), who it runs
// as (session), and the API. One per run.

export interface GlobalFlags {
  profile?: string;
  json?: boolean;
  quiet?: boolean;
  color?: boolean;
}

export interface IO extends OutputStreams {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  env: NodeJS.ProcessEnv;
}

export const processIO = (): IO => ({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  stderrIsTTY: Boolean(process.stderr.isTTY),
  env: process.env,
});

export class Context {
  readonly mode: OutputMode;
  readonly style: Style;
  readonly session: Session;
  private client?: ApiClient;

  constructor(
    readonly io: IO,
    readonly flags: GlobalFlags,
  ) {
    this.mode = resolveMode(flags, io.stdoutIsTTY);
    this.style = styleFor({ color: flags.color !== false, isTTY: io.stdoutIsTTY, env: io.env });
    this.session = new Session({ profile: flags.profile, env: io.env });
  }

  /** The developer API, as the current profile. */
  api(): ApiClient {
    if (!this.client) {
      const { name, profile } = this.session.current();
      const credential = this.io.env.RW_TOKEN ? null : this.session.credential(name);
      this.client = new ApiClient({
        host: profile.host,
        accessToken: (options) => this.session.accessToken(options),
        canRefresh: credential?.kind === "oauth",
      });
    }
    return this.client;
  }

  /** Whether rw may stop and ask the person something. */
  get interactive(): boolean {
    return Boolean(this.io.stdin.isTTY) && this.io.stderrIsTTY && !this.io.env.RW_NONINTERACTIVE;
  }

  /** A note for people, on stderr so it never mixes with the answer. */
  note(text: string) {
    if (this.mode === "human" || this.io.stderrIsTTY) this.io.stderr.write(`${text}\n`);
  }

  /** Ask yes or no on stderr. Only call when interactive. */
  async confirm(question: string): Promise<boolean> {
    const answer = await this.prompt(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  }

  async prompt(question: string, options: { hidden?: boolean } = {}): Promise<string> {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({
      input: this.io.stdin as NodeJS.ReadStream,
      output: this.io.stderr as NodeJS.WriteStream,
      terminal: true,
    });
    if (options.hidden) {
      // Print nothing as the person types or pastes.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
    try {
      return await new Promise<string>((resolve) => {
        this.io.stderr.write(question);
        rl.question("", resolve);
      });
    } finally {
      if (options.hidden) this.io.stderr.write("\n");
      rl.close();
    }
  }

  /** All of stdin, as text. */
  async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.io.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString("utf8");
  }

  /**
   * JSON from --data, a file, or stdin (`-`). Only one, and stdin is read
   * only when asked for, so rw never sits waiting on a pipe nobody filled.
   */
  async readJson(source: { file?: string; data?: string }): Promise<unknown> {
    if (source.file && source.data) throw new RwError("usage", "Give a file or --data, not both");
    let text: string;
    let from: string;
    if (source.data !== undefined) {
      text = source.data;
      from = "--data";
    } else if (source.file === "-") {
      text = await this.readStdin();
      from = "stdin";
    } else if (source.file) {
      try {
        text = readFileSync(source.file, "utf8");
      } catch (error) {
        throw new RwError("usage", `Can't read ${source.file}: ${(error as NodeJS.ErrnoException).code ?? error}`);
      }
      from = source.file;
    } else {
      throw new RwError("usage", "Nothing to send", { hint: "Give a JSON file, `-` for stdin, or --data '<json>'." });
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new RwError("usage", `${from} isn't valid JSON: ${(error as Error).message}`);
    }
  }

  print(result: Result) {
    printResult(result, this.mode, this.io, this.style.dim);
  }
}

// Each command picks its own data type, so the handler returns Result<any>.
export type Handler<O> = (ctx: Context, args: string[], options: O) => Promise<Result<any>>;

/** Wraps a command's handler: builds the context, prints the result. */
export function action<O = Record<string, unknown>>(io: () => IO, handler: Handler<O>) {
  return async (...received: unknown[]) => {
    const command = received[received.length - 1] as Command;
    const all = command.optsWithGlobals() as O & GlobalFlags;
    const args = received.slice(0, -2).flatMap((arg) => (Array.isArray(arg) ? arg : [arg])) as string[];
    const ctx = new Context(io(), all);
    ctx.print(
      await handler(
        ctx,
        args.filter((arg) => arg !== undefined),
        all,
      ),
    );
  };
}
