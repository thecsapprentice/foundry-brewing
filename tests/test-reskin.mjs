import * as H from "./harness.mjs";
const { chat, sockets, dialogQueue, dialogLog, log } = H;
const check = (cond, label) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const gm = { id: "gm1", isGM: true, active: true }, player = { id: "p1", isGM: false, active: true };
const pip = H.mkActor("Pip", "p1"), bram = H.mkActor("Bram", "p2");
const worldItems = [];
H.installGlobals({ actors: [pip, bram], users: [gm, player], worldItems });
await import("../scripts/microbrew.mjs");
await H.runHook("init");
game.user = gm;
await H.runHook("ready");
const api = game.modules.get("microbrew").api;
const idx = await game.packs.get("microbrew.microbrew-tables").getIndex();
const u = (n) => idx.find((e) => e.name === n).uuid;
const TABLES = { good: u("Brewing Results: Good Effects"), bad: u("Brewing Results: Bad Effects"), cosmetic: u("Brewing Results: Cosmetic Effects") };

// Pip gets a default keg and a brew
canvas.tokens.controlled = [{ actor: pip }];
dialogQueue.push({ action: "give", data: { ...TABLES, template: "" } });
await api.giveKeg();
const keg = pip.items.find(api.isKeg);
dialogQueue.push({ action: "brew", data: { ing1: "Honey", ing2: "Ash", ing3: "Mint", consume: false, servings: "3" } });
await api.brew(keg);

console.log("== Reskin Pip's keg into an Alchemist's Kit");
const KIT = {
  name: "Alchemist's Kit", img: "icons/tools/laboratory/alembic-copper-blue.webp", price: "75", denomination: "gp", weight: "4", rarity: "rare",
  description: "<p>A battered leather case of vials, burners and a tiny copper alembic.</p>",
  container: "kit", product: "potion", portion: "dose", portions: "doses",
  brewAction: "Brew a Potion", drinkAction: "Drink Potion", brewVerb: "concocts", drinkVerb: "quaffs", drinkImg: "icons/consumables/potions/bottle-bulb-corked-green.webp",
};
dialogQueue.push({ action: "save", data: { ...KIT, name: "  " } }, { action: "save", data: KIT });
await api.reskinKeg(keg);
const d = keg.data;
check(dialogLog.at(-1).error, "blank name re-prompts with an error");
check(d.name === "Alchemist's Kit" && d.img === KIT.img && d.system.price.value === 75 && d.system.weight.value === 4 && d.system.rarity === "rare", "name, icon, price, weight, rarity saved");
check(d.system.activities.brewKegActivity1.name === "Brew a Potion" && d.system.activities.drinkBrewActvty1.name === "Drink Potion" && d.system.activities.drinkBrewActvty1.img === KIT.drinkImg, "activity names and icons follow the wording");
const desc = d.system.description.value;
check(desc.startsWith(KIT.description) && desc.includes("<h2>Kit: Honey, Ash, Mint Ale</h2>") && desc.includes("Doses left: 3 of 3") && desc.includes("@Microbrew[drink]{Drink Potion}") && desc.includes("@Microbrew[brew]{Brew a Potion}"), "description = DM text + generated section in the new wording (brew kept)");
check(api.isKeg(keg), "still recognised as a Keg after renaming");

console.log("== Player brews in the kit");
game.user = player; canvas.tokens.controlled = [];
await H.runHook("dnd5e.postUseActivity", { id: "brewKegActivity1", item: keg });
const req = chat.at(-1);
check(req.content.includes("starts a new batch in their Alchemist&#x27;s Kit") || req.content.includes("starts a new batch in their Alchemist's Kit"), "request card names the kit");
game.user = gm;
dialogQueue.push({ action: "brew", data: { ing1: "Salt", ing2: "Toad", ing3: "Wort", consume: false, servings: "2" } });
await sockets.handlers["module.microbrew"][0](sockets.emitted.at(-1).data);
const dlg = dialogLog.filter((x) => x.buttons?.includes("Brew!")).at(-1);
check(dlg.title === "Alchemist's Kit — Pip" && /still holds <strong>3 doses<\/strong>/.test(dlg.content) && /<label>Doses<\/label>/.test(dlg.content), "GM dialog: title, warning and portions label use the kit wording");
const card = chat.at(-1).content;
check(/Pip concocts Salt, Toad, Wort into a fresh kit: <strong>2 doses<\/strong> ready/.test(card) && /The last 3 doses of Honey, Ash, Mint Ale were poured out/.test(card), "brew card: verb, container, portions");
check(keg.data.flags.world.microbrew.name === "Salt, Toad, Wort Potion", "default brew name uses 'Potion'");
check(keg.data.system.activities.drinkBrewActvty1.name === "Drink Potion" && keg.data.system.activities.drinkBrewActvty1.img === KIT.drinkImg, "re-created Drink activity keeps the kit's name and icon");
check(keg.data.system.description.value.startsWith(KIT.description), "DM description survives a brew");

console.log("== Drinking from the kit");
game.user = player;
await api.drink(keg);
check(/Pip quaffs Salt, Toad, Wort Potion/.test(chat.at(-1).content) && /1 dose of 2 left in Pip&#x27;s kit|1 dose of 2 left in Pip's kit/.test(chat.at(-1).content), "drink card: verb, '1 dose', kit");
await api.drink(keg);
check(/That was the last dose\. Pip(&#x27;|')s kit is empty\./.test(chat.at(-1).content), "last dose message");
check(keg.data.system.description.value.startsWith(KIT.description) && keg.data.system.description.value.includes("The kit is empty."), "empty description keeps DM text");
await api.drink(keg);
check(log.at(-1).includes("the kit is empty"), "empty warning uses 'kit'");

console.log("== Template: a reskinned Keg in the Items sidebar");
game.user = gm;
const template = H.mkItem(keg.toObject(), null);
template.data._id = "tmplKeg000000001"; template.id = "tmplKeg000000001";
template.data.name = "Witch's Cauldron";
template.data.flags.world.microbrewSkin = { ...keg.data.flags.world.microbrewSkin, container: "cauldron" };
worldItems.push(template);
canvas.tokens.controlled = [{ actor: bram }];
dialogQueue.push({ action: "give", data: { ...TABLES, template: "tmplKeg000000001" } });
await api.giveKeg();
const bk = bram.items.find(api.isKeg);
check(bk?.data.name === "Witch's Cauldron" && bk.data.system.price.value === 75 && bk.data.flags.world.microbrewSkin.container === "cauldron", "Bram got a copy of the template's look and wording");
check(!bk.data.flags.world.microbrew && !bk.data.system.activities.drinkBrewActvty1 && bk.data.system.description.value.includes("The cauldron is empty."), "copy starts empty");
check(bk.data.flags.world.microbrewTables.good === TABLES.good && bk.data._id !== template.id, "copy uses the chosen tables and its own id");
check(/Witch's Cauldron \(Items sidebar\)/.test(dialogLog.filter((x) => x.buttons?.includes("Give Keg")).at(-1).content), "Give a Keg lists sidebar Kegs as looks");

console.log("== Reset to default");
dialogQueue.push({ action: "reset" }, { action: "yes" });
await api.reskinKeg(bk);
check(bk.data.name === "Microbrew Keg" && bk.data.system.price.value === 250 && bk.data.flags.world.microbrewSkin.container === "keg" && bk.data.system.description.value.includes("The keg is empty."), "reset restores the default Keg look and wording");
check(bk.data.flags.world.microbrewTables.good === TABLES.good, "reset keeps the tables");

console.log("== Players can't reskin");
game.user = player;
await api.reskinKeg(keg);
check(log.at(-1).includes("only a GM"), "GM only");
