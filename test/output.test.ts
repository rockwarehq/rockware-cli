import { describe, expect, it } from "vitest";
import { EXIT_CODES, RwError, toRwError } from "../src/errors.js";
import { table } from "../src/format.js";
import { printError, printResult, resolveMode } from "../src/output.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    streams: { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => err.push(s) } },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

describe("output mode", () => {
  it("is readable in a terminal and JSON when piped", () => {
    expect(resolveMode({}, true)).toBe("human");
    expect(resolveMode({}, false)).toBe("json");
    expect(resolveMode({ json: true }, true)).toBe("json");
    expect(resolveMode({ quiet: true }, true)).toBe("quiet");
  });
});

describe("the envelope", () => {
  const result = {
    data: [{ id: "a" }],
    summary: "1 station",
    breadcrumbs: [{ action: "Show it", cmd: "rw stations show a" }],
  };

  it("wraps data with ok, summary and breadcrumbs", () => {
    const c = capture();
    printResult(result, "json", c.streams);
    expect(JSON.parse(c.out())).toEqual({ ok: true, ...result });
  });

  it("is the data alone with --quiet", () => {
    const c = capture();
    printResult(result, "quiet", c.streams);
    expect(JSON.parse(c.out())).toEqual([{ id: "a" }]);
  });

  it("puts failures on stdout as JSON, with code and retryable", () => {
    const c = capture();
    printError(new RwError("rate_limited", "Too many requests", { hint: "Wait" }), "json", c.streams);
    expect(JSON.parse(c.out())).toEqual({
      ok: false,
      error: "Too many requests",
      code: "rate_limited",
      retryable: true,
      hint: "Wait",
    });
    expect(c.err()).toBe("");
  });

  it("tells people on stderr, with each field error", () => {
    const c = capture();
    const details = [{ field: "products[0].sku", code: "TAKEN", message: "Already used" }];
    printError(new RwError("validation", "Nothing was saved", { details }), "human", c.streams);
    expect(c.out()).toBe("");
    expect(c.err()).toContain("products[0].sku: Already used (TAKEN)");
  });
});

describe("exit codes", () => {
  it("are fixed per code", () => {
    // Part of rw's contract: scripts depend on these numbers.
    expect(EXIT_CODES).toEqual({
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
    });
    expect(new RwError("auth", "x").exitCode).toBe(4);
    expect(toRwError(new Error("boom"))).toMatchObject({ code: "error", message: "boom", retryable: false });
  });
});

describe("tables", () => {
  it("pad columns and show empty cells as -", () => {
    const text = table(
      [
        { id: "1", name: "Press 1", job: null },
        { id: "22", name: "Lathe", job: { name: "Bracket" } },
      ],
      [
        { header: "ID", value: (row) => row.id },
        { header: "NAME", value: (row) => row.name },
        { header: "JOB", value: (row) => row.job },
      ],
    );
    expect(text.split("\n")).toEqual(["ID  NAME     JOB", "1   Press 1  -", "22  Lathe    Bracket"]);
  });
});
