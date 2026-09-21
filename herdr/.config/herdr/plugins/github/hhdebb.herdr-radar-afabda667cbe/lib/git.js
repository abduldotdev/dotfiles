'use strict';

// Git repository inspection: branch names and ahead-of-upstream commit counts.
//
// Herdr's own `branch` token follows the pane's launch directory, and the agent
// harnesses that print a branch read it once and cache it — so both go stale the
// moment an agent runs `git checkout` mid-session. Reading HEAD is always
// current, and it is only a file read: this runs on the tab-bar's two-second
// timer, where spawning `git` would be far too expensive (quirks §7).
//
// The Spaces list needs more than the branch: it flags workspaces that have
// local commits pending push (`↑3`). But asking git rev-list on every 150ms
// frame tick would melt the machine. The computation is cached per path and
// only re-spawns when either:
//   (a) the filesystem mtime of HEAD, logs/HEAD, packed-refs, or the current /
//       upstream ref files changed, or
//   (b) a rate-limiting floor of at least 30 seconds has elapsed since the last
//       spawn for that path.
// Spawns never run concurrently for the same checkout; in-flight queries return
// the last known value immediately.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AHEAD_TIMEOUT_MS = 3000;
const AHEAD_SPAWN_FLOOR_MS = 30000;

// `.git` is a directory in a normal clone and a file in a worktree or submodule,
// where it holds `gitdir: <path>` pointing at the real one.
function gitDir(start) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.git');
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) return candidate;
      if (stat.isFile()) {
        const pointer = fs
          .readFileSync(candidate, 'utf8')
          .match(/^gitdir:\s*(.+)$/m)?.[1]
          ?.trim();
        if (pointer) return path.resolve(dir, pointer);
      }
    } catch {
      // Not here; keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// In a worktree, `HEAD` and `logs/HEAD` live in the worktree git dir, while
// `packed-refs`, `refs/remotes`, and config live in the common git repository
// dir pointed to by `commondir`.
function gitDirs(start) {
  const dir = gitDir(start);
  if (!dir) return null;
  let commonDir = dir;
  try {
    const pointer = fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim();
    if (pointer) commonDir = path.resolve(dir, pointer);
  } catch {
    // Regular clone; dir is the common dir.
  }
  return { dir, commonDir };
}

function branchRef(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
    const match = head.match(/^ref:\s*(refs\/heads\/.+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function upstreamRefFile(commonDir, dir, branchName) {
  if (!branchName) return null;
  const configs = [path.join(dir, 'config.worktree'), path.join(commonDir, 'config')];
  for (const cfg of configs) {
    try {
      const text = fs.readFileSync(cfg, 'utf8');
      const escaped = branchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\[branch\\s+"${escaped}"\\]([^\\[]+)`, 'i');
      const match = text.match(re);
      if (match) {
        const body = match[1];
        const remote = body.match(/^\s*remote\s*=\s*([^\s#;]+)/m)?.[1]?.trim();
        const merge = body.match(/^\s*merge\s*=\s*([^\s#;]+)/m)?.[1]?.trim();
        if (remote && merge) {
          if (remote === '.') return path.join(commonDir, merge);
          const remoteBranch = merge.replace(/^refs\/heads\//, '');
          return path.join(commonDir, 'refs', 'remotes', remote, remoteBranch);
        }
      }
    } catch {
      // Unreadable or missing config.
    }
  }
  return null;
}

function mtime(file) {
  if (!file) return 0;
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function mtimeSignature(dirs) {
  const { dir, commonDir } = dirs;
  const bRef = branchRef(dir);
  const bName = bRef ? bRef.replace(/^refs\/heads\//, '') : null;
  const uFile = upstreamRefFile(commonDir, dir, bName);

  return [
    mtime(path.join(dir, 'HEAD')),
    mtime(path.join(dir, 'logs', 'HEAD')),
    mtime(path.join(commonDir, 'packed-refs')),
    bRef ? mtime(path.join(commonDir, bRef)) : 0,
    bRef ? mtime(path.join(dir, bRef)) : 0,
    mtime(uFile),
    mtime(path.join(commonDir, 'config')),
  ].join(':');
}

function branch(cwd) {
  if (!cwd) return null;
  const dir = gitDir(cwd);
  if (!dir) return null;
  let head;
  try {
    head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1];
  if (ref) return ref;
  // Detached HEAD holds a raw sha. Seven characters is what git itself shows.
  return /^[0-9a-f]{7,40}$/i.test(head) ? head.slice(0, 7) : null;
}

const aheadCache = new Map();

function cachedAhead(checkoutPath) {
  if (!checkoutPath) return null;
  const abs = path.resolve(checkoutPath);
  return aheadCache.get(abs)?.value ?? null;
}

function ahead(checkoutPath) {
  if (!checkoutPath) return Promise.resolve(null);
  const abs = path.resolve(checkoutPath);

  let entry = aheadCache.get(abs);
  if (!entry) {
    entry = { value: null, mtimeSig: null, lastSpawn: 0, inFlight: null };
    aheadCache.set(abs, entry);
  }

  if (entry.inFlight) {
    return Promise.resolve(entry.value);
  }

  const dirs = gitDirs(abs);
  if (!dirs) {
    entry.value = null;
    return Promise.resolve(null);
  }

  const now = Date.now();
  const currentSig = mtimeSignature(dirs);
  const sigChanged = entry.mtimeSig === null || entry.mtimeSig !== currentSig;
  const floorPassed = entry.lastSpawn > 0 && now - entry.lastSpawn >= AHEAD_SPAWN_FLOOR_MS;

  if (!sigChanged && !floorPassed) {
    return Promise.resolve(entry.value);
  }

  entry.lastSpawn = now;

  const spawnPromise = new Promise((resolve) => {
    execFile(
      'git',
      ['-C', abs, 'rev-list', '--count', '@{upstream}..HEAD'],
      { timeout: AHEAD_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        entry.inFlight = null;
        if (error) {
          entry.value = null;
          entry.mtimeSig = currentSig;
          return resolve(null);
        }
        const count = Number.parseInt(String(stdout).trim(), 10);
        entry.value = Number.isFinite(count) && count > 0 ? `↑${count}` : null;
        entry.mtimeSig = currentSig;
        resolve(entry.value);
      },
    );
  });

  entry.inFlight = spawnPromise;
  return spawnPromise;
}

module.exports = {
  branch,
  ahead,
  cachedAhead,
  gitDir,
};
