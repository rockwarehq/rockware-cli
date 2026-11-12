# rw

Rockware on the command line. Read your plant's records, send records in from your own systems, and manage webhooks, from a terminal, a script or an AI agent.

This repo holds rw's releases. The code lives in Rockware's main repo.

## Install

```sh
curl -fsSL https://github.com/rockwarehq/rockware-cli/releases/latest/download/install.sh | sh
# or
brew install rockwarehq/tap/rw
```

The script checks the download against its checksum, and puts `rw` in `~/.local/bin`. On Windows, download the `.zip` from the [releases](https://github.com/rockwarehq/rockware-cli/releases).

## Start

```sh
rw auth login --host <your tenant>   # sign in through your browser
rw stations list                     # the plant's stations
rw commands                          # everything rw can do
rw doctor                            # check your setup
```

## License

rw is free to use with Rockware, but it isn't open source. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES).
