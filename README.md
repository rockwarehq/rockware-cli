# rw

Rockware on the command line. Read your plant's records, send records in from your own systems, and manage webhooks, from a terminal, a script or an AI agent.

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

The script checks the download against its checksum, and puts `rw` in `~/.local/bin`. On Windows, download the `.zip` from the [releases](https://github.com/rockwarehq/rockware-cli/releases).

From source: `pnpm install`, then `pnpm dev -- <command>`, or build one file with `pnpm compile` (needs [Bun](https://bun.sh)). See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Sign in

```sh
rw auth login --host <your tenant>
```

This opens your browser. You approve rw for one plant on Rockware's consent page, and rw saves the sign-in in your keychain. The plant must allow agent connections: a plant admin turns them on in IMM under Settings → Connect an agent.

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
| `rw <records> list` | `workcenters`, `stations`, `jobs`, `products`, `materials`, `customers`, `orders`. Takes `--limit`, `--all`, `--after <cursor>`, `--updated-since <time>`, `--include-deleted` |
| `rw <records> show <id>` | One record |
| `rw materials upsert <file>` | Up to 100 materials. All or nothing |
| `rw products upsert <file>` | Up to 100 products, with bills of materials. Send materials first |
| `rw orders upsert <file>` | One order, with its customer and lines |
| `rw webhooks …` | `list`, `events`, `create`, `update`, `delete`, `rotate-secret`, `test`, `deliveries`, `redeliver` |
| `rw api '<graphql>'` | Any query or mutation, with `--var name=value` |
| `rw completion zsh` | Shell completion (`bash`, `zsh`, `fish`) |

Upserts read a JSON file, `-` for stdin, or `--data '<json>'`. Records are matched by your `externalId`, so sending the same file again is safe. `--source` names the system the ids come from (default `erp`). See the [developer API docs](https://platform.rockwarecorp.com/api/graphql-writes/) for the fields.

## For scripts and agents

When its output is piped, or with `--json`, rw answers with one JSON envelope:

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

rw comes with a paid Rockware subscription, under the [Rockware Terms of Service](https://rockwarecorp.com/terms). It isn't open source. With a subscription you may install and run it anywhere, in scripts, CI and agents too. You may change it and send patches, and anyone may build and test changes without a subscription; Rockware owns the changes. You may not take apart its binaries, pass it on, or use it to harm Rockware. See [LICENSE](./LICENSE). The open source parts it includes are in [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES).
