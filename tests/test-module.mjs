import * as H from "./harness.mjs";
const { log, chat, dialogQueue, dialogLog, sockets, settings } = H;
const out = (m) => console.log(m);
const check = (cond, label) => out(`${cond ? "PASS" : "FAIL"}  ${label}`);

// ---- World: GM + player; Pip owned by player; a legacy keg from the macro version on Bram ----
const gm = { id: "gm1", isGM: true, active: true, name: "DM" };
const player = { id: "p1", isGM: false, active: true, name: "Player", character: null };
const pip = H.mkActor("Pip", "p1");
const bram = H.mkActor("Bram", "p2");
player.character = pip;
pip.items.push(H.mkItem({ name: "Honey", type: "loot", system: { quantity: 2 }, flags: {} }, pip));
// legacy keg (macro-based version): old icon, activity-macro flags, old description link, world-scope contents
const legacyKeg = H.mkItem({
  name: "Microbrew Keg", type: "consumable", img: "icons/containers/barrels/barrel-open-brown-red.webp",
  system: { description: { value: "old @UUID[Macro.microbrewKegMcr1]{Brew}" }, activities: {
    brewKegActivity1: { _id: "brewKegActivity1", type: "utility", img: "icons/containers/barrels/barrel-open-brown-red.webp" } } },
  flags: { "activity-macro": { brewKegActivity1: { macroId: "microbrewKegMcr1" } },
    world: { microbrew: { name: "Old Ale", brewer: "Bram", ingredients: ["a", "b", "c"], servings: 2, maxServings: 4,
      good: { roll: 5, text: "G", label: "d30: 5, Trivial", extra: [] }, bad: { roll: 5, text: "B", extra: [] }, cosmetic: { roll: 5, text: "C", extra: [] } } } },
}, bram);
bram.items.push(legacyKeg);
H.installGlobals({ actors: [pip, bram], users: [gm, player], worldTables: [H.customTable] });
// legacy recipe book (journal flags)
await JournalEntry.create({ name: "Microbrew Recipe Book", pages: [{ name: "Recipes", type: "text", text: { content: "" } }],
  flags: { world: { microbrewRecipes: { "ash__honey__mint": { ingredients: ["Honey", "Ash", "Mint"], name: "Old Faithful", good: { roll: 7 }, bad: { roll: 9 }, cosmetic: { roll: 11, extra: [] }, timesBrewed: 2 } } } } });

await import("../scripts/microbrew.mjs");
await H.runHook("init");
game.user = gm;
await H.runHook("ready");
const api = game.modules.get("microbrew").api;

out("== Init / migration");
check(CONFIG.TextEditor.enrichers.length === 1, "link enricher registered");
check(sockets.handlers["module.microbrew"]?.length === 1, "socket listener registered");
check(!legacyKeg.data.flags["activity-macro"]?.brewKegActivity1, "legacy keg: Activity Macro flag removed");
check(legacyKeg.data.img.includes("barrel-walnut-steel-brown"), "legacy keg: icon fixed");
check(legacyKeg.data.system.description.value.includes("@Microbrew[drink]") && !legacyKeg.data.system.description.value.includes("@UUID[Macro"), "legacy keg: description uses module links");
check(legacyKeg.data.system.activities.drinkBrewActvty1?.uses?.spent === 2, "legacy keg: Drink activity restored with 2 spent");
check(Object.keys(settings["microbrew.recipes"]).length === 1 && !H.getBook().flags.world.microbrewRecipes, "legacy recipes moved into the setting");
const enr = await CONFIG.TextEditor.enrichers[0].enricher(["@Microbrew[brew]{Brew!}", "brew", "Brew!"]);
check(enr.dataset.microbrew === "brew" && enr.innerHTML.includes("Brew!"), "enricher builds a brew link");

out("== Give a Keg (GM)");
canvas.tokens.controlled = [{ actor: pip }];
const tIdx = await game.packs.get("microbrew.microbrew-tables").getIndex();
const uuidOf = (n) => tIdx.find((e) => e.name === n).uuid;
dialogQueue.push({ action: "give", data: { good: uuidOf("Brewing Results: Good Effects"), bad: uuidOf("Brewing Results: Bad Effects"), cosmetic: uuidOf("Brewing Results: Cosmetic Effects") } });
await api.giveKeg();
const keg = pip.items.find((i) => i.name === "Microbrew Keg");
check(!!keg && keg.data.system.activities.brewKegActivity1 && !keg.data.flags["activity-macro"], "Pip got a Keg with a Brew activity and no Activity Macro flags");
check(keg.data.flags.world.microbrewTables.good.startsWith("Compendium.microbrew"), "Keg uses the module's compendium tables");
check(/Brewing Results: Good Effects — Microbrew: Brewing Tables/.test(dialogLog.at(-1).content), "Give dialog lists compendium tables");

out("== Player brews via the Keg's activity → request → GM dialog via socket");
game.user = player; canvas.tokens.controlled = [];
await H.runHook("dnd5e.postUseActivity", { id: "brewKegActivity1", item: keg });
const req = chat.at(-1);
check(req.whisper?.includes("gm1") && req.content.includes("@Microbrew[request]"), "player's request is whispered to the GM with a request link");
check(sockets.emitted.at(-1)?.data.messageId === req.id, "socket asks the GM to open the dialog");
check(!dialogLog.some((d) => d.title.includes("Pip") && d.step && game.user === player), "no dialog shown to the player");
game.user = gm;
dialogQueue.push({ action: "brew", data: { ing1: "honey", ing2: "Ash", ing3: "Mint", consume: true, servings: "3" } });
await sockets.handlers["module.microbrew"][0](sockets.emitted.at(-1).data);
const c = keg.data.flags.world.microbrew;
check(c?.name === "Old Faithful" && c.good.roll === 7 && c.good.method === "recipe", "legacy recipe reused (Old Faithful, Good 7)");
check(req.flags.world.microbrewRequest.status === "brewed", "request card marked brewed");
check(pip.items.find((i) => i.name === "Honey")?.data.system.quantity === 1, "one Honey consumed");
check(keg.data.system.activities.drinkBrewActvty1?.uses?.max === "3", "Drink activity added with 3 servings");
const recs = settings["microbrew.recipes"];
check(Object.keys(recs).length === 1 && Object.keys(recs)[0].includes("__ash__honey__mint") && Object.keys(recs)[0] !== "ash__honey__mint", "old-style recipe re-keyed to this table set");
check(H.getBook().pages.getName("Recipes").text.content.includes("Old Faithful"), "Recipe Book page rewritten");

out("== Request click by GM again (already brewed), and by the player");
await H.runHook("ready"); // migration should not run twice
const linkEvent = (action, msg) => ({ target: { closest: (sel) => (sel === "a.microbrew-link" ? { dataset: { microbrew: action }, closest: (s) => (s === "[data-message-id]" ? { dataset: { messageId: msg.id } } : null) } : null) }, preventDefault() {}, stopPropagation() {} });
await document._listeners[0](linkEvent("request", req));
check(log.at(-1).includes("already brewed"), "GM re-click is refused");

out("== Drinking: player via activity, a friend via the link");
game.user = player;
await H.runHook("dnd5e.postUseActivity", { id: "drinkBrewActvty1", item: keg });
check(keg.data.flags.world.microbrew.servings === 2 && keg.data.system.activities.drinkBrewActvty1.uses.spent === 1, "drink 1: 2 left, spent 1");
check(chat.at(-1).content.includes("Pip drinks Old Faithful"), "drink card names Pip");
canvas.tokens.controlled = [{ actor: bram }];
await api.drink(keg);
check(chat.at(-1).content.includes("Bram drinks"), "a selected friend drinks from Pip's keg");
canvas.tokens.controlled = [];
await api.drink(keg);
check(!keg.data.flags.world.microbrew && !keg.data.system.activities.drinkBrewActvty1, "last serving empties the keg and removes Drink");
await api.drink(keg);
check(log.at(-1).includes("keg is empty"), "drinking an empty keg warns");

out("== GM brews directly with a custom table (Ale Boons for Good)");
game.user = gm; canvas.tokens.controlled = [{ actor: pip }];
dialogQueue.push({ action: "give", data: { good: "RollTable.aleBoons00000001", bad: uuidOf("Brewing Results: Bad Effects"), cosmetic: uuidOf("Brewing Results: Cosmetic Effects"), repoint: true } });
await api.giveKeg();
check(keg.data.flags.world.microbrewTables.good === "RollTable.aleBoons00000001", "existing Keg re-pointed to Ale Boons");
dialogQueue.push({ action: "brew", data: { ing1: "Mint", ing2: "Ash", ing3: "Honey", consume: false, servings: "2", good: "9" } },
                 { action: "brew", data: { ing1: "Mint", ing2: "Ash", ing3: "Honey", consume: false, servings: "2", good: "6" } });
await api.brew(keg);
const c2 = keg.data.flags.world.microbrew;
check(dialogLog.at(-1).error && dialogLog.at(-1).buttons.join() === "Brew!,Cancel", "out-of-range d6 roll re-prompts (direct brew: Brew!/Cancel)");
check(c2.good.label === "d6: 6" && c2.good.extra.length === 2 && !c2.good.tier, "d6 'roll twice more' pulled two extras, no tier");
check(Object.keys(settings["microbrew.recipes"]).length === 2, "separate recipe for the new table set");

out("== Deny flow");
game.user = player;
await api.brew(keg);
const req2 = chat.at(-1);
game.user = gm;
dialogQueue.push({ action: "deny" });
await sockets.handlers["module.microbrew"][0](sockets.emitted.at(-1).data);
check(req2.flags.world.microbrewRequest.status === "denied" && req2.content.includes("denied"), "request denied");

out("== Admin: add / remove / clear recipes");
dialogQueue.push({ action: "save", data: { ing1: "Salt", ing2: "Toad", ing3: "Wort", "good-mode": "text", "good-text": "You glow.", "bad-mode": "none", "cosmetic-mode": "table", "cosmetic-table": uuidOf("Brewing Results: Cosmetic Effects"), "cosmetic-roll": "" } });
await api.addRecipe();
const any = settings["microbrew.recipes"]["any__salt__toad__wort"];
check(any?.manual && any.good.text === "You glow." && any.bad.none && Number.isInteger(any.cosmetic.roll), "hand-made recipe saved");
dialogQueue.push({ action: "brew", data: { ing1: "wort", ing2: "salt", ing3: "toad", consume: false, servings: "4" } });
await api.brew(keg);
check(keg.data.flags.world.microbrew.good.text === "You glow." && keg.data.flags.world.microbrew.bad.label === "no effect", "brewing uses the hand-made recipe");
const before = Object.keys(settings["microbrew.recipes"]).length;
dialogQueue.push({ action: "remove", data: { recipe: "any__salt__toad__wort" } });
await api.removeRecipe();
check(Object.keys(settings["microbrew.recipes"]).length === before - 1, "recipe removed");
dialogQueue.push({ action: "no" });
await api.clearRecipeBook();
check(Object.keys(settings["microbrew.recipes"]).length === before - 1, "clear declined keeps recipes");
dialogQueue.push({ action: "yes" });
await api.clearRecipeBook();
check(Object.keys(settings["microbrew.recipes"]).length === 0, "clear confirmed empties the book");
game.user = player;
await api.giveKeg();
check(log.at(-1).includes("only a GM"), "players can't use the DM tools");

out("== Notifications / errors seen");
for (const l of log) if (/ERROR/.test(l)) out("  " + l);
out(`dialogs shown: ${dialogLog.length}, chat messages: ${chat.length}`);
