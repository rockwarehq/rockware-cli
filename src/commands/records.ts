import { Command, InvalidArgumentError } from "commander";
import { groupOf, listQuery, RECORD_KINDS, type RecordKind, SITE, showQuery } from "../api/queries.js";
import { action, type Context, type IO } from "../context.js";
import { RwError } from "../errors.js";
import { fields, table } from "../format.js";
import type { Breadcrumb, Result } from "../output.js";

// rw <records> list | show: one command group per kind of record in
// RECORD_KINDS. All of them page the same way the API does.

/** The API gives at most this many per page. */
const PAGE_SIZE = 100;
const DEFAULT_LIMIT = 50;

export interface ListOptions {
  limit?: number;
  all?: boolean;
  after?: string;
  updatedSince?: string;
  includeDeleted?: boolean;
}

interface Page {
  nodes: Array<Record<string, any>>;
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
}

/**
 * Read pages of one list until there are `limit` rows or no more. `field` is
 * the query's root field. Shared by every list command.
 */
export async function readPages(
  ctx: Context,
  query: string,
  field: string,
  variables: Record<string, unknown>,
  options: ListOptions,
): Promise<{ rows: Array<Record<string, any>>; after: string | null; more: boolean }> {
  if (options.all && options.limit) throw new RwError("usage", "Use --all or --limit, not both");
  const limit = options.all ? Number.POSITIVE_INFINITY : (options.limit ?? DEFAULT_LIMIT);
  const rows: Array<Record<string, any>> = [];
  let after = options.after ?? null;
  let more = true;
  while (more && rows.length < limit) {
    const result = await ctx.api().request<Record<string, Page>>(query, {
      ...variables,
      first: Math.min(PAGE_SIZE, limit - rows.length),
      after,
      updatedSince: options.updatedSince ?? null,
      includeDeleted: options.includeDeleted ?? false,
    });
    const page = result[field] as Page;
    rows.push(...page.nodes);
    after = page.pageInfo.endCursor;
    more = page.pageInfo.hasNextPage;
  }
  return { rows, after, more };
}

/** The flags every list takes. */
export function listOptions(command: Command): Command {
  return command
    .option("--limit <n>", `How many at most (default ${DEFAULT_LIMIT})`, positiveInt)
    .option("--all", "Every one, page after page")
    .option("--after <cursor>", "Start after this cursor, from a page before")
    .option("--updated-since <time>", "Only ones changed since then", isoTime)
    .option("--include-deleted", "Include deleted ones");
}

export function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Must be a whole number, 1 or more.");
  return n;
}

function isoTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new InvalidArgumentError("Must be a date or time, like 2026-11-01T00:00:00Z.");
  return date.toISOString();
}

/** A kind's name in words: "production run", "production runs". */
const many = (kind: RecordKind) => groupOf(kind).replace(/-/g, " ");
const one = (kind: RecordKind) => kind.singular.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);

async function list(ctx: Context, kind: RecordKind, options: ListOptions): Promise<Result<any>> {
  const { rows, after, more } = await readPages(ctx, listQuery(kind), kind.plural, {}, options);
  const group = groupOf(kind);
  const breadcrumbs: Breadcrumb[] = [];
  const first = rows[0];
  if (first) breadcrumbs.push({ action: `Show one ${one(kind)}`, cmd: `rw ${group} show ${first.id}` });
  // The cursor works later too: pass it to get what changed since this page.
  if (more && after) breadcrumbs.push({ action: "Get the next page", cmd: `rw ${group} list --after ${after}` });

  const word = rows.length === 1 ? one(kind) : many(kind);
  return {
    data: rows,
    summary: `${rows.length} ${word}${more ? ", and more" : ""}`,
    breadcrumbs,
    human: (data) =>
      table(
        data,
        kind.columns.map(([field, header]) => ({ header, value: (row: Record<string, any>) => row[field] })),
        ctx.style,
      ),
  };
}

async function show(ctx: Context, kind: RecordKind, id: string): Promise<Result<any>> {
  const result = await ctx.api().request<Record<string, Record<string, any> | null>>(showQuery(kind), { id });
  const record = result[kind.singular];
  if (!record) {
    throw new RwError("not_found", `No ${one(kind)} with id ${id} at this plant`, {
      hint: `Find its id: rw ${groupOf(kind)} list`,
    });
  }
  return {
    data: record,
    summary: `${one(kind)} ${record.name ?? record.orderNumber ?? record.sku ?? record.id}`,
    breadcrumbs: kind.next?.(record) ?? [],
    human: (data) => fields(data, ctx.style),
  };
}

function recordCommand(io: () => IO, kind: RecordKind): Command {
  const group = new Command(groupOf(kind)).description(kind.description);

  listOptions(group.command("list").description(`List ${many(kind)}`)).action(
    action<ListOptions>(io, (ctx, _args, options) => list(ctx, kind, options)),
  );

  group
    .command("show")
    .description(`Show one ${one(kind)}`)
    .argument("<id>", `The ${one(kind)}'s Rockware id`)
    .action(action(io, (ctx, [id]) => show(ctx, kind, id as string)));

  return group;
}

export function recordCommands(io: () => IO): Command[] {
  return RECORD_KINDS.map((kind) => recordCommand(io, kind));
}

export function siteCommand(io: () => IO): Command {
  return new Command("site").description("Show the plant you're signed in to").action(
    action(io, async (ctx) => {
      const { site } = await ctx.api().request<{ site: Record<string, unknown> | null }>(SITE);
      if (!site) throw new RwError("not_found", "This token isn't tied to a plant");
      return { data: site, summary: String(site.name), human: (data) => fields(data, ctx.style) };
    }),
  );
}
