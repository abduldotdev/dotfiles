// Lazygit in a float. Bound to ctrl-space g (mod.open:lazygit).
//
// Starts lazygit in the focused terminal's folder as a sub-terminal of it (so it sits under
// that tab in the agents list) and peeks it over the tab: the same float the agents list
// opens, with the keyboard on it. q quits lazygit and the float goes with it. The float's ✕
// only hides it: lazygit keeps running and ctrl-space g brings the same one back for that tab;
// ↗ keep turns it into a tab.
//
// This mod only draws an invisible 1px popup and closes it. It waits for a new lazygit to show up
// in terminals() before peeking: peeking a terminal Herdr hasn't seen yet fails with a toast.

import { View, div } from "gpui-kit";
import { focused, spaces, terminals, run, hc, props, closeOverlay, notify } from "herdr";

export default class Lazygit extends View {
  init(_props, cx) {
    // Only act when opened by mod.open (`herdr-app check` renders it with no overlay or focus).
    const overlay = props()?.overlay;
    const f = focused();
    if (overlay == null || !f) return;
    cx.spawn(async (cx) => {
      let address = null;
      try {
        address = await this.launch(f);
        if (!(await this.waitLive(cx, address))) throw new Error(`lazygit (${address}) didn't start`);
      } catch (e) {
        address = null;
        notify({ title: "Lazygit", body: String(e?.message ?? e), level: "error" });
      }
      closeOverlay(overlay);
      if (address) run("terminal.peek", { terminal: address });
    });
  }

  // Up to 5 s for the terminal to appear as live (it usually takes a frame or two).
  async waitLive(cx, address) {
    const short = address.replace(/^.*\//, "");
    for (let i = 0; i < 100; i++) {
      if (terminals().some((t) => t.state === "live" && (t.address === address || t.address === short))) return true;
      await new Promise((res) => cx.timer.after(50, () => res(null)));
    }
    return false;
  }

  async launch(f) {
    const tabKey = f.tab || "none";
    const existing = terminals().find(
      (t) => t.state === "live" && t.labels?.["herdr.lazygit"] === tabKey,
    );
    if (existing) return existing.address;

    const machine = spaces().find((s) => s.id === f.space)?.machine ?? null;
    const args = ["run", "--json", "--bg", "--rm", "--no-notify", "--label", `herdr.lazygit=${tabKey}`];
    if (f.terminal) args.push("--parent", f.terminal.replace(/^.*\//, ""));
    else args.push("--no-parent");
    if (f.cwd) args.push("--cwd", f.cwd);
    if (machine) args.push("--on", machine);
    args.push("lazygit");

    const r = await hc(args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || "hc run failed").trim());
    const { address } = JSON.parse(r.stdout);
    return machine && !address.includes("/") ? `${machine}/${address}` : address;
  }

  render() {
    return div();
  }
}
