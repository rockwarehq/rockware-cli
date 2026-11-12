import { Command } from "commander";
import { UPSERT_MATERIALS, UPSERT_ORDER, UPSERT_PRODUCTS } from "../api/queries.js";
import { action, type Context, type IO } from "../context.js";
import { RwError } from "../errors.js";
import { table } from "../format.js";
import type { Result } from "../output.js";

// rw <records> upsert: send records in from your own system. Each record is
// matched by its externalId: made the first time, updated after that, so
// sending the same file again is safe. Nothing here decides anything: the
// API's own checks and error codes come back as they are.

/** The API takes at most this many in one call, all or nothing. */
const MAX_BATCH = 100;

interface UpsertError {
  field: string | null;
  code: string;
  message: string;
}

interface WriteOptions {
  data?: string;
  source?: string;
}

/** A list of records from `[...]`, `{ "<key>": [...] }`, or one record. */
function asList(input: unknown, key: string): Record<string, unknown>[] {
  const list = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as Record<string, unknown>)[key])
      ? ((input as Record<string, unknown>)[key] as unknown[])
      : [input];
  if (list.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new RwError("usage", `Each of the ${key} must be a JSON object`);
  }
  return list as Record<string, unknown>[];
}

function failIfErrors(errors: UpsertError[], what: string) {
  if (errors.length === 0) return;
  throw new RwError(
    "validation",
    `Nothing was saved: ${errors.length === 1 ? "1 problem" : `${errors.length} problems`} with the ${what}`,
    {
      hint: "Fix them and send the whole list again.",
      details: errors,
    },
  );
}

function tally(actions: string[]): string {
  const counts = new Map<string, number>();
  for (const a of actions) counts.set(a, (counts.get(a) ?? 0) + 1);
  return ["CREATED", "UPDATED", "UNCHANGED"]
    .filter((a) => counts.has(a))
    .map((a) => `${counts.get(a)} ${a.toLowerCase()}`)
    .join(", ");
}

async function upsertBatch(
  ctx: Context,
  options: WriteOptions & { file?: string },
  spec: {
    key: "materials" | "products";
    mutation: string;
    field: "upsertMaterials" | "upsertProducts";
    record: "material" | "product";
  },
): Promise<Result<any>> {
  const rows = asList(await ctx.readJson({ file: options.file, data: options.data }), spec.key);
  if (rows.length === 0) throw new RwError("usage", `No ${spec.key} to send`);
  if (rows.length > MAX_BATCH) {
    throw new RwError("usage", `At most ${MAX_BATCH} ${spec.key} at a time; this has ${rows.length}`, {
      hint: `Split the file into lists of ${MAX_BATCH} or fewer. Each call is all or nothing.`,
    });
  }
  const result = await ctx
    .api()
    .request<Record<string, { results: Array<Record<string, any>>; errors: UpsertError[] }>>(spec.mutation, {
      source: options.source ?? null,
      [spec.key]: rows,
    });
  const payload = result[spec.field] as { results: Array<Record<string, any>>; errors: UpsertError[] };
  failIfErrors(payload.errors, spec.key);
  return {
    data: payload.results,
    summary: tally(payload.results.map((row) => row.action)),
    breadcrumbs: [
      {
        action: `See the ${spec.key}`,
        cmd: `rw ${spec.key} list --updated-since ${new Date(Date.now() - 60_000).toISOString()}`,
      },
    ],
    human: () =>
      table(
        payload.results,
        [
          { header: "ACTION", value: (row) => row.action },
          { header: "EXTERNAL ID", value: (row) => row.externalId },
          { header: "ID", value: (row) => row[spec.record]?.id },
          { header: "NAME", value: (row) => row[spec.record]?.name },
        ],
        ctx.style,
      ),
  };
}

async function upsertOrder(ctx: Context, options: WriteOptions & { file?: string }): Promise<Result<any>> {
  const input = await ctx.readJson({ file: options.file, data: options.data });
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RwError("usage", "An order is one JSON object", { hint: "Send orders one at a time." });
  }
  const order = ((input as Record<string, unknown>).order ?? input) as Record<string, unknown>;
  const { upsertOrder: payload } = await ctx.api().request<{
    upsertOrder: { action: string | null; order: Record<string, any> | null; errors: UpsertError[] };
  }>(UPSERT_ORDER, { source: options.source ?? null, order });
  failIfErrors(payload.errors, "order");
  return {
    data: payload,
    summary: `Order ${payload.order?.orderNumber ?? ""} ${(payload.action ?? "").toLowerCase()}`.trim(),
    breadcrumbs: payload.order ? [{ action: "Show the order", cmd: `rw orders show ${payload.order.id}` }] : [],
    human: () => "",
  };
}

const SOURCE_HELP = 'The system the ids come from, like "erp" (the default). Use the same one every time';

function writeCommand(
  name: string,
  description: string,
  run: (ctx: Context, options: WriteOptions & { file?: string }) => Promise<Result<any>>,
) {
  return (io: () => IO) =>
    new Command("upsert")
      .description(description)
      .argument("[file]", "A JSON file, or - for stdin")
      .option("--data <json>", "The JSON itself, instead of a file")
      .option("--source <name>", SOURCE_HELP)
      .addHelpText("after", `\nExample:\n  rw ${name} upsert ${name}.json --source erp`)
      .action(action<WriteOptions>(io, (ctx, [file], options) => run(ctx, { ...options, file })));
}

/** The `upsert` subcommand for each group that has one, by group name. */
export const upsertCommands: Record<string, (io: () => IO) => Command> = {
  materials: writeCommand(
    "materials",
    `Send up to ${MAX_BATCH} materials, matched by externalId. All or nothing`,
    (ctx, options) =>
      upsertBatch(ctx, options, {
        key: "materials",
        mutation: UPSERT_MATERIALS,
        field: "upsertMaterials",
        record: "material",
      }),
  ),
  products: writeCommand(
    "products",
    `Send up to ${MAX_BATCH} products with their bills of materials. Send materials first`,
    (ctx, options) =>
      upsertBatch(ctx, options, {
        key: "products",
        mutation: UPSERT_PRODUCTS,
        field: "upsertProducts",
        record: "product",
      }),
  ),
  orders: writeCommand("orders", "Send one order, with its customer and lines", upsertOrder),
};
