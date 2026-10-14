// Run twice: WITH_LIBWRAPPER=1 and WITH_LIBWRAPPER=0
import * as H from "./harness.mjs";
const { chat, sockets, dialogQueue } = H;
const WITH = process.env.WITH_LIBWRAPPER === "1";
const check = (cond, label) => console.log(`${cond ? "PASS" : "FAIL"}  [${WITH ? "libWrapper" : "hook fallback"}] ${label}`);

const gm = { id: "gm1", isGM: true, active: true }, player = { id: "p1", isGM: false, active: true };
const pip = H.mkActor("Pip", "p1");
H.installGlobals({ actors: [pip], users: [gm, player] });

// dnd5e's utility activity, replaced by a Midi-style subclass whose use() runs its own workflow,
// then (like dnd5e) fires postUseActivity with an activity on a *clone* of the item.
const workflowRuns = [];
class UtilityActivity {
  constructor(item, id) { this.item = item; this.id = id; }
  async use() {
    workflowRuns.push(this.id);
    const clone = { ...this.item, isClone: true, id: this.item.id, actor: this.item.actor, documentName: "Item",
      name: this.item.name, system: this.item.system, getFlag: (...a) => this.item.getFlag(...a),
      update: async () => { throw new Error("updated the clone instead of the real Keg"); } };
    await H.runHook("dnd5e.postUseActivity", { id: this.id, item: clone });
    return { message: "usage card" };
  }
}
class MidiUtilityActivity extends UtilityActivity {}
CONFIG.DND5E = { activityTypes: { utility: { documentClass: MidiUtilityActivity } } };

if (WITH) {
  globalThis.libWrapper = {
    registered: [],
    register(pkg, path, fn, type) {
      const parts = path.split("."); const method = parts.pop();
      const target = parts.reduce((o, k) => o[k], globalThis);
      const original = target[method];
      target[method] = function (...args) { return fn.call(this, original.bind(this), ...args); };
      this.registered.push({ pkg, path, type });
    },
  };
}

await import("../scripts/microbrew.mjs");
await H.runHook("init");
game.user = gm;
await H.runHook("ready");
if (WITH) check(libWrapper.registered[0]?.path === "CONFIG.DND5E.activityTypes.utility.documentClass.prototype.use" && libWrapper.registered[0].type === "MIXED", "wrapper registered on the utility activity's use() (MIXED)");

// Give Pip a keg
canvas.tokens.controlled = [{ actor: pip }];
const idx = await game.packs.get("microbrew.microbrew-tables").getIndex();
const u = (n) => idx.find((e) => e.name === n).uuid;
dialogQueue.push({ action: "give", data: { good: u("Brewing Results: Good Effects"), bad: u("Brewing Results: Bad Effects"), cosmetic: u("Brewing Results: Cosmetic Effects") } });
await game.modules.get("microbrew").api.giveKeg();
const keg = pip.items.find((i) => i.name === "Microbrew Keg");
const act = (id, item = keg) => new CONFIG.DND5E.activityTypes.utility.documentClass(item, id);

// Player uses the Brew activity
game.user = player; canvas.tokens.controlled = [];
const before = chat.length;
await act("brewKegActivity1").use();
const requests = chat.slice(before).filter((m) => m.flags?.world?.microbrewRequest);
check(requests.length === 1, "exactly one brewing request (no double trigger)");
check(WITH ? workflowRuns.length === 0 : workflowRuns.length === 1, WITH ? "Keg activity skipped the activity workflow entirely" : "activity workflow ran, then the hook handled the Keg");

// GM completes the brew from the socket
game.user = gm;
dialogQueue.push({ action: "brew", data: { ing1: "Honey", ing2: "Ash", ing3: "Mint", consume: false, servings: "2" } });
await sockets.handlers["module.microbrew"][0](sockets.emitted.at(-1).data);
check(keg.data.flags.world.microbrew?.servings === 2, "brew landed on the real Keg");

// Player drinks via the activity
game.user = player;
await act("drinkBrewActvty1").use();
check(keg.data.flags.world.microbrew?.servings === 1, "drink updated the real Keg (not dnd5e's clone)");

// Some other item's utility activity passes through untouched
const torch = H.mkItem({ name: "Torch", type: "consumable", system: { activities: {} }, flags: {} }, pip);
pip.items.push(torch);
const runsBefore = workflowRuns.length;
const res = await act("someOtherActivity", torch).use();
check(res?.message === "usage card" && workflowRuns.length === runsBefore + 1, "other activities run their normal workflow");
