// Foraging: find logic, the player roll prompt over the socket, DM fallbacks, and that nothing is written to inventories.
import * as H from "./harness.mjs";
const { dialogQueue, dialogLog, sockets, chat, log } = H;
const check = (cond, label) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);

const gm = { id: "gm1", name: "DM", isGM: true, active: true };
const player = { id: "p1", name: "Sam", isGM: false, active: true };
const offline = { id: "p2", name: "Alex", isGM: false, active: false };
const mkPC = (name, owner, rolls) => {
  const a = H.mkActor(name, owner.id);
  a.uuid = `Actor.${a.id}`;
  a.testUserPermission = (u, lvl) => u.id === owner.id && lvl === "OWNER";
  Object.defineProperty(a, "isOwner", { get: () => game.user.isGM || game.user.id === owner.id });
  a.rolled = [];
  a.rollSkill = async (config) => { a.rolled.push({ by: game.user.id, config }); const t = rolls.shift(); return t === null ? null : [{ total: t }]; };
  return a;
};
const pip = mkPC("Pip", player, [17, 12]);
const bram = mkPC("Bram", offline, [21]);
player.character = pip;
H.installGlobals({ actors: [pip, bram], users: [gm, player, offline] });
globalThis.fromUuid = ((orig) => async (u) => ([pip, bram].find((a) => a.uuid === u) ?? orig(u)))(globalThis.fromUuid);
await import("../scripts/microbrew.mjs");
await H.runHook("init");
game.user = gm;
await H.runHook("ready");
const api = game.modules.get("microbrew").api;
const F = await import("../scripts/forage.mjs");
const socket = sockets.handlers["module.microbrew"][0];

console.log("== Ingredients by biome (from the compendium's data)");
const all = await F.forageableIngredients();
const biomes = [...new Set(all.map((i) => i.biome))];
const boreal = all.filter((i) => i.biome === "Boreal Highlands");
check(all.length === 358 && biomes.length === 10, `358 ingredients across 10 biomes (${all.length}, ${biomes.length})`);
check(boreal.find((i) => i.name === "Wyrmroot")?.dc === 19 && boreal.find((i) => i.name === "Juniper Berries")?.dc === 10, "DCs come from the item data (Wyrmroot 19, Juniper 10)");

console.log("== Choosing a find");
const pool = [
  ...Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, dc: 10 })),
  ...Array.from({ length: 10 }, (_, i) => ({ name: `U${i}`, dc: 13 })),
  ...Array.from({ length: 4 }, (_, i) => ({ name: `R${i}`, dc: 16 })),
  { name: "VR", dc: 19 },
];
check(F.chooseFind(pool, 9) === null, "below every DC: nothing found");
const tally = (total, selection, n = 20000) => {
  const c = {};
  for (let i = 0; i < n; i++) { const f = F.chooseFind(pool, total, { selection, step: 5 }); c[f.dc] = (c[f.dc] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round((v / n) * 100)]));
};
const w20 = tally(20, "weighted"), u20 = tally(20, "uniform"), b20 = tally(20, "best");
console.log(`    total 20 → weighted ${JSON.stringify(w20)} | uniform ${JSON.stringify(u20)} | best ${JSON.stringify(b20)} (% by DC)`);
check(Math.abs(w20[19] - 40) <= 3 && Math.abs(w20[16] - 30) <= 3 && Math.abs(w20[13] - 20) <= 3 && Math.abs(w20[10] - 10) <= 3, "weighted: 40/30/20/10% for very rare/rare/uncommon/common at 20");
check(Math.abs(u20[19] - 3) <= 2 && Math.abs(u20[10] - 57) <= 3, "uniform: each ingredient equally likely (very rare ≈ 3%)");
check(b20[19] === 100, "best tier only: always the very rare at 20");
const w14 = tally(14, "weighted");
check(!w14[16] && !w14[19] && Math.abs(w14[13] - 67) <= 3, "weighted at 14: only common/uncommon, uncommon ≈ 2/3");
const q = (total, dc, step) => F.chooseFind([{ name: "x", dc }], total, { step }).quantity;
check(q(10, 10, 5) === 1 && q(14, 10, 5) === 1 && q(15, 10, 5) === 2 && q(25, 10, 5) === 4 && q(20, 19, 5) === 1, "quantity: +1 per 5 over the find's DC");
check(q(30, 10, 0) === 1 && q(13, 10, 3) === 2, "step 0 always finds 1; step is configurable");

console.log("== Forage: Pip's player rolls (online); Bram's player is offline");
canvas.tokens.controlled = [{ actor: pip }, { actor: bram }];
const inv = () => JSON.stringify([pip.items.map((i) => i.name), bram.items.map((i) => i.name)]);
const before = inv();
dialogQueue.push(
  { action: "go", data: { biome: "Boreal Highlands", roller: "ask", selection: "weighted", step: "5" } },
  { action: "hold" },                        // the DM's "waiting for Sam" dialog stays open until the roll arrives
  { action: "ok", data: { total: "21" } },   // Bram: no player online → DM types a total
);
const run = api.forage();
const waitFor = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await H.tick(); return fn(); };
const req = await waitFor(() => sockets.emitted.find((e) => e.data.action === "forageRoll"));
check(req?.data.userId === "p1" && req.data.actorUuid === pip.uuid && req.data.biome === "Boreal Highlands", "Pip's player is asked to roll, over the socket");
// Sam's client receives the request and rolls
game.user = player;
dialogQueue.unshift({ action: "roll" });
await socket(req.data);
check(pip.rolled.at(-1)?.by === "p1" && pip.rolled.at(-1).config.skill === "sur", "the player rolls Survival on their own client (dnd5e rollSkill)");
const res = sockets.emitted.find((e) => e.data.action === "forageResult");
check(res?.data.total === 17, "the player's total is sent back to the DM");
game.user = gm;
await socket(res.data);
const results = await run;
check(results[0].total === 17 && results[0].how === "rolled by Sam" && results[0].find?.dc <= 17, "Pip's find uses Sam's 17");
check(results[1].total === 21 && results[1].how === "entered by the DM", "Bram (player offline): the DM entered 21");
check(log.some((l) => l.includes("no player is online for Bram")), "the DM is told Bram's player is offline");
const card = chat.at(-1);
check(card.whisper?.length === 1 && card.whisper[0] === "gm1" && /Foraging: Boreal Highlands/.test(card.content), "the result card is whispered to the DM only");
check(/@UUID\[Compendium\.microbrew\.microbrew-items\.Item\.[A-Za-z0-9]{16}\]\{/.test(card.content) && /Pip<\/strong> \(Survival <strong>17<\/strong>, rolled by Sam\)/.test(card.content), "the card links the ingredient (draggable) and shows the roll");
check(inv() === before, "nothing was added to any inventory");
check(game.settings.get("microbrew", "forageDefaults").biome === "Boreal Highlands", "the DM's choices are remembered");

console.log("== The DM steps in while waiting");
canvas.tokens.controlled = [{ actor: pip }];
dialogQueue.push({ action: "go", data: { biome: "Arid Desert", roller: "ask", selection: "best", step: "0" } }, { action: "gm" });
const r2 = await api.forage();
check(r2[0].total === 12 && r2[0].how === "rolled by the DM" && pip.rolled.at(-1).by === "gm1", "'Roll for them' while waiting: the DM rolls instead");
check(sockets.emitted.at(-1).data.action === "forageCancel" && sockets.emitted.at(-1).data.userId === "p1", "the player's prompt is cancelled");
check(r2[0].find.quantity === 1 && r2[0].find.dc === 10, "best tier only at 12 (step 0): one common");

console.log("== Safety");
// a forged or stale result for an unknown request is ignored
await socket({ action: "forageResult", requestId: "nope", actorUuid: pip.uuid, total: 99 });
check(true, "an unknown forageResult is ignored (no crash)");
// a player is never asked to roll for a character they don't own
game.user = player;
const n = sockets.emitted.length;
await socket({ action: "forageRoll", requestId: "x", userId: "p1", actorUuid: bram.uuid, biome: "Coast & Shore" });
check(sockets.emitted.at(-1).data.declined === true && bram.rolled.every((r) => r.by !== "p1") && sockets.emitted.length === n + 1, "a request for someone else's character is declined without rolling");
await api.forage();
check(log.at(-1).includes("only a GM"), "players can't run Forage");
game.user = gm;
canvas.tokens.controlled = [];
await api.forage();
check(log.at(-1).includes("select the token"), "Forage needs selected tokens");
