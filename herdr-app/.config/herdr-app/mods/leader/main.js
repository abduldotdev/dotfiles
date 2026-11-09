// Ctrl+Space prefix: keys.json opens this invisible popup, which takes the next
// key, closes, and runs that key's action from bindings.json (same action
// forms as keys.json, plus {exec: [program, ...args]} to start a desktop program
// detached, "{cwd}" in its args being the focused pane's folder). While it waits, shared "leader.active" is true, so the
// status bar can show the prefix is armed.

import { View, div } from "gpui-kit";
import { run, commands, readTextFile, appHome, closeOverlay, props, setShared, exec, focused, panes, spaces } from "herdr";

export default class Leader extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.bindings = {};
    setShared("leader.active", true);
    cx.spawn(async () => {
      try { this.bindings = JSON.parse((await readTextFile(`${appHome()}/mods/leader/bindings.json`)) ?? "{}"); } catch {}
    });
    this.handle.focus();
    cx.timer.after(30, () => this.handle.focus());
  }

  async close() {
    setShared("leader.active", false);
  }

  done() {
    setShared("leader.active", false);
    closeOverlay(props().overlay);
  }

  // "name", "name:value" (value fills the first argument), {command, args} or {exec}.
  act(action) {
    if (action.exec) {
      const f = focused();
      const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
      const cwd = pane?.cwd || f?.cwd || spaces().find((s) => s.active)?.folder || "";
      return exec("setsid", ["-f", ...action.exec.map((a) => a.replaceAll("{cwd}", cwd))]).catch(() => null);
    }
    if (typeof action === "object") return run(action.command, action.args ?? {});
    const i = action.indexOf(":");
    if (i < 0) return run(action);
    const name = action.slice(0, i);
    const first = commands().find((c) => c.name === name)?.args?.[0]?.name;
    run(name, first ? { [first]: action.slice(i + 1) } : {});
  }

  render() {
    return div()
      .id("leader")
      .track_focus(this.handle)
      .size_full()
      .on_key_down((e, cx) => {
        cx.stop_propagation();
        const action = this.bindings[e.keystroke.toLowerCase()];
        this.done();
        if (action) this.act(action);
      });
  }
}
