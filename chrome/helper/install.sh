#!/bin/sh
# Build and register the Multi-Account Containers proxy helper as a native
# messaging host for Chromium-based browsers (current user only).
#
#   ./install.sh [extension-id]        install / update
#   ./install.sh --uninstall           remove
#
# The extension id defaults to the one pinned by the manifest key, which is
# what you get when loading dist/chromium or the release zip unpacked.
set -eu

NAME=io.github.jpdagostin0.macc_proxy
EXT_ID=${1:-onhincpcieoahedkojoldccglpaokjln}
DEST=${XDG_DATA_HOME:-$HOME/.local/share}/macc-proxy-helper
CONF=${XDG_CONFIG_HOME:-$HOME/.config}
HERE=$(cd "$(dirname "$0")" && pwd)

# Every Chromium flavour looks in its own config directory.
BROWSER_DIRS="net.imput.helium chromium google-chrome google-chrome-beta google-chrome-unstable
BraveSoftware/Brave-Browser vivaldi microsoft-edge thorium"

if [ "$EXT_ID" = "--uninstall" ]; then
  for d in $BROWSER_DIRS; do rm -f "$CONF/$d/NativeMessagingHosts/$NAME.json"; done
  rm -rf "$DEST"
  echo "removed $NAME"
  exit 0
fi

GO=$(command -v go || true)
[ -z "$GO" ] && [ -x "$HOME/.local/go/bin/go" ] && GO=$HOME/.local/go/bin/go
[ -z "$GO" ] && [ -x /usr/local/go/bin/go ] && GO=/usr/local/go/bin/go

mkdir -p "$DEST"
if [ -n "$GO" ] && [ -f "$HERE/go.mod" ]; then
  (cd "$HERE" && CGO_ENABLED=0 "$GO" build -trimpath -ldflags="-s -w" -o "$DEST/macc-proxy-helper.new" .)
elif [ -x "$HERE/macc-proxy-helper" ]; then
  # Release tarball: prebuilt binary next to this script.
  cp "$HERE/macc-proxy-helper" "$DEST/macc-proxy-helper.new"
else
  echo "error: Go is required to build the helper (https://go.dev/dl/), or use a release tarball" >&2
  exit 1
fi
mv -f "$DEST/macc-proxy-helper.new" "$DEST/macc-proxy-helper"

installed=""
for d in $BROWSER_DIRS; do
  [ -d "$CONF/$d" ] || continue
  mkdir -p "$CONF/$d/NativeMessagingHosts"
  cat > "$CONF/$d/NativeMessagingHosts/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "Multi-Account Containers per-container proxy helper",
  "path": "$DEST/macc-proxy-helper",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  installed="$installed $d"
done

echo "helper: $DEST/macc-proxy-helper ($("$DEST/macc-proxy-helper" --version))"
if [ -n "$installed" ]; then
  echo "registered for:$installed"
else
  echo "warning: no Chromium-based browser profile found under $CONF" >&2
fi
