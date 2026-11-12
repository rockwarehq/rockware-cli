#!/bin/sh
# Install the Rockware CLI (`rw`).
#
#   curl -fsSL https://github.com/rockwarehq/rockware-cli/releases/latest/download/install.sh | sh
#
# It downloads the release for this computer, checks its SHA-256 against
# checksums.txt, and puts `rw` in ~/.local/bin (or RW_BIN_DIR).
#
# Settings:
#   RW_VERSION   a version like 0.1.0 (default: the latest)
#   RW_BIN_DIR   where to put rw (default: ~/.local/bin)
#   RW_RELEASES  where releases are, for a mirror (default: GitHub)
set -eu

REPO="rockwarehq/rockware-cli"
BIN_DIR="${RW_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*" >&2; }
fail() { say "Rockware CLI install: $*"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "needs $1"; }
need curl
need tar
need uname

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this script is for macOS and Linux. On Windows, download the Rockware CLI from https://github.com/$REPO/releases" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "no build for $(uname -m)" ;;
esac
# Apple silicon running this shell under Rosetta still wants the arm64 build.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi

if [ -n "${RW_VERSION:-}" ] || [ -n "${RW_RELEASES:-}" ]; then
  [ -n "${RW_VERSION:-}" ] || fail "RW_RELEASES needs RW_VERSION too"
  version="${RW_VERSION#v}"
else
  version=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$version" ] || fail "couldn't find the latest version"
fi

archive="rw-$version-$os-$arch.tar.gz"
base="${RW_RELEASES:-https://github.com/$REPO/releases/download}/v$version"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Downloading the Rockware CLI $version for ${os}-${arch}…"
curl -fsSL -o "$tmp/$archive" "$base/$archive" || fail "couldn't download $base/$archive"
curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt" || fail "couldn't download checksums.txt"

expected=$(grep "  $archive\$" "$tmp/checksums.txt" | cut -d' ' -f1)
[ -n "$expected" ] || fail "checksums.txt doesn't list $archive"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$archive" | cut -d' ' -f1)
else
  actual=$(shasum -a 256 "$tmp/$archive" | cut -d' ' -f1)
fi
[ "$expected" = "$actual" ] || fail "the download doesn't match its checksum, so it wasn't installed"

tar -xzf "$tmp/$archive" -C "$tmp"
mkdir -p "$BIN_DIR"
mv "$tmp/rw" "$BIN_DIR/rw"
chmod 755 "$BIN_DIR/rw"

say "Installed the Rockware CLI $version to $BIN_DIR/rw"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    # Name the file this person's shell reads, so the line can be pasted as is.
    case "${SHELL##*/}" in
      zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
      bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
      fish) rc="" ;;
      *) rc="$HOME/.profile" ;;
    esac
    say ""
    say "$BIN_DIR isn't on your PATH yet, so your shell can't find the rw command. To add it, run:"
    say ""
    if [ -z "$rc" ]; then
      say "  fish_add_path \"$BIN_DIR\""
    else
      say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> \"$rc\""
    fi
    say ""
    say "Then open a new terminal."
    ;;
esac
say "Next: rw auth login --host <your tenant>"
