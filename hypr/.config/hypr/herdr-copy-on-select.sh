#!/usr/bin/env bash
# Copy-on-select for herdr-app: herdr-app puts selected text into the Wayland
# primary selection; mirror it into the clipboard while herdr-app is focused.
# Other apps' selections are left alone.
exec wl-paste --primary --type text --watch bash -c '
  [ "$(hyprctl activewindow -j | jq -r .class)" = "herdr-app" ] || exit 0
  text=$(cat)
  [ -n "$text" ] && printf %s "$text" | wl-copy --type text/plain
'
