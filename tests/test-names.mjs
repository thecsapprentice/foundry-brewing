// Automatic brew names from the Brew Name tables. Set SHOW_NAMES=1 to print a sample.
import * as H from "./harness.mjs";
const check = (cond, label) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const gm = { id: "gm1", isGM: true, active: true };
const pip = H.mkActor("Pip", "p1");
H.installGlobals({ actors: [pip], users: [gm] });
await import("../scripts/microbrew.mjs");
await H.runHook("init");
game.user = gm;
await H.runHook("ready");
const { generateBrewName, nameStyles } = await import("../scripts/names.mjs");
const { forageableIngredients } = await import("../scripts/forage.mjs");
const idx = await game.packs.get("microbrew.microbrew-tables").getIndex();
const tbl = async (n) => game.packs.get("microbrew.microbrew-tables").getDocument(idx.find((e) => e.name === n)._id);
const tables = { good: await tbl("Brewing Results: Good Effects"), bad: await tbl("Brewing Results: Bad Effects") };

// Seeded randomness, so runs are repeatable
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const all = await forageableIngredients();
const byBiome = (b) => all.filter((i) => i.biome === b).map((i) => i.name);
const sample = (arr, n) => { const a = [...arr]; const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]); return out; };
const gen = (ings, g, b, style = "Ale") => generateBrewName({ ingredients: ings, good: { roll: g }, bad: { roll: b }, tables, style, rand });

check(JSON.stringify(await nameStyles()) === JSON.stringify(["Ale", "Potion", "Tea"]), "name styles: Ale, Potion, Tea");

// ---- Theme follows the ingredients
const swampWords = /Swamp|Bog|Fen|Mire|Marsh|Witch|Hag|Bogman|Frog King|Leech-Doctor|Murky|Brackish|Sunken|Will-o'-Wisp|Drowned Man|Low Tide/;
let swampy = 0;
for (let i = 0; i < 200; i++) if (swampWords.test(await gen(sample(byBiome("Wetlands & Bogs"), 3), 15, 15))) swampy++;
check(swampy > 100, `an all-Wetlands brew mostly gets swamp words (${swampy}/200; the rest use mood/adventurer patterns)`);
let tavern = 0;
for (let i = 0; i < 100; i++) if (/Tavern|Cellar|Crossroads|Roadside|Barkeep|Tinker|Drunkard|Pot-Boy|Questionable|Mystery|House|Bottom-Shelf|Last Call|Payday|Closing Time/.test(await gen(["Pocket Lint", "Old Boot", "Floor Sweepings"], 15, 15))) tavern++;
check(tavern > 40, `unrecognised ingredients fall back to the Tavern theme (${tavern}/100)`);

// ---- Mood follows the effects
const count = async (re, g, b) => { let n = 0; for (let i = 0; i < 200; i++) if (re.test(await gen(sample(all.map((x) => x.name), 3), g, b))) n++; return n; };
const goodWords = /Merry|Jolly|Blessed|Lucky|Heroic|Glorious|Joy|Triumph|Delight|Fortune|Glory/;
const badWords = /Angry|Grumpy|Cursed|Wretched|Vengeful|Spiteful|Rage|Ruin|Regret|Spite|Revenge/;
const gGood = await count(goodWords, 30, 30), gBad = await count(badWords, 30, 30);
const bGood = await count(goodWords, 2, 1), bBad = await count(badWords, 2, 1);
check(gGood > 20 && gBad === 0, `legendary Good + trivial Bad → good moods only (${gGood} good, ${gBad} bad)`);
check(bBad > 20 && bGood === 0, `trivial Good + catastrophic Bad → bad moods only (${bBad} bad, ${bGood} good)`);

// ---- Style and length
let potions = 0, teas = 0, long = 0;
for (let i = 0; i < 200; i++) {
  const ings = sample(all.map((x) => x.name), 3);
  const p = await gen(ings, 15, 15, "Potion"), t = await gen(ings, 15, 15, "Tea");
  if (/Tonic|Elixir|Draught|Philter|Brew|Tincture|Cordial|Potion|Concoction/.test(p)) potions++;
  if (/Tea|Tisane|Infusion|Brew|Steep|Blend|Chai|Cuppa|Leaf/.test(t)) teas++;
  for (const n of [p, t]) if (n.replace(/'s\b/g, "").split(" ").length > 4) long++;
}
check(potions > 150 && teas > 150, `Potion and Tea styles end names with their own words (${potions}, ${teas} of 200)`);
check(long === 0, "no name is longer than four words");
check(await gen(["Unknown Leaf", "Mystery Bark", "Odd Root"], 15, 15, "Nonexistent") !== null, "an unknown style falls back to Ale");

// ---- World tables override and extend
const pirate = { id: "w1", name: "Brew Name Theme: Pirate", results: { contents: [
  { text: "Keyword: rum", weight: 1, range: [1, 1] }, { text: "Person: Pirate Captain", weight: 1, range: [2, 2] },
  { text: "Place: Crow's Nest", weight: 1, range: [3, 3] }, { text: "Adjective: Scurvy", weight: 1, range: [4, 4] }, { text: "Force: Black Spot", weight: 1, range: [5, 5] }] } };
game.tables.push(pirate);
let pir = 0;
for (let i = 0; i < 100; i++) if (/Pirate Captain|Crow's Nest|Scurvy|Black Spot/.test(await gen(["Spiced Rum", "Old Boot", "Floor Sweepings"], 15, 15))) pir++;
check(pir > 40, `a DM's own world theme table joins in by keyword (${pir}/100)`);
const onlyStyle = { id: "w2", name: "Brew Name Style: Ale", results: { contents: [{ text: "Grog", weight: 1, range: [1, 1] }] } };
game.tables.push(onlyStyle);
let grog = 0;
for (let i = 0; i < 50; i++) if (/Grog/.test(await gen(sample(all.map((x) => x.name), 3), 15, 15))) grog++;
check(grog > 35, `a world table with the same name replaces the compendium's (Ale → Grog, ${grog}/50)`);
game.tables.splice(game.tables.indexOf(onlyStyle), 1);

// ---- Wired into brewing
canvas.tokens.controlled = [{ actor: pip }];
const u = (n) => idx.find((e) => e.name === n).uuid;
H.dialogQueue.push({ action: "give", data: { good: u("Brewing Results: Good Effects"), bad: u("Brewing Results: Bad Effects"), cosmetic: u("Brewing Results: Cosmetic Effects") } });
await game.modules.get("microbrew").api.giveKeg();
const keg = pip.items.find((i) => i.data.system?.activities?.brewKegActivity1);
H.dialogQueue.push({ action: "brew", data: { ing1: "Cattail Root", ing2: "Bogbean", ing3: "Sphagnum Moss", consume: false, servings: "2" } });
await game.modules.get("microbrew").api.brew(keg);
const brewed = keg.data.flags.world.microbrew.name;
check(brewed && !/Cattail Root, Bogbean/.test(brewed), `a blank brew name is generated: "${brewed}"`);
H.dialogQueue.push({ action: "brew", data: { ing1: "Cattail Root", ing2: "Bogbean", ing3: "Sphagnum Moss", consume: false, servings: "2" } });
await game.modules.get("microbrew").api.brew(keg);
check(keg.data.flags.world.microbrew.name === brewed, "the same ingredients again reuse the recorded name");
H.dialogQueue.push({ action: "brew", data: { ing1: "Wheat", ing2: "Hops", ing3: "Barley", consume: false, servings: "2", brewName: "House Special" } });
await game.modules.get("microbrew").api.brew(keg);
check(keg.data.flags.world.microbrew.name === "House Special", "a typed name always wins");

if (process.env.SHOW_NAMES) {
  console.log("\n--- sample ---");
  for (const b of [...new Set(all.map((i) => i.biome))]) {
    const ings = sample(byBiome(b), 3);
    console.log(`${(await gen(ings, Math.ceil(rand() * 30), Math.ceil(rand() * 30))).padEnd(36)} ← ${ings.join(", ")}`);
  }
  for (let i = 0; i < 10; i++) {
    const ings = sample(all.map((x) => x.name), 3);
    console.log(`${(await gen(ings, Math.ceil(rand() * 30), Math.ceil(rand() * 30))).padEnd(36)} ← ${ings.join(", ")}`);
  }
  for (const st of ["Potion", "Tea"]) {
    const ings = sample(all.map((x) => x.name), 3);
    console.log(`${(await gen(ings, 20, 20, st)).padEnd(36)} ← ${ings.join(", ")}  [${st}]`);
  }
}
