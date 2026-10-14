// Dragging items onto the Add a Recipe ingredient fields.
import * as H from "./harness.mjs";
const check = (cond, label) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const gm = { id: "gm1", isGM: true, active: true };
const pip = H.mkActor("Pip", "p1");
const honey = H.mkItem({ name: "Honey", type: "loot", system: { quantity: 3 }, flags: {} }, pip);
pip.items.push(honey);
const worldRoot = H.mkItem({ _id: "worldItem0000001", name: "Mandrake Root", type: "loot", system: {}, flags: {} }, null);
H.installGlobals({ actors: [pip], users: [gm], worldItems: [worldRoot] });
const origFromUuid = globalThis.fromUuid;
globalThis.fromUuid = async (u) => {
  if (u === "Item.worldItem0000001") return worldRoot;
  if (u === "Compendium.microbrew.microbrew-items.Item.abc") return { name: "  Frostcap  " };
  if (u === "JournalEntry.j1") return { name: "A Journal" };
  return origFromUuid(u);
};
await import("../scripts/microbrew.mjs");
await H.runHook("init");
game.user = gm;
await H.runHook("ready");
const { acceptItemDrop, droppedItemName } = await import("../scripts/util.mjs");

// A fake drop event / input
const dropEvent = (payload) => ({ preventDefault() { this.prevented = true; }, stopPropagation() {}, dataTransfer: { getData: () => (typeof payload === "string" ? payload : JSON.stringify(payload)) } });
function fakeInput() {
  const handlers = {};
  const input = { value: "", classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } },
    events: [], addEventListener: (t, f) => (handlers[t] = f), dispatchEvent(e) { this.events.push(e.type); handlers[e.type]?.(e); }, handlers };
  return input;
}
globalThis.Event ??= class { constructor(type) { this.type = type; } };

console.log("== Reading a dropped item's name");
check((await droppedItemName(dropEvent({ type: "Item", uuid: "Item.worldItem0000001" }))) === "Mandrake Root", "Items sidebar item");
check((await droppedItemName(dropEvent({ type: "Item", uuid: honey.uuid }))) === "Honey", "item from a character sheet");
check((await droppedItemName(dropEvent({ type: "Item", uuid: "Compendium.microbrew.microbrew-items.Item.abc" }))) === "Frostcap", "compendium item (name trimmed)");
check((await droppedItemName(dropEvent({ type: "Item", data: { name: "Raw Data Herb" } }))) === "Raw Data Herb", "item data dropped directly");
check((await droppedItemName(dropEvent({ type: "JournalEntry", uuid: "JournalEntry.j1" }))) === null, "a journal entry is ignored");
check((await droppedItemName(dropEvent({ type: "Item", uuid: "Item.doesNotExist" }))) === null, "a missing item is ignored");
check((await droppedItemName(dropEvent("not json at all"))) === null, "plain text / junk data is ignored");
globalThis.TextEditor = { getDragEventData: () => ({ type: "Item", uuid: "Item.worldItem0000001" }) };
check((await droppedItemName(dropEvent("ignored"))) === "Mandrake Root", "uses Foundry's TextEditor.getDragEventData when present");
delete globalThis.TextEditor;

console.log("== Dropping onto a field");
const input = fakeInput();
acceptItemDrop(input);
const over = dropEvent({});
input.handlers.dragover(over);
check(over.prevented && input.classList.set.has("microbrew-drop-hover"), "dragover allows the drop and highlights the field");
const ev = dropEvent({ type: "Item", uuid: honey.uuid });
await input.handlers.drop(ev);
check(input.value === "Honey" && ev.prevented && !input.classList.set.has("microbrew-drop-hover"), "drop fills the name, suppresses the browser's text drop, clears the highlight");
check(input.events.includes("input"), "fires an input event, as typing would");
const before = H.log.length;
await input.handlers.drop(dropEvent({ type: "Actor", uuid: "Actor.x" }));
check(input.value === "Honey" && H.log.length === before + 1 && H.log.at(-1).includes("drop an Item"), "dropping a non-Item leaves the field alone and explains why");
check(honey.data.system.quantity === 3 && honey.data.name === "Honey", "the dropped item itself is never changed");

console.log("== Wired into Add a Recipe");
const fields = { ing1: fakeInput(), ing2: fakeInput(), ing3: fakeInput() };
const root = { querySelector: (sel) => fields[/name="(ing\d)"/.exec(sel)?.[1]] ?? null, querySelectorAll: () => [] };
const RealDialog = globalThis.Dialog;
let seen;
globalThis.Dialog = class extends RealDialog {
  constructor(o) { super(o); seen = o; o.render?.([root]); }
};
H.dialogQueue.push({ action: "cancel" });
await game.modules.get("microbrew").api.addRecipe();
check(Object.values(fields).every((f) => typeof f.handlers.drop === "function"), "all three ingredient fields accept drops");
check(/drag an item onto the field/.test(seen.content) && /placeholder="type, or drop an item"/.test(seen.content), "the dialog tells the DM about dragging");
globalThis.Dialog = RealDialog;

console.log("== Wired into the brewing dialog");
canvas.tokens.controlled = [{ actor: pip }];
const idx = await game.packs.get("microbrew.microbrew-tables").getIndex();
const u = (n) => idx.find((e) => e.name === n).uuid;
H.dialogQueue.push({ action: "give", data: { good: u("Brewing Results: Good Effects"), bad: u("Brewing Results: Bad Effects"), cosmetic: u("Brewing Results: Cosmetic Effects") } });
await game.modules.get("microbrew").api.giveKeg();
const keg = pip.items.find((i) => i.data.system?.activities?.brewKegActivity1);
const bf = { ing1: fakeInput(), ing2: fakeInput(), ing3: fakeInput() };
const status = { innerHTML: "" };
const broot = { querySelector: (sel) => (sel === ".microbrew-recipe" ? status : bf[/name="(ing\d)"/.exec(sel)?.[1]] ?? null), querySelectorAll: () => [] };
let brewSeen;
globalThis.Dialog = class extends RealDialog {
  constructor(o) { super(o); brewSeen = o; o.render?.([broot]); }
};
// Fill two fields by typing, drop the third; the live recipe check should react to the drop
bf.ing1.value = "Ash"; bf.ing2.value = "Mint";
const brewDone = (async () => { H.dialogQueue.push({ action: "later" }); await game.modules.get("microbrew").api.brew(keg); })();
await new Promise((r) => setTimeout(r, 0));
await bf.ing3.handlers.drop(dropEvent({ type: "Item", uuid: honey.uuid }));
check(bf.ing3.value === "Honey", "dropping an item fills the brewing dialog's ingredient field");
check(/New combination/.test(status.innerHTML), "the live Recipe Book check updates after a drop");
await brewDone;
globalThis.Dialog = RealDialog;
check(Object.values(bf).every((f) => typeof f.handlers.drop === "function"), "all three brewing ingredient fields accept drops");
check(/list="microbrew-inv"/.test(brewSeen.content) && /<datalist id="microbrew-inv"><option value="Honey"><\/option>/.test(brewSeen.content), "the inventory pick-list is still there (Honey listed)");
check(/drag an item onto the field/.test(brewSeen.content), "the brewing dialog mentions dragging");
