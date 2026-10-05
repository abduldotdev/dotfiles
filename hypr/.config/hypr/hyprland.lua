-- Learn how to configure Hyprland: https://wiki.hypr.land/Configuring/Start/

-- Omarchy's bootstrap keeps path setup out of this user config.
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")

-- Disable all Omarchy default bindings. Add your own in hypr/bindings.lua.
-- omarchy_default_bindings = false
--
-- Or disable only bindings for Omarchy's preinstalled apps/web apps while
-- keeping core window-manager bindings:
-- omarchy_preinstalled_bindings = false

-- Load Omarchy defaults.
require("default.hypr.omarchy")

-- Put your personal overrides in these files. They're loaded after Omarchy's
-- defaults so package updates can improve the defaults without rewriting your
-- ~/.config/hypr files.
require("hypr.envs")
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")

-- Toggle config flags dynamically.
require("default.hypr.toggles")

-- Add any other personal Hyprland configuration below.
-- o.window("qemu", { workspace = "5" })


-- [key-visualizer] capture hook (managed by the plugin; safe to remove)
local kc_path = os.getenv("HOME") .. "/.config/omarchy/plugins/felixzsh.key-visualizer/key-visualizer.lua"
local kc_file = io.open(kc_path, "r")
if kc_file then kc_file:close(); dofile(kc_path) end


-- [mouse-mark] capture hook (managed by the plugin; safe to remove)
local mm_path = os.getenv("HOME") .. "/.config/omarchy/plugins/sanbid.mouse-mark/mouse-mark.lua"
local mm_file = io.open(mm_path, "r")
if mm_file then mm_file:close(); dofile(mm_path) end




-- [wispr-flow] overlay hide rule (managed by abdul.wispr-flow; safe to remove)
local wf_path = "/home/abdul/.config/omarchy/plugins/abdul.wispr-flow/hypr/wispr-flow.lua"
local wf_file = io.open(wf_path, "r")
if wf_file then wf_file:close(); dofile(wf_path) end

-- Added by hyprmoncfg: its generated monitor rules load last, so nothing before this can override the applied layout.
do local path = os.getenv("HOME") .. "/.config/hypr/hyprmoncfg-monitors.lua"; local file = io.open(path, "r"); if file then file:close(); dofile(path) end end
