import type { RwError } from "./errors.js";

// How rw answers. Every command returns a Result, and this file prints it.
//
// - In a terminal, people get readable text: a table or a list of fields, a
//   one-line summary, and the commands that make sense next.
// - Piped, or with --json, the answer is one JSON envelope:
//     { ok: true, data, summary, breadcrumbs }
//     { ok: false, error, code, retryable, hint, details }
// - With --quiet, it is the data alone, as JSON.
//
// The envelope's fields are rw's contract with scripts and agents. Their
// order is not.

export type OutputMode = "human" | "json" | "quiet";

/** A command that makes sense next, like `rw stations show <id>`. */
export interface Breadcrumb {
  action: string;
  cmd: string;
}

export interface Result<T = unknown> {
  data: T;
  /** One line a person reads first: "12 stations". */
  summary?: string;
  breadcrumbs?: Breadcrumb[];
  /** The readable form of data. Without it, people get the JSON too. */
  human?: (data: T) => string;
}

export interface OutputStreams {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

export function resolveMode(flags: { json?: boolean; quiet?: boolean }, stdoutIsTTY: boolean): OutputMode {
  if (flags.quiet) return "quiet";
  if (flags.json || !stdoutIsTTY) return "json";
  return "human";
}

export function envelope<T>(result: Result<T>) {
  return {
    ok: true as const,
    data: result.data,
    ...(result.summary ? { summary: result.summary } : {}),
    breadcrumbs: result.breadcrumbs ?? [],
  };
}

export function errorEnvelope(error: RwError) {
  return {
    ok: false as const,
    error: error.message,
    code: error.code,
    retryable: error.retryable,
    ...(error.hint ? { hint: error.hint } : {}),
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}

export function printResult<T>(result: Result<T>, mode: OutputMode, streams: OutputStreams, dim = (s: string) => s) {
  if (mode === "quiet") {
    streams.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
    return;
  }
  if (mode === "json") {
    streams.stdout.write(`${JSON.stringify(envelope(result), null, 2)}\n`);
    return;
  }
  const body = result.human ? result.human(result.data) : JSON.stringify(result.data, null, 2);
  if (body) streams.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
  if (result.summary) streams.stdout.write(`${dim(result.summary)}\n`);
  const crumbs = result.breadcrumbs ?? [];
  if (crumbs.length > 0) {
    streams.stdout.write(`\n${dim("Next:")}\n`);
    for (const crumb of crumbs) streams.stdout.write(`  ${crumb.cmd}  ${dim(`# ${crumb.action}`)}\n`);
  }
}

export function printError(error: RwError, mode: OutputMode, streams: OutputStreams, red = (s: string) => s) {
  if (mode !== "human") {
    // On stdout, so whatever reads the JSON gets the failure too.
    streams.stdout.write(`${JSON.stringify(errorEnvelope(error), null, 2)}\n`);
    return;
  }
  streams.stderr.write(`${red("Error:")} ${error.message}\n`);
  const details = error.details;
  if (Array.isArray(details)) {
    for (const item of details) streams.stderr.write(`  - ${describeDetail(item)}\n`);
  }
  if (error.hint) streams.stderr.write(`${error.hint}\n`);
}

function describeDetail(item: unknown): string {
  if (item && typeof item === "object" && "message" in item) {
    const { field, message, code } = item as { field?: string | null; message: string; code?: string };
    return `${field ? `${field}: ` : ""}${message}${code ? ` (${code})` : ""}`;
  }
  return String(item);
}
