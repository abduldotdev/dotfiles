// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, exec, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
// Same marks as the spaces list, so a workspace reads the same in both.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// Tree lines, one cell per level: "├" an elbow that carries on down, "└" the last
// elbow, "│" a line past a sibling's children, "" a gap. A level is LEVEL wide so
// each line sits under its parent's icon.
const LEVEL = 26;
const gutter = (t, lines) => h_flex().self_stretch().flex_none().children(lines.map((l, i) => {
  const cell = v_flex().self_stretch().w(9).flex_none().when(i < lines.length - 1, (el) => el.mr(LEVEL - 9));
  if (l === "│") return cell.child(div().flex_1().border_l(1.5).border_color(t.input));
  if (l !== "├" && l !== "└") return cell;
  return cell
    .child(div().flex_1().border_l(1.5).border_b(1.5).rounded_bl(6).border_color(t.input))
    .child(div().flex_1().when(l === "├", (el) => el.border_l(1.5).border_color(t.input)));
}));
// What a child's lines start with: its parent's, the parent's own elbow turned into a run.
const below = (lines) => lines.map((l, i) => (i < lines.length - 1 ? l : l === "├" ? "│" : ""));
// Where a space is now (as the spaces list reads it): its first terminal's live folder.
const place = (s, ps) => {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
};
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
// An agent on another machine has a `machine/` address prefix; null for this computer.
const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : null);
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    this.git = {}; // where() -> { repo, linked } | null (not a repo)
    this.checked = {};
    this.asking = new Set();
    this.refreshGit(cx);
    cx.timer.every(3000, (cx) => this.refreshGit(cx));
  }

  // Which spaces are git worktrees of which checkout: new places at once, the rest each minute.
  refreshGit(cx) {
    const ps = panes();
    const now = Date.now();
    for (const sp of spaces()) {
      const key = where(sp, ps);
      const [on, cwd] = JSON.parse(key);
      if (!cwd || this.asking.has(key)) continue;
      if (key in this.git && now - (this.checked[key] ?? 0) < 60000) continue;
      this.asking.add(key);
      this.checked[key] = now;
      cx.spawn(async (cx) => {
        const before = JSON.stringify(this.git[key] ?? null);
        try {
          const r = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, on });
          const [top, common] = r.stdout.trim().split("\n");
          this.git[key] = r.code === 0 && common ? { repo: JSON.stringify([on, common]), linked: common !== `${top}/.git` } : null;
        } catch {
          this.git[key] ??= null;
        }
        this.asking.delete(key);
        if (JSON.stringify(this.git[key]) !== before) cx.notify();
      });
    }
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact, under = null) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .when(under === null, (el) => el.pl(39))
      .when(under !== null, (el) => el.pl(15).child(gutter(t, [...under, ...s.lines]).mr(9)))
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      // Sub-agents open in the peek pop-up; only top-level rows switch tabs.
      .on_click(() => this.peek(k.address))
      .children((under === null ? s.lines : []).map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: a ! for blocked where a header already says "Needs you".
  status(t, a, compact = false) {
    const color = t[a.status] ?? t.dim;
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    // Idle: a ring; done: a dot.
    if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    // A sub-agent with its own pane is in agents() too, but it already shows in
    // its parent's tree: only agents with no listed live ancestor get a row.
    const byAddr = new Map(all.map((k) => [k.address, k]));
    const nested = (a) => {
      for (let p = byAddr.get(a.address)?.parent, seen = 0; p && seen < 32; seen++) {
        const up = byAddr.get(p);
        if (!up || up.state !== "live") return false;
        if (this.listed.has(p)) return true;
        p = up.parent;
      }
      return false;
    };
    list = list.filter((a) => !nested(a));
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    // `lines`: its tree lines under a workspace (null: not under one).
    const withKids = (a, i, lines = null) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs, lines);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, true, lines === null ? null : below(lines)))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const ps = panes();
    const leads = leadPanes(ps);
    const tabLabels = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, title(tab, leads.get(tab.id))]));
    const labels = new Map(list.map(a => [a.address, tabLabels.get(a.tab) ?? (a.title || a.program?.name || "")]));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    // The zsh launcher that started each agent (cld1, agy2d…), from the `profile` label.
    const profiles = new Map(terminals().filter((x) => x.labels?.profile).map((x) => [x.address, x.labels.profile]));

    const row = (a, i, subs = [], lines = null) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      // Under a machine header (priority, unpinned) the machine goes without saying.
      const machine = byPriority && !a.pinned ? null : machineOf(a);
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = (byPriority || isPinned) && lines === null;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .when(lines !== null, (el) => el.pl(15).child(gutter(t, lines)))
        .h(30)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(profiles.has(a.address), el => el.child(div().flex_none().px(5).h(16).flex().items_center().rounded(4).bg(t.hover).text_size(10).font_medium().text_color(t.dim).child(profiles.get(a.address))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    if (byPriority) {
      // Priority: one group per machine (this computer first), most urgent first inside.
      const byMachine = new Map([["local", []]]);
      for (const a of rest) {
        const m = machineOf(a) ?? "local";
        if (!byMachine.has(m)) byMachine.set(m, []);
        byMachine.get(m).push(a);
      }
      for (const [m, members] of byMachine) {
        if (members.length) groups.push({ id: `machine-${m}`, label: m === "local" ? "This computer" : m, status: null, members });
      }
    } else {
      for (const a of rest) {
        const id = `sp-${a.space}`;
        if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
        else groups.push({ id, label: a.space_name || "", status: null, members: [a] });
      }
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    // A machine's header stands out: a rule above it (but the first), its icon, its name in
    // capitals and a count pill, so the machines read as separate blocks.
    const machineHeader = (g, first) => {
      const open = !this.folded.has(g.id);
      const local = g.id === "machine-local";
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return v_flex()
        .flex_none()
        .when(!first, (el) => el.mt(8).child(div().mx(4).h(1).bg(t.border)))
        .child(h_flex()
          .id(g.id)
          .mt(first ? 2 : 8)
          .mb(2)
          .px(8)
          .h(26)
          .gap(7)
          .items_center()
          .rounded(6)
          .bg(t.hover)
          .cursor_pointer()
          .hover((s) => s.bg(t.selected))
          .on_click((_e, cx) => {
            open ? this.folded.add(g.id) : this.folded.delete(g.id);
            cx.notify();
          })
          .child(svg(`mods/workspace-chrome/${local ? "monitor" : "server"}.svg`).size(13).flex_none().text_color(local ? t.foreground : t.ansi4 ?? t.foreground))
          .child(div().flex_1().min_w(0).truncate().text_size(11).font_bold().text_color(t.foreground).child(g.label.toUpperCase()))
          .when(!open && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(div().flex_none().px(6).h(16).flex().items_center().rounded(8).bg(t.border).text_size(10.5).font_medium().text_color(t.foreground).child(String(g.members.length)))
          .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim)));
    };
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    // A space (or a worktree of one) over what runs in it; it folds them.
    const spaceColors = shared("space.colors") ?? {};
    const folder = (id, open) => (el) => el.on_click((_e, cx) => {
      open ? this.folded.add(id) : this.folded.delete(id);
      cx.notify();
    });
    const tail = (members, open) => (el) => {
      const top = members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return el
        .child(div().flex_none().text_size(11).text_color(t.dim).child(String(members.length)))
        .when(!open && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim));
    };
    const spaceRow = (id, sp, members) => {
      const open = !this.folded.has(`ws-${id}`);
      const name = sp?.name || members[0]?.space_name || "";
      const color = spaceColors[id] ?? "ansi6";
      const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color] ?? t.dim);
      return h_flex()
        .id(`ws-${id}`)
        .px(8)
        .h(28)
        .flex_none()
        .rounded(8)
        .gap(9)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .map(folder(`ws-${id}`, open))
        .child(h_flex().size(16).flex_none().items_center().justify_center().child(svg("mods/workspace-chrome/folder.svg").size(14).text_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(name))
        .map(tail(members, open));
    };
    const worktreeRow = (id, sp, members, lines) => {
      const open = !this.folded.has(`ws-${id}`);
      const name = sp?.name || members[0]?.space_name || "";
      const branch = sp?.branch && sp.branch !== name ? sp.branch : null;
      return h_flex()
        .id(`ws-${id}`)
        .pl(15)
        .pr(8)
        .h(28)
        .flex_none()
        .rounded(8)
        .gap(9)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .map(folder(`ws-${id}`, open))
        .child(gutter(t, lines))
        .child(svg("mods/workspace-chrome/git-branch.svg").size(14).flex_none().text_color(t.dim))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).truncate().text_color(t.foreground).child(name))
          .when(Boolean(branch), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(branch))))
        .map(tail(members, open));
    };
    // A machine's agents as a tree: space, then its own agents and its git worktrees
    // (each over its agents), then sub-agents. Most urgent first at every level.
    const allSpaces = spaces();
    const spaceById = new Map(allSpaces.map((sp) => [sp.id, sp]));
    const gitOf = (id) => {
      const sp = spaceById.get(id);
      return sp ? this.git[where(sp, ps)] ?? null : null;
    };
    const mainOf = new Map(); // repo -> the space of its main checkout
    for (const sp of allSpaces) {
      const g = gitOf(sp.id);
      if (g && !g.linked && !mainOf.has(g.repo)) mainOf.set(g.repo, sp.id);
    }
    const parentOf = (id) => {
      const g = gitOf(id);
      const m = g?.linked ? mainOf.get(g.repo) : null;
      return m && m !== id ? m : null;
    };
    const spaceTrees = (members) => {
      const bySpace = new Map();
      for (const a of members) {
        if (!bySpace.has(a.space)) bySpace.set(a.space, []);
        bySpace.get(a.space).push(a);
      }
      const roots = [];
      const worktrees = new Map();
      for (const id of bySpace.keys()) {
        const p = parentOf(id);
        if (!roots.includes(p ?? id)) roots.push(p ?? id);
        if (p) worktrees.set(p, [...(worktrees.get(p) ?? []), id]);
      }
      return roots.flatMap((id) => {
        const own = bySpace.get(id) ?? [];
        const wts = worktrees.get(id) ?? [];
        const head = spaceRow(id, spaceById.get(id), [...own, ...wts.flatMap((w) => bySpace.get(w))]);
        if (this.folded.has(`ws-${id}`)) return [head];
        const items = [...own.map((a) => ({ a })), ...wts.map((w) => ({ w }))];
        return [head, ...items.flatMap((it, i) => {
          const lines = [i === items.length - 1 ? "└" : "├"];
          if (it.a) return withKids(it.a, i, lines);
          const ms = bySpace.get(it.w);
          const wrow = worktreeRow(it.w, spaceById.get(it.w), ms, lines);
          if (this.folded.has(`ws-${it.w}`)) return [wrow];
          return [wrow, ...ms.flatMap((a, j) => withKids(a, j, [...below(lines), j === ms.length - 1 ? "└" : "├"]))];
        })];
      });
    };
    // Priority: a header per machine over its workspace trees, most urgent first.
    const rows = collapsed
      ? list.flatMap((a, i) => withKids(a, i))
      : groups.flatMap((g, gi) => [g.id.startsWith("machine-") ? machineHeader(g, gi === 0) : header(g), ...(this.folded.has(g.id) ? [] : byPriority && g.id !== "pinned" ? spaceTrees(g.members) : g.members.flatMap((a, i) => withKids(a, i)))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      // The rule between the spaces and agents lists, red so the two read apart.
      .border_t(2)
      .border_color(t.ansi1 ?? t.blocked)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "agents-profile", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
