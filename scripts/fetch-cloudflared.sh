#!/bin/zsh
# Downloads Cloudflare's official cloudflared build into build-cache/, for
# bundling into the app ("Connect a web app" uses it for the public HTTPS link).
# Homebrew's build only runs on the macOS version it was built on, so it is not
# suitable for an app that is sent to other Macs.
#
#   npm run fetch-cloudflared            (default version below)
#   CLOUDFLARED_VERSION=2026.11.0 npm run fetch-cloudflared
set -euo pipefail
VERSION="${CLOUDFLARED_VERSION:-2026.11.0}"
# SHA-256 of the extracted binary, as published under "SHA256 Checksums" on
# https://github.com/cloudflare/cloudflared/releases/tag/<version>. Pass
# CLOUDFLARED_SHA256 together with another CLOUDFLARED_VERSION.
if [[ -z "${CLOUDFLARED_SHA256:-}" && "$VERSION" == "2026.11.0" ]]; then
  CLOUDFLARED_SHA256=97e24268d9704a570fab276293028f3580ae2c7d5d2678621a4809e90f776a5e
fi
[[ -n "${CLOUDFLARED_SHA256:-}" ]] || { echo "Set CLOUDFLARED_SHA256 (from the release page) for version $VERSION"; exit 1; }
DIR="${0:A:h}/../build-cache"
URL="https://github.com/cloudflare/cloudflared/releases/download/$VERSION/cloudflared-darwin-arm64.tgz"

mkdir -p "$DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading $URL"
curl -fSL --retry 3 -o "$TMP/cf.tgz" "$URL"
tar -xzf "$TMP/cf.tgz" -C "$TMP"
GOT="$(shasum -a 256 "$TMP/cloudflared" | cut -d' ' -f1)"
if [[ "$GOT" != "$CLOUDFLARED_SHA256" ]]; then
  echo "Checksum mismatch: got $GOT, expected $CLOUDFLARED_SHA256. Nothing was saved."
  exit 1
fi
echo "Checksum verified ($GOT)"
mv "$TMP/cloudflared" "$DIR/cloudflared"
chmod 755 "$DIR/cloudflared"
echo "Minimum macOS: $(otool -l "$DIR/cloudflared" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
echo "Saved to $DIR/cloudflared"
