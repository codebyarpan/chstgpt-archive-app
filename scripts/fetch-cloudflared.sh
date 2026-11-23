#!/bin/zsh
# Downloads Cloudflare's official cloudflared build into build-cache/, for
# bundling into the app ("Connect ChatGPT" uses it for the public HTTPS link).
# Homebrew's build only runs on the macOS version it was built on, so it is not
# suitable for an app that is sent to other Macs.
#
#   npm run fetch-cloudflared            (default version below)
#   CLOUDFLARED_VERSION=2026.11.0 npm run fetch-cloudflared
set -euo pipefail
VERSION="${CLOUDFLARED_VERSION:-2026.11.0}"
DIR="${0:A:h}/../build-cache"
URL="https://github.com/cloudflare/cloudflared/releases/download/$VERSION/cloudflared-darwin-arm64.tgz"

mkdir -p "$DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading $URL"
curl -fSL --retry 3 -o "$TMP/cf.tgz" "$URL"
tar -xzf "$TMP/cf.tgz" -C "$TMP"
mv "$TMP/cloudflared" "$DIR/cloudflared"
chmod 755 "$DIR/cloudflared"
echo "SHA-256 of the download: $(shasum -a 256 "$TMP/cf.tgz" | cut -d' ' -f1)"
echo "(compare with the checksum on https://github.com/cloudflare/cloudflared/releases/tag/$VERSION)"
echo "Minimum macOS: $(otool -l "$DIR/cloudflared" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
echo "Saved to $DIR/cloudflared"
