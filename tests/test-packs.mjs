// Checks the built compendium packs: valid dnd5e data, unique names, folders, verified icons.
import fs from "node:fs";
import { packData } from "./harness.mjs";
const check = (cond, label) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const RARITIES = ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"];
const icons = new Set([...fs.readFileSync(new URL("../data/icons.py", import.meta.url), "utf8").matchAll(/"(icons\/[^"]+\.webp)"/g)].map((m) => m[1]));
const items = packData.items.filter(([k]) => k.startsWith("!items!")).map(([, v]) => v);
const folders = new Map(packData.items.filter(([k]) => k.startsWith("!folders!")).map(([, v]) => [v._id, v]));
const ingredients = items.filter((i) => i.type === "loot");
const keg = items.find((i) => i.name === "Microbrew Keg");

check(ingredients.length >= 300, `ingredients present (${ingredients.length}) in ${folders.size} biome folders`);
check(new Set(items.map((i) => i.name.toLowerCase())).size === items.length, "every item name is unique");
check(new Set(items.map((i) => i._id)).size === items.length && items.every((i) => /^[A-Za-z0-9]{16}$/.test(i._id)), "ids are unique 16-character Foundry ids");
const badRarity = ingredients.filter((i) => !RARITIES.includes(i.system.rarity));
check(!badRarity.length, `every rarity is a dnd5e key${badRarity.length ? `: ${badRarity.map((i) => `${i.name}=${i.system.rarity}`).join(", ")}` : ""}`);
check(ingredients.every((i) => i.system.type?.value === "material"), "every ingredient is a dnd5e Material");
const orphans = ingredients.filter((i) => !folders.has(i.folder));
check(!orphans.length, "every ingredient is in a biome folder");
const badIcons = items.filter((i) => !icons.has(i.img) && i !== keg);
check(!badIcons.length, `every ingredient icon is in data/icons.py${badIcons.length ? `: ${badIcons.map((i) => i.name).join(", ")}` : ""}`);
check(ingredients.every((i) => i.system.price?.value > 0 && ["cp", "sp", "gp"].includes(i.system.price.denomination) && i.system.weight?.value > 0), "prices and weights are positive");
check(ingredients.every((i) => /Harvesting:<\/strong> DC \d+ Wisdom \(Survival\)/.test(i.system.description.value)), "every description has a harvesting DC");
check(!!keg?.system.activities?.brewKegActivity1 && keg.system.description.value.includes("@Microbrew[brew]"), "the compendium Keg has its Brew activity and link");
const tables = packData.tables.filter(([k]) => k.startsWith("!tables!")).map(([, v]) => v);
check(tables.length === 3 && tables.every((t) => t.results.length === Number(t.formula.replace("1d", ""))), "three tables, each with one result per die face");
const macros = packData.macros.map(([, v]) => v);
check(macros.every((m) => m.type === "script" && /game\.modules\.get\("microbrew"\)\?\.api/.test(m.command)), `all ${macros.length} DM-tool macros call the module API`);
