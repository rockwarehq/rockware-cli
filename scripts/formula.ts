// Write the Homebrew formula for a release, from dist/release/checksums.txt.
// The release workflow commits it to rockwarehq/homebrew-tap, so people can:
//
//   brew install rockwarehq/tap/rw
//
//   tsx scripts/formula.ts > rw.rb

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const sums = new Map(
  readFileSync(join(root, "dist", "release", "checksums.txt"), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/).reverse() as [string, string]),
);

const base = `https://github.com/rockwarehq/rockware-cli/releases/download/v${version}`;
const target = (name: string) => {
  const archive = `rw-${version}-${name}.tar.gz`;
  const sha = sums.get(archive);
  if (!sha) throw new Error(`checksums.txt has no ${archive}`);
  return `      url "${base}/${archive}"\n      sha256 "${sha}"`;
};

process.stdout.write(`# Made by rockwarehq/rockware-cli's scripts/formula.ts. Don't edit by hand.
class Rw < Formula
  desc "Rockware on the command line"
  homepage "https://github.com/rockwarehq/rockware-cli"
  version "${version}"
  license :cannot_represent

  on_macos do
    on_arm do
${target("darwin-arm64")}
    end
    on_intel do
${target("darwin-x64")}
    end
  end

  on_linux do
    on_arm do
${target("linux-arm64")}
    end
    on_intel do
${target("linux-x64")}
    end
  end

  def install
    bin.install "rw"
    prefix.install "LICENSE", "THIRD_PARTY_NOTICES"
    generate_completions_from_executable(bin/"rw", "completion")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rw --version")
  end
end
`);
