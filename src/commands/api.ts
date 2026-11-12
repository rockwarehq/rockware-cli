import { Command } from "commander";
import { action, type IO } from "../context.js";
import { RwError } from "../errors.js";

// rw api: send any GraphQL to the developer API, as the current profile.
// For whatever the named commands don't cover yet. Same token, same limits,
// same answer envelope.

function parseVar(value: string, previous: Record<string, unknown> = {}): Record<string, unknown> {
  const at = value.indexOf("=");
  if (at < 1) throw new RwError("usage", `--var needs name=value, not "${value}"`);
  const name = value.slice(0, at);
  const raw = value.slice(at + 1);
  // JSON when it parses (numbers, true, lists), else the text as it is.
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A plain string.
  }
  return { ...previous, [name]: parsed };
}

export function apiCommand(io: () => IO): Command {
  return new Command("api")
    .description("Send any GraphQL query or mutation to the developer API")
    .argument("<query>", "The GraphQL, or - to read it from stdin")
    .option("--var <name=value>", "A variable. Repeat for more. JSON values are parsed", parseVar)
    .option("--variables <json>", "All the variables, as one JSON object")
    .addHelpText(
      "after",
      `\nExamples:\n  rw api '{ site { id name } }'\n  rw api 'query ($id: ID!) { order(id: $id) { orderNumber status } }' --var id=…\n  rw api - < query.graphql`,
    )
    .action(
      action<{ var?: Record<string, unknown>; variables?: string }>(io, async (ctx, [query], options) => {
        const text = query === "-" ? await ctx.readStdin() : (query as string);
        let variables: Record<string, unknown> = {};
        if (options.variables) {
          try {
            variables = JSON.parse(options.variables) as Record<string, unknown>;
          } catch (error) {
            throw new RwError("usage", `--variables isn't valid JSON: ${(error as Error).message}`);
          }
        }
        const data = await ctx.api().request<unknown>(text, { ...variables, ...options.var });
        return { data };
      }),
    );
}
