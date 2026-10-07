#!/usr/bin/env bash
# Installs the allthings CLI, `allthings`, in ~/.allthings/bin, with `atw`
# beside it as the old name for now.
#
#   curl -fsSL https://allthingsweb-dev.github.io/allthingsweb/install.bash | bash
#
# ALLTHINGS_VERSION=2.0.0-alpha.3 installs that (pre)release; the default is
# the latest stable release. ALLTHINGS_HOME moves the install (~/.allthings).
set -euo pipefail

repo="allthingsweb-dev/allthingsweb"
home_dir="${ALLTHINGS_HOME:-$HOME/.allthings}"
bin_dir="$home_dir/bin"
version="${ALLTHINGS_VERSION:-${ATW_VERSION:-}}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  linux | darwin) ;;
  *)
    echo "No installer for $os. Download the binary from https://github.com/$repo/releases." >&2
    exit 1
    ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac
platform="bun-$os-$arch"

if [[ -z "$version" ]]; then
  version=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | grep '"tag_name"' | cut -d '"' -f 4)
fi
if [[ -z "$version" ]]; then
  echo "Could not find the latest release." >&2
  exit 1
fi

mkdir -p "$bin_dir"
download=$(mktemp "$bin_dir/.allthings.XXXXXX")
trap 'rm -f "$download"' EXIT
base="https://github.com/$repo/releases/download/$version"
# Releases before the rename ship the binary as atw-cli-<platform>.
if ! curl -fsL -o "$download" "$base/allthings-$platform" &&
  ! curl -fsSL -o "$download" "$base/atw-cli-$platform"; then
  echo "Release $version has no binary for $platform." >&2
  exit 1
fi
chmod 755 "$download"
mv "$download" "$bin_dir/allthings"
trap - EXIT
ln -sf allthings "$bin_dir/atw"

echo "Installed allthings $version in $bin_dir."
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "Add it to your PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac
echo
"$bin_dir/allthings" --help
