# Dotfiles

User configuration managed with GNU Stow.

## Packages

- `atuin` -> `~/.config/atuin/config.toml`
- `bash` -> `~/.bashrc`
- `zsh` -> `~/.zshrc`
- `tmux` -> `~/.config/tmux`
- `ghostty` -> `~/.config/ghostty`
- `herdr` -> `~/.config/herdr/config.toml`
- `hypr` -> `~/.config/hypr`
- `mako` -> `~/.config/mako`
- `nvim` -> `~/.config/nvim`
- `omarchy` -> `~/.config/omarchy/shell.json`, `~/.config/omarchy/shell.toml`
- `starship` -> `~/.config/starship.toml`
- `waybar` -> `~/.config/waybar`
- `yazi` -> `~/.config/yazi`

## Apply

From this directory:

```bash
./setup-configs.sh
```

The setup script backs up existing config targets before applying Stow links.

To relink manually after changes:

```bash
stow -R -t "$HOME" atuin bash zsh tmux ghostty herdr hypr mako nvim omarchy starship waybar yazi
```

## Install Packages

Package installers live in `install-packages/`.

```bash
cd install-packages
./install-all.sh
```

## Notes

- These are user configs only.
- Omarchy source/default files under `~/.local/share/omarchy` are intentionally not tracked.
- Mako was captured as the current effective config rather than an Omarchy theme symlink.
- Hyprland uses Omarchy Quattro's Lua configuration; only `hyprsunset.conf` and `xdph.conf` remain standalone.
