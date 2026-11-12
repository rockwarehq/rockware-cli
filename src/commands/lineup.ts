import { Command } from "commander";
import { SEQUENCE_LINEUP, STATION_LINEUP } from "../api/queries.js";
import { action, type IO } from "../context.js";
import { RwError } from "../errors.js";
import { table } from "../format.js";
import type { Result } from "../output.js";
import { failIfErrors, SOURCE_HELP, type UpsertError } from "./writes.js";

// rw lineup: a station's schedule of production runs. `show` reads it as it
// is now, with predicted times. `sequence` puts runs in order by your own
// ids, the way a person drags them in Rockware; the plant can reorder too.
// Send runs in with `rw production-runs upsert`.

export function lineupCommand(io: () => IO): Command {
  const group = new Command("lineup").description("A station's lineup: its production runs, in order");

  group
    .command("show")
    .description("Show a station's lineup now: the running run, then the queue, with predicted times")
    .argument("<station-id>", "The station's Rockware id")
    .action(
      action(io, async (ctx, [id]): Promise<Result<any>> => {
        const { station } = await ctx
          .api()
          .request<{ station: { id: string; name: string; lineup: Array<Record<string, any>> | null } | null }>(
            STATION_LINEUP,
            { id },
          );
        if (!station) {
          throw new RwError("not_found", `No station with id ${id} at this plant`, {
            hint: "Find its id: rw stations list",
          });
        }
        const lineup = station.lineup ?? [];
        return {
          data: station,
          summary: station.lineup
            ? `${station.name}: ${lineup.length} ${lineup.length === 1 ? "run" : "runs"}`
            : `${station.name} has no lineup: it isn't in a workcenter`,
          breadcrumbs: [{ action: "Send runs to it", cmd: "rw production-runs upsert runs.json" }],
          human: () =>
            table(
              lineup,
              [
                { header: "#", value: (entry) => entry.position },
                { header: "STATUS", value: (entry) => entry.run.status },
                { header: "JOB", value: (entry) => entry.run.job?.name },
                { header: "OUTSIDE IDS", value: (entry) => entry.run.externalIds },
                { header: "START", value: (entry) => entry.predictedStart },
                { header: "END", value: (entry) => entry.predictedEnd },
                {
                  header: "AT RISK",
                  value: (entry) =>
                    [entry.startByAtRisk ? "start" : "", entry.endByAtRisk ? "end" : ""].filter(Boolean).join(", "),
                },
              ],
              ctx.style,
            ),
        };
      }),
    );

  group
    .command("sequence")
    .description(
      "Put queued runs in order at one station, by your ids. They take the places they hold, in this order; other runs stay put",
    )
    .argument("<station>", "The station's externalId, or its Rockware id")
    .argument("<runs...>", "The runs' externalIds, in the order to run them")
    .option("--source <name>", SOURCE_HELP)
    .addHelpText("after", "\nExample:\n  rw lineup sequence PRESS-4 WO-1043 WO-1042 --source erp")
    .action(
      action<{ source?: string }>(io, async (ctx, [station, ...runs], options): Promise<Result<any>> => {
        const { sequenceLineup: payload } = await ctx.api().request<{
          sequenceLineup: {
            action: string | null;
            station: { id: string; name: string } | null;
            errors: UpsertError[];
          };
        }>(SEQUENCE_LINEUP, { source: options.source ?? null, station, runs });
        failIfErrors(payload.errors, "runs");
        return {
          data: payload,
          summary: `${payload.station?.name ?? station}: lineup ${(payload.action ?? "").toLowerCase()}`.trim(),
          breadcrumbs: payload.station
            ? [{ action: "Show the lineup", cmd: `rw lineup show ${payload.station.id}` }]
            : [],
          human: () => "",
        };
      }),
    );

  return group;
}
