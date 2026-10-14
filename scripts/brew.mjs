// Brewing: players send a request; the DM fills in the recipe and the Keg is filled.
import {
  SOCKET, DRINK_ACTIVITY_ID, DEFAULT_SERVINGS, TABLE_NAMES, SLOT_LABEL, FLAG_CONTENTS, FLAG_TABLES, FLAG_REQUEST,
} from "./constants.mjs";
import {
  esc, textFor, ingKey, tableRange, dieOf, rollOn, rollWithExtras, resolveTable, buttonDialog, readForm, titleCase, acceptItemDrop,
} from "./util.mjs";
import { kegContents, kegDescription, drinkActivity, skinOf, countOf, isKeg } from "./keg.mjs";

/** Item types that may be used up as ingredients. */
const INGREDIENT_TYPES = ["loot", "consumable"];
import { getRecipes, setRecipes } from "./book.mjs";
import { generateBrewName } from "./names.mjs";

const tierGood = (v) => (v <= 6 ? "Trivial" : v <= 12 ? "Minor" : v <= 18 ? "Moderate" : v <= 24 ? "Strong" : v <= 29 ? "Major" : "Legendary");
const tierBad = (v) => (v === 1 ? "Catastrophic" : v <= 6 ? "Major" : v <= 12 ? "Strong" : v <= 18 ? "Moderate" : v <= 24 ? "Minor" : "Trivial");

/* -------------------------------------------- */
/*  Entry point                                 */
/* -------------------------------------------- */

/** Start a brew in a Keg: GMs get the dialog, players send the DM a request. */
export async function startBrew(keg) {
  if (!keg?.actor) return ui.notifications.warn(`Microbrew: the ${keg?.name ?? "Keg"} must be in a character's inventory to brew.`);
  if (!keg.isOwner) return ui.notifications.warn(`Microbrew: you don't own ${keg.actor.name}'s ${keg.name}.`);
  if (game.user.isGM) return brew(keg);
  return requestBrew(keg);
}

/** Player side: whisper a request card to the GMs and ask the active GM to open the dialog. */
async function requestBrew(keg) {
  const brewer = keg.actor;
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  const msg = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: brewer }),
    whisper: gmIds,
    content: `
<h3>🍺 Brewing Request</h3>
<p><strong>${esc(brewer.name)}</strong> starts a new batch in their ${esc(keg.name)}.</p>
<p style="text-align:center;font-size:1.15em">@Microbrew[request]{Open the brewing dialog}</p>
<p><em>Only the DM can complete the brew.</em></p>`,
    flags: { world: { [FLAG_REQUEST]: { kegUuid: keg.uuid, requestedBy: game.user.id, status: "pending" } } },
  });
  if (game.users.activeGM) {
    game.socket.emit(SOCKET, { action: "brewRequest", messageId: msg.id });
    ui.notifications.info("Microbrew: brewing request sent to the DM.");
  } else {
    ui.notifications.warn("Microbrew: no DM is online right now. The request is saved in chat for later.");
  }
}

/** GM side: open the brewing dialog for a request card (from the socket or a click on the card). */
export async function openRequest(msg) {
  const req = msg?.getFlag("world", FLAG_REQUEST);
  if (!req) return;
  const status = req.status ?? (req.fulfilled ? "brewed" : "pending");
  if (!game.user.isGM) {
    return ui.notifications.info(status === "denied" ? "Microbrew: the DM denied that request."
      : status === "brewed" ? "Microbrew: that request has already been brewed." : "Microbrew: your request is with the DM.");
  }
  if (status === "brewed") return ui.notifications.warn("Microbrew: that request was already brewed. Use the Keg's Brew activity to brew again.");
  if (status === "denied") return ui.notifications.warn("Microbrew: that request was denied. The player can send a new one.");
  const keg = await fromUuid(req.kegUuid);
  if (!keg) return ui.notifications.warn("Microbrew: that Keg no longer exists.");
  return brew(keg, { request: { msg, req } });
}

/* -------------------------------------------- */
/*  The brewing dialog (GM)                     */
/* -------------------------------------------- */

const open = new Set(); // keg uuids with a dialog already open

export async function brew(keg, { request = null } = {}) {
  if (!game.user.isGM) return startBrew(keg);
  if (open.has(keg.uuid)) return ui.notifications.info("Microbrew: that Keg's brewing dialog is already open.");
  open.add(keg.uuid);
  try {
    return await _brew(keg, request);
  } finally {
    open.delete(keg.uuid);
  }
}

async function _brew(keg, request) {
  const brewer = keg.actor;
  const skin = skinOf(keg);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---- This Keg's tables ----
  const chosen = keg.getFlag("world", FLAG_TABLES) ?? {};
  const tables = {}, RANGE = {};
  for (const key of Object.keys(TABLE_NAMES)) {
    tables[key] = await resolveTable(chosen[key], chosen[key] ? null : key);
    if (!tables[key]) {
      return ui.notifications.error(`Microbrew: this Keg's ${SLOT_LABEL[key]} table ${chosen[key] ? "no longer exists" : "can't be found"}. Select ${brewer.name}'s token and use "Give a Keg" to choose its tables.`);
    }
    RANGE[key] = tableRange(tables[key]);
    if (!RANGE[key]) return ui.notifications.error(`Microbrew: the table "${tables[key].name}" has no results.`);
  }
  const isDefault = (key) => tables[key].name === TABLE_NAMES[key];
  const allDefault = Object.keys(TABLE_NAMES).every(isDefault);

  // ---- Recipe lookup: hand-made (any Keg) first, then this table set, then old-style ----
  const recipes = getRecipes();
  const setKey = [tables.good.id, tables.bad.id, tables.cosmetic.id].join("-");
  const recipeKey = (ings) => `${setKey}__${ingKey(ings)}`;
  const anyKey = (ings) => `any__${ingKey(ings)}`;
  const findRecipe = (ings) => {
    for (const k of [anyKey(ings), recipeKey(ings), ...(allDefault ? [ingKey(ings)] : [])]) {
      if (recipes[k]) return { key: k, rec: recipes[k] };
    }
    return null;
  };
  const describeSlot = (sl) => (!sl || sl.none ? "none" : sl.text != null ? "custom" : `${sl.roll}${sl.extra?.length ? ` (+${sl.extra.join(", ")})` : ""}`);
  const describeRecipe = (r) => `Good ${describeSlot(r.good)}, Bad ${describeSlot(r.bad)}, Cosmetic ${describeSlot(r.cosmetic)}`;

  // ---- Dialog ----
  const current = kegContents(keg);
  const warning = current?.servings > 0
    ? `<p class="notification warning" style="margin:0 0 6px">The ${esc(skin.container)} still holds <strong>${countOf(current.servings, skin)}</strong> of <em>${esc(current.name)}</em>. Brewing pours it out.</p>`
    : "";
  const inventory = brewer.items.filter((i) => i.id !== keg.id).map((i) => `<option value="${esc(i.name)}"></option>`).join("");
  const val = (v) => (v === undefined || v === null ? "" : esc(v));
  const content = (prev, error) => `
<form class="microbrew">
  ${error ? `<p class="notification error" style="margin:0 0 6px">${esc(error)}</p>` : ""}
  ${warning}
  <p>Name three <strong>different</strong> ingredients: type, pick from ${esc(brewer.name)}'s inventory, or drag an item onto the field. Leave a roll blank to roll it randomly.</p>
  <p class="hint">Tables: ${Object.keys(SLOT_LABEL).map((k) => `${SLOT_LABEL[k]}: <em>${esc(tables[k].name)}</em>`).join(" · ")}</p>
  <datalist id="microbrew-inv">${inventory}</datalist>
  ${[1, 2, 3].map((n) => `<div class="form-group"><label>Ingredient ${n}</label><input type="text" name="ing${n}" list="microbrew-inv" value="${val(prev[`ing${n}`])}" placeholder="type, pick, or drop an item" ${n === 1 ? "autofocus" : ""}></div>`).join("")}
  <div class="form-group"><label>Consume ingredients</label><input type="checkbox" name="consume" ${prev.consume === undefined || prev.consume ? "checked" : ""}>
    <p class="hint">Removes one of each ingredient from inventory if a loot or consumable item with that name exists. Weapons, armor, equipped items and other gear are never touched.</p></div>
  <div class="form-group"><label>Brew name</label><input type="text" name="brewName" placeholder="(automatic)" value="${val(prev.brewName)}"></div>
  <div class="form-group"><label>${esc(cap(skin.portions))}</label><input type="number" name="servings" min="1" max="20" value="${val(prev.servings ?? DEFAULT_SERVINGS)}"></div>
  <hr>
  <p class="microbrew-recipe" style="margin:4px 0;padding:4px 6px;border:1px dashed var(--color-border-light-tertiary, #999);border-radius:4px">📖 Type the ingredients to check the Recipe Book.</p>
  <div class="form-group"><label>Overwrite known recipe</label><input type="checkbox" name="overwrite" ${prev.overwrite ? "checked" : ""}>
    <p class="hint">A known combination reuses its recorded results and ignores the rolls below. Tick this to roll (or set) new results and record them instead.</p></div>
  ${Object.keys(SLOT_LABEL).map((k) => `<div class="form-group"><label>${SLOT_LABEL[k]} roll (${RANGE[k].min}–${RANGE[k].max})</label><input type="number" name="${k}" min="${RANGE[k].min}" max="${RANGE[k].max}" placeholder="roll" value="${val(prev[k])}"></div>`).join("\n  ")}
</form>`;
  const onRender = (html) => {
    const root = html[0] ?? html;
    const inputs = ["ing1", "ing2", "ing3"].map((n) => root.querySelector?.(`input[name="${n}"]`));
    // Dropping an item fills in its name; the inventory list (datalist) still works as before.
    inputs.forEach(acceptItemDrop);
    const status = root.querySelector?.(".microbrew-recipe");
    if (!status) return;
    const refresh = () => {
      const ings = inputs.map((i) => (i?.value ?? "").trim());
      if (ings.some((x) => !x)) return (status.innerHTML = "📖 Type the ingredients to check the Recipe Book.");
      const r = findRecipe(ings)?.rec;
      status.innerHTML = r
        ? `📖 <strong>Known recipe:</strong> ${esc(r.name)} (${describeRecipe(r)}), brewed ${r.timesBrewed ?? 0}×. These results will be reused.`
        : "📖 <strong>New combination.</strong> Its results will be recorded in the Recipe Book.";
    };
    inputs.forEach((i) => i?.addEventListener("input", refresh));
    refresh();
  };
  const validate = (d) => {
    const ings = [d.ing1, d.ing2, d.ing3].map((x) => (x ?? "").trim());
    if (ings.some((x) => !x)) return "All three ingredients need a name.";
    if (new Set(ings.map((x) => x.toLowerCase())).size < 3) return "The three ingredients must be different.";
    const sv = Number(String(d.servings ?? "").trim() || DEFAULT_SERVINGS);
    if (!Number.isInteger(sv) || sv < 1 || sv > 20) return `${cap(skin.portions)} must be a whole number from 1 to 20.`;
    for (const key of Object.keys(RANGE)) {
      const raw = String(d[key] ?? "").trim();
      if (!raw) continue;
      const n = Number(raw);
      const { min, max } = RANGE[key];
      if (!Number.isInteger(n) || n < min || n > max) return `The ${SLOT_LABEL[key]} roll must be a whole number from ${min} to ${max}.`;
    }
    return null;
  };

  const buttons = { brew: { icon: '<i class="fas fa-beer-mug-empty"></i>', label: "Brew!" } };
  if (request) {
    buttons.deny = { icon: '<i class="fas fa-ban"></i>', label: "Deny Request" };
    buttons.later = { icon: '<i class="fas fa-clock"></i>', label: "Decide Later" };
  } else {
    buttons.later = { icon: '<i class="fas fa-times"></i>', label: "Cancel" };
  }

  let data = null, error = null, prev = {};
  while (true) {
    const choice = await buttonDialog({ title: `${keg.name} — ${brewer.name}`, content: content(prev, error), buttons, defaultButton: "brew", render: onRender });
    if (choice.action === "later" || choice.action === "close") return null;
    if (choice.action === "deny") {
      await request.msg.update({
        [`flags.world.${FLAG_REQUEST}.status`]: "denied",
        content: `<h3>🍺 Brewing Request</h3><p><strong>${esc(brewer.name)}</strong>'s brewing request was <strong>denied</strong> by the DM.</p>`,
      });
      ui.notifications.info(`Microbrew: ${brewer.name}'s request denied.`);
      return null;
    }
    prev = readForm(choice.html);
    error = validate(prev);
    if (!error) { data = prev; break; }
  }

  // ---- Work out the results ----
  const ingredients = [data.ing1, data.ing2, data.ing3].map((s) => (s ?? "").trim());
  const servings = Number(String(data.servings ?? "").trim() || DEFAULT_SERVINGS);
  const manual = {};
  for (const key of Object.keys(RANGE)) {
    const raw = String(data[key] ?? "").trim();
    if (raw) manual[key] = Number(raw);
  }
  const rKey = recipeKey(ingredients);
  const found = findRecipe(ingredients);
  const known = found?.rec;
  const reuse = !!known && !data.overwrite;
  const saveKey = reuse && found.key.startsWith("any__") ? found.key : rKey;
  const dropKey = found && found.key !== saveKey ? found.key : null;

  async function pick(key) {
    const table = tables[key];
    if (reuse) {
      const rec = known[key];
      if (!rec || rec.none) return { roll: null, method: "recipe", text: "No effect.", extra: [], none: true };
      if (rec.text != null) return { roll: null, method: "recipe", text: rec.text, extra: [], custom: true };
      const t = (rec.table && (await resolveTable(rec.table))) || table;
      return {
        roll: rec.roll, method: "recipe", text: textFor(t, rec.roll), fromTable: t,
        extra: (rec.extra ?? []).map((v) => ({ roll: v, text: textFor(t, v) })),
      };
    }
    const value = manual[key] ?? (await rollOn(table));
    const extra = await rollWithExtras(table, value);
    return {
      roll: value, method: manual[key] === undefined ? "rolled" : "set", text: textFor(table, value),
      extra: extra.map((v) => ({ roll: v, text: textFor(table, v) })),
    };
  }
  const good = await pick("good"), bad = await pick("bad"), cosmetic = await pick("cosmetic");
  for (const [key, p] of Object.entries({ good, bad, cosmetic })) {
    const t = p.fromTable ?? tables[key];
    delete p.fromTable; // never store a document in flags
    const dflt = t.name === TABLE_NAMES[key] && p.roll != null;
    p.tier = dflt && key === "good" ? tierGood(p.roll) : dflt && key === "bad" ? tierBad(p.roll) : null;
    p.label = p.none ? "no effect" : p.custom ? "custom" : `${dieOf(t)}: ${p.roll}${p.tier ? `, ${p.tier}` : ""}`;
    p.table = p.none || p.custom ? null : t.name;
  }

  // ---- Consume ingredients ----
  const consumed = [];
  if (data.consume) {
    for (const name of ingredients) {
      // Only plain goods (loot / consumables) are ever used up: never weapons, armor, features,
      // spells, equipped items or another Keg, even if their names happen to match.
      const it = brewer.items.find((i) => i.id !== keg.id && !isKeg(i) && INGREDIENT_TYPES.includes(i.type)
        && !i.system?.equipped && i.name.toLowerCase() === name.toLowerCase());
      if (!it) continue;
      const qty = Number(it.system?.quantity ?? 1);
      if (qty > 1) await it.update({ "system.quantity": qty - 1 });
      else await it.delete();
      consumed.push(it.name);
    }
  }

  // ---- Fill the Keg ----
  let brewName = (data.brewName ?? "").trim() || (reuse ? known.name : "");
  if (!brewName) {
    try {
      brewName = await generateBrewName({ ingredients, good, bad, tables: { good: tables.good, bad: tables.bad }, style: skin.nameStyle });
    } catch (e) {
      console.warn("Microbrew | couldn't generate a brew name", e);
    }
  }
  brewName ||= `${ingredients.map(titleCase).join(", ")} ${titleCase(skin.product)}`;
  const contents = { name: brewName, brewer: brewer.name, ingredients, servings, maxServings: servings, good, bad, cosmetic, brewedAt: Date.now() };
  const update = {
    [`flags.world.${FLAG_CONTENTS}`]: contents,
    "system.description.value": kegDescription(contents, skin),
    [`system.activities.${DRINK_ACTIVITY_ID}`]: drinkActivity(servings, brewName, skin),
  };
  await keg.update(update);

  // ---- Record the recipe ----
  const now = Date.now();
  const tableRefs = { good: tables.good.uuid, bad: tables.bad.uuid, cosmetic: tables.cosmetic.uuid };
  const record = reuse
    ? {
        ...known, ...(saveKey.startsWith("any__") ? {} : { tables: tableRefs }), name: known.name,
        firstBrewer: known.firstBrewer ?? brewer.name, timesBrewed: (known.timesBrewed ?? 0) + 1, lastBrewed: now, lastBrewer: brewer.name,
      }
    : {
        ingredients, name: brewName, tables: tableRefs,
        good: { roll: good.roll, extra: good.extra.map((e) => e.roll) },
        bad: { roll: bad.roll, extra: bad.extra.map((e) => e.roll) },
        cosmetic: { roll: cosmetic.roll, extra: cosmetic.extra.map((e) => e.roll) },
        firstBrewer: known?.firstBrewer ?? brewer.name, created: known?.created ?? now,
        timesBrewed: (known?.timesBrewed ?? 0) + 1, lastBrewed: now, lastBrewer: brewer.name,
      };
  recipes[saveKey] = record;
  if (dropKey) delete recipes[dropKey];
  await setRecipes(recipes);

  // ---- Close out the request card ----
  if (request) {
    await request.msg.update({
      [`flags.world.${FLAG_REQUEST}.status`]: "brewed",
      content: `<h3>🍺 Brewing Request</h3><p><strong>${esc(brewer.name)}</strong>'s batch is done: <em>${esc(brewName)}</em> (${countOf(servings, skin)}).</p>`,
    });
  }

  // ---- Announce ----
  const how = (p) => (p.roll != null ? `${p.method} ${p.roll}` : p.method);
  const joined = (p) => (p.extra.length ? p.extra.map((e) => e.text).join(" <em>and</em> ") : p.text);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: brewer }),
    content: `
<h3>🍺 ${esc(brewName)}</h3>
<p>${esc(brewer.name)} ${esc(skin.brewVerb)} ${esc(ingredients.join(", "))} into a fresh ${esc(skin.container)}: <strong>${countOf(servings, skin)}</strong> ready.</p>
${reuse ? `<p><em>📖 A familiar recipe: it comes out just like last time.</em></p>` : ""}
${current?.servings > 0 ? `<p><em>The last ${countOf(current.servings, skin)} of ${esc(current.name)} ${current.servings === 1 ? "was" : "were"} poured out.</em></p>` : ""}
<p><strong>Good</strong> (${how(good)}): ${joined(good)}</p>
<p><strong>Bad</strong> (${how(bad)}): ${joined(bad)}</p>
<p><strong>Cosmetic</strong> (${how(cosmetic)}): ${joined(cosmetic)}</p>
${consumed.length ? `<p><em>Used up: ${esc(consumed.join(", "))}.</em></p>` : ""}`,
  });
  return contents;
}
