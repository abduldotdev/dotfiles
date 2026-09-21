'use strict';

// The theme accent colour: Herdr's `terminal` theme paints its accent from the
// host terminal's ANSI palette, but sidebar cells accept only a hex `#rrggbb`.
// A hardcoded hex would freeze one theme's accent into every other theme, so
// this module resolves the active accent (from a hand-written override,
// Herdr's built-in theme palette, or omarchy's active theme) and re-finds it
// when the theme changes.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { herdrConfigPath } = require('./paths');
const { dropBlock, tableValue, tableRaw } = require('./toml-blocks');
const identity = require('./identity');
const appearance = require('./appearance');

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Transcribed from herdrdev/herdr v0.9.1 src/app/state.rs.
// Canonical names from src/config/theme.rs canonical_theme_name.
// Must be re-checked when Herdr adds themes.
const BUILTIN_ACCENTS = {
  catppuccin: '#89b4fa',
  'catppuccin-latte': '#1e66f5',
  'tokyo-night': '#7aa2f7',
  'tokyo-night-day': '#2e7de9',
  dracula: '#bd93f9',
  nord: '#88c0d0',
  gruvbox: '#d79921',
  'gruvbox-light': '#076678',
  'one-dark': '#61afef',
  'one-light': '#4078f2',
  solarized: '#268bd2',
  'solarized-light': '#268bd2',
  kanagawa: '#7e9cd8',
  'kanagawa-lotus': '#4d699b',
  'rose-pine': '#c4a7e7',
  'rose-pine-dawn': '#907aa9',
  vesper: '#ffc799',
};

// Herdr canonicalises names: lowercase, spaces/underscores -> '-', plus aliases.
const THEME_ALIASES = {
  'catppuccin-mocha': 'catppuccin',
  latte: 'catppuccin-latte',
  light: 'catppuccin-latte',
  tokyonight: 'tokyo-night',
  'tokyo-day': 'tokyo-night-day',
  'tokyonight-day': 'tokyo-night-day',
  'gruvbox-dark': 'gruvbox',
  onedark: 'one-dark',
  onelight: 'one-light',
  'solarized-dark': 'solarized',
  lotus: 'kanagawa-lotus',
  rosepine: 'rose-pine',
  'rosepine-dawn': 'rose-pine-dawn',
  dawn: 'rose-pine-dawn',
};

function canonicalThemeName(name) {
  if (typeof name !== 'string') return '';
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return THEME_ALIASES[normalized] ?? normalized;
}

function defaultOmarchyDir() {
  const base = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'omarchy', 'current', 'theme');
}

function fileMtime(filePath) {
  try {
    return String(fs.statSync(filePath).mtimeMs);
  } catch {
    return '';
  }
}

function realPath(dirPath) {
  try {
    return fs.realpathSync(dirPath);
  } catch {
    return '';
  }
}

// Current accent colour as `#rrggbb` lowercase, or null.
// Sources, first hit wins:
//   a. Hand-written `accent = "..."` under `[theme.custom]` in Herdr's config.toml
//      (or `[theme.custom.light]`/`[theme.custom.dark]` for current appearance)
//      outside our managed theme block.
//   b. Herdr's built-in theme palette from `[theme]` in config.toml (evaluating
//      `auto_switch` and appearance to pick the effective theme).
//   c. omarchy's active theme: colors.toml `accent = "#rrggbb"`.
//   d. null.
function current({ configPath = herdrConfigPath(), omarchyDir = defaultOmarchyDir() } = {}) {
  // Source (a) & (b): config.toml custom overrides and built-in theme
  try {
    if (fs.existsSync(configPath)) {
      const text = fs.readFileSync(configPath, 'utf8');
      const themeMarkers = identity.markers('theme');
      const outside = dropBlock(text, themeMarkers.start, themeMarkers.end);

      let app = null;
      try {
        app = appearance.current();
      } catch {
        app = null;
      }

      // Source (a): hand-written custom accent overrides
      if (app) {
        const variantAccent = tableValue(outside, `theme.custom.${app}`, 'accent');
        if (variantAccent && HEX_COLOR.test(variantAccent)) {
          return variantAccent.toLowerCase();
        }
      }
      const customAccent = tableValue(outside, 'theme.custom', 'accent');
      if (customAccent && HEX_COLOR.test(customAccent)) {
        return customAccent.toLowerCase();
      }

      // Source (b): Herdr built-in theme from [theme]
      const isAutoSwitch =
        tableRaw(outside, 'theme', 'auto_switch') === 'true' || tableValue(outside, 'theme', 'auto_switch') === 'true';

      let themeName = null;
      if (isAutoSwitch && app) {
        themeName =
          app === 'dark' ? tableValue(outside, 'theme', 'dark_name') : tableValue(outside, 'theme', 'light_name');
      }
      if (!themeName) {
        themeName = tableValue(outside, 'theme', 'name');
      }

      if (themeName) {
        const canonical = canonicalThemeName(themeName);
        const builtInAccent = BUILTIN_ACCENTS[canonical];
        if (builtInAccent && HEX_COLOR.test(builtInAccent)) {
          return builtInAccent.toLowerCase();
        }
      }
    }
  } catch {
    // Fall through to source (c)
  }

  // Source (c): omarchy's active theme colors.toml
  try {
    const colorsPath = path.join(omarchyDir, 'colors.toml');
    if (fs.existsSync(colorsPath)) {
      const colorsText = fs.readFileSync(colorsPath, 'utf8');
      const match = colorsText.match(/^accent\s*=\s*"([^"]+)"/m);
      if (match && HEX_COLOR.test(match[1])) {
        return match[1].toLowerCase();
      }
    }
  } catch {
    // Fall through to null
  }

  return null;
}

// Cheap change-detection signature with no parsing. Concatenates:
// (a) mtime of config.toml (which already covers Herdr theme name changes under [theme]);
// (b) realpath of theme directory plus colors.toml mtime.
// Never throws; missing pieces contribute ''.
function signature({ configPath = herdrConfigPath(), omarchyDir = defaultOmarchyDir() } = {}) {
  let a = '';
  try {
    a = fileMtime(configPath);
  } catch {
    a = '';
  }

  let b = '';
  try {
    b = `${realPath(omarchyDir)}:${fileMtime(path.join(omarchyDir, 'colors.toml'))}`;
  } catch {
    b = '';
  }

  return `${a}:${b}`;
}

module.exports = { current, signature, BUILTIN_ACCENTS, canonicalThemeName };
