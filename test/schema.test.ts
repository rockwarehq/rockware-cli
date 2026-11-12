import { readFileSync } from "node:fs";
import { buildSchema, type GraphQLEnumType, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { ALL_OPERATIONS, DELIVERY_STATUSES, WEBHOOK_EVENTS } from "../src/api/queries.js";
import { VERSION } from "../src/version.js";

// These tests fail when the API changes in a way that would break rw, before
// anyone runs it. They read schema/developer-api.graphql, a copy of the
// developer API's schema. Rockware's server CI runs them against its current
// schema too, by pointing RW_SCHEMA at it, so the API can't break rw unseen.

const schemaFile = process.env.RW_SCHEMA ?? new URL("../schema/developer-api.graphql", import.meta.url);
const schema = buildSchema(readFileSync(schemaFile, "utf8"));

describe("rw's queries against the developer API schema", () => {
  for (const [name, query] of Object.entries(ALL_OPERATIONS)) {
    it(`${name} is valid`, () => {
      expect(validate(schema, parse(query)).map((error) => error.message)).toEqual([]);
    });
  }

  it("knows every webhook event and delivery status", () => {
    const values = (type: string) => (schema.getType(type) as GraphQLEnumType).getValues().map((value) => value.name);
    expect([...WEBHOOK_EVENTS].sort()).toEqual(values("WebhookEventType").sort());
    expect([...DELIVERY_STATUSES].sort()).toEqual(values("WebhookDeliveryStatus").sort());
  });
});

it("says the same version as package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  expect(VERSION).toBe(pkg.version);
});
