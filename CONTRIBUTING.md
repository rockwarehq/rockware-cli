# Contributing to rw

Patches and helpful contributions are welcome: bug fixes, clearer help and
errors, docs, and commands for what the developer API already does.

## Before you start

- rw isn't open source. Read [LICENSE](./LICENSE). You may copy and change rw
  to develop and test a patch without a Rockware subscription. Rockware owns
  every change and patch, and they can only be used with a paid subscription.
- By opening a pull request, you agree that what you send is yours to give,
  and that Rockware owns it under the license.
- For anything bigger than a small fix, open an issue first, so we can agree
  on the shape before you build it.
- Found a security problem? Don't open an issue. Email
  support@rockwarecorp.com, with "Security" in the subject.

## Working on rw

You need Node 24 and pnpm. [Bun](https://bun.sh) is only needed to build the
single-file binary.

```sh
pnpm install
pnpm dev -- --help          # run rw from source
pnpm test                   # no server or network needed
pnpm typecheck
pnpm lint
```

To try a change against a real Rockware host, sign in as usual:
`pnpm dev -- auth login --host <your tenant>`.

How rw is put together is in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Rules that keep rw safe to depend on

- **Answers are a contract.** The JSON envelope, the error codes and the exit
  codes (`src/errors.ts`) only grow. Add a code; never change one.
- **Every command and flag is listed in `surface.txt`.** The tests fail when
  it changes, so a change to it is always on purpose. Update it in the same
  pull request.
- **rw adds no rules of its own.** The API decides what's allowed, and rw
  passes its answer on. rw never matches records by name.
- **Secrets only on stdin** or in the keychain, never as arguments, and never
  in output except the one time a new webhook secret is shown.
- **Every query is checked against `schema/developer-api.graphql`.** If a
  command needs something the API doesn't have yet, open an issue instead.
  Rockware updates the schema copy when the API changes.
- **No real customer names, hosts, tokens or data,** anywhere: code, tests,
  examples or commit messages. Use `acme`, `globex` and made-up ids. CI scans
  every pull request for secrets.

Write help, errors and docs in plain, short words.
