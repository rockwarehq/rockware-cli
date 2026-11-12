// Build rw for every platform we ship, as single files with no install
// step: Bun puts its runtime and rw's code in one binary.
//
//   pnpm compile:all                # every target, into dist/release
//   pnpm compile:all darwin-arm64
//
// Each target gets rw-<version>-<os>-<arch>.tar.gz (a .zip for Windows)
// holding the `rw` file with LICENSE and THIRD_PARTY_NOTICES, and
// checksums.txt lists the SHA-256 of each.
// install.sh and the Homebrew formula read those names, so keep them.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

const TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"];
const wanted = process.argv.slice(2);
const targets = wanted.length > 0 ? TARGETS.filter((target) => wanted.includes(target)) : TARGETS;

const out = join(root, "dist", "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const NOTICES = ["LICENSE", "THIRD_PARTY_NOTICES"];

const sums: string[] = [];
for (const target of targets) {
  const windows = target.startsWith("windows");
  const dir = join(out, target);
  mkdirSync(dir);
  const binary = join(dir, windows ? "rw.exe" : "rw");
  execFileSync(
    "bun",
    ["build", "src/main.ts", "--compile", "--minify", `--target=bun-${target}`, "--outfile", binary],
    { cwd: root, stdio: "inherit" },
  );
  for (const file of NOTICES) copyFileSync(join(root, file), join(dir, file));
  const archive = `rw-${version}-${target}.${windows ? "zip" : "tar.gz"}`;
  const files = [windows ? "rw.exe" : "rw", ...NOTICES];
  if (windows) execFileSync("zip", ["-j", "-q", join(out, archive), ...files.map((file) => join(dir, file))]);
  else execFileSync("tar", ["-czf", join(out, archive), "-C", dir, ...files]);
  rmSync(dir, { recursive: true });
  sums.push(
    `${createHash("sha256")
      .update(readFileSync(join(out, archive)))
      .digest("hex")}  ${archive}`,
  );
  console.log(`built ${archive}`);
}
writeFileSync(join(out, "checksums.txt"), `${sums.join("\n")}\n`);
console.log(`rw ${version}: ${targets.length} targets in ${out}`);
