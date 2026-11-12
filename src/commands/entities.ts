import { Command } from "commander";
import {
  ENTITY_MODEL,
  ENTITY_MODELS,
  ENTITY_RECORD,
  ENTITY_RECORDS,
  UPSERT_ENTITY_MODELS,
  UPSERT_ENTITY_RECORDS,
} from "../api/queries.js";
import { action, type Context, type IO } from "../context.js";
import { RwError } from "../errors.js";
import { fields, table } from "../format.js";
import type { Breadcrumb, Result } from "../output.js";
import { type ListOptions, listOptions, readPages } from "./records.js";
import { SOURCE_HELP, upsertBatch, type WriteOptions } from "./writes.js";

// Custom entities: the plant's own kinds of record (gauges, molds' history,
// anything). They all have one general shape: `rw entities` for the kinds and
// their fields, by key, and `rw entity-records` for their records, with
// values as JSON. Records are matched by externalId, never by name.

const MAX_BATCH = 100;

function upsertOptions(command: Command, withSource: boolean): Command {
  command
    .argument("[file]", "A JSON file, or - for stdin")
    .option("--data <json>", "The JSON itself, instead of a file");
  if (withSource) command.option("--source <name>", SOURCE_HELP);
  return command;
}

export function entitiesCommand(io: () => IO): Command {
  const group = new Command("entities").description(
    "Custom entities: the plant's own kinds of record, and their fields",
  );

  group
    .command("list")
    .description("List custom entities, with their fields")
    .action(
      action(io, async (ctx): Promise<Result<any>> => {
        const { entityModels } = await ctx.api().request<{ entityModels: Array<Record<string, any>> }>(ENTITY_MODELS);
        const first = entityModels[0];
        return {
          data: entityModels,
          summary: `${entityModels.length} ${entityModels.length === 1 ? "entity" : "entities"}`,
          breadcrumbs: first
            ? [
                { action: "Show one entity", cmd: `rw entities show ${first.key}` },
                { action: "List its records", cmd: `rw entity-records list ${first.key}` },
              ]
            : [{ action: "Make one", cmd: "rw entities upsert entities.json" }],
          human: (data) =>
            table(
              data,
              [
                { header: "KEY", value: (model: Record<string, any>) => model.key },
                { header: "LABEL", value: (model: Record<string, any>) => model.label },
                {
                  header: "FIELDS",
                  value: (model: Record<string, any>) => model.fields.map((f: { key: string }) => f.key).join(", "),
                },
              ],
              ctx.style,
            ),
        };
      }),
    );

  group
    .command("show")
    .description("Show one custom entity and its fields")
    .argument("<key>", "The entity's key, like gauge")
    .action(
      action(io, async (ctx, [key]): Promise<Result<any>> => {
        const { entityModel } = await ctx
          .api()
          .request<{ entityModel: Record<string, any> | null }>(ENTITY_MODEL, { key });
        if (!entityModel) {
          throw new RwError("not_found", `No custom entity ${key} at this plant`, {
            hint: "Find its key: rw entities list",
          });
        }
        return {
          data: entityModel,
          summary: `${entityModel.label}: ${entityModel.fields.length} fields`,
          breadcrumbs: [{ action: "List its records", cmd: `rw entity-records list ${key}` }],
          human: (data) =>
            table(
              data.fields,
              [
                { header: "KEY", value: (field: Record<string, any>) => field.key },
                { header: "LABEL", value: (field: Record<string, any>) => field.label },
                {
                  header: "TYPE",
                  value: (field: Record<string, any>) =>
                    `${field.type}${field.isList ? " list" : ""}${field.refModel ? ` → ${field.refModel}` : ""}`,
                },
                { header: "REQUIRED", value: (field: Record<string, any>) => (field.required ? "yes" : "") },
              ],
              ctx.style,
            ),
        };
      }),
    );

  upsertOptions(
    group
      .command("upsert")
      .description(
        `Make or change up to ${MAX_BATCH} custom entities and their fields, by key. Fields not listed are left alone`,
      ),
    false,
  )
    .addHelpText("after", "\nExample:\n  rw entities upsert entities.json")
    .action(
      action<WriteOptions>(io, (ctx, [file], options) =>
        upsertBatch(
          ctx,
          { ...options, file },
          {
            key: "models",
            mutation: UPSERT_ENTITY_MODELS,
            field: "upsertEntityModels",
            record: "model",
            listCmd: "rw entities list",
            source: false,
          },
        ).then((result) => ({ ...result, breadcrumbs: [{ action: "See them", cmd: "rw entities list" }] })),
      ),
    );

  return group;
}

export function entityRecordsCommand(io: () => IO): Command {
  const group = new Command("entity-records").description("Records of a custom entity, with their values as JSON");

  listOptions(
    group
      .command("list")
      .description("List one custom entity's records")
      .argument("<model>", "The entity's key, like gauge"),
  ).action(
    action<ListOptions>(io, async (ctx: Context, [model], options): Promise<Result<any>> => {
      const { rows, after, more } = await readPages(ctx, ENTITY_RECORDS, "entityRecords", { model }, options);
      const breadcrumbs: Breadcrumb[] = [];
      const first = rows[0];
      if (first) breadcrumbs.push({ action: "Show one record", cmd: `rw entity-records show ${first.id}` });
      if (more && after) {
        breadcrumbs.push({ action: "Get the next page", cmd: `rw entity-records list ${model} --after ${after}` });
      }
      return {
        data: rows,
        summary: `${rows.length} ${rows.length === 1 ? "record" : "records"}${more ? ", and more" : ""}`,
        breadcrumbs,
        human: (data) =>
          table(
            data,
            [
              { header: "ID", value: (row: Record<string, any>) => row.id },
              { header: "NAME", value: (row: Record<string, any>) => row.name },
              { header: "OUTSIDE IDS", value: (row: Record<string, any>) => row.externalIds },
              { header: "VALUES", value: (row: Record<string, any>) => JSON.stringify(row.values) },
            ],
            ctx.style,
          ),
      };
    }),
  );

  group
    .command("show")
    .description("Show one custom entity record")
    .argument("<id>", "The record's Rockware id")
    .action(
      action(io, async (ctx, [id]): Promise<Result<any>> => {
        const { entityRecord } = await ctx
          .api()
          .request<{ entityRecord: Record<string, any> | null }>(ENTITY_RECORD, { id });
        if (!entityRecord) {
          throw new RwError("not_found", `No custom entity record with id ${id} at this plant`, {
            hint: "Find its id: rw entity-records list <model>",
          });
        }
        return {
          data: entityRecord,
          summary: `${entityRecord.model} ${entityRecord.name}`,
          breadcrumbs: [{ action: "Show its entity", cmd: `rw entities show ${entityRecord.model}` }],
          human: (data) => fields(data, ctx.style),
        };
      }),
    );

  upsertOptions(
    group
      .command("upsert")
      .description(`Send up to ${MAX_BATCH} records of one custom entity, matched by externalId. All or nothing`)
      .argument("<model>", "The entity's key, like gauge"),
    true,
  )
    .addHelpText("after", "\nExample:\n  rw entity-records upsert gauge gauges.json --source erp")
    .action(
      action<WriteOptions>(io, (ctx, [model, file], options) =>
        upsertBatch(
          ctx,
          { ...options, file },
          {
            key: "records",
            mutation: UPSERT_ENTITY_RECORDS,
            field: "upsertEntityRecords",
            record: "record",
            listCmd: `rw entity-records list ${model}`,
            variables: { model },
          },
        ),
      ),
    );

  return group;
}
