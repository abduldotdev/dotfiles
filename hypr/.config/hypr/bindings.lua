-- Personal bindings migrated from bindings.conf for Omarchy Quattro.

local bindings = {
	{
		"SUPER + ALT + RETURN",
		"Tmux",
		[=[uwsm-app -- xdg-terminal-exec --dir="$(omarchy-cmd-terminal-cwd)" tmux new]=],
	},
	{ "SUPER + RETURN", "Terminal", [=[uwsm app -- $TERMINAL --dir="$(omarchy-cmd-terminal-cwd)"]=] },
	{ "SUPER + SHIFT + RETURN", "Browser", "omarchy-launch-browser" },
	{ "SUPER + SHIFT + F", "File manager", "uwsm app -- nautilus --new-window" },
	{ "SUPER + SHIFT + B", "Browser", "omarchy-launch-or-focus brave" },
	{ "SUPER + SHIFT + ALT + B", "Brave Browser", "omarchy-launch-or-focus brave" },
	{ "SUPER + SHIFT + N", "Editor", "omarchy-launch-editor" },
	{ "SUPER + SHIFT + D", "Docker", "omarchy-launch-tui lazydocker" },
	{ "SUPER + SHIFT + O", "Obsidian", 'omarchy-launch-or-focus obsidian "uwsm-app -- obsidian"' },
	{ "SUPER + SHIFT + SLASH", "Passwords", "uwsm app -- 1password" },
	-- { "SUPER + SHIFT + A", "ChatGPT", 'omarchy-launch-webapp "https://chatgpt.com"' },
	{ "SUPER + SHIFT + ALT + A", "Grok", 'omarchy-launch-webapp "https://grok.com"' },
	{ "SUPER + SHIFT + G", "Grok", 'omarchy-launch-webapp "https://gemini.google.com"' },
	{ "SUPER + SHIFT + A", "AI Search", 'omarchy-launch-webapp "https://google.com/ai"' },
	{ "SUPER + SHIFT + E", "Email", 'omarchy-launch-webapp "https://app.hey.com"' },
	{ "SUPER + SHIFT + Y", "YouTube", 'omarchy-launch-or-focus-webapp YouTube "https://youtube.com/"' },
	{ "SUPER + SHIFT + W", "WhatsApp", 'omarchy-launch-or-focus-webapp WhatsApp "https://web.whatsapp.com/"' },
	{
		"SUPER + SHIFT + CTRL + G",
		"Google Messages",
		'omarchy-launch-or-focus-webapp "Google Messages" "https://messages.google.com/web/conversations"',
	},
	{ "SUPER + SHIFT + X", "X", 'omarchy-launch-webapp "https://x.com/"' },
	{ "SUPER + SHIFT + ALT + X", "X Post", 'omarchy-launch-webapp "https://x.com/compose/post"' },
	{ "SUPER + SHIFT + M", "YT Music", 'omarchy-launch-or-focus-webapp "YouTube Music" "https://music.youtube.com"' },
	{ "SUPER + SHIFT + P", "Perplexity", 'omarchy-launch-or-focus-webapp "Perpleixity" "https://perplexity.ai"' },
	{ "SUPER + SHIFT + S", "Smart screenshot to clipboard", "omarchy-capture-screenshot" },
	{ "SUPER + SHIFT + T", "Extract text (OCR) from screenshot", "omarchy capture text" },
}

for _, binding in ipairs(bindings) do
	hl.unbind(binding[1])
	o.bind(binding[1], binding[2], binding[3])
end

-- Replace Omarchy's close/full-screen bindings with the legacy behavior.
hl.unbind("SUPER + W")
hl.unbind("SUPER + Q")
o.bind("SUPER + Q", "Close active window", hl.dsp.window.close())

hl.unbind("SUPER + F")
o.bind("SUPER + F", "Full width", hl.dsp.window.fullscreen({ mode = "maximized" }))

hl.unbind("SUPER + ALT + F")
o.bind("SUPER + ALT + F", "Force full screen", hl.dsp.window.fullscreen({ mode = "fullscreen" }))
