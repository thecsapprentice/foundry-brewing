import * as H from "./harness.mjs";
const { dialogQueue } = H;
const check = (cond, label) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const gm = { id: "gm1", isGM: true, active: true }, player = { id: "p1", isGM: false, active: true };
const pip = H.mkActor("Pip", "p1");
const add = (data) => { const it = H.mkItem({ flags: {}, system: {}, ...data }, pip); pip.items.push(it); return it; };
// Items whose names match ingredients but must never be used up
const ashWeapon = add({ name: "Ash", type: "weapon", system: { quantity: 1 } });
const mintEquipped = add({ name: "Mint", type: "consumable", system: { quantity: 1, equipped: true } });
const honeySpell = add({ name: "Honey", type: "spell", system: {} });
// A real ingredient that should be used up
const saltLoot = add({ name: "Salt", type: "loot", system: { quantity: 3 } });
// An unrelated item that just happens to be called "Microbrew Keg": no Microbrew data at all
const impostor = add({ name: "Microbrew Keg", type: "loot", system: { description: { value: "<p>My own homebrew barrel.</p>" } } });

// A world table the DM made, and a pre-existing journal with the same name as the Recipe Book
const myTable = { ...H.customTable, ownership: { default: 0 } };
H.installGlobals({ actors: [pip], users: [gm, player], worldTables: [myTable] });
await JournalEntry.create({ name: "Microbrew Recipe Book", pages: [{ name: "My Notes", type: "text", text: { content: "<p>Do not lose this.</p>" } }] });

await import("../scripts/microbrew.mjs");
await H.runHook("init");
game.user = gm;
await H.runHook("ready");
const api = game.modules.get("microbrew").api;

console.log("== Migration leaves non-Microbrew items alone");
check(impostor.data.system.description.value === "<p>My own homebrew barrel.</p>", "an item merely named 'Microbrew Keg' is not rewritten");

console.log("== Give a Keg doesn't change table permissions");
canvas.tokens.controlled = [{ actor: pip }];
const idx = await game.packs.get("microbrew.microbrew-tables").getIndex();
const u = (n) => idx.find((e) => e.name === n).uuid;
dialogQueue.push({ action: "give", data: { good: "RollTable.aleBoons00000001", bad: u("Brewing Results: Bad Effects"), cosmetic: u("Brewing Results: Cosmetic Effects"), repoint: true } });
await api.giveKeg();
check(myTable.ownership.default === 0, "the DM's own table keeps its permissions");

console.log("== Ingredient consumption only uses up loot/consumables");
const keg = pip.items.find((i) => i.name === "Microbrew Keg" && i !== impostor) ?? pip.items.find((i) => api.isKeg(i) && i !== impostor);
const realKeg = pip.items.filter((i) => i.data.system?.activities?.brewKegActivity1).at(0);
dialogQueue.push({ action: "brew", data: { ing1: "Ash", ing2: "Mint", ing3: "Honey", consume: true, servings: "2" } });
await api.brew(realKeg);
check(pip.items.includes(ashWeapon) && pip.items.includes(mintEquipped) && pip.items.includes(honeySpell), "a weapon, an equipped item and a spell with matching names are untouched");
dialogQueue.push({ action: "brew", data: { ing1: "Salt", ing2: "Mint", ing3: "Honey", consume: true, servings: "2" } });
await api.brew(realKeg);
check(saltLoot.data.system.quantity === 2, "a loot ingredient is used up (3 → 2)");
check(pip.items.includes(impostor), "the other 'Microbrew Keg' item still exists");
check(!impostor.data.flags.world?.microbrewTables && !api.isKeg(impostor), "the homemade 'Microbrew Keg' is not treated as a Keg (no tables written to it)");

console.log("== Recipe Book only writes its own page");
const book = H.getBook();
check(book.pages.getName("My Notes")?.text.content === "<p>Do not lose this.</p>", "the DM's existing page is untouched");
check(!!book.pages.getName("Recipes")?.text.content.includes("<table>"), "a separate 'Recipes' page was added");
