# Rockware CLI

Rockware on the command line. The command is `rw`. Read your plant's records, send records in from your own systems, and manage webhooks, from a terminal, a script or an AI agent.

```sh
rw auth login --host acme        # sign in through your browser
rw stations list                  # the plant's stations
rw orders show <id>               # one order, with its lines
rw products upsert products.json  # send products in, matched by your own ids
rw webhooks create --url https://example.com/hook --event order.updated
```

## Install

```sh
curl -fsSL https://github.com/rockwarehq/rockware-cli/releases/latest/download/install.sh | sh
# or
brew install rockwarehq/tap/rw
```

The script checks the download against its checksum, and puts `rw` in `~/.local/bin`. If that folder isn't on your PATH (it isn't on a new Mac), the script prints the line that adds it for your shell. Run that line, then open a new terminal. On Windows, download the `.zip` from the [releases](https://github.com/rockwarehq/rockware-cli/releases).

From source: `pnpm install`, then `pnpm dev -- <command>`, or build one file with `pnpm compile` (needs [Bun](https://bun.sh)). See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Sign in

```sh
rw auth login --host <your tenant>
```

This opens your browser. You approve the Rockware CLI for one plant on Rockware's consent page, and it saves the sign-in in your keychain. The plant must allow agent connections: a plant admin turns them on in IMM under Settings → Connect an agent.

- `--scope write` asks to send records in and change webhooks too. Only a plant admin can give that.
- `--no-browser` prints the link instead of opening it.
- With an API token instead (for scripts and CI): `rw auth login --host acme --with-token < token.txt`. Make tokens in IMM under Settings → Developers.
- In CI, skip signing in: set `RW_TOKEN` and `RW_HOST`.

Each sign-in is a **profile**: one host and one plant. Sign in again with `-P <name>` for another one. Then `rw profile list`, `rw profile use <name>`, or `-P <name>` on any command.

`rw auth status` shows who you are. `rw doctor` checks everything, and says how to fix what's wrong.

## Commands

`rw <noun> <verb>`. `rw <noun>` alone shows what it can do, and `rw commands` lists everything.

| | |
| --- | --- |
| `rw site` | The plant you're signed in to |
| `rw <records> list` | `workcenters`, `stations`, `jobs`, `tools`, `products`, `materials`, `customers`, `orders`, `production-runs`. Takes `--limit`, `--all`, `--after <cursor>`, `--updated-since <time>`, `--include-deleted` |
| `rw <records> show <id>` | One record |
| `rw workcenters upsert <file>` | Up to 100 workcenters. All or nothing |
| `rw stations upsert <file>` | Up to 100 stations. Send workcenters first |
| `rw materials upsert <file>` | Up to 100 materials. All or nothing |
| `rw products upsert <file>` | Up to 100 products, with bills of materials. Send materials first |
| `rw tools upsert <file>` | Up to 100 tools, with their cavities |
| `rw jobs upsert <file>` | Up to 100 jobs, with their tools and the products they make. Send tools and products first |
| `rw customers upsert <file>` | Up to 100 customers |
| `rw orders upsert <file>` | One order, with its customer and lines |
| `rw production-runs upsert <file>` | Up to 100 runs to stations' lineups, by your work order ids |
| `rw lineup show <station-id>` | A station's lineup now, with predicted times |
| `rw lineup sequence <station> <runs…>` | Put queued runs in order, by your ids |
| `rw entities list \| show <key> \| upsert <file>` | Custom entities and their fields, by key |
| `rw entity-records list <model> \| show <id> \| upsert <model> <file>` | A custom entity's records, with values as JSON |
| `rw webhooks …` | `list`, `events`, `create`, `update`, `delete`, `rotate-secret`, `test`, `deliveries`, `redeliver` |
| `rw api '<graphql>'` | Any query or mutation, with `--var name=value` |
| `rw completion zsh` | Shell completion (`bash`, `zsh`, `fish`) |

Upserts read a JSON file, `-` for stdin, or `--data '<json>'`. Records are matched by your `externalId`, so sending the same file again is safe. Never by name: to use a record made in Rockware, send its Rockware `id` with your `externalId` the first time. `--source` names the system the ids come from (default `erp`). See the [developer API docs](https://platform.rockwarecorp.com/api/graphql-writes/) for the fields.

## For scripts and agents

When its output is piped, or with `--json`, the Rockware CLI answers with one JSON envelope:

```json
{ "ok": true, "data": [...], "summary": "12 stations", "breadcrumbs": [{ "action": "Show one station", "cmd": "rw stations show …" }] }
{ "ok": false, "error": "No order with id … at this plant", "code": "not_found", "retryable": false, "hint": "Find its id: rw orders list" }
```

`--quiet` gives the data alone. Retry only when `retryable` is true. The exit code says what went wrong:

| Exit | Code | Means |
| --- | --- | --- |
| 0 | | It worked |
| 1 | `error` | Something else |
| 2 | `usage` | The command was wrong |
| 3 | `not_found` | No such record |
| 4 | `auth` | Not signed in, or the sign-in ended |
| 5 | `forbidden` | Signed in, but not allowed |
| 6 | `rate_limited` | Too many requests: wait, then retry |
| 7 | `network` | Couldn't reach Rockware: retry |
| 8 | `api` | Rockware failed |
| 9 | `validation` | An upsert had problems. Nothing was saved; they're in `details` |

`rw commands --json` lists every command, argument and flag. `rw` never stops to ask a question when it isn't in a terminal: `rw webhooks delete` needs `--yes` there.

## Settings

| | |
| --- | --- |
| `RW_PROFILE` | The profile to use |
| `RW_TOKEN`, `RW_HOST` | Run with this token and host, without signing in |
| `RW_CONFIG_DIR` | Where settings live (default `~/.config/rw`) |
| `RW_NO_KEYRING` | Keep secrets in a file, not the keychain |
| `RW_NONINTERACTIVE` | Never ask questions |
| `NO_COLOR` | No color |
| `BROWSER` | The command that opens the sign-in page |

How it works inside: [ARCHITECTURE.md](./ARCHITECTURE.md).

## License

The Rockware CLI isn't open source. It's under the Rockware CLI license in [LICENSE](./LICENSE). This is a short summary. Where they differ, LICENSE is what counts.

- **Using it for real work** needs a paid Rockware subscription. You must also agree to and follow the [Rockware Terms of Service](https://rockwarecorp.com/terms), or another agreement you have with Rockware.
- **Developing and testing:** you may copy and change it for this without a subscription.
- **Patches:** you may change it and publish patches. Rockware owns every change and patch, and they may only be used with a paid subscription.
- **You may not** copy, publish, share, sublicense or sell it beyond what's above. You may not use it to harm Rockware, or reverse engineer its binaries, unless the law or a third-party license allows it.
- **No warranty:** it comes as is.

The Rockware CLI includes open source software, such as the Bun runtime, each part under its own license. They're listed in [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES). Nothing in LICENSE limits your rights under them.
