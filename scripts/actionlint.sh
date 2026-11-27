#!/usr/bin/env bash
# Runs actionlint, the GitHub Actions workflow linter, at a pinned version.
# It isn't on npm, so the first run downloads the release binary and checks it
# against the checksum the release published. https://github.com/rhysd/actionlint
set -euo pipefail

version=1.7.12
case "$(uname -s)_$(uname -m)" in
  Darwin_arm64) platform=darwin_arm64 sha=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  Darwin_x86_64) platform=darwin_amd64 sha=5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644 ;;
  Linux_x86_64) platform=linux_amd64 sha=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  Linux_aarch64) platform=linux_arm64 sha=325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6 ;;
  *)
    echo "actionlint: no pinned build for $(uname -sm)" >&2
    exit 1
    ;;
esac

dir="$(dirname "$0")/../node_modules/.cache/actionlint-$version"
if [ ! -x "$dir/actionlint" ]; then
  archive="actionlint_${version}_${platform}.tar.gz"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$archive" \
    "https://github.com/rhysd/actionlint/releases/download/v$version/$archive"
  # shasum -c reads "<hash>  <file>" lines and fails when the file doesn't match.
  (cd "$tmp" && echo "$sha  $archive" | shasum -a 256 -c --status)
  mkdir -p "$dir"
  # Extract (-x) only the binary from the gzipped (-z) archive (-f) into $dir (-C).
  tar -xzf "$tmp/$archive" -C "$dir" actionlint
  rm -rf "$tmp"
fi

# With no arguments it lints every file in .github/workflows/.
exec "$dir/actionlint" "$@"
