// Every failure rw reports is an RwError. Its code says what kind of failure
// it is, and each code has its own exit code, so a script (or an agent) can
// tell "sign in again" from "try again later" without reading the message.
//
// The codes and exit codes are part of rw's contract. Don't change one; add
// a new one.

export const EXIT_CODES = {
  error: 1,
  usage: 2,
  not_found: 3,
  auth: 4,
  forbidden: 5,
  rate_limited: 6,
  network: 7,
  api: 8,
  validation: 9,
  cancelled: 130,
} as const;

export type ErrorCode = keyof typeof EXIT_CODES;

/** Codes that are worth trying again, unchanged, a little later. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["rate_limited", "network"]);

export interface RwErrorOptions {
  /** One line on what to do next, often a command to run. */
  hint?: string;
  /** Overrides the code's default. */
  retryable?: boolean;
  /** Machine-readable detail, like the field errors from an upsert. */
  details?: unknown;
}

export class RwError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: RwErrorOptions = {}) {
    super(message);
    this.name = "RwError";
    this.code = code;
    this.hint = options.hint;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.details = options.details;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}

/** Any thrown value as an RwError. Unknown errors keep their message. */
export function toRwError(error: unknown): RwError {
  if (error instanceof RwError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new RwError("error", message);
}
