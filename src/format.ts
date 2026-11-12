// Readable text for people in a terminal: tables, lists of fields, color.
// Only human output uses this. JSON output never has color or padding.

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
}

const plain: Style = { bold: (s) => s, dim: (s) => s, red: (s) => s, green: (s) => s, yellow: (s) => s };

const ansi = (open: number, close: number) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;

const colored: Style = {
  bold: ansi(1, 22),
  dim: ansi(2, 22),
  red: ansi(31, 39),
  green: ansi(32, 39),
  yellow: ansi(33, 39),
};

/** Color only in a terminal, and never when NO_COLOR is set (no-color.org). */
export function styleFor(options: { color: boolean; isTTY: boolean; env: NodeJS.ProcessEnv }): Style {
  if (!options.color || !options.isTTY || options.env.NO_COLOR) return plain;
  return colored;
}

export interface Column<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Rows as a padded table. Empty cells show as "-". */
export function table<T>(rows: readonly T[], columns: readonly Column<T>[], style: Style = plain): string {
  if (rows.length === 0) return style.dim("Nothing found.");
  const cells = rows.map((row) => columns.map((column) => cell(column.value(row))));
  const widths = columns.map((column, i) =>
    Math.max(column.header.length, ...cells.map((line) => (line[i] ?? "").length)),
  );
  const pad = (text: string, i: number) => (i === columns.length - 1 ? text : text.padEnd(widths[i] ?? 0));
  const header = columns.map((column, i) => style.bold(pad(column.header, i))).join("  ");
  const body = cells.map((line) => line.map(pad).join("  "));
  return [header, ...body].join("\n");
}

/** One record as "label  value" lines. Nested lists are shown as counts. */
export function fields(record: Record<string, unknown>, style: Style = plain): string {
  const entries = Object.entries(record);
  const width = Math.max(...entries.map(([key]) => key.length));
  return entries.map(([key, value]) => `${style.dim(key.padEnd(width))}  ${cell(value)}`).join("\n");
}

export function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== "object" || item === null)) return value.join(", ");
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }
  if (typeof value === "object") {
    const named = value as { name?: unknown; id?: unknown };
    if (typeof named.name === "string") return named.name;
    if (typeof named.id === "string") return named.id;
    return JSON.stringify(value);
  }
  return String(value);
}
