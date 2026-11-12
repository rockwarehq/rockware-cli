import { Command, InvalidArgumentError, Option } from "commander";
import {
  CREATE_WEBHOOK,
  DELETE_WEBHOOK,
  DELIVERY_STATUSES,
  REDELIVER_WEBHOOK,
  ROTATE_WEBHOOK_SECRET,
  SEND_TEST_WEBHOOK,
  UPDATE_WEBHOOK,
  WEBHOOK_DELIVERIES,
  WEBHOOK_EVENTS,
  WEBHOOKS,
} from "../api/queries.js";
import { action, type Context, type IO } from "../context.js";
import { RwError } from "../errors.js";
import { fields, table } from "../format.js";
import type { Result } from "../output.js";
import { positiveInt } from "./records.js";

// rw webhooks: "tell my URL when records change." A webhook's body has ids
// only; fetch the record with rw (or /graphql) when it arrives.

type EventName = (typeof WEBHOOK_EVENTS)[number];

/** `order.updated` (what a webhook's body says) as ORDER_UPDATED (the API's name), and back. */
export function toEventName(value: string): EventName {
  const name = value.trim().toUpperCase().replace(/\./g, "_") as EventName;
  if (!WEBHOOK_EVENTS.includes(name)) {
    throw new InvalidArgumentError(`Not an event. See them all: rw webhooks events`);
  }
  return name;
}

export function toDotted(name: string): string {
  return name.toLowerCase().replace("_", ".");
}

function collectEvents(value: string, previous: EventName[] = []): EventName[] {
  return [...previous, ...value.split(",").filter(Boolean).map(toEventName)];
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
}

function webhookTable(ctx: Context, rows: Webhook[]) {
  return table(
    rows,
    [
      { header: "ID", value: (row) => row.id },
      { header: "URL", value: (row) => row.url },
      { header: "EVENTS", value: (row) => row.events.map(toDotted) },
      { header: "ON", value: (row) => (row.enabled ? "yes" : "no") },
    ],
    ctx.style,
  );
}

/** A new secret, said loudly: this is the only time anyone sees it. */
function withSecret(ctx: Context, payload: { secret: string; webhook: Webhook }, verb: string): Result<any> {
  return {
    data: payload,
    summary: `Webhook ${payload.webhook.id} ${verb}. Store the secret now: it won't be shown again.`,
    breadcrumbs: [{ action: "Send it a test event", cmd: `rw webhooks test ${payload.webhook.id}` }],
    human: (data) =>
      `${fields({ id: data.webhook.id, url: data.webhook.url, events: data.webhook.events.map(toDotted), enabled: data.webhook.enabled }, ctx.style)}\n` +
      `${ctx.style.dim("secret".padEnd(7))}  ${ctx.style.yellow(data.secret)}`,
  };
}

function delivery(ctx: Context, row: Record<string, any>, summary: string): Result<any> {
  return {
    data: row,
    summary,
    breadcrumbs: row.status === "FAILED" ? [{ action: "Send it again", cmd: `rw webhooks redeliver ${row.id}` }] : [],
    human: (data) => fields(data, ctx.style),
  };
}

export function webhooksCommand(io: () => IO): Command {
  const webhooks = new Command("webhooks").description("Get told when records change");

  webhooks
    .command("list")
    .description("List the plant's webhooks")
    .action(
      action(io, async (ctx) => {
        const { webhooks: rows } = await ctx.api().request<{ webhooks: Webhook[] }>(WEBHOOKS);
        return {
          data: rows,
          summary: rows.length === 1 ? "1 webhook" : `${rows.length} webhooks`,
          breadcrumbs: rows[0]
            ? [{ action: "See its deliveries", cmd: `rw webhooks deliveries ${rows[0].id}` }]
            : [{ action: "Make one", cmd: "rw webhooks create --url https://… --event order.updated" }],
          human: (data) => webhookTable(ctx, data),
        };
      }),
    );

  webhooks
    .command("events")
    .description("List the events a webhook can follow")
    .action(
      action(io, async () => ({
        data: WEBHOOK_EVENTS.map((name) => ({ name, type: toDotted(name) })),
        summary: `${WEBHOOK_EVENTS.length} events. Pass them as order.updated or ORDER_UPDATED.`,
        human: () => WEBHOOK_EVENTS.map(toDotted).join("\n"),
      })),
    );

  webhooks
    .command("create")
    .description("Make a webhook. Its signing secret is shown once")
    .requiredOption("--url <url>", "Where to send events (https)")
    .requiredOption(
      "--event <events>",
      "An event to follow, like order.updated. Repeat it, or use commas",
      collectEvents,
    )
    .option("--disabled", "Make it switched off")
    .action(
      action<{ url: string; event: EventName[]; disabled?: boolean }>(io, async (ctx, _args, options) => {
        const { createWebhook } = await ctx
          .api()
          .request<{ createWebhook: { secret: string; webhook: Webhook } }>(CREATE_WEBHOOK, {
            webhook: { url: options.url, events: [...new Set(options.event)], enabled: !options.disabled },
          });
        return withSecret(ctx, createWebhook, "made");
      }),
    );

  webhooks
    .command("update")
    .description("Change a webhook's URL, events, or whether it's on")
    .argument("<id>", "The webhook")
    .option("--url <url>", "A new URL")
    .option("--event <events>", "The events to follow, instead of the ones it has", collectEvents)
    .addOption(new Option("--enable", "Switch it on").conflicts("disable"))
    .addOption(new Option("--disable", "Switch it off"))
    .action(
      action<{ url?: string; event?: EventName[]; enable?: boolean; disable?: boolean }>(
        io,
        async (ctx, [id], options) => {
          const change = {
            ...(options.url ? { url: options.url } : {}),
            ...(options.event ? { events: [...new Set(options.event)] } : {}),
            ...(options.enable ? { enabled: true } : options.disable ? { enabled: false } : {}),
          };
          if (Object.keys(change).length === 0) {
            throw new RwError("usage", "Nothing to change", { hint: "Pass --url, --event, --enable or --disable." });
          }
          const { updateWebhook } = await ctx
            .api()
            .request<{ updateWebhook: Webhook }>(UPDATE_WEBHOOK, { id, webhook: change });
          return { data: updateWebhook, summary: `Webhook ${id} changed.`, human: (data) => webhookTable(ctx, [data]) };
        },
      ),
    );

  webhooks
    .command("delete")
    .description("Delete a webhook")
    .argument("<id>", "The webhook")
    .option("--yes", "Don't ask first")
    .action(
      action<{ yes?: boolean }>(io, async (ctx, [id], options) => {
        if (!options.yes) {
          if (!ctx.interactive) throw new RwError("usage", "Deleting needs --yes when the Rockware CLI can't ask you");
          if (!(await ctx.confirm(`Delete webhook ${id}?`))) throw new RwError("cancelled", "Nothing was deleted");
        }
        const { deleteWebhook } = await ctx.api().request<{ deleteWebhook: boolean }>(DELETE_WEBHOOK, { id });
        if (!deleteWebhook) throw new RwError("not_found", `No webhook with id ${id}`);
        return { data: { deleted: id }, summary: `Webhook ${id} deleted.`, human: () => "" };
      }),
    );

  webhooks
    .command("rotate-secret")
    .description("Give a webhook a new signing secret. The old one stops working now")
    .argument("<id>", "The webhook")
    .action(
      action(io, async (ctx, [id]) => {
        const { rotateWebhookSecret } = await ctx
          .api()
          .request<{ rotateWebhookSecret: { secret: string; webhook: Webhook } }>(ROTATE_WEBHOOK_SECRET, { id });
        return withSecret(ctx, rotateWebhookSecret, "has a new secret");
      }),
    );

  webhooks
    .command("test")
    .description('Send a "webhook.test" event now, and see how your URL answered')
    .argument("<id>", "The webhook")
    .action(
      action(io, async (ctx, [id]) => {
        const { sendTestWebhook } = await ctx
          .api()
          .request<{ sendTestWebhook: Record<string, any> }>(SEND_TEST_WEBHOOK, { id });
        const answered = sendTestWebhook.responseStatus ? ` Your URL answered ${sendTestWebhook.responseStatus}.` : "";
        return delivery(ctx, sendTestWebhook, `Test ${sendTestWebhook.status.toLowerCase()}.${answered}`);
      }),
    );

  webhooks
    .command("deliveries")
    .description("List a webhook's recent deliveries")
    .argument("<id>", "The webhook")
    .addOption(new Option("--status <status>", "Only these").choices(DELIVERY_STATUSES.map((s) => s.toLowerCase())))
    .option("--limit <n>", "How many at most", positiveInt)
    .action(
      action<{ status?: string; limit?: number }>(io, async (ctx, [id], options) => {
        const { webhookDeliveries: rows } = await ctx
          .api()
          .request<{ webhookDeliveries: Array<Record<string, any>> }>(WEBHOOK_DELIVERIES, {
            webhookId: id,
            status: options.status?.toUpperCase() ?? null,
            first: options.limit ?? null,
          });
        const failed = rows.find((row) => row.status === "FAILED");
        return {
          data: rows,
          summary: rows.length === 1 ? "1 delivery" : `${rows.length} deliveries`,
          breadcrumbs: failed ? [{ action: "Send a failed one again", cmd: `rw webhooks redeliver ${failed.id}` }] : [],
          human: () =>
            table(
              rows,
              [
                { header: "ID", value: (row) => row.id },
                { header: "TYPE", value: (row) => row.type },
                { header: "STATUS", value: (row) => row.status },
                { header: "HTTP", value: (row) => row.responseStatus },
                { header: "TRIES", value: (row) => row.attempts },
                { header: "STARTED", value: (row) => row.startedAt },
              ],
              ctx.style,
            ),
        };
      }),
    );

  webhooks
    .command("redeliver")
    .description("Send a delivery again")
    .argument("<delivery-id>", "The delivery, from `rw webhooks deliveries`")
    .action(
      action(io, async (ctx, [deliveryId]) => {
        const { redeliverWebhook } = await ctx
          .api()
          .request<{ redeliverWebhook: Record<string, any> }>(REDELIVER_WEBHOOK, {
            deliveryId,
          });
        return delivery(ctx, redeliverWebhook, `Sent again: ${redeliverWebhook.status.toLowerCase()}.`);
      }),
    );

  return webhooks;
}
