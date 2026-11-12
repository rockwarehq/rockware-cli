import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IO } from "../src/context.js";
import { toRwError } from "../src/errors.js";
import { buildProgram } from "../src/program.js";

// Commands end to end against a fake /graphql: what each one sends, and what
// it answers. The real API's rules are tested in Rockware's server repo; the
// queries themselves are checked against the schema in schema.test.ts.

let server: Server;
let host: string;
let sent: Array<{ query: string; variables: Record<string, unknown> }> = [];
let answer: (query: string) => unknown = () => ({ data: {} });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = JSON.parse(text);
    sent.push(request);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer(request.query)));
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const address = server.address();
  host = `http://localhost:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  sent = [];
});

/** Run one command as a script would (piped, so JSON), and return its envelope. */
async function rw(...argv: string[]): Promise<Record<string, any>> {
  const out: string[] = [];
  const io: IO = {
    stdin: Readable.from([]),
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: () => true },
    stdoutIsTTY: false,
    stderrIsTTY: false,
    env: {
      RW_TOKEN: "rw_app_test",
      RW_HOST: host,
      RW_NO_KEYRING: "1",
      RW_CONFIG_DIR: mkdtempSync(join(tmpdir(), "rw-commands-")),
    },
  } as unknown as IO;
  await buildProgram(() => io).parseAsync(argv, { from: "user" });
  return JSON.parse(out.join(""));
}

const upserted = (field: string, record: string, rows: Array<Record<string, unknown>>) => () => ({
  data: {
    [field]: { results: rows.map((row) => ({ action: "CREATED", ...row, [record]: { id: "id-1" } })), errors: [] },
  },
});

describe("writes", () => {
  it("sends a custom entity's records with its model and source", async () => {
    answer = upserted("upsertEntityRecords", "record", [{ externalId: "G-17" }]);
    const result = await rw(
      "entity-records",
      "upsert",
      "gauge",
      "--source",
      "erp",
      "--data",
      '[{"externalId":"G-17","values":{"serial":"SN-1"}}]',
    );
    expect(sent[0]?.variables).toEqual({
      source: "erp",
      model: "gauge",
      records: [{ externalId: "G-17", values: { serial: "SN-1" } }],
    });
    expect(result).toMatchObject({ ok: true, summary: "1 created" });
    expect(result.breadcrumbs[0].cmd).toMatch(/^rw entity-records list gauge --updated-since /);
  });

  it("sends custom entities without a source: they're found by key", async () => {
    answer = upserted("upsertEntityModels", "model", [{ key: "gauge" }]);
    await rw("entities", "upsert", "--data", '{"models":[{"key":"gauge","label":"Gauge"}]}');
    expect(sent[0]?.variables).toEqual({ models: [{ key: "gauge", label: "Gauge" }] });
  });

  it("sends production runs, and a problem is a validation failure with its fields", async () => {
    answer = () => ({
      data: {
        upsertProductionRuns: {
          results: [],
          errors: [{ field: "runs[0].station", code: "UNKNOWN_STATION", message: "No station PRESS-9" }],
        },
      },
    });
    const failure = await rw("production-runs", "upsert", "--data", '{"runs":[{"externalId":"WO-1"}]}').catch(
      toRwError,
    );
    expect(sent[0]?.variables).toEqual({ source: null, runs: [{ externalId: "WO-1" }] });
    expect(failure).toMatchObject({ code: "validation", exitCode: 9 });
    expect(failure.details).toEqual([
      { field: "runs[0].station", code: "UNKNOWN_STATION", message: "No station PRESS-9" },
    ]);
  });

  it("puts a station's runs in order by the caller's ids", async () => {
    answer = () => ({
      data: { sequenceLineup: { action: "UPDATED", station: { id: "st-1", name: "Press 4" }, errors: [] } },
    });
    const result = await rw("lineup", "sequence", "PRESS-4", "WO-2", "WO-1", "--source", "erp");
    expect(sent[0]?.variables).toEqual({ source: "erp", station: "PRESS-4", runs: ["WO-2", "WO-1"] });
    expect(result).toMatchObject({ summary: "Press 4: lineup updated" });
    expect(result.breadcrumbs).toEqual([{ action: "Show the lineup", cmd: "rw lineup show st-1" }]);
  });
});

describe("reads", () => {
  it("lists production runs under their own group name", async () => {
    answer = () => ({
      data: {
        productionRuns: {
          nodes: [{ id: "run-1", stationId: "st-1", jobId: "job-1" }],
          pageInfo: { endCursor: "c1", hasNextPage: false },
        },
      },
    });
    const result = await rw("production-runs", "list");
    expect(sent[0]?.query).toContain("productionRuns(");
    expect(result).toMatchObject({
      summary: "1 production run",
      breadcrumbs: [{ action: "Show one production run", cmd: "rw production-runs show run-1" }],
    });
  });

  it("says when a custom entity doesn't exist", async () => {
    answer = () => ({ data: { entityModel: null } });
    const failure = await rw("entities", "show", "nope").catch(toRwError);
    expect(failure).toMatchObject({ code: "not_found", hint: "Find its key: rw entities list" });
  });
});
