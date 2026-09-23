# If not running interactively, don't do anything (leave this at the top of this file)
[[ $- != *i* ]] && return

# All the default Omarchy aliases and functions
source ~/.local/share/omarchy/default/bash/envs
source ~/.local/share/omarchy/default/bash/shell
source ~/.local/share/omarchy/default/bash/aliases
source ~/.local/share/omarchy/default/bash/functions
[[ $- == *i* ]] && bind -f ~/.local/share/omarchy/default/bash/inputrc

# Bash inline autosuggestions and enhanced line editing
[[ -r /usr/share/blesh/ble.sh ]] && source -- /usr/share/blesh/ble.sh --noattach
[[ ${BLE_VERSION-} ]] && bleopt prompt_command_changes_layout=1

source ~/.local/share/omarchy/default/bash/init

# ── User config ──────────────────────────────────────────────────────────────

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
[[ "$TERM_PROGRAM" == "kiro" ]] && . "$(kiro --locate-shell-integration-path bash)"

# Bun
export PATH="$HOME/.bun/bin:$HOME/.cache/.bun/bin:$PATH"

# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

# fnm is disabled; mise owns Node version switching.
# eval "$(fnm env --use-on-cd)"

# Remove stale Node manager paths before activating mise.
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -Ev "^$HOME/\\.local/share/mise/installs/node/.*/bin$|^/run/user/.*/fnm_multishells/.*/bin$" | paste -sd: -)"
export PATH

# mise
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi

# ── Antigravity GUI launchers ─────────────────────────────────────────────────

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

# ── Antigravity CLI ───────────────────────────────────────────────────────────

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

# Ghostty integration is loaded manually so its prompt hooks exist before
# ble.sh attaches and renders the first interactive prompt.
if [[ -n ${GHOSTTY_RESOURCES_DIR-} && -r ${GHOSTTY_RESOURCES_DIR}/shell-integration/bash/ghostty.bash ]]; then
  source "${GHOSTTY_RESOURCES_DIR}/shell-integration/bash/ghostty.bash"
fi

# ── ble.sh attach (must be last) ──────────────────────────────────────────────
[[ ${BLE_VERSION-} ]] && ble-attach

. "$HOME/.atuin/bin/env"
eval "$(atuin init bash)"
