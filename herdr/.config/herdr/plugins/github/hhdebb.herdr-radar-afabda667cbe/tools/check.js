#!/usr/bin/env node
'use strict';

// `npm run check`: the declaration files agree with lib/identity.js, and every
// script parses. No test runner needed for a zero-dependency plugin.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const problems = require('../lib/identity').verify(root);
for (const dir of ['bin', 'lib']) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    if (!file.endsWith('.js')) continue;
    try {
      execFileSync(process.execPath, ['--check', path.join(root, dir, file)], { stdio: 'pipe' });
    } catch (error) {
      problems.push(`${dir}/${file}: ${String(error.stderr).trim().split('\n')[0]}`);
    }
  }
}
// The tab-bar block's poll interval has to stay above its timeout. Inverted, a
// slow tick is still running when the next one starts, and on Windows every tick
// is a fresh `cmd.exe`: the overlap compounds until the machine stops
// responding. That happened. It is two numbers on one generated line — exactly
// the pair that drifts — so read them back out of the text that gets written.
const tabBar = require('../lib/managed-config').block();
const timings = /interval_seconds = (\d+), timeout_seconds = (\d+)/.exec(tabBar);
if (!timings) {
  problems.push('tab-bar block: no longer states an interval and a timeout');
} else if (Number(timings[1]) <= Number(timings[2])) {
  problems.push(
    `tab-bar block: interval_seconds (${timings[1]}) must be greater than timeout_seconds ` +
      `(${timings[2]}); overlapping ticks pile up processes`,
  );
}

// Nothing we write into a terminal's config may set that terminal's primary
// font. Our font holds icons and nothing else, so claiming the primary slot
// sends every ordinary character to a font that cannot draw it and the terminal
// falls back to something the user never picked. Ghostty's `font-family` and
// kitty's `font_family` both do exactly that; only the per-codepoint
// redirections belong in the block. Reported in #4.
const claimsPrimaryFont = /^\s*(font-family|font_family)[\s=]/;
for (const terminal of require('../lib/font').TERMINALS) {
  const line = terminal.lines.find((text) => claimsPrimaryFont.test(text));
  if (line) {
    problems.push(
      `${terminal.name} block: sets the terminal's primary font (${line.trim()}); ` +
        'map our codepoints instead, our font has only icons',
    );
  }
}

// Nor may it quote the family name: terminals read the name literally, so the quotes become part of it,
// nothing matches, and the codepoints fall through to whatever else claims the range (in the PUA, a CJK font).
const family = require('../lib/font').FONT_FAMILY;
// Whitespace inside the quotes is still a quoted name, just a worse one.
const quotesFamily = new RegExp(`["']\\s*${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*["']`);
for (const terminal of require('../lib/font').TERMINALS) {
  const line = terminal.lines.find((text) => quotesFamily.test(text));
  if (line) {
    problems.push(
      `${terminal.name} block: quotes the font family (${line.trim()}); ` +
        'the quotes become part of the name the terminal looks for',
    );
  }
}

// Every colour the sidebar writes has to stay readable on the panel behind it.
//
// Herdr's themes all set `sidebar_bg: Color::Reset`, so the panel is whatever
// the host terminal paints and no value here can know it. The reference panels
// below stand in for it: two real ones this was measured against. They are a
// backstop, not a target — the shipped values clear the floor with room to
// spare, and the point is that a future edit cannot quietly drop below it.
//
// This exists because a value did. `idleStale` was #585a64, which is 2.6:1 on
// a dark panel and capped at 3.06:1 against any background at all, and every
// cell wearing it also asked for the terminal's `dim` — a switch, not a value,
// answered with a third of the way to the background by one terminal and half
// by another. It rendered at 1.8:1 and 1.5:1: present, drawn, unreadable.
// Nothing checked. Reported in #5.
const PANELS = { light: '#eff1f5', dark: '#191724' };
// WCAG's large/bold threshold. Sidebar labels are short and mostly bold; the
// floor is here to catch inks that cannot be read at all, not to force body
// text ratios onto a tier whose job is to recede.
const CONTRAST_FLOOR = 3;

const channel = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Marks, not prose. A vendor's logo is a shape first: coral at 2.8:1 still
// reads as that glyph in that colour, and the Spaces list's "no agent" dot is
// a dot. The floor is about text that cannot be read, so it is scored against
// the inks that carry text and not against these. (Several of the brand values
// are below 3:1 on a light panel, which the palette's own comment claims they
// clear — true of the table as a whole against a darker light panel than the
// reference here, and worth its own look, but not this check's business.)
const palette = require('../lib/palette');
const accent = require('../lib/accent');
const managed = require('../lib/managed-config');

// Contrast must hold both when a live theme accent is present and on the
// fallback path when no accent source exists (where workspace headers and
// spaces marks fall back to palette greys like subtle and idleStale).
const originalCurrent = accent.current;
const liveAccent = originalCurrent();
const accentStates = [liveAccent ?? '#e68e0d', null];

try {
  for (const testAccent of accentStates) {
    accent.current = () => testAccent;
    const markColours = new Set([...Object.values(palette.brand), palette.state.none, testAccent].filter(Boolean));
    for (const [variant, panel] of Object.entries(PANELS)) {
      const text = managed.sidebarBlock(variant);
      // `dim` asks the terminal to fade an ink by an amount it chooses and we
      // cannot measure. Whatever fade a cell needs belongs in its colour.
      if (/dim = true/.test(text)) {
        problems.push(`sidebar block (${variant}): asks for the terminal's dim; put the fade in the colour`);
      }
      for (const colour of new Set(text.match(/#[0-9a-f]{6}/g) ?? [])) {
        if (markColours.has(colour)) continue;
        const ratio = contrast(colour, panel);
        if (ratio < CONTRAST_FLOOR) {
          problems.push(
            `sidebar block (${variant}): ${colour} is ${ratio.toFixed(2)}:1 on ${panel}, ` +
              `under the ${CONTRAST_FLOOR}:1 floor`,
          );
        }
      }
    }
  }
} finally {
  accent.current = originalCurrent;
}

// Accent resolution: verify that accent.current resolves built-in themes,
// custom overrides, omarchy fallback on terminal, aliases, and unknown to null.
const tempAccentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-radar-check-accent-'));
try {
  const tempConfigPath = path.join(tempAccentDir, 'config.toml');
  const tempOmarchyDir = path.join(tempAccentDir, 'omarchy');
  const noOmarchyDir = path.join(tempAccentDir, 'no-omarchy');
  fs.mkdirSync(tempOmarchyDir, { recursive: true });
  fs.writeFileSync(path.join(tempOmarchyDir, 'colors.toml'), 'accent = "#00aabb"\n', 'utf8');

  // (i) [theme] name = "tokyo-night-day" with no custom accent and no omarchy dir -> "#2e7de9"
  fs.writeFileSync(tempConfigPath, '[theme]\nname = "tokyo-night-day"\n', 'utf8');
  const accent1 = accent.current({ configPath: tempConfigPath, omarchyDir: noOmarchyDir });
  if (accent1 !== '#2e7de9') {
    problems.push(`accent.current built-in theme: expected '#2e7de9', got ${JSON.stringify(accent1)}`);
  }

  // (ii) same plus [theme.custom]\naccent = "#123456" -> "#123456"
  fs.writeFileSync(tempConfigPath, '[theme]\nname = "tokyo-night-day"\n\n[theme.custom]\naccent = "#123456"\n', 'utf8');
  const accent2 = accent.current({ configPath: tempConfigPath, omarchyDir: noOmarchyDir });
  if (accent2 !== '#123456') {
    problems.push(`accent.current custom override: expected '#123456', got ${JSON.stringify(accent2)}`);
  }

  // (iii) name = "terminal" with an omarchy colors.toml accent -> that omarchy value
  fs.writeFileSync(tempConfigPath, '[theme]\nname = "terminal"\n', 'utf8');
  const accent3 = accent.current({ configPath: tempConfigPath, omarchyDir: tempOmarchyDir });
  if (accent3 !== '#00aabb') {
    problems.push(`accent.current terminal fall-through: expected '#00aabb', got ${JSON.stringify(accent3)}`);
  }

  // (iv) name = "Tokyo Night" alias -> "#7aa2f7"
  fs.writeFileSync(tempConfigPath, '[theme]\nname = "Tokyo Night"\n', 'utf8');
  const accent4 = accent.current({ configPath: tempConfigPath, omarchyDir: noOmarchyDir });
  if (accent4 !== '#7aa2f7') {
    problems.push(`accent.current alias resolution: expected '#7aa2f7', got ${JSON.stringify(accent4)}`);
  }

  // (v) unknown name and no omarchy -> null
  fs.writeFileSync(tempConfigPath, '[theme]\nname = "unknown-theme-xyz"\n', 'utf8');
  const accent5 = accent.current({ configPath: tempConfigPath, omarchyDir: noOmarchyDir });
  if (accent5 !== null) {
    problems.push(`accent.current unknown theme fallback: expected null, got ${JSON.stringify(accent5)}`);
  }
} finally {
  fs.rmSync(tempAccentDir, { recursive: true, force: true });
}

// Every glyph the font defines has to fall inside a range the installer maps.
//
// The terminal only looks in our font for the codepoints we tell it about, so a
// glyph outside those ranges is drawn from whatever the terminal had — which is
// nothing, silently, while install-font reports success. Adding the 24th vendor
// at E1B7 did exactly that: one past the end of a range written down by hand.
// Read the codepoints back out of the source of truth rather than trusting two
// places to agree.
const codepointsToml = fs.readFileSync(path.join(root, 'tools', 'codepoints.toml'), 'utf8');
const glyphSection = codepointsToml.split(/^\[fit\]/m)[0];
const declared = [...glyphSection.matchAll(/^([a-z_][a-z0-9_]*)\s*=\s*"([0-9A-Fa-f]{4})"/gm)].map(([, name, hex]) => ({
  name,
  point: parseInt(hex, 16),
}));
if (declared.length === 0) {
  problems.push('codepoints.toml: no glyph assignments found — did the file move?');
}
const { RANGES } = require('../lib/font');
const mapped = RANGES.map(([lo, hi]) => [parseInt(lo, 16), parseInt(hi, 16)]);
for (const { name, point } of declared) {
  if (!mapped.some(([lo, hi]) => point >= lo && point <= hi)) {
    problems.push(
      `codepoints.toml: ${name} at U+${point.toString(16).toUpperCase()} is outside every ` +
        'range install-font maps, so the terminal will never look for it',
    );
  }
}

// Every display a pane can carry has to reach the Spaces column, and has to
// land on a token that exists.
//
// Two lists and a mapping have to agree: STATES is what a pane's display can
// be, SPACE_PRIORITY is which of them a workspace's single mark speaks for, and
// spaceToken() names the cell it publishes under. When idle was split into
// three tiers only the first list was updated, so a workspace of fresh or stale
// agents matched nothing and drew the no-agent dot (#11). The second failure is
// quieter still: writeSpaceState nulls every token it does not match, so a name
// outside SPACE_TOKENS does not mis-draw one cell, it clears every state mark on
// the row at once. (The logos and the label survive it — they are written after,
// from a separate object — so the row goes nameless rather than vanishing.)
const state = require('../lib/state');
const spaceTokens = new Set(state.SPACE_TOKENS);
for (const display of state.STATES) {
  if (!state.SPACE_PRIORITY.includes(display)) {
    problems.push(`SPACE_PRIORITY: no entry for '${display}', so a workspace holding only those agents reads as empty`);
  }
  // Vendor only matters for `working`; an unbranded one must still land.
  for (const vendor of [...palette.brandVendors, 'nosuchvendor']) {
    const token = state.spaceToken(display, vendor);
    if (!spaceTokens.has(token)) {
      problems.push(
        `spaceToken('${display}', '${vendor}') is '${token}', which is not in SPACE_TOKENS — ` +
          'it clears every state mark on the row',
      );
    }
  }
}
for (const display of state.SPACE_PRIORITY) {
  if (!state.STATES.includes(display)) {
    problems.push(`SPACE_PRIORITY: '${display}' is not a display any pane can carry`);
  }
}
// A token with no cell in the sidebar block is a mark that never draws.
//
// Matched with the closing quote the generated cell carries, not as a bare
// substring: `$space_idle` occurs inside `$space_idle_fresh`, so a cell renamed
// to something that merely starts with the published name would have satisfied
// a substring test while the name actually published had no cell left.
for (const variant of ['light', 'dark']) {
  const block = managed.sidebarBlock(variant);
  for (const token of state.SPACE_TOKENS) {
    if (!block.includes(`token = "$${token}"`)) {
      problems.push(`sidebar block (${variant}): no cell for $${token}, so that mark never draws`);
    }
  }
}

// The ranges the READMEs print have to be the ranges the installer maps.
//
// A user on a terminal we do not write config for reads them and maps by hand,
// so a stale range there is a silently half-drawn sidebar for exactly the people
// who cannot check it against anything. All three said E1A0-E1B3 long after the
// 24th vendor moved the end to E1B7, and the Chinese one had drifted to E1D1 on
// the second range as well. Derived, because prose does not get recompiled.
const documented = RANGES.map(([lo, hi]) => `U+${lo}\u2013U+${hi}`);
for (const name of ['README.md', 'README.zh-CN.md', 'README.ja.md']) {
  const prose = fs.readFileSync(path.join(root, name), 'utf8');
  // A hyphen is the same range typed on a keyboard without an en dash, and
  // lower-case hex is the same range too. The lookahead stops a fifth digit
  // from being read as a correct four-digit range with a stray character.
  const printed = [...prose.matchAll(/U\+[0-9A-F]{4}[\u2013-]U\+[0-9A-F]{4}(?![0-9A-F])/gi)].map(([text]) =>
    text.toUpperCase().replace('-', '\u2013'),
  );
  for (const range of printed) {
    if (!documented.includes(range)) {
      problems.push(
        `${name}: documents ${range}, which install-font does not map (it maps ${documented.join(' and ')})`,
      );
    }
  }
  for (const range of documented) {
    if (!printed.includes(range)) {
      problems.push(`${name}: never tells a user to map ${range}`);
    }
  }
}

// Reordering workspaces has to settle. The module moves them, Herdr emits
// workspace.reordered, the frame wakes and asks again — so if feeding the
// result back in ever produces a different list, that is not a wrong order,
// it is an infinite write loop over IPC. Idempotence is the whole safety
// argument for the feature, so it is checked rather than assumed.
//
// Randomised because the interesting cases are interactions: families whose
// members start apart, a parent with no key of its own, ties, and parent links
// that happen to form a cycle.
const { desiredOrder } = require('../lib/workspace-order');
const ids = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
let unstable = null;
for (let i = 0; i < 200 && !unstable; i += 1) {
  const order = [...ids].sort(() => Math.random() - 0.5);
  const keys = new Map();
  const parents = new Map();
  for (const id of ids) {
    if (Math.random() < 0.7) keys.set(id, String(Math.floor(Math.random() * 4)).padStart(3, '0'));
    if (Math.random() < 0.25) {
      const parent = ids[Math.floor(Math.random() * ids.length)];
      if (parent !== id) parents.set(id, parent);
    }
  }
  try {
    const once = desiredOrder(order, keys, parents);
    const twice = desiredOrder(once, keys, parents);
    if (once.join() !== twice.join()) {
      unstable = `once=${once.join(',')} twice=${twice.join(',')}`;
    } else if ([...once].sort().join() !== [...order].sort().join()) {
      unstable = `membership changed: in=${order.join(',')} out=${once.join(',')}`;
    }
  } catch (error) {
    unstable = `threw: ${error.message}`;
  }
  if (unstable) {
    unstable += `\n  order=${order.join(',')} keys=${JSON.stringify([...keys])} parents=${JSON.stringify([...parents])}`;
  }
}
if (unstable) {
  problems.push(`workspace order: desiredOrder is not idempotent — ${unstable}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('ok');
