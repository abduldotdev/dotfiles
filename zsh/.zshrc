# If not running interactively, don't do anything.
[[ -o interactive ]] || return

# Keep the system login shell as bash, but let tools started from zsh know the
# active interactive shell is zsh.
export SHELL=/usr/bin/zsh
export EDITOR=nvim
export VISUAL=nvim

# History
HISTFILE=~/.histfile
HISTSIZE=32768
SAVEHIST=32768
setopt append_history
setopt hist_ignore_all_dups
setopt hist_ignore_space
setopt share_history

# Completion
autoload -Uz compinit
compinit
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'
[[ -n ${LS_COLORS-} ]] && zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"

# Match normal Bash-style editing even when EDITOR is nvim.
bindkey -e
bindkey '^?' backward-delete-char
bindkey '^H' backward-delete-char
[[ -n ${terminfo[kbs]-} ]] && bindkey "${terminfo[kbs]}" backward-delete-char
[[ -n ${terminfo[kdch1]-} ]] && bindkey "${terminfo[kdch1]}" delete-char
bindkey '^[[3~' delete-char

# All the default Omarchy aliases and functions that are zsh-compatible.
source ~/.local/share/omarchy/default/bash/envs
source ~/.local/share/omarchy/default/bash/aliases
for f in "$OMARCHY_PATH"/default/bash/fns/*(.N); do
  source "$f"
done

# Enable core terminal color support.
export CLICOLOR=1
alias grep="grep --color=auto"

# Zsh plugins
if [[ -r /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh ]]; then
  source /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
fi

# Zsh-native fzf integration
if [[ -t 0 && -t 1 ]]; then
  [[ -r /usr/share/fzf/completion.zsh ]] && source /usr/share/fzf/completion.zsh
  [[ -r /usr/share/fzf/key-bindings.zsh ]] && source /usr/share/fzf/key-bindings.zsh
fi

# Zsh-native Omarchy command completion
_omarchy_complete() {
  local omarchy_path bin_dir prefix part file basename rest next args enum
  local -a candidates
  local -A seen

  omarchy_path=$(command -v omarchy 2>/dev/null) || return 1
  bin_dir=$(dirname -- "$(readlink -f -- "$omarchy_path" 2>/dev/null || printf '%s' "$omarchy_path")")
  [[ -d $bin_dir ]] || return 1

  prefix="omarchy"
  for part in "${words[@]:1:CURRENT-2}"; do
    [[ -z $part || $part == -* ]] && continue
    prefix+="-$part"
  done

  for file in "$bin_dir/$prefix"-*(N); do
    [[ -f $file && -x $file ]] || continue
    basename="${file:t}"
    rest="${basename#"$prefix"-}"
    next="${rest%%-*}"
    if [[ -n $next && -z ${seen[$next]-} ]]; then
      seen[$next]=1
      candidates+=("$next")
    fi
  done

  if (( CURRENT == 2 )); then
    candidates+=("commands")
  fi

  if [[ ${words[2]-} == "commands" && CURRENT -ge 3 ]]; then
    candidates+=("--all" "--json" "--markdown" "--check")
  fi

  if (( ${#candidates[@]} == 0 )) && [[ -x $bin_dir/$prefix ]]; then
    args=$(grep -m 1 '^# omarchy:args=<' "$bin_dir/$prefix" 2>/dev/null)
    enum="${args#*<}"
    enum="${enum%%>*}"
    if [[ $enum == *"|"* && $enum != *" "* ]]; then
      candidates=("${(@s:|:)enum}")
    fi
  fi

  (( ${#candidates[@]} > 0 )) && _describe 'omarchy command' candidates
}

compdef _omarchy_complete omarchy

# User config
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

alias lg="lazygit"
alias oc="opencode"

# Claude aliases
alias cld="claude --dangerously-skip-permissions"
alias claude1="CLAUDE_CONFIG_DIR=~/.claude-profile-1 claude"
alias cld1="claude1 --dangerously-skip-permissions"
alias claude2="CLAUDE_CONFIG_DIR=~/.claude-profile-2 claude"
alias cld2="claude2 --dangerously-skip-permissions"

# Codex aliases
alias cdx="codex --yolo"
alias codex1="CODEX_HOME=~/.codex-profile-1 codex"
alias cdx1="codex1 --yolo"
alias codex2="CODEX_HOME=~/.codex-profile-2 codex"
alias cdx2="codex2 --yolo"

# Kiro shell integration
if [[ "$TERM_PROGRAM" == "kiro" ]] && command -v kiro >/dev/null 2>&1; then
  __kiro_integration="$(kiro --locate-shell-integration-path zsh 2>/dev/null || true)"
  [[ -r "$__kiro_integration" ]] && source "$__kiro_integration"
  unset __kiro_integration
fi

# Bun
export PATH="$HOME/.bun/bin:$HOME/.cache/.bun/bin:$PATH"

# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

# fnm is disabled; mise owns Node version switching.
# if command -v fnm >/dev/null 2>&1; then
#   eval "$(fnm env --use-on-cd --shell zsh)"
# fi

# Remove any fnm hook/env/path that may have been loaded earlier.
autoload -U add-zsh-hook
add-zsh-hook -D chpwd _fnm_autoload_hook 2>/dev/null || true
unfunction _fnm_autoload_hook 2>/dev/null || true
unset FNM_MULTISHELL_PATH FNM_VERSION_FILE_STRATEGY FNM_DIR FNM_LOGLEVEL FNM_NODE_DIST_MIRROR FNM_COREPACK_ENABLED FNM_RESOLVE_ENGINES FNM_ARCH
path=("${(@)path:#$HOME/.local/share/mise/installs/node/*/bin}")
path=("${(@)path:#/run/user/*/fnm_multishells/*/bin}")

# mise
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate zsh)"
fi

# zoxide
if command -v zoxide >/dev/null 2>&1; then
  eval "$(zoxide init zsh)"
fi

# Starship prompt
if [[ ${TERM:-} != "dumb" ]] && command -v starship >/dev/null 2>&1; then
  eval "$(starship init zsh)"
fi

# try
if command -v try >/dev/null 2>&1; then
  try() {
    unset -f try
    eval "$(SHELL=/bin/zsh command try init ~/Work/tries)"
    try "$@"
  }
fi

# Antigravity GUI launchers
__antigravity_launch() {
  mkdir -p "$HOME/.cache"
  __antigravity_cleanup_stale_main
  setsid -f /usr/bin/antigravity "$@" >> "$HOME/.cache/antigravity-launch.log" 2>&1 < /dev/null
}

__antigravity_window_exists_for_pid() {
  command -v hyprctl >/dev/null 2>&1 &&
    hyprctl clients -j 2>/dev/null | rg -q "\"pid\": $1"
}

__antigravity_kill_pgid() {
  local pgid
  pgid="$(ps -o pgid= -p "$1" 2>/dev/null | tr -d ' ')"
  [ -n "$pgid" ] || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep 0.3
  kill -KILL -- "-$pgid" 2>/dev/null || true
}

__antigravity_cleanup_stale_main() {
  local pid cmd
  while read -r pid; do
    [ -n "$pid" ] || continue
    cmd="$(ps -p "$pid" -o args= 2>/dev/null)"
    [[ "$cmd" == *"--user-data-dir="* ]] && continue
    __antigravity_window_exists_for_pid "$pid" || __antigravity_kill_pgid "$pid"
  done < <(pgrep -f '^/usr/bin/antigravity( |$)' 2>/dev/null)
}

__antigravity_cleanup_stale_profile() {
  local profile_dir="$1"
  local pid
  while read -r pid; do
    [ -n "$pid" ] || continue
    __antigravity_window_exists_for_pid "$pid" || __antigravity_kill_pgid "$pid"
  done < <(pgrep -f "^/usr/bin/antigravity --user-data-dir=$profile_dir( |$)" 2>/dev/null)
}

__antigravity_kill_profile() {
  local profile_dir="$1"
  local pid
  while read -r pid; do
    [ -n "$pid" ] || continue
    __antigravity_kill_pgid "$pid"
  done < <(pgrep -f "^/usr/bin/antigravity --user-data-dir=$profile_dir( |$)" 2>/dev/null)
}

__antigravity_profile() {
  local profile_num="$1"
  local profile_dir="$HOME/.antigravity-profile-$profile_num"
  shift

  __antigravity_cleanup_stale_profile "$profile_dir"

  mkdir -p \
    "$profile_dir/bin" \
    "$profile_dir/.config" \
    "$profile_dir/.cache" \
    "$profile_dir/.cache/keyring" \
    "$profile_dir/.local/share/keyrings" \
    "$profile_dir/.local/state" \
    "$profile_dir/.gemini"

  # Keep auth/browser callbacks inside this isolated profile.
  cat << 'EOF' > "$profile_dir/bin/xdg-open"
#!/bin/bash
case "$1" in
    antigravity:*)
        exec /usr/bin/antigravity --user-data-dir="$HOME" "$@"
        ;;
    http://*|https://*)
        mkdir -p "$HOME/.browser-profile"
        if command -v brave >/dev/null 2>&1; then
            exec brave --user-data-dir="$HOME/.browser-profile" --new-window "$@"
        elif command -v chromium >/dev/null 2>&1; then
            exec chromium --user-data-dir="$HOME/.browser-profile" --new-window "$@"
        elif command -v google-chrome-stable >/dev/null 2>&1; then
            exec google-chrome-stable --user-data-dir="$HOME/.browser-profile" --new-window "$@"
        fi
        exec /usr/bin/xdg-open "$@"
        ;;
    *)
        exec /usr/bin/xdg-open "$@"
        ;;
esac
EOF
  chmod +x "$profile_dir/bin/xdg-open"

  setsid -f dbus-run-session -- env \
    HOME="$profile_dir" \
    XDG_CONFIG_HOME="$profile_dir/.config" \
    XDG_CACHE_HOME="$profile_dir/.cache" \
    XDG_DATA_HOME="$profile_dir/.local/share" \
    XDG_STATE_HOME="$profile_dir/.local/state" \
    GNOME_KEYRING_CONTROL="$profile_dir/.cache/keyring" \
    PATH="$profile_dir/bin:$PATH" \
    ORIG_HOME="$HOME" \
    ORIG_DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    ORIG_XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    ORIG_XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
    ORIG_XDG_DATA_HOME="$XDG_DATA_HOME" \
    ORIG_XDG_STATE_HOME="$XDG_STATE_HOME" \
    bash -lc '
            mkdir -p "$GNOME_KEYRING_CONTROL"
            eval "$(
                printf "\n" | gnome-keyring-daemon --unlock --components=secrets --control-directory="$GNOME_KEYRING_CONTROL" 2>/dev/null ||
                gnome-keyring-daemon --start --components=secrets --control-directory="$GNOME_KEYRING_CONTROL" 2>/dev/null
            )"
            exec /usr/bin/antigravity --user-data-dir="$HOME" "$@"
        ' antigravity-profile "$@" >> "$HOME/.cache/antigravity-launch-profile-$profile_num.log" 2>&1 < /dev/null
}

antigravity() { __antigravity_launch "$@"; }
ag()          { __antigravity_launch --new-window "$@"; }
ag1()         { __antigravity_profile 1 --profile="Profile 1" --new-window "$@"; }
ag2()         { __antigravity_profile 2 --profile="Profile 2" --new-window "$@"; }

agkill() {
  local pid cmd
  while read -r pid; do
    [ -n "$pid" ] || continue
    cmd="$(ps -p "$pid" -o args= 2>/dev/null)"
    [[ "$cmd" == *"--user-data-dir="* ]] && continue
    __antigravity_kill_pgid "$pid"
  done < <(pgrep -f '^/usr/bin/antigravity( |$)' 2>/dev/null)
}

ag1kill() { __antigravity_kill_profile "$HOME/.antigravity-profile-1"; }
ag2kill() { __antigravity_kill_profile "$HOME/.antigravity-profile-2"; }

# Antigravity CLI
alias agy="$HOME/.local/bin/agy"
alias agyd="$HOME/.local/bin/agy --dangerously-skip-permissions"

__agy_profile() {
  local profile_dir="$HOME/.agy-profile-$1"
  shift

  mkdir -p \
    "$profile_dir/bin" \
    "$profile_dir/.config" \
    "$profile_dir/.cache" \
    "$profile_dir/.local/share" \
    "$profile_dir/.local/share/keyrings" \
    "$profile_dir/.local/state" \
    "$profile_dir/.antigravitycli" \
    "$profile_dir/.gemini/antigravity-browser-profile" \
    "$profile_dir/.gemini/antigravity-cli/brain" \
    "$profile_dir/.gemini/antigravity-cli/conversations" \
    "$profile_dir/.gemini/antigravity-cli/knowledge" \
    "$profile_dir/.gemini/antigravity-cli/log" \
    "$profile_dir/.gemini/antigravity-cli/updater"

  cat << 'EOF' > "$profile_dir/bin/xdg-open"
#!/bin/bash
exec env \
    HOME="$ORIG_HOME" \
    DBUS_SESSION_BUS_ADDRESS="$ORIG_DBUS_SESSION_BUS_ADDRESS" \
    XDG_RUNTIME_DIR="$ORIG_XDG_RUNTIME_DIR" \
    XDG_CONFIG_HOME="$ORIG_XDG_CONFIG_HOME" \
    XDG_DATA_HOME="$ORIG_XDG_DATA_HOME" \
    XDG_STATE_HOME="$ORIG_XDG_STATE_HOME" \
    /usr/bin/xdg-open "$@"
EOF
  chmod +x "$profile_dir/bin/xdg-open"

  dbus-run-session -- env \
    HOME="$profile_dir" \
    XDG_CONFIG_HOME="$profile_dir/.config" \
    XDG_CACHE_HOME="$profile_dir/.cache" \
    XDG_DATA_HOME="$profile_dir/.local/share" \
    XDG_STATE_HOME="$profile_dir/.local/state" \
    PATH="$profile_dir/bin:$PATH" \
    ORIG_HOME="$HOME" \
    ORIG_DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    ORIG_XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    ORIG_XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
    ORIG_XDG_DATA_HOME="$XDG_DATA_HOME" \
    ORIG_XDG_STATE_HOME="$XDG_STATE_HOME" \
    bash -lc '
            printf "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 ||
                gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1
            exec "$ORIG_HOME/.local/bin/agy" "$@"
        ' agy-profile "$@"
}

agy1()  { __agy_profile 1 "$@"; }
agy1d() { __agy_profile 1 --dangerously-skip-permissions "$@"; }
agy2()  { __agy_profile 2 "$@"; }
agy2d() { __agy_profile 2 --dangerously-skip-permissions "$@"; }

# Ghostty integration
if [[ -n ${GHOSTTY_RESOURCES_DIR-} && -r ${GHOSTTY_RESOURCES_DIR}/shell-integration/zsh/ghostty-integration ]]; then
  source "${GHOSTTY_RESOURCES_DIR}/shell-integration/zsh/ghostty-integration"
elif [[ -r /usr/share/ghostty/shell-integration/zsh/ghostty-integration ]]; then
  source /usr/share/ghostty/shell-integration/zsh/ghostty-integration
fi

# zsh-syntax-highlighting should be loaded last so it can wrap final widgets.
if [[ -r /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]]; then
  source /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi

# bun completions
[ -s "/home/abdul-lapi/.bun/_bun" ] && source "/home/abdul-lapi/.bun/_bun"

# >>> grok installer >>>
export PATH="$HOME/.grok/bin:$PATH"
fpath=(~/.grok/completions/zsh $fpath)
autoload -Uz compinit && compinit -C
# <<< grok installer <<<
