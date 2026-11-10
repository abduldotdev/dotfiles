#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/.dotfiles-backups}"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"

PACKAGES=(
  atuin
  bash
  zsh
  tmux
  ghostty
  foot
  herdr
  hypr
  gtk
  icons
  mako
  nvim
  omarchy
  starship
  waybar
  yazi
)

TARGETS=(
  "$HOME/.config/atuin/config.toml"
  "$HOME/.bashrc"
  "$HOME/.zshrc"
  "$HOME/.p10k.zsh"
  "$HOME/.config/tmux"
  "$HOME/.config/ghostty"
  "$HOME/.config/foot"
  "$HOME/.config/herdr/config.toml"
  "$HOME/.config/hypr"
  "$HOME/.config/gtk-3.0"
  "$HOME/.config/gtk-4.0"
  "$HOME/.icons/default"
  "$HOME/.config/mako"
  "$HOME/.config/nvim"
  "$HOME/.config/omarchy/shell.json"
  "$HOME/.config/omarchy/shell.toml"
  "$HOME/.config/starship.toml"
  "$HOME/.config/waybar"
  "$HOME/.config/yazi"
)

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    echo "Install packages first, then rerun this script." >&2
    exit 1
  fi
}

is_linked_to_this_repo() {
  local target="$1"
  local resolved

  resolved="$(readlink -f "$target" 2>/dev/null || true)"

  case "$resolved" in
    "$ROOT"/*) return 0 ;;
    *) return 1 ;;
  esac
}

backup_target() {
  local target="$1"
  local relative
  local destination

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    echo "No existing target: $target"
    return
  fi

  if is_linked_to_this_repo "$target"; then
    echo "Already linked: $target"
    return
  fi

  relative="${target#"$HOME"/}"
  destination="$BACKUP_DIR/$relative"
  mkdir -p "$(dirname "$destination")"
  mv "$target" "$destination"
  echo "Backed up: $target -> $destination"
}

require_command stow

mkdir -p "$HOME/.config"

for target in "${TARGETS[@]}"; do
  backup_target "$target"
done

# Herdr App keeps live state alongside its config. Back up only files Stow
# will replace, leaving data/, installed.json, and other app state in place.
if [ ! -d "$HOME/.config/herdr-app" ] || [ -L "$HOME/.config/herdr-app" ]; then
  backup_target "$HOME/.config/herdr-app"
else
  while IFS= read -r -d '' source; do
    target="$HOME/${source#"$ROOT/herdr-app/"}"
    if [ -e "$target" ] || [ -L "$target" ]; then
      if is_linked_to_this_repo "$target" || [ "$(realpath "$target")" = "$source" ]; then
        continue
      fi
      destination="$BACKUP_DIR/${target#"$HOME"/}"
      mkdir -p "$(dirname "$destination")"
      cp -a "$target" "$destination"
      # The running app recreates missing keys/settings; replace atomically.
      ln -s "$(realpath --relative-to="$(dirname "$target")" "$source")" "$target.stow-$$"
      mv -Tf "$target.stow-$$" "$target"
      echo "Backed up and linked: $target -> $destination"
    fi
  done < <(find "$ROOT/herdr-app" -type f -print0)
fi

echo "Applying Stow packages: ${PACKAGES[*]} herdr-app"
stow -R -d "$ROOT" -t "$HOME" "${PACKAGES[@]}"
stow -d "$ROOT" -t "$HOME" herdr-app

if [ -d "$BACKUP_DIR" ]; then
  echo "Backup directory: $BACKUP_DIR"
else
  echo "No backups were needed."
fi

echo "Config setup complete."
