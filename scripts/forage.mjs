// Foraging: a DM tool to decide what a character finds in the wild.
// The DM picks a biome; the player is asked to roll Wisdom (Survival); every ingredient in that biome
// whose DC the total meets is eligible; one is chosen (weighted toward the best by default), and the
// amount grows with how far the roll beat its DC. The result is whispered to the DM only.
// Nothing is added to any inventory: the DM drags the item from the chat card if they want to give it.
import { MODULE_ID, SOCKET } from "./constants.mjs";
import { esc, buttonDialog, readForm } from "./util.mjs";

export const SETTING_FORAGE = "forageDefaults";
const ITEM_PACK = `${MODULE_ID}.microbrew-items`;
const DC_BY_RARITY = { common: 10, uncommon: 13, rare: 16, veryRare: 19, legendary: 22, artifact: 25 };
const TIER_LABEL = { 10: "common", 13: "uncommon", 16: "rare", 19: "very rare", 22: "legendary", 25: "artifact" };
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
const SELECTIONS = {
  weighted: "Weighted toward the best",
  uniform: "Any eligible, equally likely",
  best: "Best tier only",
};
const ROLLERS = {
  ask: "Ask the player to roll (if online)",
  gm: "I'll roll for them",
  manual: "I'll enter the totals",
};

export function registerForageSettings() {
  game.settings.register(MODULE_ID, SETTING_FORAGE, {
    scope: "client", config: false, type: Object,
    default: { biome: "", step: 5, selection: "weighted", roller: "ask" },
  });
}

/* -------------------------------------------- */
/*  Ingredients by biome                        */
/* -------------------------------------------- */

/**
 * Every ingredient that can be foraged: the module's compendium, plus world Items carrying
 * flags.world.microbrewIngredient (so a DM's own ingredients can join in). Read-only.
 */
export async function forageableIngredients() {
  const out = [];
  const add = (name, uuid, info, rarity) => {
    const biome = info?.biome;
    if (!biome) return;
    const dc = Number(info.dc) || DC_BY_RARITY[info.rarity ?? rarity] || DC_BY_RARITY.common;
    out.push({ name, uuid, biome, dc });
  };
  const pack = game.packs.get(ITEM_PACK);
  if (pack) {
    const idx = await pack.getIndex({ fields: ["flags.world.microbrewIngredient", "system.rarity"] });
    for (const e of idx) {
      add(e.name, e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, e.flags?.world?.microbrewIngredient, e.system?.rarity);
    }
  }
  for (const it of game.items) add(it.name, it.uuid, it.flags?.world?.microbrewIngredient, it.system?.rarity);
  return out;
}

/* -------------------------------------------- */
/*  Choosing what is found                      */
/* -------------------------------------------- */

/**
 * Pick what a Survival total finds in a biome. Returns null if nothing qualifies.
 * @param {object[]} pool       ingredients of one biome ({ name, uuid, dc })
 * @param {number} total        the Survival check total
 * @param {object} options      { selection: "weighted"|"uniform"|"best", step: number (0 = no bonus) }
 * @param {Function} rand       random number source (0 ≤ r < 1), for tests
 */
export function chooseFind(pool, total, { selection = "weighted", step = 5 } = {}, rand = Math.random) {
  const eligible = pool.filter((i) => i.dc <= total);
  if (!eligible.length) return null;
  const tiers = [...new Set(eligible.map((i) => i.dc))].sort((a, b) => a - b);
  let tier;
  if (selection === "best") tier = tiers.at(-1);
  else if (selection === "uniform") tier = null;
  else {
    // Weighted toward the best: the k-th lowest tier reached gets weight k, so the highest tier
    // the roll reaches is the most likely, but lower tiers still turn up.
    const total_w = (tiers.length * (tiers.length + 1)) / 2;
    let r = rand() * total_w;
    tier = tiers.find((_, k) => (r -= k + 1) < 0) ?? tiers.at(-1);
  }
  const candidates = tier === null ? eligible : eligible.filter((i) => i.dc === tier);
  const pick = candidates[Math.floor(rand() * candidates.length)] ?? candidates[0];
  const over = total - pick.dc;
  const quantity = 1 + (step > 0 ? Math.floor(over / step) : 0);
  return { ...pick, quantity, over, eligible: eligible.length, tiers };
}

/* -------------------------------------------- */
/*  Rolling Survival                            */
/* -------------------------------------------- */

/** Roll Wisdom (Survival) with dnd5e's own roll (dnd5e 4.0 and 4.1+ signatures). Returns the total, or null if cancelled. */
export async function rollSurvival(actor) {
  const modern = foundry.utils.isNewerVersion(game.system.version, "4.0.99");
  const result = modern ? await actor.rollSkill({ skill: "sur" }) : await actor.rollSkill("sur");
  const roll = Array.isArray(result) ? result[0] : result;
  return Number.isFinite(roll?.total) ? roll.total : null;
}

/** The active, non-GM user who should roll for this actor (their assigned character first). */
function playerFor(actor) {
  const owners = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER"));
  return owners.find((u) => u.character?.id === actor.id) ?? owners[0] ?? null;
}

const pending = new Map(); // requestId → { resolve, actorUuid }

/** Socket messages for foraging. Called from the module's socket listener on every client. */
export async function handleForageSocket(data) {
  // GM: a player's roll came back
  if (data.action === "forageResult") {
    if (!game.user.isGM) return;
    const p = pending.get(data.requestId);
    if (!p || p.actorUuid !== data.actorUuid) return; // unknown or mismatched: ignore
    const total = Number(data.total);
    p.resolve(data.declined ? { declined: true } : Number.isFinite(total) && total > -50 && total < 100 ? { total } : { declined: true });
    return;
  }
  // Player: the DM asks this user to roll
  if (data.action === "forageRoll" && data.userId === game.user.id) return promptPlayer(data);
  if (data.action === "forageCancel" && data.userId === game.user.id) openPrompts.get(data.requestId)?.close();
}

const openPrompts = new Map(); // requestId → Dialog, on the player's client

async function promptPlayer(data) {
  const actor = await fromUuid(data.actorUuid);
  const reply = (r) => game.socket.emit(SOCKET, { action: "forageResult", requestId: data.requestId, actorUuid: data.actorUuid, ...r });
  if (!actor?.isOwner) return reply({ declined: true });
  let rolled = false;
  const choice = await new Promise((resolve) => {
    const dlg = new Dialog({
      title: `Foraging — ${actor.name}`,
      content: `<p>The DM asks <strong>${esc(actor.name)}</strong> to search the <strong>${esc(data.biome)}</strong> for ingredients.</p>
<p>Make a <strong>Wisdom (Survival)</strong> check.</p>`,
      buttons: {
        roll: { icon: '<i class="fas fa-dice-d20"></i>', label: "Roll Survival", callback: () => resolve("roll") },
        decline: { icon: '<i class="fas fa-times"></i>', label: "Decline", callback: () => resolve("decline") },
      },
      default: "roll",
      close: () => resolve("decline"),
    });
    openPrompts.set(data.requestId, dlg);
    dlg.render(true);
  });
  openPrompts.delete(data.requestId);
  if (choice !== "roll") return reply({ declined: true });
  const total = await rollSurvival(actor);
  rolled = total !== null;
  return reply(rolled ? { total } : { declined: true });
}

/**
 * Get one character's Survival total: ask their player, roll for them, or have the DM type it.
 * While waiting on a player, the DM can roll for them, type a total, or skip.
 */
async function totalFor(actor, roller, biome) {
  if (roller === "gm") return { total: await rollSurvival(actor), how: "rolled by the DM" };
  if (roller === "manual") return askTotal(actor, "");

  const user = playerFor(actor);
  if (!user) {
    ui.notifications.info(`Microbrew: no player is online for ${actor.name}.`);
    return askTotal(actor, "No player is online for this character. ");
  }
  const requestId = foundry.utils.randomID();
  const fromPlayer = new Promise((resolve) => pending.set(requestId, { resolve, actorUuid: actor.uuid }));
  game.socket.emit(SOCKET, { action: "forageRoll", requestId, userId: user.id, actorUuid: actor.uuid, biome });

  // Wait for the player, while letting the DM step in
  let waiting;
  const fromDM = new Promise((resolve) => {
    waiting = new Dialog({
      title: `Foraging — waiting for ${actor.name}`,
      content: `<p>Waiting for <strong>${esc(user.name)}</strong> to roll Survival for <strong>${esc(actor.name)}</strong>…</p>`,
      buttons: {
        gm: { icon: '<i class="fas fa-dice-d20"></i>', label: "Roll for them", callback: () => resolve({ dm: "gm" }) },
        manual: { icon: '<i class="fas fa-keyboard"></i>', label: "Enter total", callback: () => resolve({ dm: "manual" }) },
        skip: { icon: '<i class="fas fa-forward"></i>', label: "Skip", callback: () => resolve({ dm: "skip" }) },
      },
      default: "gm",
      close: () => resolve({ dm: "skip" }),
    });
    waiting.render(true);
  });
  let timer;
  const timeout = new Promise((resolve) => (timer = setTimeout(() => resolve({ timedOut: true }), PROMPT_TIMEOUT_MS)));
  const first = await Promise.race([fromPlayer, fromDM, timeout]);
  clearTimeout(timer);
  pending.delete(requestId);
  if (!("dm" in first)) waiting.close();
  if ("dm" in first || first.timedOut) game.socket.emit(SOCKET, { action: "forageCancel", requestId, userId: user.id });

  if (first.timedOut) return askTotal(actor, `${user.name} didn't roll in time. `);
  if (first.declined) return askTotal(actor, `${user.name} declined to roll. `);
  if ("total" in first) return { total: first.total, how: `rolled by ${user.name}` };
  if (first.dm === "gm") return { total: await rollSurvival(actor), how: "rolled by the DM" };
  if (first.dm === "manual") return askTotal(actor, "");
  return { total: null };
}

/** Ask the DM to type a Survival total (or roll / skip). */
async function askTotal(actor, note) {
  while (true) {
    const choice = await buttonDialog({
      title: `Foraging — ${actor.name}`,
      content: `<form><p>${esc(note)}Enter <strong>${esc(actor.name)}</strong>'s Wisdom (Survival) total:</p>
<div class="form-group"><label>Total</label><input type="number" name="total" autofocus></div></form>`,
      buttons: {
        ok: { icon: '<i class="fas fa-check"></i>', label: "Use Total" },
        gm: { icon: '<i class="fas fa-dice-d20"></i>', label: "Roll for them" },
        skip: { icon: '<i class="fas fa-forward"></i>', label: "Skip" },
      },
      defaultButton: "ok",
    });
    if (choice.action === "gm") return { total: await rollSurvival(actor), how: "rolled by the DM" };
    if (choice.action !== "ok") return { total: null };
    const total = Number(readForm(choice.html).total);
    if (Number.isFinite(total) && String(readForm(choice.html).total).trim() !== "") return { total: Math.round(total), how: "entered by the DM" };
    ui.notifications.warn("Microbrew: enter a number for the total.");
  }
}

/* -------------------------------------------- */
/*  The Forage tool (DM)                        */
/* -------------------------------------------- */

export async function forage() {
  if (!game.user.isGM) return ui.notifications.warn("Microbrew: only a GM can do that.");
  const actors = [...new Set(canvas.tokens?.controlled.map((t) => t.actor).filter(Boolean) ?? [])];
  if (!actors.length) return ui.notifications.warn("Microbrew: select the token(s) of the characters who are foraging, then try again.");

  const all = await forageableIngredients();
  const biomes = [...new Set(all.map((i) => i.biome))].sort((a, b) => a.localeCompare(b));
  if (!biomes.length) return ui.notifications.warn("Microbrew: no foragable ingredients found. Is the Microbrew compendium available?");

  const saved = { biome: "", step: 5, selection: "weighted", roller: "ask", ...(game.settings.get(MODULE_ID, SETTING_FORAGE) ?? {}) };
  const opt = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${l}</option>`).join("");
  const choice = await buttonDialog({
    title: "Microbrew — Forage",
    content: `<form>
  <p>Foraging: <strong>${actors.map((a) => esc(a.name)).join(", ")}</strong>. Each character makes a Wisdom (Survival) check; the results are whispered to you. Nothing is added to anyone's inventory.</p>
  <div class="form-group"><label>Biome</label><select name="biome">${biomes.map((b) => `<option value="${esc(b)}" ${b === saved.biome ? "selected" : ""}>${esc(b)} (${all.filter((i) => i.biome === b).length})</option>`).join("")}</select></div>
  <div class="form-group"><label>Who rolls</label><select name="roller">${opt(ROLLERS, saved.roller)}</select></div>
  <div class="form-group"><label>What is found</label><select name="selection">${opt(SELECTIONS, saved.selection)}</select></div>
  <div class="form-group"><label>+1 found for every</label><input type="number" name="step" min="0" max="20" value="${esc(saved.step)}"><span style="flex:0 0 auto;margin-left:4px">points over the DC</span></div>
  <p class="hint">Ingredient DCs: common 10, uncommon 13, rare 16, very rare 19. Every ingredient whose DC the total meets can be found. "Weighted toward the best" makes the highest tier reached most likely; set the step to 0 to always find 1.</p>
</form>`,
    buttons: { go: { icon: '<i class="fas fa-leaf"></i>', label: "Forage" }, cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" } },
    defaultButton: "go",
  });
  if (choice.action !== "go") return;
  const d = readForm(choice.html);
  const step = Math.max(0, Math.min(20, Math.floor(Number(d.step) || 0)));
  const settings = { biome: d.biome, step, selection: d.selection in SELECTIONS ? d.selection : "weighted", roller: d.roller in ROLLERS ? d.roller : "ask" };
  await game.settings.set(MODULE_ID, SETTING_FORAGE, settings);
  const pool = all.filter((i) => i.biome === settings.biome);

  const results = [];
  for (const actor of actors) {
    const { total, how } = await totalFor(actor, settings.roller, settings.biome);
    if (total === null || total === undefined) {
      results.push({ actor, skipped: true });
      continue;
    }
    results.push({ actor, total, how, find: chooseFind(pool, total, settings) });
  }
  await postResults(settings, pool, results);
  return results;
}

async function postResults(settings, pool, results) {
  const lines = results.map(({ actor, skipped, total, how, find }) => {
    if (skipped) return `<li><strong>${esc(actor.name)}</strong>: skipped.</li>`;
    if (!find) return `<li><strong>${esc(actor.name)}</strong> (Survival <strong>${total}</strong>, ${esc(how)}): finds nothing useful.</li>`;
    const extra = find.quantity > 1 ? ` (${find.over} over DC ${find.dc})` : "";
    return `<li><strong>${esc(actor.name)}</strong> (Survival <strong>${total}</strong>, ${esc(how)}): finds <strong>${find.quantity}×</strong> @UUID[${find.uuid}]{${esc(find.name)}}, ${TIER_LABEL[find.dc] ?? `DC ${find.dc}`}${extra}. <small>${find.eligible} of ${pool.length} were within reach.</small></li>`;
  }).join("");
  await ChatMessage.create({
    speaker: { alias: "Microbrew: Foraging" },
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
    content: `<h3>🌿 Foraging: ${esc(settings.biome)}</h3>
<ul>${lines}</ul>
<p><em>Only you can see this. Drag an ingredient onto a character sheet to give it, and set the quantity there.</em></p>`,
  });
}
